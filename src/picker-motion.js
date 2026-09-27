/*
  Движение выбиралок: месяца, года и календаря.

  Перелистывание месяца и года — не мгновенная подмена разметки, а
  переход: старое содержимое остаётся слепком и уезжает, новое приезжает
  ему на смену. Слепок снимается с живого узла вместе с его геометрией,
  иначе он «подпрыгивает» относительно того, что заменяет.

  Здесь только само движение. Ни состояния приложения, ни знания о том,
  какой месяц выбран, этот модуль не имеет: ему дают узлы и направление.
*/

import {
  whenAnimationsSettle
} from "./render/schedule.js";

import {
  prefersReducedMotion
} from "./reduced-motion.js";

function makeDateCalendarGhost(
  element,
  picker
){
  const rect=
    element.getBoundingClientRect();

  const pickerRect=
    picker.getBoundingClientRect();

  const ghost=
    element.cloneNode(true);

  ghost.removeAttribute("id");
  ghost.setAttribute(
    "aria-hidden",
    "true"
  );
  ghost.setAttribute(
    "inert",
    ""
  );

  ghost.style.position="absolute";

  ghost.style.left=
    rect.left-pickerRect.left+"px";

  ghost.style.top=
    rect.top-pickerRect.top+"px";

  ghost.style.width=
    rect.width+"px";

  ghost.style.height=
    rect.height+"px";

  ghost.style.margin="0";
  ghost.style.zIndex="5";
  ghost.style.pointerEvents="none";

  picker.appendChild(ghost);

  return ghost;
}

function makeMonthTransitionGhost(
  element,
  zIndex
){
  const rect=
    element.getBoundingClientRect();

  const ghost=
    element.cloneNode(true);

  ghost.removeAttribute(
    "id"
  );

  ghost
    .querySelectorAll("[id]")
    .forEach(node=>{
      node.removeAttribute(
        "id"
      );
    });

  ghost.setAttribute(
    "aria-hidden",
    "true"
  );

  ghost.setAttribute(
    "inert",
    ""
  );

  ghost.style.position=
    "fixed";

  ghost.style.left=
    rect.left+"px";

  ghost.style.top=
    rect.top+"px";

  ghost.style.width=
    rect.width+"px";

  ghost.style.height=
    rect.height+"px";

  ghost.style.margin=
    "0";

  ghost.style.zIndex=
    String(zIndex);

  ghost.style.pointerEvents=
    "none";

  ghost.style.willChange=
    "transform, opacity";

  ghost.style.setProperty(
    "view-transition-name",
    "none"
  );

  document.body.appendChild(
    ghost
  );

  if(
    element instanceof HTMLElement &&
    ghost instanceof HTMLElement
  ){
    ghost.scrollTop=
      element.scrollTop;

    ghost.scrollLeft=
      element.scrollLeft;

    const sourceShiftScroll=
      element.querySelector(
        ".shift-scroll"
      );

    const ghostShiftScroll=
      ghost.querySelector(
        ".shift-scroll"
      );

    if(
      sourceShiftScroll instanceof HTMLElement &&
      ghostShiftScroll instanceof HTMLElement
    ){
      ghostShiftScroll.scrollTop=
        sourceShiftScroll.scrollTop;

      ghostShiftScroll.scrollLeft=
        sourceShiftScroll.scrollLeft;
    }
  }

  return ghost;
}

function animatePickerYearChange({
  container,
  grid,
  label,
  direction,
  apply,
  onFinish
}){
  const finish=()=>{
    if(onFinish){
      onFinish();
    }
  };

  if(
    prefersReducedMotion() ||
    typeof grid.animate!=="function"
  ){
    apply();
    finish();
    return;
  }

  let oldGrid=null;
  let oldLabel=null;
  let animations=[];
  let applied=false;

  try{
    oldGrid=
      makeDateCalendarGhost(
        grid,
        container
      );

    oldLabel=
      makeDateCalendarGhost(
        label,
        container
      );

    apply();
    applied=true;

    grid.style.pointerEvents="none";

    const oldGridX=
      direction>0
        ? -28
        : 28;

    const newGridX=
      -oldGridX;

    const oldLabelX=
      direction>0
        ? -10
        : 10;

    const newLabelX=
      -oldLabelX;

    const options={
      duration:320,
      easing:
        "cubic-bezier(.22,.72,.22,1)",
      fill:"both"
    };

    animations=[
      oldGrid.animate(
        [
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          },
          {
            opacity:0,
            transform:
              `translate3d(${oldGridX}px,0,0)`
          }
        ],
        options
      ),

      grid.animate(
        [
          {
            opacity:0,
            transform:
              `translate3d(${newGridX}px,0,0)`
          },
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          }
        ],
        options
      ),

      oldLabel.animate(
        [
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          },
          {
            opacity:0,
            transform:
              `translate3d(${oldLabelX}px,0,0)`
          }
        ],
        options
      ),

      label.animate(
        [
          {
            opacity:0,
            transform:
              `translate3d(${newLabelX}px,0,0)`
          },
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          }
        ],
        options
      )
    ];

    whenAnimationsSettle(
      animations,
      ()=>{
        animations.forEach(
          animation=>animation.cancel()
        );

        oldGrid?.remove();
        oldLabel?.remove();

        grid.style.removeProperty(
          "pointer-events"
        );

        finish();
      }
    );
  }catch{
    animations.forEach(
      animation=>animation.cancel()
    );

    oldGrid?.remove();
    oldLabel?.remove();

    grid.style.removeProperty(
      "pointer-events"
    );

    if(!applied){
      apply();
    }

    finish();
  }
}

export {
  animatePickerYearChange,
  makeDateCalendarGhost,
  makeMonthTransitionGhost
};
