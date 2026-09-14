const HORIZONTAL_DEAD_ZONE=8;
const HORIZONTAL_LOCK=10;
const VERTICAL_LOCK=14;
const MONTH_DISTANCE=38;
const YEAR_DISTANCE=35;
const FLICK_DISTANCE=22;
const FLICK_VELOCITY=.30;

function activeMainMonthTab(){
  const selected=
    document.querySelector(
      '[role="tab"][aria-selected="true"]'
    );

  return [
    "tab-shifts",
    "tab-stats"
  ].includes(selected?.id);
}

function monthSwipeStartBlocked(target){
  if(!(target instanceof Element)){
    return true;
  }

  return Boolean(
    target.closest(
      "input,textarea,select,a,button:not(.sh)"
    )
  );
}

function modalBlocksMonthSwipe(){
  return (
    document.body.classList.contains(
      "sheet-open"
    ) ||
    document.body.classList.contains(
      "point-picker-open"
    ) ||
    document.body.classList.contains(
      "month-picker-open"
    )
  );
}

function findTouch(list,id){
  for(let index=0;index<list.length;index++){
    const touch=list[index];

    if(touch.identifier===id){
      return touch;
    }
  }

  return null;
}

let monthSwipe=null;
let suppressMonthClickUntil=0;

function resetMonthSwipe(){
  monthSwipe=null;
  document.body.classList.remove(
    "month-swiping"
  );
}

function beginMonthSwipe(event){
  if(
    !activeMainMonthTab() ||
    event.touches.length!==1 ||
    modalBlocksMonthSwipe() ||
    monthSwipeStartBlocked(event.target)
  ){
    resetMonthSwipe();
    return;
  }

  const touch=event.touches[0];

  monthSwipe={
    id:touch.identifier,
    x:touch.clientX,
    y:touch.clientY,
    lastX:touch.clientX,
    lastY:touch.clientY,
    time:performance.now(),
    axis:null
  };

  event.stopPropagation();
}

function moveMonthSwipe(event){
  if(!monthSwipe){
    return;
  }

  event.stopPropagation();

  const touch=
    findTouch(
      event.touches,
      monthSwipe.id
    );

  if(!touch){
    return;
  }

  monthSwipe.lastX=touch.clientX;
  monthSwipe.lastY=touch.clientY;

  const dx=touch.clientX-monthSwipe.x;
  const dy=touch.clientY-monthSwipe.y;
  const absX=Math.abs(dx);
  const absY=Math.abs(dy);

  if(monthSwipe.axis===null){
    if(
      absX<HORIZONTAL_DEAD_ZONE &&
      absY<HORIZONTAL_DEAD_ZONE
    ){
      return;
    }

    if(
      absX>=HORIZONTAL_LOCK &&
      absX>absY*1.10
    ){
      monthSwipe.axis="x";
    }else if(
      absY>=VERTICAL_LOCK &&
      absY>absX*1.25
    ){
      monthSwipe.axis="y";
    }else{
      return;
    }
  }

  if(monthSwipe.axis!=="x"){
    return;
  }

  document.body.classList.add(
    "month-swiping"
  );

  if(event.cancelable){
    event.preventDefault();
  }
}

function finishMonthSwipe(event){
  if(!monthSwipe){
    return;
  }

  event.stopPropagation();

  const swipe=monthSwipe;
  const touch=
    findTouch(
      event.changedTouches,
      swipe.id
    );

  const endX=touch
    ? touch.clientX
    : swipe.lastX;

  const endY=touch
    ? touch.clientY
    : swipe.lastY;

  const dx=endX-swipe.x;
  const dy=endY-swipe.y;
  const absX=Math.abs(dx);
  const absY=Math.abs(dy);
  const duration=Math.max(
    1,
    performance.now()-swipe.time
  );
  const velocity=absX/duration;

  resetMonthSwipe();

  const horizontal=
    absX>absY*1.08;

  const enoughDistance=
    absX>=MONTH_DISTANCE;

  const fastSwipe=
    absX>=FLICK_DISTANCE &&
    velocity>=FLICK_VELOCITY;

  if(
    swipe.axis==="y" ||
    !horizontal ||
    (
      !enoughDistance &&
      !fastSwipe
    )
  ){
    return;
  }

  if(event.cancelable){
    event.preventDefault();
  }

  const button=
    document.getElementById(
      dx<0
        ? "nextM"
        : "prevM"
    );

  button?.click();

  suppressMonthClickUntil=
    performance.now()+400;
}

