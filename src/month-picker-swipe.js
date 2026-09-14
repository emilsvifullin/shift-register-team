const PICKER_ID="monthPicker";
const HANDLE_SELECTOR=".month-picker-handle,.picker-toolbar";
const CLOSE_DURATION=420;
const CLOSE_EASING="cubic-bezier(.4,0,.2,1)";
const REFERENCE_PREFIX="shift-register-modal-";

let gesture=null;
let cleanupTimer=0;
let suppressClickUntil=0;

const picker=()=>
  document.getElementById(PICKER_ID);

const reducedMotion=()=>Boolean(
  globalThis.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches
);

function isInteractive(target){
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "button,input,textarea,select,a,[contenteditable=\"true\"]"
      )
    )
  );
}

function isMonthHeaderTarget(target){
  if(
    !(target instanceof Element) ||
    isInteractive(target)
  ){
    return false;
  }

  const element=picker();

  if(
    !(element instanceof HTMLElement) ||
    !element.classList.contains("on") ||
    !element.contains(target)
  ){
    return false;
  }

  return Boolean(
    target.closest(HANDLE_SELECTOR)
  );
}

function cancelReferenceMotion(element){
  element
    .getAnimations?.()
    .filter(animation=>
      String(animation.id || "")
        .startsWith(REFERENCE_PREFIX)
    )
    .forEach(animation=>animation.cancel());
}

function clearGestureStyles(element){
  window.clearTimeout(cleanupTimer);
  cleanupTimer=0;

  element.style.removeProperty("transition");
  element.style.removeProperty("transform");
  element.style.removeProperty("--month-drag");
}

function resetForOpen(element){
  window.clearTimeout(cleanupTimer);
  cleanupTimer=0;
  gesture=null;
  suppressClickUntil=0;

  cancelReferenceMotion(element);
  element.removeAttribute("data-reference-closing");
  element.removeAttribute("data-month-swipe-closing");
  element.style.removeProperty("display");
  element.style.removeProperty("transition");
  element.style.removeProperty("transform");
  element.style.removeProperty("--month-drag");
}

function startGesture(kind,id,target,x,y){
  const element=picker();

  if(
    !(element instanceof HTMLElement) ||
    !isMonthHeaderTarget(target)
  ){
    return false;
  }

  clearGestureStyles(element);

  gesture={
    kind,
    id,
    element,
    startX:x,
    startY:y,
    distance:0,
    started:performance.now(),
    axis:null
  };

  return true;
}

function beginVerticalDrag(state){
  const {element}=state;

  cancelReferenceMotion(element);
  element.style.transition="none";
  element.style.removeProperty("--month-drag");
  element.style.transform="translate3d(0,0,0)";
  void element.offsetHeight;
}

function lockAxis(state,dx,dy){
  if(state.axis!==null){
    return state.axis==="y";
  }

  const absX=Math.abs(dx);
  const absY=Math.abs(dy);

  if(absX<8 && absY<8){
    return false;
  }

  if(
    absX>=10 &&
    absX>absY*1.10
  ){
    state.axis="x";
    return false;
  }

  if(
    dy<0 &&
    absY>=10 &&
    absY>absX*1.10
  ){
    state.axis="scroll";
    return false;
  }

  if(
    dy>0 &&
    absY>=10 &&
    absY>absX*1.08
  ){
    state.axis="y";
    beginVerticalDrag(state);
    return true;
  }

  return false;
}

function applyDistance(state,distance){
  const next=Math.max(0,distance);
  state.distance=next;
  state.element.style.transform=
    `translate3d(0,${next}px,0)`;
}

function transitionFromCurrent(
  state,
  destination,
  onFinish
){
  const {element}=state;
  let finished=false;
  let fallbackTimer=0;

  const finish=()=>{
    if(finished){
      return;
    }

    finished=true;
    window.clearTimeout(fallbackTimer);
    element.removeEventListener(
      "transitionend",
      handleTransitionEnd
    );
    onFinish();
  };

  const handleTransitionEnd=event=>{
    if(
      event.target===element &&
      event.propertyName==="transform"
    ){
      finish();
    }
  };

  element.addEventListener(
    "transitionend",
    handleTransitionEnd
  );

  element.style.transition="none";
  element.style.transform=
    `translate3d(0,${state.distance}px,0)`;
  void element.offsetHeight;

  requestAnimationFrame(()=>{
    if(finished){
      return;
    }

    element.style.transition=
      `transform ${CLOSE_DURATION}ms ${CLOSE_EASING}`;

    requestAnimationFrame(()=>{
      if(finished){
        return;
      }

      element.style.transform=
        `translate3d(0,${destination}px,0)`;
    });
  });

  fallbackTimer=window.setTimeout(
    finish,
    CLOSE_DURATION+120
  );
}

function finishSwipeClose(state,endDistance){
  const {element}=state;

  element.style.transition="none";
  element.style.transform=
    `translate3d(0,${endDistance}px,0)`;

  /*
    The swipe has already moved the picker completely below the viewport.
    Keep it hard-hidden while the normal close handler updates veil/body/focus.
    This prevents modal-motion from painting a second y=0 -> hidden close pass.
  */
  element.setAttribute(
    "data-month-swipe-closing",
    "true"
  );
  element.style.setProperty(
    "display",
    "none",
    "important"
  );

  suppressClickUntil=0;
  document.getElementById("monthCancel")?.click();

  const suppressSecondaryClose=()=>{
    cancelReferenceMotion(element);
    element.removeAttribute(
      "data-reference-closing"
    );
  };

  queueMicrotask(suppressSecondaryClose);
  requestAnimationFrame(suppressSecondaryClose);
  window.setTimeout(suppressSecondaryClose,0);

  cleanupTimer=window.setTimeout(()=>{
    suppressSecondaryClose();
    element.style.setProperty(
      "display",
      "none"
    );
    element.removeAttribute(
      "data-month-swipe-closing"
    );
    element.style.removeProperty("transition");
    element.style.removeProperty("transform");
    element.style.removeProperty("--month-drag");
    cleanupTimer=0;
  },560);
}

