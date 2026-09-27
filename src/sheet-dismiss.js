import {
  prefersReducedMotion
} from "./reduced-motion.js";

/*
  Закрытие нижних поверхностей жестом.

  Лист, выбор ПВЗ, календарь и выбор месяца закрываются одинаково:
  потянули вниз за ручку или заголовок — поверхность уезжает следом за
  пальцем, отпустили за порогом — закрывается, не дотянули — возвращается
  на место. Колесо мыши на десктопе ведёт себя так же.

  Правила здесь одни на все поверхности, и жили они внутри app.js — шесть
  с половиной сотен строк среди совсем других забот. Наружу модуль
  выставляет ровно то, чем им пользуются: сам привязчик и поиск
  касания по идентификатору.

  Привязчик ничего не знает о приложении: ему дают поверхность, свойство
  для сдвига и то, что делать при закрытии.
*/


/*
  Касание по идентификатору: в списке TouchList нет поиска, а палец нужен
  именно тот, которым начали.
*/
function findTouch(list,id){
  for(let i=0;i<list.length;i++){
    const touch=list[i];

    if(touch.identifier===id){
      return touch;
    }
  }

  return null;
}

function bindBottomSheetDismiss({
  element,
  dragProperty,
  close,
  canStart=()=>true,
  onBegin=()=>{}
}){
  let gesture=null;
  let dragFrame=0;
  let pendingDistance=0;
  let snapTimer=0;
  let suppressClickUntil=0;
  let wheelTimer=0;
  let wheelSequence=null;

  const blockedTarget=target=>
    target instanceof Element &&
    Boolean(
      target.closest(
        'input,textarea,select,[contenteditable="true"]'
      )
    );

  const dismissSurface=target=>
    target instanceof Element &&
    Boolean(
      target.closest(
        ".grab,.shead,.point-picker-handle,.month-picker-handle,.date-picker-handle,.picker-toolbar"
      )
    );

  const queueDistance=distance=>{
    pendingDistance=distance;

    if(dragFrame){
      return;
    }

    dragFrame=requestAnimationFrame(()=>{
      dragFrame=0;

      element.style.setProperty(
        dragProperty,
        pendingDistance+"px"
      );
    });
  };

  const flushDistance=()=>{
    if(!dragFrame){
      return;
    }

    cancelAnimationFrame(dragFrame);
    dragFrame=0;

    element.style.setProperty(
      dragProperty,
      pendingDistance+"px"
    );
  };

  const beginDrag=()=>{
    clearTimeout(snapTimer);

    onBegin();

    element.style.transition="none";
  };

  /*
    Возврат на место — короткая поправка: столько же занимает возврат в
    остальных жестах приложения (src/swipe-close-guard.js,
    src/month-picker-swipe.js). Роспуск окна идёт своим, длинным ходом.
  */
  const snapBack=()=>{
    element.style.transition=
      "transform .26s cubic-bezier(.4,0,.2,1)";

    requestAnimationFrame(()=>{
      element.style.setProperty(
        dragProperty,
        "0px"
      );
    });

    snapTimer=setTimeout(()=>{
      if(
        element.classList.contains("on")
      ){
        element.style.removeProperty(
          "transition"
        );

        element.style.removeProperty(
          dragProperty
        );
      }
    },284);
  };

  const resetInteraction=()=>{
    clearTimeout(snapTimer);
    clearTimeout(wheelTimer);

    snapTimer=0;
    wheelTimer=0;
    wheelSequence=null;
    gesture=null;

    if(dragFrame){
      cancelAnimationFrame(
        dragFrame
      );

      dragFrame=0;
    }

    pendingDistance=0;

    element.style.removeProperty(
      dragProperty
    );
  };

  element.addEventListener(
    "bottomsheetopen",
    resetInteraction
  );

  const animateClose=distance=>{
    const endDistance=
      element.getBoundingClientRect()
        .height+40;

    if(
      prefersReducedMotion() ||
      typeof element.animate!=="function"
    ){
      element.style.removeProperty(
        "transition"
      );

      close();
      return;
    }

    element.style.removeProperty(
      "transition"
    );

    const animation=
      element.animate(
        [
          {
            transform:
              `translate3d(0,${distance}px,0)`
          },
          {
            transform:
              `translate3d(0,${endDistance}px,0)`
          }
        ],
        {
          duration:420,
          easing:
            "cubic-bezier(.4,0,.2,1)",
          fill:"both"
        }
      );

    close();

    animation.finished
      .catch(()=>{})
      .finally(()=>{
        animation.cancel();
      });
  };

  const finishDrag=({
    allowClose=true
  }={})=>{
    if(
      !gesture ||
      gesture.axis!=="y"
    ){
      gesture=null;
      return;
    }

    flushDistance();

    const distance=
      gesture.distance;

    const duration=Math.max(
      1,
      performance.now()-
        gesture.started
    );

    const fastSwipe=
      distance>=22 &&
      distance/duration>=0.32;

    const shouldClose=
      allowClose &&
      (
        distance>=56 ||
        fastSwipe
      );

    gesture=null;

    suppressClickUntil=
      performance.now()+650;

    if(shouldClose){
      animateClose(distance);
      return;
    }

    snapBack();
  };

  const lockAxis=(
    dx,
    dy
  )=>{
    if(!gesture){
      return false;
    }

    const absX=Math.abs(dx);
    const absY=Math.abs(dy);

    if(gesture.axis!==null){
      return gesture.axis==="y";
    }

    if(
      absX<8 &&
      absY<8
    ){
      return false;
    }

    if(
      absX>=10 &&
      absX>absY*1.10
    ){
      gesture.axis="x";
      return false;
    }

    if(
      dy<0 &&
      absY>=10 &&
      absY>absX*1.10
    ){
      gesture.axis="scroll";
      return false;
    }

    if(
      dy>0 &&
      absY>=10 &&
      absY>absX*1.08
    ){
      if(!canStart(gesture.target)){
        gesture.axis="scroll";
        return false;
      }

      gesture.axis="y";
      beginDrag();
      return true;
    }

    return false;
  };

  element.addEventListener(
    "touchstart",
    event=>{
      if(
        event.touches.length!==1 ||
        !element.classList.contains("on") ||
        blockedTarget(event.target) ||
        !dismissSurface(event.target)
      ){
        gesture=null;
        return;
      }

      const touch=
        event.touches[0];

      gesture={
        kind:"touch",
        id:touch.identifier,
        target:event.target,
        startX:touch.clientX,
        startY:touch.clientY,
        distance:0,
        started:performance.now(),
        axis:null
      };
    },
    {passive:true}
  );

  element.addEventListener(
    "touchmove",
    event=>{
      if(
        !gesture ||
        gesture.kind!=="touch"
      ){
        return;
      }

      const touch=
        findTouch(
          event.touches,
          gesture.id
        );

      if(!touch){
        return;
      }

      const dx=
        touch.clientX-
        gesture.startX;

      const dy=
        touch.clientY-
        gesture.startY;

      if(!lockAxis(dx,dy)){
        return;
      }

      gesture.distance=
        Math.max(0,dy);

      queueDistance(
        gesture.distance
      );

      if(event.cancelable){
        event.preventDefault();
      }
    },
    {passive:false}
  );

  element.addEventListener(
    "touchend",
    event=>{
      if(
        !gesture ||
        gesture.kind!=="touch"
      ){
        return;
      }

      const touch=
        findTouch(
          event.changedTouches,
          gesture.id
        );

      if(
        touch &&
        gesture.axis==="y"
      ){
        gesture.distance=
          Math.max(
            0,
            touch.clientY-
              gesture.startY
          );

        pendingDistance=
          gesture.distance;
      }

      finishDrag();
    }
  );

  element.addEventListener(
    "touchcancel",
    ()=>{
      if(
        !gesture ||
        gesture.kind!=="touch"
      ){
        return;
      }

      finishDrag({
        allowClose:false
      });
    }
  );

  element.addEventListener(
    "pointerdown",
    event=>{
      if(
        event.pointerType==="touch" ||
        !event.isPrimary ||
        !element.classList.contains("on") ||
        blockedTarget(event.target) ||
        !dismissSurface(event.target)
      ){
        return;
      }

      gesture={
        kind:"pointer",
        id:event.pointerId,
        target:event.target,
        startX:event.clientX,
        startY:event.clientY,
        distance:0,
        started:performance.now(),
        axis:null
      };
    }
  );

  element.addEventListener(
    "pointermove",
    event=>{
      if(
        !gesture ||
        gesture.kind!=="pointer" ||
        event.pointerId!==gesture.id
      ){
        return;
      }

      const dx=
        event.clientX-
        gesture.startX;

      const dy=
        event.clientY-
        gesture.startY;

      const wasDragging=
        gesture.axis==="y";

      if(!lockAxis(dx,dy)){
        return;
      }

      if(!wasDragging){
        try{
          element.setPointerCapture(
            event.pointerId
          );
        }catch{}
      }

      gesture.distance=
        Math.max(0,dy);

      queueDistance(
        gesture.distance
      );

      event.preventDefault();
    }
  );

  element.addEventListener(
    "pointerup",
    event=>{
      if(
        !gesture ||
        gesture.kind!=="pointer" ||
        event.pointerId!==gesture.id
      ){
        return;
      }

      if(gesture.axis==="y"){
        gesture.distance=
          Math.max(
            0,
            event.clientY-
              gesture.startY
          );

        pendingDistance=
          gesture.distance;
      }

      try{
        if(
          element.hasPointerCapture(
            event.pointerId
          )
        ){
          element.releasePointerCapture(
            event.pointerId
          );
        }
      }catch{}

      finishDrag();
    }
  );

  element.addEventListener(
    "pointercancel",
    event=>{
      if(
        !gesture ||
        gesture.kind!=="pointer" ||
        event.pointerId!==gesture.id
      ){
        return;
      }

      finishDrag({
        allowClose:false
      });
    }
  );

  element.addEventListener(
    "wheel",
    event=>{
      if(
        !element.classList.contains("on") ||
        !dismissSurface(event.target) ||
        Math.abs(event.deltaX)>
          Math.abs(event.deltaY)*1.15 ||
        (
          gesture &&
          gesture.kind!=="wheel"
        )
      ){
        return;
      }

      if(event.deltaY>=0){
        clearTimeout(wheelTimer);
        wheelTimer=0;
        wheelSequence=null;

        if(
          gesture?.kind==="wheel"
        ){
          finishDrag({
            allowClose:false
          });
        }

        return;
      }

      const now=performance.now();

      if(
        !wheelSequence ||
        now-wheelSequence.lastAt>130
      ){
        wheelSequence={
          lastAt:now,
          canDismiss:
            canStart(event.target)
        };
      }else{
        wheelSequence.lastAt=now;
      }

      clearTimeout(wheelTimer);
      wheelTimer=setTimeout(()=>{
        wheelTimer=0;
        wheelSequence=null;

        if(
          gesture?.kind==="wheel"
        ){
          finishDrag();
        }
      },90);

      if(!wheelSequence.canDismiss){
        return;
      }

      if(!gesture){
        gesture={
          kind:"wheel",
          target:event.target,
          distance:0,
          started:performance.now(),
          axis:"y"
        };

        beginDrag();
      }

      if(event.cancelable){
        event.preventDefault();
      }

      gesture.distance+=Math.min(
        34,
        Math.abs(event.deltaY)*.72
      );

      queueDistance(
        gesture.distance
      );
    },
    {passive:false}
  );

  element.addEventListener(
    "click",
    event=>{
      if(
        performance.now()>
        suppressClickUntil
      ){
        return;
      }

      suppressClickUntil=0;

      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );
}

export {
  bindBottomSheetDismiss,
  findTouch
};
