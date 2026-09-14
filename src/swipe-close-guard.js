const GUARD_ATTRIBUTE="data-reference-closing";
const REFERENCE_PREFIX="shift-register-modal-";
const guardTimers=new WeakMap();
const releaseTransforms=new WeakMap();

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

function surfaceFromTarget(target){
  if(!(target instanceof Element)){
    return null;
  }

  const element=target.closest(
    ".sheet,#pointPicker,#datePicker,#monthPicker"
  );

  return trackedSurface(element)
    ? element
    : null;
}

function rememberReleaseTransform(event){
  const element=
    surfaceFromTarget(event.target);

  if(
    !element ||
    !element.classList.contains("on")
  ){
    return;
  }

  const transform=
    getComputedStyle(element).transform;

  if(
    transform &&
    transform!=="none"
  ){
    releaseTransforms.set(
      element,
      transform
    );
  }
}

/*
  Capture the exact painted position before app.js handles the release.
  On iOS the final touch coordinate can be a little ahead of the last
  rendered drag frame. Starting the exit from this computed transform keeps
  the sheet continuous instead of letting it jump to another Y position.
*/
document.addEventListener(
  "touchend",
  rememberReleaseTransform,
  true
);

document.addEventListener(
  "pointerup",
  event=>{
    if(event.pointerType!=="touch"){
      rememberReleaseTransform(event);
    }
  },
  true
);

function clearGuard(element){
  const timer=guardTimers.get(element);

  if(timer){
    clearTimeout(timer);
  }

  guardTimers.delete(element);
  releaseTransforms.delete(element);
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

function stabilizeSwipeClose(
  element,
  animation
){
  const frames=
    animation.effect?.getKeyframes?.();

  const releaseTransform=
    releaseTransforms.get(element);

  const endTransform=
    Array.isArray(frames)
      ? frames.at(-1)?.transform
      : null;

  if(
    releaseTransform &&
    typeof endTransform==="string" &&
    endTransform
  ){
    try{
      animation.effect.setKeyframes([
        {
          offset:0,
          transform:releaseTransform
        },
        {
          offset:1,
          transform:endTransform
        }
      ]);
    }catch{}
  }

  releaseTransforms.delete(element);

  /*
    app.js removes the temporary swipe WAAPI animation when its 420 ms exit
    finishes. If CSS transitions are active at that exact moment, WebKit can
    expose the underlying open pose for one frame and then start a second
    CSS close. That is the visible "up, then down" jerk from the recording.

    Keep the underlying transform transition disabled for the swipe-owned
    exit. When WAAPI releases the property, the closed CSS pose is applied
    immediately off-screen, so there is no second trip from the top.
  */
  element.style.transition="none";
}

function guardSwipeClose(
  element,
  animation
){
  clearGuard(element);
  stabilizeSwipeClose(
    element,
    animation
  );

  element.setAttribute(
    GUARD_ATTRIBUTE,
    "true"
  );

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
