const GUARD_ATTRIBUTE="data-reference-closing";
const REFERENCE_PREFIX="shift-register-modal-";
const guardTimers=new WeakMap();

function isReferenceAnimation(animation){
  return String(
    animation.id || ""
  ).startsWith(REFERENCE_PREFIX);
}

function isCssTransition(animation){
  return (
    typeof globalThis.CSSTransition==="function" &&
    animation instanceof globalThis.CSSTransition
  );
}

function isSwipeCloseAnimation(animation){
  if(
    isReferenceAnimation(animation) ||
    isCssTransition(animation)
  ){
    return false;
  }

  const frames=
    animation.effect?.getKeyframes?.();

  if(!Array.isArray(frames)){
    return false;
  }

  return frames.some(frame=>
    typeof frame?.transform==="string" &&
    /translate3d\(0,\s*\d+(?:\.\d+)?px,\s*0\)/u
      .test(frame.transform)
  );
}

function trackedSurface(element){
  return (
    element instanceof HTMLElement &&
    (
      element.classList.contains("sheet") ||
      element.id==="pointPicker" ||
      element.id==="datePicker" ||
      element.id==="monthPicker"
    )
  );
}

function clearGuard(element){
  const timer=guardTimers.get(element);

  if(timer){
    clearTimeout(timer);
  }

  guardTimers.delete(element);
  element.removeAttribute(GUARD_ATTRIBUTE);
}

function remainingDuration(animation){
  const timing=
    animation.effect?.getTiming?.();

  const duration=
    Number(timing?.duration);

  if(!Number.isFinite(duration)){
    return 420;
  }

  const currentTime=
    Number(animation.currentTime);

  if(!Number.isFinite(currentTime)){
    return Math.max(0,duration);
  }

  return Math.max(
    0,
    duration-currentTime
  );
}

function guardSwipeClose(
  element,
  animation
){
  clearGuard(element);

  element.setAttribute(
    GUARD_ATTRIBUTE,
    "true"
  );

  /*
    Team editors can request display:none only 100 ms after close starts.
    A header swipe owns its own 420 ms WAAPI exit, so keep the surface
    rendered until that animation has painted its final frame.
  */
  const timeout=
    Math.max(
      48,
      remainingDuration(animation)+48
    );

  const timer=setTimeout(()=>{
    guardTimers.delete(element);
    element.removeAttribute(
      GUARD_ATTRIBUTE
    );
  },timeout);

  guardTimers.set(element,timer);
}

document.addEventListener(
  "bottomsheetopen",
  event=>{
    const element=event.target;

    if(trackedSurface(element)){
      clearGuard(element);
    }
  },
  true
);

const observer=new MutationObserver(
  mutations=>{
    for(const mutation of mutations){
      const element=mutation.target;

      if(!trackedSurface(element)){
        continue;
      }

      const previous=
        mutation.oldValue || "";

      const wasOpen=
        /(?:^|\s)on(?:\s|$)/u
          .test(previous);

      const isOpen=
        element.classList.contains("on");

      if(!wasOpen && isOpen){
        clearGuard(element);
        continue;
      }

      if(!wasOpen || isOpen){
        continue;
      }

      const swipeAnimation=
        element
          .getAnimations()
          .find(isSwipeCloseAnimation);

      if(swipeAnimation){
        guardSwipeClose(
          element,
          swipeAnimation
        );
      }
    }
  }
);

observer.observe(
  document.documentElement,
  {
    attributes:true,
    attributeFilter:["class"],
    attributeOldValue:true,
    subtree:true
  }
);

document.documentElement.dataset.swipeCloseGuard=
  "ready";
