/*
  Возврат из раздела управления горизонтальным жестом.

  Пороги совпадают с жестом переключения месяца, поэтому «назад» в
  управлении ощущается так же, как остальная навигация приложения.

  Раньше этот жест жил в модуле employee-ui.js вместе с подменой
  <select id="employeeAccount"> на кастомный пикер. Сам select исчез из
  разметки ещё раньше, и половина модуля — около пятисот строк вместе с
  наблюдателем DOM — выполнялась вхолостую.
*/

const DEAD_ZONE=8;
const HORIZONTAL_LOCK=10;
const VERTICAL_LOCK=14;
const FLICK_DISTANCE=22;
const FLICK_VELOCITY=0.30;
const SWIPE_DISTANCE=38;
const WHEEL_DISTANCE=48;
const WHEEL_IDLE=140;
const CLICK_SUPPRESSION=650;

const INTERACTIVE_SELECTOR=
  "input,textarea,select,[contenteditable='true']";

let instance=null;

export function swipeAxis({dx,dy}){
  const absX=Math.abs(dx);
  const absY=Math.abs(dy);

  if(absX<DEAD_ZONE && absY<DEAD_ZONE){
    return null;
  }

  if(
    dx>0 &&
    absX>=HORIZONTAL_LOCK &&
    absX>absY*1.10
  ){
    return "x";
  }

  if(
    absY>=VERTICAL_LOCK &&
    absY>absX*1.25
  ){
    return "y";
  }

  return null;
}

export function swipeCompletesBack({
  dx,
  dy,
  axis,
  duration
}){
  const absX=Math.abs(dx);
  const absY=Math.abs(dy);

  if(
    dx<=0 ||
    axis==="y" ||
    absX<=absY*1.08
  ){
    return false;
  }

  return (
    absX>=SWIPE_DISTANCE ||
    (
      absX>=FLICK_DISTANCE &&
      absX/Math.max(1,duration)>=
        FLICK_VELOCITY
    )
  );
}

export function initManageSwipe({app}){
  if(instance){
    return instance;
  }

  let swipe=null;
  let suppressClickUntil=0;
  let wheelX=0;
  let wheelY=0;
  let wheelTimer=0;
  let wheelLocked=false;

  const inSubsection=()=>Boolean(
    document.getElementById("manageBack")
  );

  const blocked=target=>Boolean(
    !inSubsection() ||
    target?.closest?.(INTERACTIVE_SELECTOR) ||
    document.body.classList.contains(
      "sheet-open"
    ) ||
    document.body.classList.contains(
      "point-picker-open"
    )
  );

  const reset=()=>{
    swipe=null;
  };

  const goBack=()=>{
    suppressClickUntil=
      performance.now()+CLICK_SUPPRESSION;

    document
      .getElementById("manageBack")
      ?.click();
  };

  const begin=({id,x,y,pointer=false})=>{
    swipe={
      id,
      x,
      y,
      lastX:x,
      lastY:y,
      time:performance.now(),
      axis:null,
      pointer
    };
  };

  const track=({id,x,y,cancelable,preventDefault})=>{
    if(!swipe || swipe.id!==id){
      return;
    }

    swipe.lastX=x;
    swipe.lastY=y;

    if(swipe.axis===null){
      swipe.axis=swipeAxis({
        dx:x-swipe.x,
        dy:y-swipe.y
      });
    }

    if(swipe.axis==="x" && cancelable){
      preventDefault();
    }
  };

  const finish=({id,x,y})=>{
    if(!swipe || swipe.id!==id){
      return;
    }

    const current=swipe;
    reset();

    if(
      swipeCompletesBack({
        dx:x-current.x,
        dy:y-current.y,
        axis:current.axis,
        duration:
          performance.now()-current.time
      })
    ){
      goBack();
    }
  };

  const touchOf=(list,id)=>
    Array.from(list || []).find(touch=>
      touch.identifier===id
    );

  app?.addEventListener(
    "touchstart",
    event=>{
      if(
        event.touches.length!==1 ||
        blocked(event.target)
      ){
        reset();
        return;
      }

      const touch=event.touches[0];

      begin({
        id:touch.identifier,
        x:touch.clientX,
        y:touch.clientY
      });
    },
    {passive:true}
  );

  app?.addEventListener(
    "touchmove",
    event=>{
      const touch=swipe
        ? touchOf(event.touches,swipe.id)
        : null;

      if(!touch){
        return;
      }

      track({
        id:touch.identifier,
        x:touch.clientX,
        y:touch.clientY,
        cancelable:event.cancelable,
        preventDefault:()=>
          event.preventDefault()
      });
    },
    {passive:false}
  );

  app?.addEventListener(
    "touchend",
    event=>{
      if(!swipe){
        return;
      }

      const touch=touchOf(
        event.changedTouches,
        swipe.id
      );

      finish({
        id:swipe.id,
        x:touch
          ? touch.clientX
          : swipe.lastX,
        y:touch
          ? touch.clientY
          : swipe.lastY
      });
    },
    {passive:true}
  );

  app?.addEventListener(
    "touchcancel",
    reset,
    {passive:true}
  );

  app?.addEventListener(
    "pointerdown",
    event=>{
      if(
        event.pointerType==="touch" ||
        !event.isPrimary ||
        blocked(event.target)
      ){
        reset();
        return;
      }

      begin({
        id:event.pointerId,
        x:event.clientX,
        y:event.clientY,
        pointer:true
      });
    }
  );

  app?.addEventListener(
    "pointermove",
    event=>{
      if(!swipe?.pointer){
        return;
      }

      track({
        id:event.pointerId,
        x:event.clientX,
        y:event.clientY,
        cancelable:true,
        preventDefault:()=>
          event.preventDefault()
      });
    }
  );

  app?.addEventListener(
    "pointerup",
    event=>{
      if(!swipe?.pointer){
        return;
      }

      finish({
        id:event.pointerId,
        x:event.clientX,
        y:event.clientY
      });
    }
  );

  app?.addEventListener(
    "pointercancel",
    event=>{
      if(
        swipe?.pointer &&
        swipe.id===event.pointerId
      ){
        reset();
      }
    }
  );

  app?.addEventListener(
    "wheel",
    event=>{
      if(
        !inSubsection() ||
        Math.abs(event.deltaX)<=
          Math.abs(event.deltaY)
      ){
        return;
      }

      wheelX+=event.deltaX;
      wheelY+=event.deltaY;

      window.clearTimeout(wheelTimer);

      wheelTimer=window.setTimeout(()=>{
        wheelX=0;
        wheelY=0;
        wheelLocked=false;
      },WHEEL_IDLE);

      if(wheelLocked){
        if(event.cancelable){
          event.preventDefault();
        }

        return;
      }

      if(
        wheelX>-WHEEL_DISTANCE ||
        Math.abs(wheelX)<=
          Math.abs(wheelY)*1.12
      ){
        return;
      }

      if(event.cancelable){
        event.preventDefault();
      }

      wheelX=0;
      wheelY=0;
      wheelLocked=true;

      goBack();
    },
    {passive:false}
  );

  /*
    После жеста браузер ещё присылает синтетический click по элементу,
    который был под пальцем. Он относится к уже покинутому экрану.
  */
  document.addEventListener(
    "click",
    event=>{
      if(
        event.detail!==0 &&
        performance.now()<=suppressClickUntil
      ){
        suppressClickUntil=0;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true
  );

  instance={};

  return instance;
}
