const MOTION_PREFIX="shift-register-modal-";
const SWIPE_ANIMATION_ID="header-swipe-dismiss";
const SWIPE_TRANSFORM=
  /translate3d\(\s*0(?:px)?\s*,\s*(\d+(?:\.\d+)?)px\s*,\s*0(?:px)?\s*\)/u;
const closingVisibilityTimers=new WeakMap();

const reducedMotion=()=>Boolean(
  globalThis.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches
);

function modalSpec(element){
  if(element.classList.contains("sheet")){
    return {
      hiddenTransform:
        "translate3d(0,calc(100% + 24px),0)",
      openTransform:
        "translate3d(0,0,0)",
      transformDuration:480,
      opacityDuration:300,
      hiddenOpacity:.96
    };
  }

  if(element.id==="pointPicker"){
    if(
      element.classList.contains(
        "app-picker-anchored"
      )
    ){
      return null;
    }

    /*
      Picker стоит над нижней границей экрана на safe-area, поэтому ход
      закрытия включает её так же, как у датапикера. Без неё на iPhone с
      домашним индикатором окно не доезжало до края: верхняя кромка
      оставалась видимой и пропадала отдельным кадром вместе с display:none.
    */
    return {
      hiddenTransform:
        "translate3d(0,calc(100% + 24px + env(safe-area-inset-bottom)),0)",
      openTransform:
        "translate3d(0,0,0)",
      transformDuration:420,
      opacityDuration:270,
      hiddenOpacity:.96
    };
  }

  if(element.id==="datePicker"){
    return {
      hiddenTransform:
        "translate3d(0,calc(100% + 24px + env(safe-area-inset-bottom)),0)",
      openTransform:
        "translate3d(0,0,0)",
      transformDuration:420,
      opacityDuration:270,
      hiddenOpacity:.96
    };
  }

  if(element.id==="monthPicker"){
    return {
      hiddenTransform:
        "translate3d(0,calc(100% + 24px + env(safe-area-inset-bottom)),0)",
      openTransform:
        "translate3d(0,0,0)",
      transformDuration:420,
      opacityDuration:0,
      hiddenOpacity:1
    };
  }

  return null;
}

