const ACTIVE_TABS=new Set(["tab-shifts","tab-stats"]);
const BLOCKED_START="input,textarea,select,a,button:not(.sh),[contenteditable='true']";
const MODAL_CLASSES=[
  "sheet-open",
  "point-picker-open",
  "month-picker-open",
  "date-picker-open",
  "employee-sheet-open",
  "employee-filter-open",
  "shift-filter-open",
  "manage-editor-open"
];

let gesture=null;
let settling=false;
let suppressClickUntil=0;

function selectedTab(){
  return document.querySelector(
    ".tabs [role='tab'][aria-selected='true']"
  )?.id || "";
}

function swipeEnabled(){
  if(!ACTIVE_TABS.has(selectedTab())) return false;
  if(settling) return false;

  return !MODAL_CLASSES.some(name=>
    document.body.classList.contains(name)
  );
}

function blockedStart(target){
  return !(target instanceof Element) ||
    Boolean(target.closest(BLOCKED_START));
}

function touchById(list,id){
  for(let index=0;index<list.length;index+=1){
    if(list[index].identifier===id) return list[index];
  }

  return null;
}

function prefersReducedMotion(){
  return window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches===true;
}

function withReducedMotion(callback){
  const original=window.matchMedia;

  if(typeof original!=="function"){
    callback();
    return;
  }

  window.matchMedia=function(query){
    if(query==="(prefers-reduced-motion: reduce)"){
      return {matches:true};
    }

    return original.call(window,query);
  };

  try{
    callback();
  }finally{
    window.matchMedia=original;
  }
}

function invokeMonthButton(direction){
  const button=document.getElementById(
    direction>0 ? "nextM" : "prevM"
  );

  if(!(button instanceof HTMLButtonElement)) return;

  withReducedMotion(()=>{
    if(typeof button.onclick==="function"){
      button.onclick.call(
        button,
        new MouseEvent("click")
      );
    }else{
      button.click();
    }
  });
}

function transitionTargets(){
  return [
    {
      element:document.getElementById("app"),
      distance:14
    },
    {
      element:document.getElementById("period"),
      distance:6
    }
  ].filter(item=>
    item.element instanceof HTMLElement
  );
}

function animateTargets(
  direction,
  phase
){
  const incoming=phase==="in";
  const items=transitionTargets();

  if(
    prefersReducedMotion() ||
    !items.every(item=>
      typeof item.element.animate==="function"
    )
  ){
    return Promise.resolve();
  }

  const animations=items.map(({element,distance})=>{
    const signed=
      (direction>0 ? -1 : 1)*distance;

    const fromTransform=incoming
      ? `translate3d(${-signed}px,0,0)`
      : "translate3d(0,0,0)";

    const toTransform=incoming
      ? "translate3d(0,0,0)"
      : `translate3d(${signed}px,0,0)`;

    const animation=element.animate(
      [
        {
          opacity:incoming ? .94 : 1,
          transform:fromTransform
        },
        {
          opacity:incoming ? 1 : .94,
          transform:toTransform
        }
      ],
      {
        duration:incoming ? 145 : 95,
        easing:incoming
          ? "cubic-bezier(.2,.8,.2,1)"
          : "cubic-bezier(.4,0,.8,.2)",
        fill:"both"
      }
    );

    return animation;
  });

  return Promise.allSettled(
    animations.map(animation=>
      animation.finished
    )
  ).finally(()=>{
    animations.forEach(animation=>
      animation.cancel()
    );
  });
}

async function transitionMonth(direction){
  if(settling) return;
  settling=true;

  try{
    await animateTargets(
      direction,
      "out"
    );

    invokeMonthButton(direction);

    await new Promise(resolve=>
      requestAnimationFrame(()=>
        requestAnimationFrame(resolve)
      )
    );

    await animateTargets(
      direction,
      "in"
    );
  }finally{
    settling=false;
    suppressClickUntil=
      performance.now()+350;
  }
}

function startGesture(event){
  if(
    !swipeEnabled() ||
    event.touches.length!==1 ||
    blockedStart(event.target)
  ){
    gesture=null;
    return;
  }

  const touch=event.touches[0];

  gesture={
    id:touch.identifier,
    x:touch.clientX,
    y:touch.clientY,
    lastX:touch.clientX,
    lastY:touch.clientY,
    started:performance.now(),
    axis:null
  };
}

function moveGesture(event){
  if(!gesture || settling) return;

  const touch=touchById(
    event.touches,
    gesture.id
  );

  if(!touch) return;

  gesture.lastX=touch.clientX;
  gesture.lastY=touch.clientY;

  const dx=touch.clientX-gesture.x;
  const dy=touch.clientY-gesture.y;
  const absX=Math.abs(dx);
  const absY=Math.abs(dy);

  if(gesture.axis===null){
    if(absX<8 && absY<8) return;

    if(absX>=10 && absX>absY*1.10){
      gesture.axis="x";
    }else if(absY>=14 && absY>absX*1.25){
      gesture.axis="y";
      return;
    }else{
      return;
    }
  }

  if(gesture.axis!=="x") return;

  if(event.cancelable){
    event.preventDefault();
  }

  /*
    Никакого движения страницы за пальцем.
    Мы только распознаём жест, а после
    отпускания делаем короткий спокойный
    переход между месяцами.
  */
  event.stopImmediatePropagation();
}

function finishGesture(event){
  if(!gesture) return;

  const current=gesture;
  gesture=null;

  if(current.axis!=="x") return;

  event.stopImmediatePropagation();

  const touch=touchById(
    event.changedTouches,
    current.id
  );

  const endX=touch?.clientX ?? current.lastX;
  const endY=touch?.clientY ?? current.lastY;
  const dx=endX-current.x;
  const dy=endY-current.y;
  const absX=Math.abs(dx);
  const absY=Math.abs(dy);
  const elapsed=
    Math.max(
      1,
      performance.now()-current.started
    );
  const velocity=absX/elapsed;

  const horizontal=
    absX>absY*1.08;

  const enoughDistance=
    absX>=38;

  const fastSwipe=
    absX>=22 &&
    velocity>=0.30;

  suppressClickUntil=
    performance.now()+450;

  if(
    horizontal &&
    (enoughDistance || fastSwipe)
  ){
    void transitionMonth(
      dx<0 ? 1 : -1
    );
  }
}

function cancelGesture(event){
  if(!gesture) return;

  const horizontal=
    gesture.axis==="x";

  gesture=null;

  if(horizontal){
    event.stopImmediatePropagation();
  }
}

document.addEventListener(
  "touchstart",
  startGesture,
  {capture:true,passive:true}
);

document.addEventListener(
  "touchmove",
  moveGesture,
  {capture:true,passive:false}
);

document.addEventListener(
  "touchend",
  finishGesture,
  {capture:true,passive:true}
);

document.addEventListener(
  "touchcancel",
  cancelGesture,
  {capture:true,passive:true}
);

document.addEventListener(
  "click",
  event=>{
    if(
      performance.now()>
      suppressClickUntil
    ){
      return;
    }

    suppressClickUntil=0;

    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true
);
