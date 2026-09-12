const MANAGE_RETRY_INTERVAL=90;
const MANAGE_RETRY_TIMEOUT=720;

function closestElement(
  target,
  selector
){
  return target?.closest?.(selector) || null;
}

export function installManagementNavigation({
  windowRef=window,
  documentRef=document
}={}){
  const panel=
    documentRef.getElementById("app");

  const previous=
    documentRef.getElementById("prevM");

  const next=
    documentRef.getElementById("nextM");

  if(!panel || !previous){
    return ()=>{};
  }

  documentRef.body.dataset.managementNavigation=
    "ready";

  let reconcileFrame=0;
  let retryTimer=0;
  let retryToken=0;
  let syntheticSectionClick=false;

  const activeManage=()=>
    documentRef.body.dataset.activeTab===
      "manage";

  const sourceBack=()=>
    panel.querySelector(
      ":scope > #manageBack"
    );

  const detailOpen=()=>
    activeManage() &&
    Boolean(sourceBack());

  const syncHeaderBack=()=>{
    reconcileFrame=0;

    if(detailOpen()){
      previous.classList.remove(
        "is-hidden"
      );

      previous.disabled=false;
      previous.dataset.manageBackProxy=
        "true";

      previous.setAttribute(
        "aria-label",
        "Назад в управление"
      );

      if(next){
        next.classList.add(
          "is-hidden"
        );
        next.disabled=true;
      }

      return;
    }

    if(
      previous.dataset.manageBackProxy!==
        "true"
    ){
      return;
    }

    delete previous.dataset.manageBackProxy;
    previous.setAttribute(
      "aria-label",
      "Назад"
    );

    if(activeManage()){
      previous.classList.add(
        "is-hidden"
      );
      previous.disabled=true;
    }
  };

  const queueHeaderSync=()=>{
    if(reconcileFrame){
      return;
    }

    reconcileFrame=
      windowRef.requestAnimationFrame(
        syncHeaderBack
      );
  };

  const clearRetry=()=>{
    retryToken++;

    if(retryTimer){
      windowRef.clearTimeout(
        retryTimer
      );
      retryTimer=0;
    }
  };

  const sectionButton=section=>
    Array.from(
      panel.querySelectorAll(
        "[data-manage-section]"
      )
    ).find(button=>
      button.dataset.manageSection===
        section
    ) || null;

  const retrySectionNavigation=(
    section,
    startedAt,
    token
  )=>{
    if(
      token!==retryToken ||
      !activeManage() ||
      detailOpen()
    ){
      retryTimer=0;
      return;
    }

    if(
      windowRef.performance.now()-
        startedAt>
        MANAGE_RETRY_TIMEOUT
    ){
      retryTimer=0;
      return;
    }

    const button=
      sectionButton(section);

    if(!button){
      retryTimer=0;
      return;
    }

    syntheticSectionClick=true;

    try{
      button.click();
    }finally{
      syntheticSectionClick=false;
    }

    retryTimer=
      windowRef.setTimeout(
        ()=>retrySectionNavigation(
          section,
          startedAt,
          token
        ),
        MANAGE_RETRY_INTERVAL
      );
  };

  const ensureSectionNavigation=section=>{
    clearRetry();

    const token=
      retryToken;

    const startedAt=
      windowRef.performance.now();

    retryTimer=
      windowRef.setTimeout(
        ()=>retrySectionNavigation(
          section,
          startedAt,
          token
        ),
        MANAGE_RETRY_INTERVAL
      );
  };

  const retryBackNavigation=(
    startedAt,
    token
  )=>{
    if(
      token!==retryToken ||
      !activeManage() ||
      !detailOpen()
    ){
      retryTimer=0;
      return;
    }

    if(
      windowRef.performance.now()-
        startedAt>
        MANAGE_RETRY_TIMEOUT
    ){
      retryTimer=0;
      return;
    }

    sourceBack()?.click();

    retryTimer=
      windowRef.setTimeout(
        ()=>retryBackNavigation(
          startedAt,
          token
        ),
        MANAGE_RETRY_INTERVAL
      );
  };

  const ensureBackNavigation=()=>{
    clearRetry();

    const token=
      retryToken;

    const startedAt=
      windowRef.performance.now();

    sourceBack()?.click();

    retryTimer=
      windowRef.setTimeout(
        ()=>retryBackNavigation(
          startedAt,
          token
        ),
        MANAGE_RETRY_INTERVAL
      );
  };

  const onClickCapture=event=>{
    const previousClick=
      closestElement(
        event.target,
        "#prevM"
      );

    if(
      previousClick===previous &&
      detailOpen()
    ){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      ensureBackNavigation();
      queueHeaderSync();
      return;
    }

    const manageButton=
      closestElement(
        event.target,
        "[data-manage-section]"
      );

    if(
      !manageButton ||
      !panel.contains(manageButton) ||
      !activeManage() ||
      syntheticSectionClick
    ){
      return;
    }

    const section=
      manageButton.dataset.manageSection;

    if(section){
      ensureSectionNavigation(
        section
      );
    }
  };

  documentRef.addEventListener(
    "click",
    onClickCapture,
    true
  );

  const panelObserver=
    new windowRef.MutationObserver(
      queueHeaderSync
    );

  panelObserver.observe(
    panel,
    {
      childList:true,
      subtree:true
    }
  );

  const bodyObserver=
    new windowRef.MutationObserver(
      queueHeaderSync
    );

  bodyObserver.observe(
    documentRef.body,
    {
      attributes:true,
      attributeFilter:[
        "data-active-tab"
      ]
    }
  );

  queueHeaderSync();

  return ()=>{
    clearRetry();

    if(
      documentRef.body.dataset.managementNavigation===
        "ready"
    ){
      delete documentRef.body.dataset.managementNavigation;
    }

    panelObserver.disconnect();
    bodyObserver.disconnect();

    documentRef.removeEventListener(
      "click",
      onClickCapture,
      true
    );

    if(reconcileFrame){
      windowRef.cancelAnimationFrame(
        reconcileFrame
      );
    }
  };
}

function autoInstall(){
  installManagementNavigation();
}

if(
  typeof window!=="undefined" &&
  typeof document!=="undefined"
){
  if(document.readyState==="loading"){
    document.addEventListener(
      "DOMContentLoaded",
      autoInstall,
      {once:true}
    );
  }else{
    autoInstall();
  }
}
