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
  innerHeight=0,
  layoutHeight=0
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

  /*
    Высота окна приложения — это layout viewport: та же величина, от которой
    движок считает position:fixed и vh. window.innerHeight совпадает с ней не
    везде. В установленном на домашний экран приложении iOS сообщает
    innerHeight ниже окна на верхнюю safe-area, и оболочка вместе с нижней
    панелью заканчивалась на эту величину выше нижней границы экрана.

    Поэтому приоритет отдан прямому измерению layout viewport
    (installPlatformShell), а innerHeight остаётся запасным значением, пока
    измерения ещё нет.
  */
  const measured=
    Number(layoutHeight)>0
      ? Number(layoutHeight)
      : 0;

  const windowHeight=Math.max(
    1,
    Math.round(
      measured ||
      innerHeight ||
      visualViewport?.height ||
      height
    )
  );

  return {
    width,
    height,
    top,
    left,
    windowHeight
  };
}

const VIEWPORT_PROBE_CLASS=
  "app-viewport-probe";

/*
  Измеритель layout viewport.

  Элемент растянут position:fixed от верхней до нижней границы окна, поэтому
  его высота по определению равна той области, относительно которой движок
  раскладывает fixed-элементы и считает vh. Это и есть высота, до которой
  должна доходить оболочка и её нижняя панель.
*/
function installViewportProbe(
  documentRef
){
  if(!documentRef.body){
    return null;
  }

  const existing=
    documentRef.querySelector(
      `.${VIEWPORT_PROBE_CLASS}`
    );

  if(existing){
    return existing;
  }

  const probe=
    documentRef.createElement("div");

  probe.className=VIEWPORT_PROBE_CLASS;

  probe.setAttribute(
    "aria-hidden",
    "true"
  );

  documentRef.body.append(probe);

  return probe;
}

function probeLayoutHeight(
  probe
){
  const height=
    probe
      ?.getBoundingClientRect?.()
      .height || 0;

  return Number.isFinite(height) &&
    height>0
    ? height
    : 0;
}

function setViewportVariables(
  root,
  windowRef,
  probe
){
  const metrics=viewportMetrics({
    visualViewport:
      windowRef.visualViewport,
    innerWidth:
      windowRef.innerWidth,
    innerHeight:
      windowRef.innerHeight,
    layoutHeight:
      probeLayoutHeight(probe)
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

  /*
    Высота окна приложения — это layout viewport, а не видимая область:
    клавиатура окно не уменьшает, она его закрывает. Установленное
    приложение раньше брало эту высоту из статического 100vh, который в
    iOS остаётся высотой окна без клавиатуры. Пока клавиатура открыта,
    оболочка оказывалась выше окна, документ становился прокручиваемым, и
    iOS прокручивал его, чтобы показать поле. Нижняя панель в установленном
    приложении позиционируется относительно документа (position:absolute),
    поэтому уезжала вверх вместе с прокруткой и иногда там и оставалась.

    Затем эту же высоту брали из window.innerHeight — и в установленном
    приложении она оказалась ниже окна на верхнюю safe-area: оболочка
    заканчивалась на её величину выше нижней границы экрана, под нижней
    панелью оставалась пустая полоса, а список терял столько же высоты.
    Поэтому высота измеряется напрямую по layout viewport.
  */
  root.style.setProperty(
    "--app-window-height",
    `${metrics.windowHeight}px`
  );
}

function installInputModality({
  documentRef
}){
  const setModality=value=>{
    documentRef.body.dataset.inputModality=
      value;
  };

  const onPointerDown=()=>{
    setModality("pointer");
  };

  const onKeyDown=event=>{
    if(
      [
        "Shift",
        "Control",
        "Alt",
        "Meta"
      ].includes(event.key)
    ){
      return;
    }

    setModality("keyboard");
  };

  documentRef.addEventListener(
    "pointerdown",
    onPointerDown,
    true
  );

  documentRef.addEventListener(
    "keydown",
    onKeyDown,
    true
  );

  return ()=>{
    documentRef.removeEventListener(
      "pointerdown",
      onPointerDown,
      true
    );

    documentRef.removeEventListener(
      "keydown",
      onKeyDown,
      true
    );
  };
}

function installTransientFocusStabilizer({
  documentRef
}){
  const windowRef=
    documentRef.defaultView;

  const onFocusIn=event=>{
    if(
      !windowRef ||
      !(event.target instanceof windowRef.Element)
    ){
      return;
    }

    const surface=
      event.target.closest(
        ".sheet.on,"+
        ".point-picker.on,"+
        ".month-picker.on,"+
        ".date-picker.on"
      );

    if(!surface){
      return;
    }

    const animations=
      typeof surface.getAnimations==="function"
        ? surface.getAnimations()
        : [];

    for(const animation of animations){
      try{
        animation.finish();
      }catch{
        /* A cancelled transition needs no further work. */
      }
    }
  };

  documentRef.addEventListener(
    "focusin",
    onFocusIn,
    true
  );

  return ()=>{
    documentRef.removeEventListener(
      "focusin",
      onFocusIn,
      true
    );
  };
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
  let reconcileFrame=0;

  const queueVisualReconcile=()=>{
    if(reconcileFrame){
      return;
    }

    reconcileFrame=
      windowRef.requestAnimationFrame(()=>{
        reconcileFrame=0;
        syncPanelAccessibility(
          documentRef
        );
      });
  };

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

    /*
      The application renders synchronously from the tab click.
      Prime tab-scoped CSS before that render so the first visible
      frame is already in the destination state.
    */
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

        primeActiveTab(
          documentRef,
          tab
        );

        /*
          A rapid second click can be rejected by the app while a
          transition is running. Reconcile on the next frame so a
          speculative visual state can never remain stuck.
        */
        queueVisualReconcile();
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

          queueVisualReconcile();
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

    if(reconcileFrame){
      windowRef.cancelAnimationFrame(
        reconcileFrame
      );
    }

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

  const viewportProbe=
    installViewportProbe(documentRef);

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
          windowRef,
          viewportProbe
        );
      });
  };

  queueViewportSync();

  /*
    Окно приложения меняет размер и без события resize: iOS не обязан
    присылать его установленному приложению, когда раскладывает окно после
    запуска или убирает клавиатуру. Наблюдатель за измерителем реагирует на
    само изменение области, поэтому измеренная высота не может остаться
    от прошлой раскладки.
  */
  const probeObserver=
    viewportProbe &&
    typeof windowRef.ResizeObserver===
      "function"
      ? new windowRef.ResizeObserver(
          queueViewportSync
        )
      : null;

  probeObserver?.observe(
    viewportProbe
  );

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

  const cleanupInputModality=
    installInputModality({
      documentRef
    });

  const cleanupTransientFocus=
    installTransientFocusStabilizer({
      documentRef
    });

  const cleanupTabs=
    installTabShell({
      windowRef,
      documentRef
    });

  return ()=>{
    cleanupTabs();
    cleanupTransientFocus();
    cleanupInputModality();

    probeObserver?.disconnect();
    viewportProbe?.remove();

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
