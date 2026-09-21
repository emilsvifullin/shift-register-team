import test from "node:test";
import assert from "node:assert/strict";

import {
  createWheelGesture
} from "../src/wheel-gesture.js";

/*
  Потоки здесь воспроизводят то, что присылает трекпад macOS, а не ровную
  последовательность одинаковых событий: дробные шаги, разгон и затухание
  внутри самого свайпа, вертикальный шум вперемешку с горизонтальным
  движением и хвост инерции после отрыва пальцев.
*/

function trackpadSwipe({
  direction=1,
  peak=9,
  steps=18,
  start=0,
  noise=1.4,
  momentum=26
}={}){
  const events=[];
  let now=start;
  let seed=7;

  /* Шум у трекпада знакопеременный, но не случайный от прогона к прогону. */
  const jitter=()=>{
    seed=(seed*1103515245+12345)%2147483648;

    return (
      (seed/2147483648)*2-1
    )*noise;
  };

  for(let index=0;index<steps;index+=1){
    const shape=
      Math.sin(
        ((index+1)/(steps+1))*Math.PI
      );

    events.push({
      deltaX:direction*peak*shape,
      deltaY:jitter(),
      now
    });

    now+=16;
  }

  /* Инерция: только затухание, шаг за шагом. */
  let tail=peak*0.55;

  for(let index=0;index<momentum;index+=1){
    events.push({
      deltaX:direction*tail,
      deltaY:jitter()*0.3,
      now
    });

    tail*=0.82;
    now+=16+index;
  }

  return {
    events,
    endsAt:now
  };
}

function verticalScroll({
  steps=20,
  start=0,
  peak=12
}={}){
  const events=[];
  let now=start;

  for(let index=0;index<steps;index+=1){
    events.push({
      deltaX:index%3===0
        ? 0.8
        : -0.6,
      deltaY:peak,
      now
    });

    now+=16;
  }

  return {events,endsAt:now};
}

function run(gesture,events){
  const fired=[];
  let claimed=0;

  for(const event of events){
    const result=gesture.push(event);

    if(result.claim){
      claimed+=1;
    }

    if(result.direction){
      fired.push(result.direction);
    }
  }

  return {fired,claimed};
}

test(
  "one trackpad swipe switches exactly once",
  ()=>{
    const gesture=createWheelGesture();
    const {events}=trackpadSwipe({direction:1});

    const {fired}=run(gesture,events);

    assert.deepEqual(fired,[1]);
  }
);

test(
  "the direction comes from the whole gesture, not from a single step",
  ()=>{
    const gesture=createWheelGesture();

    const {events}=trackpadSwipe({direction:-1});

    /*
      Начало и конец настоящего свайпа почти всегда содержат крошечный шаг
      в обратную сторону. Направление жеста от этого не меняется.
    */
    events.unshift({deltaX:0.4,deltaY:0.2,now:-16});
    events.push({deltaX:0.5,deltaY:0.1,now:events.at(-1).now+16});

    const {fired}=run(gesture,events);

    assert.deepEqual(fired,[-1]);
  }
);

test(
  "vertical steps inside a horizontal swipe do not break it apart",
  ()=>{
    const gesture=createWheelGesture();
    const {events}=trackpadSwipe({direction:1,noise:5});

    /*
      Шум выше горизонтального шага на отдельных кадрах — ровно тот
      случай, на котором пошаговый разбор терял накопленный путь.
    */
    const dominated=events.filter(event=>
      Math.abs(event.deltaY)>=Math.abs(event.deltaX)
    ).length;

    assert.ok(
      dominated>0,
      "поток должен содержать шаги с перевесом по вертикали"
    );

    const {fired}=run(gesture,events);

    assert.deepEqual(fired,[1]);
  }
);

test(
  "a second swipe started during the momentum tail still switches",
  ()=>{
    const gesture=createWheelGesture();

    const first=trackpadSwipe({direction:1});

    /*
      Пальцы снова легли на трекпад — macOS обрывает инерцию и шлёт уже
      новый жест. Хвост поэтому не смешивается со вторым свайпом, а
      заканчивается на нём.
    */
    const cut=first.events.slice(0,-12);

    const second=trackpadSwipe({
      direction:1,
      start:cut.at(-1).now+24
    });

    const {fired}=run(
      gesture,
      [...cut,...second.events]
    );

    assert.deepEqual(fired,[1,1]);
  }
);

test(
  "the momentum tail alone never switches twice",
  ()=>{
    const gesture=createWheelGesture();

    const {events}=trackpadSwipe({
      direction:1,
      momentum:60
    });

    const {fired}=run(gesture,events);

    assert.deepEqual(fired,[1]);
  }
);

test(
  "vertical scrolling is left to the page",
  ()=>{
    const gesture=createWheelGesture();
    const {events}=verticalScroll({});

    const {fired,claimed}=run(gesture,events);

    assert.deepEqual(fired,[]);
    assert.equal(
      claimed,
      0,
      "прокрутку страницы приложение не удерживает"
    );
  }
);

test(
  "a horizontal gesture is claimed from its first steps",
  ()=>{
    const gesture=createWheelGesture();
    const {events}=trackpadSwipe({direction:1});

    const early=events
      .slice(0,4)
      .map(event=>gesture.push(event).claim);

    assert.ok(
      early.includes(true),
      "иначе горизонтальный жест успеет забрать браузер"
    );
  }
);

test(
  "a paused screen starts the next gesture from scratch",
  ()=>{
    const gesture=createWheelGesture();
    const first=trackpadSwipe({direction:1,momentum:0});

    run(gesture,first.events);

    const second=trackpadSwipe({
      direction:-1,
      start:first.endsAt+500
    });

    const {fired}=run(gesture,second.events);

    assert.deepEqual(fired,[-1]);
  }
);

test(
  "a gesture cancelled by the app does not leak into the next one",
  ()=>{
    const gesture=createWheelGesture();
    const {events}=trackpadSwipe({direction:1,momentum:0});

    run(gesture,events.slice(0,6));
    gesture.cancel();

    const next=trackpadSwipe({
      direction:1,
      start:events.at(-1).now+20
    });

    const {fired}=run(gesture,next.events);

    assert.deepEqual(fired,[1]);
  }
);

/*
  Пороги настраиваются: сетка дней календаря листается чуть меньшим путём.
*/
test(
  "thresholds are configurable",
  ()=>{
    const gesture=createWheelGesture({distance:20});
    const {events}=trackpadSwipe({
      direction:1,
      peak:3,
      steps:12,
      momentum:0
    });

    const {fired}=run(gesture,events);

    assert.deepEqual(fired,[1]);
  }
);