function closeMonthPicker(state){
  const {element}=state;
  const endDistance=
    element.getBoundingClientRect().height+48;

  if(reducedMotion()){
    finishSwipeClose(state,endDistance);
    return;
  }

  transitionFromCurrent(
    state,
    endDistance,
    ()=>finishSwipeClose(
      state,
      endDistance
    )
  );
}

function snapBack(state){
  const {element}=state;

  if(reducedMotion()){
    clearGestureStyles(element);
    return;
  }

  transitionFromCurrent(
    state,
    0,
    ()=>{
      if(element.classList.contains("on")){
        clearGestureStyles(element);
      }
    }
  );
}

function finishGesture({allowClose=true}={}){
  const state=gesture;
  gesture=null;

  if(
    !state ||
    state.axis!=="y"
  ){
    return;
  }

  const duration=Math.max(
    1,
    performance.now()-state.started
  );

  const fastSwipe=
    state.distance>=22 &&
    state.distance/duration>=0.32;

  const shouldClose=
    allowClose &&
    (
      state.distance>=56 ||
      fastSwipe
    );

  suppressClickUntil=
    performance.now()+650;

  if(shouldClose){
    closeMonthPicker(state);
    return;
  }

  snapBack(state);
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

window.addEventListener(
  "touchstart",
  event=>{
    if(event.touches.length!==1){
      return;
    }

    const touch=event.touches[0];

    if(!startGesture(
      "touch",
      touch.identifier,
      event.target,
      touch.clientX,
      touch.clientY
    )){
      return;
    }

    event.stopImmediatePropagation();
  },
  {capture:true,passive:true}
);

window.addEventListener(
  "touchmove",
  event=>{
    if(
      !gesture ||
      gesture.kind!=="touch"
    ){
      return;
    }

    const touch=findTouch(
      event.touches,
      gesture.id
    );

    if(!touch){
      return;
    }

    const dx=touch.clientX-gesture.startX;
    const dy=touch.clientY-gesture.startY;

    if(!lockAxis(gesture,dx,dy)){
      event.stopImmediatePropagation();
      return;
    }

    applyDistance(gesture,dy);

    if(event.cancelable){
      event.preventDefault();
    }

    event.stopImmediatePropagation();
  },
  {capture:true,passive:false}
);

window.addEventListener(
  "touchend",
  event=>{
    if(
      !gesture ||
      gesture.kind!=="touch"
    ){
      return;
    }

    event.stopImmediatePropagation();

    if(
      gesture.axis==="y" &&
      event.cancelable
    ){
      event.preventDefault();
    }

    /*
      Keep the last painted touchmove distance. Safari can report a smaller
      changedTouches Y on release, which would otherwise create an up-jump.
    */
    finishGesture();
  },
  {capture:true,passive:false}
);

window.addEventListener(
  "touchcancel",
  event=>{
    if(
      !gesture ||
      gesture.kind!=="touch"
    ){
      return;
    }

    event.stopImmediatePropagation();
    finishGesture({allowClose:false});
  },
  true
);

window.addEventListener(
  "pointerdown",
  event=>{
    if(
      event.pointerType==="touch" ||
      !event.isPrimary
    ){
      return;
    }

    if(!startGesture(
      "pointer",
      event.pointerId,
      event.target,
      event.clientX,
      event.clientY
    )){
      return;
    }

    event.stopImmediatePropagation();
  },
  true
);

window.addEventListener(
  "pointermove",
  event=>{
    if(
      !gesture ||
      gesture.kind!=="pointer" ||
      event.pointerId!==gesture.id
    ){
      return;
    }

    const dx=event.clientX-gesture.startX;
    const dy=event.clientY-gesture.startY;

    if(!lockAxis(gesture,dx,dy)){
      event.stopImmediatePropagation();
      return;
    }

    applyDistance(gesture,dy);

    if(event.cancelable){
      event.preventDefault();
    }

    event.stopImmediatePropagation();
  },
  true
);

window.addEventListener(
  "pointerup",
  event=>{
    if(
      !gesture ||
      gesture.kind!=="pointer" ||
      event.pointerId!==gesture.id
    ){
      return;
    }

    event.stopImmediatePropagation();
    finishGesture();
  },
  true
);

window.addEventListener(
  "pointercancel",
  event=>{
    if(
      !gesture ||
      gesture.kind!=="pointer" ||
      event.pointerId!==gesture.id
    ){
      return;
    }

    event.stopImmediatePropagation();
    finishGesture({allowClose:false});
  },
  true
);

window.addEventListener(
  "click",
  event=>{
    if(
      performance.now()>suppressClickUntil ||
      !(event.target instanceof Node) ||
      !picker()?.contains(event.target)
    ){
      return;
    }

    suppressClickUntil=0;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true
);

document.addEventListener(
  "DOMContentLoaded",
  ()=>{
    const element=picker();

    if(!(element instanceof HTMLElement)){
      return;
    }

    element.addEventListener(
      "bottomsheetopen",
      ()=>resetForOpen(element)
    );
  },
  {once:true}
);

document.documentElement.dataset.monthPickerSwipe=
  "ready";
