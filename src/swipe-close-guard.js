const SWIPE_ANIMATION_ID="header-swipe-dismiss";
const REFERENCE_PREFIX="shift-register-modal-";
const CLOSE_DURATION=420;
const CLOSE_EASING="cubic-bezier(.4,0,.2,1)";

const SURFACES=Object.freeze({
  sheet:{
    drag:"--sheet-drag",
    header:".grab,.shead",
    cancel:"sheetCancel"
  },
  employeeSheet:{
    drag:"--sheet-drag",
    header:".grab,.shead",
    cancel:"employeeSheetCancel"
  },
  employeeFilterSheet:{
    drag:"--sheet-drag",
    header:".grab,.shead",
    cancel:"employeeFilterCancel"
  },
  shiftFilterSheet:{
    drag:"--sheet-drag",
    header:".grab,.shead",
    cancel:"shiftFilterCancel"
  },
  manageEditorSheet:{
    drag:"--sheet-drag",
    header:".grab,.shead",
    cancel:"manageEditorCancel"
  },
  pointPicker:{
    drag:"--point-drag",
    header:".point-picker-handle,.picker-toolbar",
    cancel:"pointCancel"
  },
  monthPicker:{
    drag:"--month-drag",
    header:".month-picker-handle,.picker-toolbar",
    cancel:"monthCancel"
  },
  datePicker:{
    drag:"--date-drag",
    header:".date-picker-handle,.picker-toolbar",
    cancel:"dateCancel"
  }
});

let gesture=null;
let suppressClickUntil=0;
let suppressSurface=null;
const snapTimers=new WeakMap();

const reducedMotion=()=>Boolean(
  globalThis.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches
);

function surfaceConfig(element){
  if(!(element instanceof HTMLElement)){
    return null;
  }

  return SURFACES[element.id] || null;
}

function surfaceFromTarget(target){
  if(!(target instanceof Element)){
    return null;
  }

  const element=target.closest(
    "#sheet,#employeeSheet,#employeeFilterSheet,#shiftFilterSheet,#manageEditorSheet,#pointPicker,#monthPicker,#datePicker"
  );

  if(
    !(element instanceof HTMLElement) ||
    !element.classList.contains("on")
  ){
    return null;
  }

  const config=surfaceConfig(element);

  if(!config){
    return null;
  }

  return {element,config};
}

function interactiveTarget(target){
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "button,input,textarea,select,a,[contenteditable=\"true\"]"
      )
    )
  );
}

function headerTarget(
  target,
  element,
  config
){
  if(
    !(target instanceof Element) ||
    interactiveTarget(target)
  ){
    return false;
  }

  const header=target.closest(
    config.header
  );

  return Boolean(
    header &&
    element.contains(header)
  );
}

function clearSnapTimer(element){
  const timer=snapTimers.get(element);

  if(timer){
    clearTimeout(timer);
  }

  snapTimers.delete(element);
}

function cancelSwipeAnimation(element){
  element
    .getAnimations?.()
    .filter(animation=>
      animation.id===SWIPE_ANIMATION_ID
    )
    .forEach(animation=>{
      animation.cancel();
    });
}

function cancelReferenceAnimations(element){
  element
    .getAnimations?.()
    .filter(animation=>
      String(animation.id || "")
        .startsWith(REFERENCE_PREFIX)
    )
    .forEach(animation=>{
      animation.cancel();
    });
}

function resetSurface(element){
  const config=surfaceConfig(element);

  if(!config){
    return;
  }

  clearSnapTimer(element);
  cancelSwipeAnimation(element);

  element.style.removeProperty(
    "transition"
  );
  element.style.removeProperty(
    config.drag
  );
}

function beginDrag(state){
  clearSnapTimer(state.element);
  cancelSwipeAnimation(state.element);
  cancelReferenceAnimations(state.element);

  state.element.style.transition="none";
}

function setDistance(state,distance){
  state.distance=Math.max(0,distance);

  state.element.style.setProperty(
    state.config.drag,
    `${state.distance}px`
  );
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
    beginDrag(state);
    return true;
  }

  return false;
}

function snapBack(state){
  const {element,config}=state;

  element.style.transition=
    `transform ${CLOSE_DURATION}ms ${CLOSE_EASING}`;

  void element.offsetHeight;

  element.style.setProperty(
    config.drag,
    "0px"
  );

  const timer=setTimeout(()=>{
    snapTimers.delete(element);

    if(element.classList.contains("on")){
      element.style.removeProperty(
        "transition"
      );
      element.style.removeProperty(
        config.drag
      );
    }
  },CLOSE_DURATION+24);

  snapTimers.set(element,timer);
}

function closeControl(element,config){
  return (
    document.getElementById(config.cancel) ||
    element.querySelector(
      ".shead .lnk,.picker-toolbar-btn.cancel"
    )
  );
}

function requestClose(element,config){
  const control=closeControl(
    element,
    config
  );

  if(control instanceof HTMLElement){
    control.click();
    return;
  }

  element.classList.remove("on");
  element.setAttribute(
    "aria-hidden",
    "true"
  );
}

function finishCloseStyles(
  element,
  config,
  animation
){
  requestAnimationFrame(()=>{
    animation.cancel();

    if(
      element.classList.contains("on")
    ){
      snapBack({
        element,
        config,
        distance:
          Number.parseFloat(
            element.style.getPropertyValue(
              config.drag
            )
          ) || 0
      });
      return;
    }

    element.style.removeProperty(
      config.drag
    );

    requestAnimationFrame(()=>{
      if(
        !element.classList.contains("on")
      ){
        element.style.removeProperty(
          "transition"
        );
      }
    });
  });
}

