const STYLE_ID="shift-register-modal-motion-style";
const MOTION_PREFIX="shift-register-modal-";

const reducedMotion=()=>Boolean(
  globalThis.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches
);

function ensureReferenceStyles(){
  if(document.getElementById(STYLE_ID)){
    return;
  }

  const link=document.createElement("link");
  link.id=STYLE_ID;
  link.rel="stylesheet";
  link.href=new URL(
    "../styles/modal-motion-exact.css",
    import.meta.url
  ).href;

  document.head.append(link);
}

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

    return {
      hiddenTransform:
        "translate3d(0,calc(100% + 24px),0)",
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

function cancelReferenceAnimations(element){
  element
    .getAnimations()
    .filter(isReferenceAnimation)
    .forEach(animation=>{
      animation.cancel();
    });
}

function playReferenceModalMotion(
  element,
  opening
){
  if(reducedMotion()){
    return;
  }

  const spec=modalSpec(element);

  if(!spec){
    return;
  }

  /*
    bindBottomSheetDismiss already owns the gesture-close animation.
    Do not replace that animation when the user physically drags a sheet.
  */
  if(
    !opening &&
    element
      .getAnimations()
      .some(isSwipeCloseAnimation)
  ){
    return;
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

  transformAnimation.finished
    .catch(()=>{})
    .finally(()=>{
      transformAnimation.cancel();
    });

  if(!spec.opacityDuration){
    return;
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
}

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

        playReferenceModalMotion(
          element,
          isOpen
        );
      }
    }
  );

ensureReferenceStyles();

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