document.addEventListener(
  "touchstart",
  beginMonthSwipe,
  {
    passive:true,
    capture:true
  }
);

document.addEventListener(
  "touchmove",
  moveMonthSwipe,
  {
    passive:false,
    capture:true
  }
);

document.addEventListener(
  "touchend",
  finishMonthSwipe,
  {
    passive:false,
    capture:true
  }
);

document.addEventListener(
  "touchcancel",
  event=>{
    if(!monthSwipe){
      return;
    }

    event.stopPropagation();
    resetMonthSwipe();
  },
  {
    passive:true,
    capture:true
  }
);

document.addEventListener(
  "click",
  event=>{
    if(
      performance.now()>
      suppressMonthClickUntil
    ){
      return;
    }

    suppressMonthClickUntil=0;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true
);

let pointerMonthGuard=null;

function beginPointerMonthGuard(event){
  if(
    event.pointerType==="touch" ||
    !event.isPrimary ||
    !activeMainMonthTab() ||
    modalBlocksMonthSwipe() ||
    monthSwipeStartBlocked(event.target)
  ){
    pointerMonthGuard=null;
    return;
  }

  pointerMonthGuard={
    id:event.pointerId,
    x:event.clientX,
    y:event.clientY,
    axis:null
  };
}

function movePointerMonthGuard(event){
  if(
    !pointerMonthGuard ||
    event.pointerId!==pointerMonthGuard.id
  ){
    return;
  }

  const dx=
    event.clientX-pointerMonthGuard.x;
  const dy=
    event.clientY-pointerMonthGuard.y;
  const absX=Math.abs(dx);
  const absY=Math.abs(dy);

  if(pointerMonthGuard.axis===null){
    if(
      absX<HORIZONTAL_DEAD_ZONE &&
      absY<HORIZONTAL_DEAD_ZONE
    ){
      return;
    }

    if(
      absX>=HORIZONTAL_LOCK &&
      absX>absY*1.10
    ){
      pointerMonthGuard.axis="x";
    }else if(
      absY>=VERTICAL_LOCK &&
      absY>absX*1.25
    ){
      pointerMonthGuard.axis="y";
    }else{
      return;
    }
  }

  if(pointerMonthGuard.axis==="x"){
    event.stopPropagation();
  }
}

document.addEventListener(
  "pointerdown",
  beginPointerMonthGuard,
  true
);

document.addEventListener(
  "pointermove",
  movePointerMonthGuard,
  true
);

document.addEventListener(
  "pointerup",
  event=>{
    if(
      pointerMonthGuard &&
      event.pointerId===pointerMonthGuard.id
    ){
      pointerMonthGuard=null;
    }
  },
  true
);

document.addEventListener(
  "pointercancel",
  event=>{
    if(
      pointerMonthGuard &&
      event.pointerId===pointerMonthGuard.id
    ){
      pointerMonthGuard=null;
    }
  },
  true
);

document.addEventListener(
  "wheel",
  event=>{
    if(
      !activeMainMonthTab() ||
      modalBlocksMonthSwipe() ||
      Math.abs(event.deltaX)<=
        Math.abs(event.deltaY)
    ){
      return;
    }

    event.stopPropagation();
  },
  {
    passive:true,
    capture:true
  }
);

function installYearSwipe({
  containerId,
  gridId,
  previousButtonId,
  nextButtonId
}){
  const container=
    document.getElementById(
      containerId
    );

  const grid=
    document.getElementById(
      gridId
    );

  if(!container || !grid){
    return;
  }

  let guard=null;
  let swipe=null;

  container.addEventListener(
    "pointerdown",
    event=>{
      if(!event.isPrimary){
        guard=null;
        return;
      }

      guard={
        id:event.pointerId,
        x:event.clientX,
        y:event.clientY,
        axis:null,
        exact:
          ["touch","pen"].includes(
            event.pointerType
          ) &&
          grid.contains(event.target)
      };
    },
    true
  );

  container.addEventListener(
    "pointermove",
    event=>{
      if(
        !guard ||
        event.pointerId!==guard.id
      ){
        return;
      }

      const dx=event.clientX-guard.x;
      const dy=event.clientY-guard.y;
      const absX=Math.abs(dx);
      const absY=Math.abs(dy);

      if(guard.axis===null){
        if(
          absX<HORIZONTAL_DEAD_ZONE &&
          absY<HORIZONTAL_DEAD_ZONE
        ){
          return;
        }

        if(
          absX>=HORIZONTAL_LOCK &&
          absX>absY*1.10
        ){
          guard.axis="x";
        }else if(
          absY>=VERTICAL_LOCK &&
          absY>absX*1.25
        ){
          guard.axis="y";
        }else{
          return;
        }
      }

      if(
        guard.axis==="x" &&
        !guard.exact
      ){
        event.stopPropagation();
      }
    },
    true
  );

  const clearGuard=event=>{
    if(
      guard &&
      event.pointerId===guard.id
    ){
      guard=null;
    }
  };

  container.addEventListener(
    "pointerup",
    clearGuard,
    true
  );

  container.addEventListener(
    "pointercancel",
    clearGuard,
    true
  );

  container.addEventListener(
    "wheel",
    event=>{
      const absX=Math.abs(event.deltaX);
      const absY=Math.abs(event.deltaY);

      if(
        absX>=1 &&
        absX>=absY*.72
      ){
        event.stopPropagation();
      }
    },
    {
      passive:true,
      capture:true
    }
  );

  grid.addEventListener(
    "pointerdown",
    event=>{
      if(
        !event.isPrimary ||
        !["touch","pen"].includes(
          event.pointerType
        )
      ){
        swipe=null;
        return;
      }

      swipe={
        id:event.pointerId,
        x:event.clientX,
        y:event.clientY,
        time:performance.now(),
        axis:null
      };

      try{
        grid.setPointerCapture(
          event.pointerId
        );
      }catch{}
    },
    true
  );

  grid.addEventListener(
    "pointermove",
    event=>{
      if(
        !swipe ||
        event.pointerId!==swipe.id
      ){
        return;
      }

      const dx=event.clientX-swipe.x;
      const dy=event.clientY-swipe.y;
      const absX=Math.abs(dx);
      const absY=Math.abs(dy);

      if(swipe.axis===null){
        if(
          absX<HORIZONTAL_DEAD_ZONE &&
          absY<HORIZONTAL_DEAD_ZONE
        ){
          return;
        }

        if(
          absX>=HORIZONTAL_LOCK &&
          absX>absY*1.10
        ){
          swipe.axis="x";
        }else if(
          absY>=VERTICAL_LOCK &&
          absY>absX*1.25
        ){
          swipe.axis="y";
          return;
        }else{
          return;
        }
      }

      if(swipe.axis!=="x"){
        return;
      }

      if(event.cancelable){
        event.preventDefault();
      }

      event.stopPropagation();
    },
    true
  );

  grid.addEventListener(
    "pointerup",
    event=>{
      if(
        !swipe ||
        event.pointerId!==swipe.id
      ){
        return;
      }

      const current=swipe;
      swipe=null;

      try{
        if(
          grid.hasPointerCapture(
            event.pointerId
          )
        ){
          grid.releasePointerCapture(
            event.pointerId
          );
        }
      }catch{}

      const dx=event.clientX-current.x;
      const dy=event.clientY-current.y;
      const absX=Math.abs(dx);
      const absY=Math.abs(dy);
      const duration=Math.max(
        1,
        performance.now()-current.time
      );
      const velocity=absX/duration;
      const horizontal=
        absX>absY*1.08;
      const enoughDistance=
        absX>=YEAR_DISTANCE;
      const fastSwipe=
        absX>=FLICK_DISTANCE &&
        velocity>=FLICK_VELOCITY;

      if(
        current.axis!=="x" ||
        !horizontal ||
        (
          !enoughDistance &&
          !fastSwipe
        )
      ){
        return;
      }

      document
        .getElementById(
          dx<0
            ? nextButtonId
            : previousButtonId
        )
        ?.click();
    },
    true
  );

  grid.addEventListener(
    "pointercancel",
    event=>{
      if(
        swipe &&
        event.pointerId===swipe.id
      ){
        swipe=null;
      }
    },
    true
  );
}

installYearSwipe({
  containerId:"monthPicker",
  gridId:"monthGrid",
  previousButtonId:"monthYearPrev",
  nextButtonId:"monthYearNext"
});

installYearSwipe({
  containerId:"dateJump",
  gridId:"dateJumpMonths",
  previousButtonId:"dateJumpPrevYear",
  nextButtonId:"dateJumpNextYear"
});

document.documentElement.dataset.referenceSwipes=
  "shift-register";
