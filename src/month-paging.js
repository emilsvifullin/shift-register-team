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

function animateElement(element,keyframes,options){
  if(
    !(element instanceof HTMLElement) ||
    typeof element.animate!=="function" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ){
    return Promise.resolve();
  }

  const animation=element.animate(keyframes,options);

  return animation.finished
    .catch(()=>{})
    .finally(()=>animation.cancel());
}

async function runTransition(direction){
  settling=true;
  const app=document.getElementById("app");
  const period=document.getElementById("period");
  const outX=direction>0 ? -12 : 12;
  const inX=-outX;
  const options={
    duration:220,
    easing:"cubic-bezier(.22,.72,.22,1)",
    fill:"both"
  };

  try{
    await Promise.all([
      animateElement(
        app,
        [
          {opacity:1,transform:"translate3d(0,0,0)"},
          {opacity:.15,transform:`translate3d(${outX}px,0,0)`}
        ],
        {...options,duration:105}
      ),
      animateElement(
        period,
        [
          {opacity:1,transform:"translate3d(0,0,0)"},
          {opacity:.15,transform:`translate3d(${outX*.45}px,0,0)`}
        ],
        {...options,duration:105}
      )
    ]);

    invokeMonthButton(direction);

    await Promise.all([
      animateElement(
        app,
        [
          {opacity:.15,transform:`translate3d(${inX}px,0,0)`},
          {opacity:1,transform:"translate3d(0,0,0)"}
        ],
        {...options,duration:115}
      ),
      animateElement(
        period,
        [
          {opacity:.15,transform:`translate3d(${inX*.45}px,0,0)`},
          {opacity:1,transform:"translate3d(0,0,0)"}
        ],
        {...options,duration:115}
      )
    ]);
  }finally{
    settling=false;
    suppressClickUntil=performance.now()+300;
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

  suppressClickUntil=performance.now()+400;

  if(horizontal && (enoughDistance || fastSwipe)){
    void runTransition(dx<0 ? 1 : -1);
  }
}

function cancelGesture(event){
  if(!gesture) return;

  const current=gesture;
  gesture=null;
  document.body.classList.remove("month-swiping");

  if(current.axis==="x"){
    event.stopImmediatePropagation();
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