function isTrackedModal(element){
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

function isReferenceAnimation(animation){
  return String(
    animation.id || ""
  ).startsWith(MOTION_PREFIX);
}

function isCssTransition(animation){
  return (
    typeof globalThis.CSSTransition==="function" &&
    animation instanceof globalThis.CSSTransition
  );
}

function isSwipeCloseAnimation(animation){
  if(animation.id===SWIPE_ANIMATION_ID){
    return true;
  }

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

  /*
    getKeyframes() returns serialized values: "translate3d(0,140px,0)" comes
    back as "translate3d(0px, 140px, 0px)" in Chromium and WebKit. Matching only
    the source spelling never recognized a swipe close, so the reference close
    replayed from the fully-open pose right after the sheet left the screen.
  */
  return frames.some(frame=>{
    const match=
      typeof frame?.transform==="string"
        ? SWIPE_TRANSFORM.exec(frame.transform)
        : null;

    return Boolean(match) && Number(match[1])>0;
  });
}

function monthPickerAlreadyDismissedBySwipe(element){
  if(
    element.id!=="monthPicker" ||
    !element.style.transform
  ){
    return false;
  }

  const rect=element.getBoundingClientRect();

  return (
    rect.top>=globalThis.innerHeight-2 ||
    rect.bottom<=0
  );
}

function cancelReferenceAnimations(element){
  element
    .getAnimations()
    .filter(isReferenceAnimation)
    .forEach(animation=>{
      animation.cancel();
    });
}

function clearClosingVisibilityGuard(element){
  const timer=
    closingVisibilityTimers.get(element);

  if(timer){
    clearTimeout(timer);
  }

  closingVisibilityTimers.delete(element);
  element.removeAttribute(
    "data-reference-closing"
  );
}

function guardClosingVisibility(
  element,
  duration
){
  clearClosingVisibilityGuard(element);

  element.setAttribute(
    "data-reference-closing",
    "true"
  );

  const timer=
    setTimeout(()=>{
      closingVisibilityTimers.delete(
        element
      );

      element.removeAttribute(
        "data-reference-closing"
      );
    },duration+32);

  closingVisibilityTimers.set(
    element,
    timer
  );
}

function playReferenceModalMotion(
  element,
  opening
){
  if(reducedMotion()){
    return false;
  }

  const spec=modalSpec(element);

  if(!spec){
    return false;
  }

  if(opening){
    clearClosingVisibilityGuard(element);
  }

  if(
    !opening &&
    monthPickerAlreadyDismissedBySwipe(
      element
    )
  ){
    clearClosingVisibilityGuard(element);
    cancelReferenceAnimations(element);
    return false;
  }

  if(
    !opening &&
    element
      .getAnimations()
      .some(isSwipeCloseAnimation)
  ){
    return false;
  }

  cancelReferenceAnimations(element);

  const transformFrames=
    opening
      ? [
          {
            transform:
              spec.hiddenTransform
          },
          {
            transform:
              spec.openTransform
          }
        ]
      : [
          {
            transform:
              spec.openTransform
          },
          {
            transform:
              spec.hiddenTransform
          }
        ];

  const transformAnimation=
    element.animate(
      transformFrames,
      {
        duration:
          spec.transformDuration,
        easing:
          "cubic-bezier(.4,0,.2,1)",
        fill:"both"
      }
    );

  transformAnimation.id=
    `${MOTION_PREFIX}transform`;

  if(!opening){
    guardClosingVisibility(
      element,
      spec.transformDuration
    );
  }

  transformAnimation.finished
    .catch(()=>{})
    .finally(()=>{
      transformAnimation.cancel();
    });

  if(!spec.opacityDuration){
    return true;
  }

  const opacityFrames=
    opening
      ? [
          {
            opacity:
              spec.hiddenOpacity
          },
          {
            opacity:1
          }
        ]
      : [
          {
            opacity:1
          },
          {
            opacity:
              spec.hiddenOpacity
          }
        ];

  const opacityAnimation=
    element.animate(
      opacityFrames,
      {
        duration:
          spec.opacityDuration,
        easing:"ease",
        fill:"both"
      }
    );

  opacityAnimation.id=
    `${MOTION_PREFIX}opacity`;

  opacityAnimation.finished
    .catch(()=>{})
    .finally(()=>{
      opacityAnimation.cancel();
    });

  return true;
}

const pendingOpenFrames=new WeakMap();

function clearPendingOpen(
  element,
  {restoreStyles=true}={}
){
  const pending=
    pendingOpenFrames.get(element);

  if(pending?.first){
    cancelAnimationFrame(
      pending.first
    );
  }

  if(pending?.second){
    cancelAnimationFrame(
      pending.second
    );
  }

  pendingOpenFrames.delete(element);

  if(restoreStyles){
    element.style.removeProperty(
      "transform"
    );

    element.style.removeProperty(
      "opacity"
    );
  }
}

function stageReferenceOpen(element){
  clearClosingVisibilityGuard(element);

  if(reducedMotion()){
    clearPendingOpen(element);
    return;
  }

  const spec=modalSpec(element);

  if(!spec){
    return;
  }

  clearPendingOpen(element);
  cancelReferenceAnimations(element);

  /*
    Keep the modal fully below the viewport for a real painted frame before
    starting the entrance. WebKit/PWA can otherwise coalesce display:block
    and .on and make a 480ms transition look almost instantaneous.
  */
  element.style.transform=
    spec.hiddenTransform;

  if(spec.opacityDuration){
    element.style.opacity=
      String(spec.hiddenOpacity);
  }

  void element.offsetHeight;

  const pending={
    first:0,
    second:0
  };

  pending.first=
    requestAnimationFrame(()=>{
      pending.first=0;

      pending.second=
        requestAnimationFrame(()=>{
          pending.second=0;

          if(
            !element.classList.contains(
              "on"
            )
          ){
            clearPendingOpen(element);
            return;
          }

          playReferenceModalMotion(
            element,
            true
          );

          element.style.removeProperty(
            "transform"
          );

          element.style.removeProperty(
            "opacity"
          );

          pendingOpenFrames.delete(
            element
          );
        });
    });

  pendingOpenFrames.set(
    element,
    pending
  );
}

document.addEventListener(
  "bottomsheetopen",
  event=>{
    const element=event.target;

    if(!isTrackedModal(element)){
      return;
    }

    stageReferenceOpen(element);
  },
  true
);

const observer=
  new MutationObserver(
    mutations=>{
      for(const mutation of mutations){
        const element=
          mutation.target;

        if(!isTrackedModal(element)){
          continue;
        }

        const oldClass=
          mutation.oldValue || "";

        const wasOpen=
          /(?:^|\s)on(?:\s|$)/u
            .test(oldClass);

        const isOpen=
          element.classList.contains(
            "on"
          );

        if(wasOpen===isOpen){
          continue;
        }

        if(reducedMotion()){
          clearPendingOpen(element);
          clearClosingVisibilityGuard(element);
          cancelReferenceAnimations(element);
          continue;
        }

        if(isOpen){
          if(
            !pendingOpenFrames.has(
              element
            )
          ){
            stageReferenceOpen(
              element
            );
          }

          continue;
        }

        clearPendingOpen(element);

        playReferenceModalMotion(
          element,
          false
        );
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

document.documentElement.dataset.modalMotion=
  "shift-register";
