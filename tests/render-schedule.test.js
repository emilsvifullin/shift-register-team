import test from "node:test";
import assert from "node:assert/strict";

import {
  createDeferredRender,
  whenAnimationsSettle
} from "../src/render/schedule.js";

function fakeWindow(){
  const frames=[];
  const timers=new Map();

  let nextTimer=1;
  let clock=0;

  return {
    requestAnimationFrame(callback){
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame(handle){
      frames[handle-1]=null;
    },
    setTimeout(callback,delay){
      const id=nextTimer++;
      timers.set(id,{callback,at:clock+delay});
      return id;
    },
    clearTimeout(id){
      timers.delete(id);
    },
    now(){
      return clock;
    },
    advance(ms){
      clock+=ms;
    },
    runFrame(){
      const pending=frames.splice(0,frames.length);

      pending.forEach(callback=>callback?.());

      return pending.filter(Boolean).length;
    },
    pendingFrames(){
      return frames.filter(Boolean).length;
    },
    runDueTimers(){
      for(const [id,timer] of [...timers]){
        if(timer.at<=clock){
          timers.delete(id);
          timer.callback();
        }
      }
    },
    pendingTimers(){
      return timers.size;
    }
  };
}

test(
  "a render outside a transition happens immediately",
  ()=>{
    const windowRef=fakeWindow();

    let rendered=0;

    const schedule=createDeferredRender({
      shouldDefer:()=>false,
      render:()=>{rendered++;},
      windowRef,
      now:windowRef.now
    });

    schedule();
    schedule();

    assert.equal(rendered,2);
    assert.equal(windowRef.pendingFrames(),0);
  }
);

test(
  "renders during a transition collapse into one deferred render",
  ()=>{
    const windowRef=fakeWindow();

    let running=true;
    let rendered=0;

    const schedule=createDeferredRender({
      shouldDefer:()=>running,
      render:()=>{rendered++;},
      windowRef,
      now:windowRef.now
    });

    schedule();
    schedule();
    schedule();

    assert.equal(rendered,0);
    assert.equal(windowRef.pendingFrames(),1);

    windowRef.runFrame();
    assert.equal(rendered,0);

    running=false;
    windowRef.runFrame();

    assert.equal(rendered,1);
    assert.equal(windowRef.pendingFrames(),0);
  }
);

/*
  На iOS анимация, попавшая в фон, может не завершиться никогда.
  Свежие данные всё равно обязаны попасть на экран.
*/
test(
  "a transition that never ends still releases the render",
  ()=>{
    const windowRef=fakeWindow();

    let rendered=0;

    const schedule=createDeferredRender({
      shouldDefer:()=>true,
      render:()=>{rendered++;},
      windowRef,
      maxDeferral:900,
      now:windowRef.now
    });

    schedule();

    for(let step=0;step<10;step++){
      windowRef.advance(100);
      windowRef.runFrame();
    }

    assert.equal(rendered,1);
  }
);

test(
  "an immediate render cancels a pending deferred one",
  ()=>{
    const windowRef=fakeWindow();

    let running=true;
    let rendered=0;

    const schedule=createDeferredRender({
      shouldDefer:()=>running,
      render:()=>{rendered++;},
      windowRef,
      now:windowRef.now
    });

    schedule();
    running=false;
    schedule();

    assert.equal(rendered,1);

    windowRef.runFrame();
    assert.equal(rendered,1);
  }
);

test(
  "settled animations clean up exactly once",
  async()=>{
    const windowRef=fakeWindow();

    let cleaned=0;

    whenAnimationsSettle(
      [
        {finished:Promise.resolve()},
        {finished:Promise.reject(new Error("cancelled"))}
      ],
      ()=>{cleaned++;},
      {windowRef}
    );

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(cleaned,1);
    assert.equal(windowRef.pendingTimers(),0);

    windowRef.advance(5000);
    windowRef.runDueTimers();

    assert.equal(cleaned,1);
  }
);

/*
  Флаг перехода снимается по таймауту, иначе застрявшая анимация
  навсегда блокирует вкладки, месяцы и разделы управления.
*/
test(
  "an animation that never settles is cleaned up by the timeout",
  ()=>{
    const windowRef=fakeWindow();

    let cleaned=0;

    whenAnimationsSettle(
      [{finished:new Promise(()=>{})}],
      ()=>{cleaned++;},
      {
        windowRef,
        timeout:1200
      }
    );

    assert.equal(cleaned,0);

    windowRef.advance(1200);
    windowRef.runDueTimers();

    assert.equal(cleaned,1);
  }
);
