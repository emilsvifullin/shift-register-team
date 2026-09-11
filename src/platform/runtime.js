const PLATFORM_STYLESHEET="./styles/platform.css";
const TAB_SELECTOR='[role="tab"][aria-controls="app"]';

let installed=false;
let resizeFrame=0;
let tabObserver=null;

function ensurePlatformStyles(){
  if(
    typeof document==="undefined" ||
    document.querySelector('link[data-sr-platform]')
  ){
    return;
  }

  const link=document.createElement("link");
  link.rel="stylesheet";
  link.href=PLATFORM_STYLESHEET;
  link.dataset.srPlatform="";
  document.head.append(link);
}

function setCapabilityFlags(){
  if(typeof document==="undefined") return;

  const root=document.documentElement;
  const coarse=globalThis.matchMedia?.(
    "(hover:none) and (pointer:coarse)"
  ).matches===true;
  const standalone=
    globalThis.matchMedia?.("(display-mode:standalone)").matches===true ||
    globalThis.navigator?.standalone===true;

  root.dataset.pointer=coarse ? "coarse" : "fine";
  root.dataset.displayMode=standalone ? "standalone" : "browser";
}

function updateViewportMetrics(){
  if(typeof document==="undefined") return;

  const viewport=globalThis.visualViewport;
  const height=viewport?.height || globalThis.innerHeight || 0;
  const width=viewport?.width || globalThis.innerWidth || 0;
  const offsetTop=viewport?.offsetTop || 0;

  const root=document.documentElement;
  root.style.setProperty("--app-height",`${Math.round(height)}px`);
  root.style.setProperty("--app-width",`${Math.round(width)}px`);
  root.style.setProperty("--visual-offset-top",`${Math.round(offsetTop)}px`);
}

function scheduleViewportMetrics(){
  globalThis.cancelAnimationFrame?.(resizeFrame);
  resizeFrame=globalThis.requestAnimationFrame?.(
    updateViewportMetrics
  ) || 0;
}

function tabs(){
  return Array.from(document.querySelectorAll(TAB_SELECTOR))
    .filter(tab=>!tab.hidden);
}

function selectedTab(){
  return tabs().find(tab=>tab.getAttribute("aria-selected")==="true") || null;
}

function syncTabPanelLabel(){
  const panel=document.getElementById("app");
  const selected=selectedTab();

  if(!panel || !selected?.id) return;

  panel.setAttribute("aria-labelledby",selected.id);
  panel.setAttribute("tabindex","0");
}

function moveTabFocus(target){
  if(!(target instanceof HTMLElement)) return;
  target.focus({preventScroll:true});
  target.click();
}

function handleTabKeyboard(event){
  const current=event.target instanceof Element
    ? event.target.closest(TAB_SELECTOR)
    : null;

  if(!current || current.hidden) return;

  const items=tabs();
  const index=items.indexOf(current);
  if(index<0) return;

  let target=null;

  if(event.key==="Home"){
    target=items[0];
  }else if(event.key==="End"){
    target=items.at(-1);
  }

  if(!target) return;

  event.preventDefault();
  moveTabFocus(target);
}

function installTabContract(){
  if(typeof document==="undefined") return;

  syncTabPanelLabel();
  document.addEventListener("keydown",handleTabKeyboard,true);

  const tablist=document.querySelector('[role="tablist"]');
  if(!tablist || typeof MutationObserver==="undefined") return;

  tabObserver=new MutationObserver(syncTabPanelLabel);
  tabObserver.observe(tablist,{
    subtree:true,
    attributes:true,
    attributeFilter:["aria-selected","hidden"]
  });
}

function installViewportContract(){
  updateViewportMetrics();
  globalThis.addEventListener?.("resize",scheduleViewportMetrics,{passive:true});
  globalThis.addEventListener?.("orientationchange",scheduleViewportMetrics,{passive:true});
  globalThis.visualViewport?.addEventListener(
    "resize",
    scheduleViewportMetrics,
    {passive:true}
  );
  globalThis.visualViewport?.addEventListener(
    "scroll",
    scheduleViewportMetrics,
    {passive:true}
  );
}

function start(){
  ensurePlatformStyles();
  setCapabilityFlags();
  installViewportContract();
  installTabContract();
}

export function installPlatformRuntime(){
  if(installed || typeof document==="undefined") return;
  installed=true;

  if(document.readyState==="loading"){
    ensurePlatformStyles();
    installViewportContract();
    document.addEventListener("DOMContentLoaded",()=>{
      setCapabilityFlags();
      installTabContract();
    },{once:true});
    return;
  }

  start();
}

export function refreshPlatformRuntime(){
  setCapabilityFlags();
  updateViewportMetrics();
  syncTabPanelLabel();
}

export function disposePlatformRuntime(){
  tabObserver?.disconnect();
  tabObserver=null;
}
