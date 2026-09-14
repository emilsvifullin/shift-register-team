const nativeAnimate=Element.prototype.animate;

const REFERENCE_EASE=
  "cubic-bezier(.22,.72,.22,1)";

function prefersReducedMotion(){
  return Boolean(
    globalThis.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches
  );
}

function keyframeArray(keyframes){
  return Array.isArray(keyframes)
    ? keyframes
    : null;
}

function isReferenceTabTransition(
  element,
  keyframes,
  options
){
  const frames=
    keyframeArray(keyframes);

  if(
    element.id!=="app" ||
    Number(options?.duration)!==220 ||
    !frames ||
    frames.length!==2
  ){
    return false;
  }

  const first=
    frames[0];

  const last=
    frames[1];

  return (
    typeof first?.transform==="string" &&
    typeof last?.transform==="string" &&
    !Object.hasOwn(first,"opacity") &&
    !Object.hasOwn(last,"opacity") &&
    (
      first.transform.includes(
        "translate3d(24px"
      ) ||
      first.transform.includes(
        "translate3d(-24px"
      )
    ) &&
    last.transform.includes(
      "translate3d(0,0,0)"
    )
  );
}

function isManageScreenTransition(
  keyframes,
  options
){
  const frames=
    keyframeArray(keyframes);

  if(
    Number(options?.duration)!==260 ||
    !frames ||
    frames.length!==2
  ){
    return false;
  }

  return frames.every(frame=>
    typeof frame?.transform==="string" &&
    Object.hasOwn(frame,"opacity")
  ) && frames.some(frame=>
    frame.transform.includes(
      "translate3d(20px"
    ) ||
    frame.transform.includes(
      "translate3d(-20px"
    )
  );
}

function widenManageTransform(value){
  if(typeof value!=="string"){
    return value;
  }

  return value
    .replace(
      "translate3d(20px",
      "translate3d(28px"
    )
    .replace(
      "translate3d(-20px",
      "translate3d(-28px"
    );
}

Element.prototype.animate=function(
  keyframes,
  options
){
  if(
    !prefersReducedMotion() &&
    isReferenceTabTransition(
      this,
      keyframes,
      options
    )
  ){
    const frames=
      keyframeArray(keyframes);

    const direction=
      frames[0].transform.includes(
        "-24px"
      )
        ? -1
        : 1;

    return nativeAnimate.call(
      this,
      [
        {
          left:`${direction*24}px`
        },
        {
          left:"0px"
        }
      ],
      {
        ...options,
        duration:250,
        easing:REFERENCE_EASE
      }
    );
  }

  if(
    !prefersReducedMotion() &&
    isManageScreenTransition(
      keyframes,
      options
    )
  ){
    return nativeAnimate.call(
      this,
      keyframeArray(keyframes)
        .map(frame=>({
          ...frame,
          transform:
            widenManageTransform(
              frame.transform
            )
        })),
      {
        ...options,
        duration:320,
        easing:REFERENCE_EASE
      }
    );
  }

  return nativeAnimate.call(
    this,
    keyframes,
    options
  );
};

const editorActions=new Map([
  [
    "sheetSave",
    {
      sheet:"sheet",
      body:"sheetBody",
      forwardText:"Изменить"
    }
  ],
  [
    "sheetCancel",
    {
      sheet:"sheet",
      body:"sheetBody",
      backText:"Назад"
    }
  ],
  [
    "employeeSheetSave",
    {
      sheet:"employeeSheet",
      body:"employeeSheetBody",
      forwardText:"Изменить"
    }
  ],
  [
    "employeeSheetCancel",
    {
      sheet:"employeeSheet",
      body:"employeeSheetBody",
      backText:"Назад"
    }
  ],
  [
    "manageEditorSave",
    {
      sheet:"manageEditorSheet",
      body:"manageEditorBody",
      forwardText:"Изменить"
    }
  ],
  [
    "manageEditorCancel",
    {
      sheet:"manageEditorSheet",
      body:"manageEditorBody",
      backText:"Назад"
    }
  ]
]);

function normalizeText(value){
  return String(value || "")
    .replace(/\s+/gu," ")
    .trim();
}

function animateEditorSurface(
  body,
  sheet,
  direction
){
  if(
    prefersReducedMotion() ||
    !sheet.classList.contains("on") ||
    typeof body.animate!=="function"
  ){
    return;
  }

  body
    .getAnimations()
    .forEach(animation=>
      animation.cancel()
    );

  const title=
    sheet.querySelector(".ttl");

  const actions=
    sheet.querySelectorAll(".shead .lnk");

  body.animate(
    [
      {
        opacity:.18,
        transform:
          `translate3d(${direction*14}px,0,0)`
      },
      {
        opacity:1,
        transform:"translate3d(0,0,0)"
      }
    ],
    {
      duration:260,
      easing:REFERENCE_EASE
    }
  );

  title?.animate(
    [
      {
        opacity:.35,
        transform:
          `translate3d(${direction*6}px,0,0)`
      },
      {
        opacity:1,
        transform:"translate3d(0,0,0)"
      }
    ],
    {
      duration:220,
      easing:REFERENCE_EASE
    }
  );

  actions.forEach(action=>{
    action.animate(
      [
        {opacity:.45},
        {opacity:1}
      ],
      {
        duration:180,
        easing:"ease-out"
      }
    );
  });
}

function queueEditorTransition(
  definition,
  direction
){
  queueMicrotask(()=>{
    requestAnimationFrame(()=>{
      const sheet=
        document.getElementById(
          definition.sheet
        );

      const body=
        document.getElementById(
          definition.body
        );

      if(!sheet || !body){
        return;
      }

      animateEditorSurface(
        body,
        sheet,
        direction
      );
    });
  });
}

document.addEventListener(
  "click",
  event=>{
    const button=
      event.target instanceof Element
        ? event.target.closest("button")
        : null;

    if(!button){
      return;
    }

    const definition=
      editorActions.get(button.id);

    if(definition){
      const text=
        normalizeText(
          button.textContent
        );

      if(
        definition.forwardText &&
        text===definition.forwardText
      ){
        queueEditorTransition(
          definition,
          1
        );

        return;
      }

      if(
        definition.backText &&
        text===definition.backText
      ){
        queueEditorTransition(
          definition,
          -1
        );

        return;
      }
    }

    if(
      button.matches(
        "[data-tariff-edit], [data-tariff-edit-cancel]"
      )
    ){
      queueEditorTransition(
        {
          sheet:"manageEditorSheet",
          body:"manageEditorBody"
        },
        button.matches(
          "[data-tariff-edit-cancel]"
        )
          ? -1
          : 1
      );
    }
  },
  true
);

document.addEventListener(
  "toggle",
  event=>{
    const details=
      event.target;

    if(
      prefersReducedMotion() ||
      !(details instanceof HTMLDetailsElement) ||
      !details.open ||
      !details.classList.contains(
        "tariff-history-item"
      )
    ){
      return;
    }

    const body=
      details.querySelector(
        ".tariff-history-body"
      );

    body?.animate(
      [
        {
          opacity:0,
          transform:"translate3d(0,-6px,0)"
        },
        {
          opacity:1,
          transform:"translate3d(0,0,0)"
        }
      ],
      {
        duration:220,
        easing:REFERENCE_EASE
      }
    );
  },
  true
);

document.documentElement.dataset.teamMotion=
  "reference";
