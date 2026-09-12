const TAB_ROUTES=Object.freeze({
  shifts:"#shifts",
  stats:"#stats",
  manage:"#manage",
  data:"#data"
});

const ROUTE_TABS=Object.freeze(
  Object.fromEntries(
    Object.entries(TAB_ROUTES)
      .map(([tab,hash])=>[
        hash,
        tab
      ])
  )
);

export function tabNameFromHash(
  hash
){
  return ROUTE_TABS[
    String(hash || "")
      .toLowerCase()
  ] || null;
}

export function hashForTab(
  tab
){
  return TAB_ROUTES[tab] || "";
}

function reliableVisualViewport({
  visualViewport,
  innerWidth
}){
  if(!visualViewport){
    return false;
  }

  const visualWidth=
    Number(visualViewport.width);

  const layoutWidth=
    Number(innerWidth);

  if(
    !Number.isFinite(visualWidth) ||
    visualWidth<=0
  ){
    return false;
  }

  if(
    !Number.isFinite(layoutWidth) ||
    layoutWidth<=0
  ){
    return true;
  }

  const scale=
    Number(visualViewport.scale) || 1;

  if(scale>1.01){
    return true;
  }

  const ratio=
    visualWidth/layoutWidth;

  return ratio>=0.5 && ratio<=1.2;
}

export function viewportMetrics({
  visualViewport=null,
  innerWidth=0,
  innerHeight=0
}={}){
  const useVisualViewport=
    reliableVisualViewport({
      visualViewport,
      innerWidth
    });

  const width=Math.max(
    1,
    Math.round(
      useVisualViewport
        ? visualViewport.width
        : innerWidth ||
          visualViewport?.width ||
          1
    )
  );

  const height=Math.max(
    1,
    Math.round(
      useVisualViewport
        ? visualViewport.height
        : innerHeight ||
          visualViewport?.height ||
          1
    )
  );

  const top=Math.max(
    0,
    Math.round(
      useVisualViewport
        ? visualViewport.offsetTop || 0
        : 0
    )
  );

  const left=Math.max(
    0,
    Math.round(
      useVisualViewport
        ? visualViewport.offsetLeft || 0
        : 0
    )
  );

  return {
    width,
    height,
    top,
    left
  };
}

function setViewportVariables(
  root,
  windowRef
){
  const metrics=viewportMetrics({
    visualViewport:
      windowRef.visualViewport,
    innerWidth:
      windowRef.innerWidth,
    innerHeight:
      windowRef.innerHeight
  });

  root.style.setProperty(
    "--app-viewport-width",
    `${metrics.width}px`
  );

  root.style.setProperty(
    "--app-viewport-height",
    `${metrics.height}px`
  );

  root.style.setProperty(
    "--app-viewport-top",
    `${metrics.top}px`
  );

  root.style.setProperty(
    "--app-viewport-left",
    `${metrics.left}px`
  );
}

function visibleTabs(
  documentRef
){
  return Array.from(
    documentRef.querySelectorAll(
      '.tabs [role="tab"]'
    )
  ).filter(tab=>
    !tab.hidden &&
    tab.getAttribute("aria-hidden")!==
      "true"
  );
}

function selectedTab(
  documentRef
){
  return visibleTabs(documentRef)
    .find(tab=>
      tab.getAttribute(
        "aria-selected"
      )==="true"
    ) || null;
}

function tabName(
  tab
){
  return String(
    tab?.id || ""
  ).replace(/^tab-/,"");
}

function primeActiveTab(
  documentRef,
  tab
){
  const name=tabName(tab);

  if(name){
    documentRef.body.dataset.activeTab=
      name;
  }

  return name || null;
}

function syncPanelAccessibility(
  documentRef
){
  const panel=
    documentRef.getElementById("app");

  const active=
    selectedTab(documentRef);

  if(!panel || !active){
    return null;
  }

  panel.setAttribute(
    "aria-labelledby",
    active.id
  );

  return primeActiveTab(
    documentRef,
    active
  );
}

