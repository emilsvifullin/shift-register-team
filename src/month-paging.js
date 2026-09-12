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

function surfaces(){
  return [
    document.getElementById("app"),
    document.getElementById("period")
  ].filter(element=>element instanceof HTMLElement);
}

function clampDrag(dx){
  const width=Math.max(
    1,
    document.documentElement.clientWidth ||
      window.innerWidth ||
      1
  );

  return Math.max(-width,Math.min(width,dx));
}

function setOffset(dx){
  const value=clampDrag(dx);

  for(const element of surfaces()){
    element.style.transition="none";
    element.style.willChange="transform";
    element.style.transform=
      `translate3d(${value}px,0,0)`;
  }
}

function clearInlineMotion(){
  for(const element of surfaces()){
    element.style.removeProperty("transition");
    element.style.removeProperty("will-change");
    element.style.removeProperty("transform");
  }
}

function animateOffset(from,to,duration){
  const items=surfaces();

  if(
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    !items.every(element=>typeof element.animate==="function")
  ){
    clearInlineMotion();
    return Promise.resolve();
  }

  const animations=items.map(element=>{
    element.style.transition="none";
    element.style.willChange="transform";
    element.style.transform=`translate3d(${to}px,0,0)`;

    return element.animate(
      [
        {transform:`translate3d(${from}px,0,0)`},
        {transform:`translate3d(${to}px,0,0)`}
      ],
      {
        duration,
        easing:"cubic-bezier(.2,.8,.2,1)",
        fill:"both"
      }
    );
  });

  return Promise.allSettled(
    animations.map(animation=>animation.finished)
  ).finally(()=>{
    animations.forEach(animation=>animation.cancel());
  });
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
      button.onclick.call(button,new MouseEvent("click"));
    }else{
      button.click();
    }
  });
}

async function commitSwipe(dx,direction){
  settling=true;

  const width=Math.max(
    1,
    document.documentElement.clientWidth ||
      window.innerWidth ||
      1
  );
  const edge=direction>0 ? -width : width;
  const start=clampDrag(dx);

  try{
    await animateOffset(start,edge,Math.max(90,Math.min(160,160-Math.abs(start)*.15)));

    clearInlineMotion();
    invokeMonthButton(direction);

    const incoming=direction>0 ? width : -width;
    setOffset(incoming);

    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await animateOffset(incoming,0,210);
  }finally{
    clearInlineMotion();
    settling=false;
    suppressClickUntil=performance.now()+350;
  }
}

async function cancelSwipe(dx){
  settling=true;

  try{
    await animateOffset(clampDrag(dx),0,170);
  }finally{
    clearInlineMotion();
    settling=false;
  }
}

function touchById(list,id){
  for(let index=0;index<list.length;index+=1){
    if(list[index].identifier===id) return list[index];
  }
  return null;
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

  const touch=touchById(event.touches,gesture.id);
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
      document.body.classList.add("month-swiping");
    }else if(absY>=14 && absY>absX*1.25){
      gesture.axis="y";
      return;
    }else{
      return;
    }
  }

  if(gesture.axis!=="x") return;

  if(event.cancelable) event.preventDefault();
  event.stopImmediatePropagation();
  setOffset(dx);
}

function finishGesture(event){
  if(!gesture) return;

  const current=gesture;
  gesture=null;

  if(current.axis!=="x") return;

  event.stopImmediatePropagation();
  document.body.classList.remove("month-swiping");

  const touch=touchById(event.changedTouches,current.id);
  const endX=touch?.clientX ?? current.lastX;
  const endY=touch?.clientY ?? current.lastY;
  const dx=endX-current.x;
  const dy=endY-current.y;
  const absX=Math.abs(dx);
  const absY=Math.abs(dy);
  const elapsed=Math.max(1,performance.now()-current.started);
  const velocity=absX/elapsed;

  const horizontal=absX>absY*1.08;
  const enoughDistance=absX>=38;
  const fastSwipe=absX>=22 && velocity>=0.30;

  suppressClickUntil=performance.now()+450;

  if(horizontal && (enoughDistance || fastSwipe)){
    void commitSwipe(dx,dx<0 ? 1 : -1);
  }else{
    void cancelSwipe(dx);
  }
}

function cancelGesture(event){
  if(!gesture) return;

  const current=gesture;
  gesture=null;
  document.body.classList.remove("month-swiping");

  if(current.axis==="x"){
    event.stopImmediatePropagation();
    const dx=current.lastX-current.x;
    void cancelSwipe(dx);
  }
}

document.addEventListener("touchstart",startGesture,{capture:true,passive:true});
document.addEventListener("touchmove",moveGesture,{capture:true,passive:false});
document.addEventListener("touchend",finishGesture,{capture:true,passive:true});
document.addEventListener("touchcancel",cancelGesture,{capture:true,passive:true});

document.addEventListener(
  "click",
  event=>{
    if(performance.now()>suppressClickUntil) return;
    suppressClickUntil=0;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true
);
