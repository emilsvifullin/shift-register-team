const PICKER_ID="monthPicker";
const HANDLE_SELECTOR=".month-picker-handle,.picker-toolbar";
const REFERENCE_PREFIX="shift-register-modal-";
const SNAP_DURATION=260;
const SNAP_EASING="cubic-bezier(.4,0,.2,1)";
const CLOSE_EASING="cubic-bezier(0,0,.2,1)";

let gesture=null;
let suppressClickUntil=0;
let openRevealFirstFrame=0;
let openRevealSecondFrame=0;

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

function cancelOpenReveal(){
  if(openRevealFirstFrame){
    cancelAnimationFrame(
      openRevealFirstFrame
    );
    openRevealFirstFrame=0;
  }

  if(openRevealSecondFrame){
    cancelAnimationFrame(
      openRevealSecondFrame
    );
    openRevealSecondFrame=0;
  }
}

function clearGestureStyles(element){
  element.style.removeProperty("transition");
  element.style.removeProperty("transform");
  element.style.removeProperty("--month-drag");
}

function resetForOpen(element){
  gesture=null;
  suppressClickUntil=0;
  cancelOpenReveal();

  element.removeAttribute(
    "data-month-swipe-closing"
  );

  if(reducedMotion()){
    element.style.removeProperty(
      "visibility"
    );
    return;
  }

  /*
    Keep the compositor layer hidden while modal-motion stages the picker
    below the viewport. iOS PWA/WebKit can otherwise reuse the last fully-open
    layer for one frame after display:none -> display:block, producing the
    visible "ghost" before the real entrance animation starts.
  */
  element.style.visibility="hidden";

  openRevealFirstFrame=
    requestAnimationFrame(()=>{
      openRevealFirstFrame=0;

      openRevealSecondFrame=
        requestAnimationFrame(()=>{
          openRevealSecondFrame=0;

          if(
            element.classList.contains(
              "on"
            )
          ){
            element.style.removeProperty(
              "visibility"
            );
          }
        });
    });
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

function runTransformTransition(
  state,
  destination,
  duration,
  easing,
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

  element.style.transition=
    `transform ${duration}ms ${easing}`;
  element.style.transform=
    `translate3d(0,${destination}px,0)`;

  fallbackTimer=window.setTimeout(
    finish,
    duration+100
  );
}

function normalizeClosedPicker(element){
  cancelOpenReveal();
  cancelReferenceMotion(element);
  element.removeAttribute(
    "data-reference-closing"
  );
  element.removeAttribute(
    "data-month-swipe-closing"
  );

  /*
    Normalize while display:none is still active and keep the compositor layer
    non-visible until the next staged open. This prevents WebKit from flashing
    the previous fully-open layer before the hidden transform is painted.
  */
  element.style.setProperty(
    "display",
    "none"
  );
  element.style.visibility="hidden";
  element.style.removeProperty("transition");
  element.style.removeProperty("transform");
  element.style.removeProperty("--month-drag");
}

function finishSwipeClose(state,endDistance){
  const {element}=state;

  element.style.transition="none";
  element.style.transform=
    `translate3d(0,${endDistance}px,0)`;
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

  const cancel=
    document.getElementById("monthCancel");

  if(cancel instanceof HTMLElement){
    cancel.click();
  }else{
    element.classList.remove("on");
    element.setAttribute(
      "aria-hidden",
      "true"
    );
  }

  queueMicrotask(()=>{
    normalizeClosedPicker(element);
  });
}

function closeDuration(state,endDistance){
  const remaining=Math.max(
    0,
    endDistance-state.distance
  );
  const ratio=endDistance>0
    ? remaining/endDistance
    : 1;

  return Math.round(
    Math.max(
      140,
      Math.min(320,360*ratio)
    )
  );
}

function closeMonthPicker(state){
  const {element}=state;
  const endDistance=
    element.getBoundingClientRect().height+48;

  if(reducedMotion()){
    finishSwipeClose(state,endDistance);
    return;
  }

  runTransformTransition(
    state,
    endDistance,
    closeDuration(state,endDistance),
    CLOSE_EASING,
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

  runTransformTransition(
    state,
    0,
    SNAP_DURATION,
    SNAP_EASING,
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

    /* Safari can report a smaller changedTouches Y on release. */
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

function bindOpenReset(){
  const element=picker();

  if(!(element instanceof HTMLElement)){
    return;
  }

  element.addEventListener(
    "bottomsheetopen",
    ()=>resetForOpen(element)
  );
}

if(document.readyState==="loading"){
  document.addEventListener(
    "DOMContentLoaded",
    bindOpenReset,
    {once:true}
  );
}else{
  bindOpenReset();
}

document.documentElement.dataset.monthPickerSwipe=
  "ready";