function animateClose(state){
  const {element,config}=state;

  setDistance(
    state,
    state.distance
  );

  element.style.transition="none";

  const startTransform=
    getComputedStyle(element).transform;

  const endDistance=
    element.getBoundingClientRect()
      .height+40;

  if(
    reducedMotion() ||
    typeof element.animate!=="function"
  ){
    element.style.setProperty(
      config.drag,
      `${endDistance}px`
    );
    requestClose(element,config);
    element.style.removeProperty(
      config.drag
    );
    element.style.removeProperty(
      "transition"
    );
    return;
  }

  const animation=element.animate(
    [
      {
        transform:
          startTransform==="none"
            ? `translate3d(0,${state.distance}px,0)`
            : startTransform
      },
      {
        transform:
          `translate3d(0,${endDistance}px,0)`
      }
    ],
    {
      duration:CLOSE_DURATION,
      easing:CLOSE_EASING,
      fill:"both"
    }
  );

  animation.id=SWIPE_ANIMATION_ID;

  animation.finished
    .then(()=>{
      /*
        Keep the sheet at the final off-screen position while its normal
        close handler removes .on. The WAAPI animation is deliberately kept
        alive until the next frame so modal-motion can recognise this as a
        swipe-owned close and does not start a second close animation.
      */
      element.style.transition="none";
      element.style.setProperty(
        config.drag,
        `${endDistance}px`
      );

      requestClose(element,config);

      finishCloseStyles(
        element,
        config,
        animation
      );
    })
    .catch(()=>{});
}

function finishGesture({
  allowClose=true
}={}){
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
  suppressSurface=state.element;

  if(shouldClose){
    animateClose(state);
    return;
  }

  snapBack(state);
}

function newGesture(
  kind,
  id,
  target,
  x,
  y
){
  const match=surfaceFromTarget(target);

  if(
    !match ||
    !headerTarget(
      target,
      match.element,
      match.config
    )
  ){
    return null;
  }

  return {
    kind,
    id,
    target,
    element:match.element,
    config:match.config,
    startX:x,
    startY:y,
    distance:0,
    started:performance.now(),
    axis:null
  };
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

document.addEventListener(
  "touchstart",
  event=>{
    if(event.touches.length!==1){
      return;
    }

    const touch=event.touches[0];
    const next=newGesture(
      "touch",
      touch.identifier,
      event.target,
      touch.clientX,
      touch.clientY
    );

    if(!next){
      return;
    }

    gesture=next;

    /* Do not let the legacy sheet gesture start for the same header touch. */
    event.stopImmediatePropagation();
  },
  {capture:true,passive:true}
);

document.addEventListener(
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
      return;
    }

    setDistance(gesture,dy);

    if(event.cancelable){
      event.preventDefault();
    }

    event.stopImmediatePropagation();
  },
  {capture:true,passive:false}
);

document.addEventListener(
  "touchend",
  event=>{
    if(
      !gesture ||
      gesture.kind!=="touch"
    ){
      return;
    }

    const touch=findTouch(
      event.changedTouches,
      gesture.id
    );

    if(
      touch &&
      gesture.axis==="y"
    ){
      setDistance(
        gesture,
        touch.clientY-gesture.startY
      );

      if(event.cancelable){
        event.preventDefault();
      }

      event.stopImmediatePropagation();
    }

    finishGesture();
  },
  {capture:true,passive:false}
);

document.addEventListener(
  "touchcancel",
  event=>{
    if(
      !gesture ||
      gesture.kind!=="touch"
    ){
      return;
    }

    if(gesture.axis==="y"){
      event.stopImmediatePropagation();
    }

    finishGesture({allowClose:false});
  },
  true
);

document.addEventListener(
  "pointerdown",
  event=>{
    if(
      event.pointerType==="touch" ||
      !event.isPrimary
    ){
      return;
    }

    const next=newGesture(
      "pointer",
      event.pointerId,
      event.target,
      event.clientX,
      event.clientY
    );

    if(!next){
      return;
    }

    gesture=next;
    event.stopImmediatePropagation();
  },
  true
);

document.addEventListener(
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
      return;
    }

    setDistance(gesture,dy);

    if(event.cancelable){
      event.preventDefault();
    }

    event.stopImmediatePropagation();
  },
  true
);

document.addEventListener(
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
      setDistance(
        gesture,
        event.clientY-gesture.startY
      );
      event.stopImmediatePropagation();
    }

    finishGesture();
  },
  true
);

document.addEventListener(
  "pointercancel",
  event=>{
    if(
      !gesture ||
      gesture.kind!=="pointer" ||
      event.pointerId!==gesture.id
    ){
      return;
    }

    if(gesture.axis==="y"){
      event.stopImmediatePropagation();
    }

    finishGesture({allowClose:false});
  },
  true
);

document.addEventListener(
  "click",
  event=>{
    if(
      performance.now()>suppressClickUntil ||
      !suppressSurface ||
      !(event.target instanceof Node) ||
      !suppressSurface.contains(event.target)
    ){
      return;
    }

    suppressClickUntil=0;
    suppressSurface=null;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true
);

document.addEventListener(
  "bottomsheetopen",
  event=>{
    const element=event.target;

    if(surfaceConfig(element)){
      resetSurface(element);
    }
  },
  true
);

document.documentElement.dataset.swipeCloseGuard=
  "ready";