function installTabShell({
  windowRef,
  documentRef
}){
  const tablist=
    documentRef.querySelector(
      '.tabs[role="tablist"]'
    );

  const panel=
    documentRef.getElementById("app");

  if(!tablist || !panel){
    return ()=>{};
  }

  let routing=false;
  let pendingHistoryMode="replace";
  let initialRouteApplied=false;

  const syncRoute=(
    mode=pendingHistoryMode
  )=>{
    const name=
      syncPanelAccessibility(
        documentRef
      );

    pendingHistoryMode="replace";

    if(!name || routing){
      return;
    }

    const nextHash=
      hashForTab(name);

    if(
      !nextHash ||
      windowRef.location.hash===
        nextHash
    ){
      return;
    }

    const url=
      windowRef.location.pathname+
      windowRef.location.search+
      nextHash;

    if(mode==="push"){
      windowRef.history.pushState(
        {tab:name},
        "",
        url
      );
    }else{
      windowRef.history.replaceState(
        {tab:name},
        "",
        url
      );
    }
  };

  const activateHashRoute=()=>{
    const name=tabNameFromHash(
      windowRef.location.hash
    );

    if(!name){
      syncRoute("replace");
      return;
    }

    const target=
      documentRef.getElementById(
        `tab-${name}`
      );

    if(!target || target.hidden){
      syncRoute("replace");
      return;
    }

    if(
      target.getAttribute(
        "aria-selected"
      )==="true"
    ){
      syncPanelAccessibility(
        documentRef
      );
      return;
    }

    routing=true;
    pendingHistoryMode="none";

    primeActiveTab(
      documentRef,
      target
    );

    target.click();

    windowRef.requestAnimationFrame(()=>{
      routing=false;
      syncPanelAccessibility(
        documentRef
      );
    });
  };

  const maybeApplyInitialRoute=()=>{
    if(
      initialRouteApplied ||
      documentRef.body.classList
        .contains("app-booting")
    ){
      return;
    }

    initialRouteApplied=true;
    activateHashRoute();
  };

  const observer=
    new MutationObserver(records=>{
      let selectionChanged=false;

      for(const record of records){
        if(
          record.type==="attributes" &&
          record.attributeName===
            "aria-selected"
        ){
          selectionChanged=true;
          break;
        }
      }

      if(selectionChanged){
        syncRoute(
          pendingHistoryMode
        );
      }

      maybeApplyInitialRoute();
    });

  observer.observe(
    tablist,
    {
      subtree:true,
      attributes:true,
      attributeFilter:[
        "aria-selected",
        "hidden"
      ]
    }
  );

  const bodyObserver=
    new MutationObserver(
      maybeApplyInitialRoute
    );

  bodyObserver.observe(
    documentRef.body,
    {
      attributes:true,
      attributeFilter:["class"]
    }
  );

  tablist.addEventListener(
    "click",
    event=>{
      const tab=
        event.target.closest?.(
          '[role="tab"]'
        );

      if(
        tab &&
        !tab.hidden &&
        !tab.disabled
      ){
        pendingHistoryMode="push";

        /*
          The app renders the next panel synchronously in its own
          click handler. Prime the visual state in capture phase so
          tab-scoped CSS is already correct for that very first frame.
        */
        primeActiveTab(
          documentRef,
          tab
        );
      }
    },
    true
  );

  tablist.addEventListener(
    "keydown",
    event=>{
      const current=
        event.target.closest?.(
          '[role="tab"]'
        );

      if(!current){
        return;
      }

      if(
        [
          "ArrowLeft",
          "ArrowRight"
        ].includes(event.key)
      ){
        const tabs=
          visibleTabs(documentRef);

        const currentIndex=
          tabs.indexOf(current);

        if(
          tabs.length &&
          currentIndex>=0
        ){
          const direction=
            event.key==="ArrowRight"
              ? 1
              : -1;

          const target=
            tabs[
              (
                currentIndex+
                direction+
                tabs.length
              )%
              tabs.length
            ];

          primeActiveTab(
            documentRef,
            target
          );
        }

        pendingHistoryMode="push";
        return;
      }

      if(
        ![
          "Home",
          "End"
        ].includes(event.key)
      ){
        return;
      }

      const tabs=
        visibleTabs(documentRef);

      if(!tabs.length){
        return;
      }

      const target=
        event.key==="Home"
          ? tabs[0]
          : tabs.at(-1);

      event.preventDefault();
      pendingHistoryMode="push";

      primeActiveTab(
        documentRef,
        target
      );

      target.click();
      target.focus({
        preventScroll:true
      });
    },
    true
  );

  const handleHistory=()=>{
    routing=true;
    pendingHistoryMode="none";
    activateHashRoute();

    windowRef.requestAnimationFrame(()=>{
      routing=false;
    });
  };

  windowRef.addEventListener(
    "popstate",
    handleHistory
  );

  windowRef.addEventListener(
    "hashchange",
    handleHistory
  );

  syncPanelAccessibility(
    documentRef
  );

  maybeApplyInitialRoute();

  return ()=>{
    observer.disconnect();
    bodyObserver.disconnect();

    windowRef.removeEventListener(
      "popstate",
      handleHistory
    );

    windowRef.removeEventListener(
      "hashchange",
      handleHistory
    );
  };
}

export function installPlatformShell({
  windowRef=window,
  documentRef=document
}={}){
  const root=
    documentRef.documentElement;

  let viewportFrame=0;

  const queueViewportSync=()=>{
    if(viewportFrame){
      return;
    }

    viewportFrame=
      windowRef.requestAnimationFrame(()=>{
        viewportFrame=0;

        setViewportVariables(
          root,
          windowRef
        );
      });
  };

  queueViewportSync();

  windowRef.addEventListener(
    "resize",
    queueViewportSync,
    {passive:true}
  );

  windowRef.addEventListener(
    "orientationchange",
    queueViewportSync,
    {passive:true}
  );

  windowRef.visualViewport
    ?.addEventListener(
      "resize",
      queueViewportSync,
      {passive:true}
    );

  windowRef.visualViewport
    ?.addEventListener(
      "scroll",
      queueViewportSync,
      {passive:true}
    );

  const cleanupTabs=
    installTabShell({
      windowRef,
      documentRef
    });

  return ()=>{
    cleanupTabs();

    windowRef.removeEventListener(
      "resize",
      queueViewportSync
    );

    windowRef.removeEventListener(
      "orientationchange",
      queueViewportSync
    );

    windowRef.visualViewport
      ?.removeEventListener(
        "resize",
        queueViewportSync
      );

    windowRef.visualViewport
      ?.removeEventListener(
        "scroll",
        queueViewportSync
      );

    if(viewportFrame){
      windowRef.cancelAnimationFrame(
        viewportFrame
      );
    }
  };
}

function autoInstall(){
  installPlatformShell();
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
