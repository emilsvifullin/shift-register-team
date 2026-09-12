const TAP_MOVE_LIMIT=10;
const REPLAY_DELAY=48;
const REPLAY_INTERVAL=64;
const REPLAY_TIMEOUT=3200;

function sectionButtonFromTarget(
  target,
  panel
){
  const button=
    target?.closest?.(
      "[data-manage-section]"
    ) || null;

  return (
    button &&
    panel.contains(button)
  )
    ? button
    : null;
}

export function installManagementTapIntent({
  windowRef=window,
  documentRef=document
}={}){
  const panel=
    documentRef.getElementById("app");

  if(!panel){
    return ()=>{};
  }

  let gesture=null;
  let retryTimer=0;
  let retryToken=0;

  documentRef.body.dataset.managementTapIntent=
    "ready";

  const clearRetry=()=>{
    retryToken++;

    if(retryTimer){
      windowRef.clearTimeout(
        retryTimer
      );
      retryTimer=0;
    }
  };

  const currentSectionButton=section=>
    Array.from(
      panel.querySelectorAll(
        "[data-manage-section]"
      )
    ).find(button=>
      button.dataset.manageSection===
        section
    ) || null;

  const retryNavigation=(
    section,
    startedAt,
    token
  )=>{
    if(token!==retryToken){
      return;
    }

    const button=
      currentSectionButton(section);

    if(
      !button ||
      windowRef.performance.now()-
        startedAt>REPLAY_TIMEOUT
    ){
      retryTimer=0;
      return;
    }

    button.click();

    retryTimer=
      windowRef.setTimeout(
        ()=>retryNavigation(
          section,
          startedAt,
          token
        ),
        REPLAY_INTERVAL
      );
  };

  const preserveTapIntent=section=>{
    clearRetry();

    const token=
      retryToken;

    const startedAt=
      windowRef.performance.now();

    retryTimer=
      windowRef.setTimeout(
        ()=>retryNavigation(
          section,
          startedAt,
          token
        ),
        REPLAY_DELAY
      );
  };

  const onPointerDown=event=>{
    if(!event.isPrimary){
      gesture=null;
      return;
    }

    const button=
      sectionButtonFromTarget(
        event.target,
        panel
      );

    if(!button){
      gesture=null;
      return;
    }

    gesture={
      id:event.pointerId,
      section:
        button.dataset.manageSection || "",
      x:event.clientX,
      y:event.clientY,
      moved:false
    };
  };

  const onPointerMove=event=>{
    if(
      !gesture ||
      event.pointerId!==gesture.id
    ){
      return;
    }

    if(
      Math.hypot(
        event.clientX-gesture.x,
        event.clientY-gesture.y
      )>TAP_MOVE_LIMIT
    ){
      gesture.moved=true;
    }
  };

  const onPointerUp=event=>{
    const entry=gesture;
    gesture=null;

    if(
      !entry ||
      entry.moved ||
      event.pointerId!==entry.id ||
      !entry.section
    ){
      return;
    }

    const button=
      sectionButtonFromTarget(
        event.target,
        panel
      );

    if(
      !button ||
      button.dataset.manageSection!==
        entry.section
    ){
      return;
    }

    preserveTapIntent(
      entry.section
    );
  };

  const onPointerCancel=()=>{
    gesture=null;
  };

  documentRef.addEventListener(
    "pointerdown",
    onPointerDown,
    true
  );

  documentRef.addEventListener(
    "pointermove",
    onPointerMove,
    true
  );

  documentRef.addEventListener(
    "pointerup",
    onPointerUp,
    true
  );

  documentRef.addEventListener(
    "pointercancel",
    onPointerCancel,
    true
  );

  return ()=>{
    clearRetry();
    gesture=null;

    documentRef.removeEventListener(
      "pointerdown",
      onPointerDown,
      true
    );

    documentRef.removeEventListener(
      "pointermove",
      onPointerMove,
      true
    );

    documentRef.removeEventListener(
      "pointerup",
      onPointerUp,
      true
    );

    documentRef.removeEventListener(
      "pointercancel",
      onPointerCancel,
      true
    );

    if(
      documentRef.body.dataset
        .managementTapIntent===
      "ready"
    ){
      delete documentRef.body.dataset
        .managementTapIntent;
    }
  };
}

function autoInstall(){
  installManagementTapIntent();
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
