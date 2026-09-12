const POINT_CACHE_MS=15000;

let pointCache=null;
let pointCacheAt=0;
let pointLoadPromise=null;
let pointClientPromise=null;

function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function sortPoints(points){
  return [...points].sort(
    (first,second)=>
      String(first.name || "")
        .localeCompare(
          String(second.name || ""),
          "ru",
          {sensitivity:"base"}
        )
  );
}

async function pointClient(){
  if(!pointClientPromise){
    pointClientPromise=
      import("./supabase.js")
        .then(module=>
          module.supabaseClient
        );
  }

  return pointClientPromise;
}

async function loadPointCatalog(){
  const now=Date.now();

  if(
    pointCache &&
    now-pointCacheAt<POINT_CACHE_MS
  ){
    return pointCache;
  }

  if(pointLoadPromise){
    return pointLoadPromise;
  }

  pointLoadPromise=(async()=>{
    const client=
      await pointClient();

    const {data,error}=
      await client
        .from("points")
        .select("id, name, active")
        .order(
          "name",
          {ascending:true}
        );

    if(error){
      throw error;
    }

    pointCache=sortPoints(
      data || []
    );
    pointCacheAt=Date.now();

    return pointCache;
  })().finally(()=>{
    pointLoadPromise=null;
  });

  return pointLoadPromise;
}

function createPointButton(
  documentRef,
  point
){
  const button=
    documentRef.createElement(
      "button"
    );

  button.type="button";
  button.className="employee-point";
  button.dataset.employeePoint=
    String(point.id || "");
  button.innerHTML=`
    <span
      class="employee-point-check"
      aria-hidden="true"
    ></span>
    <span class="employee-point-name">
      ${escapeHtml(point.name)}
    </span>
  `;

  return button;
}

function syncArchivedState(
  documentRef,
  button,
  point
){
  const selected=
    button.classList.contains("on");

  const archived=
    point.active===false;

  button.classList.toggle(
    "employee-point-archived",
    archived
  );

  let state=
    button.querySelector(
      ".employee-point-state"
    );

  if(archived){
    if(!state){
      state=
        documentRef.createElement(
          "span"
        );
      state.className=
        "employee-point-state";
      button.append(state);
    }

    state.textContent="В архиве";

    /*
      Архивный ПВЗ нельзя назначить заново, но уже существующее
      назначение остаётся кликабельным, чтобы его можно было снять.
    */
    button.disabled=!selected;
    button.setAttribute(
      "aria-disabled",
      String(!selected)
    );
  }else{
    state?.remove();
    button.disabled=false;
    button.removeAttribute(
      "aria-disabled"
    );
  }

  button.setAttribute(
    "aria-label",
    [
      point.name,
      archived ? "в архиве" : "активен",
      selected ? "назначен" : "не назначен"
    ].join(", ")
  );
}

export function installManagementEmployeePoints({
  windowRef=window,
  documentRef=document
}={}){
  const body=
    documentRef.getElementById(
      "employeeSheetBody"
    );

  if(
    !body ||
    documentRef.body.dataset
      .managementEmployeePoints===
      "ready"
  ){
    return ()=>{};
  }

  documentRef.body.dataset
    .managementEmployeePoints=
      "ready";

  let frame=0;
  let syncToken=0;
  let retryTimer=0;

  const queueSync=()=>{
    if(frame){
      return;
    }

    frame=
      windowRef.requestAnimationFrame(
        ()=>{
          frame=0;
          void syncPointOptions();
        }
      );
  };

  const syncPointOptions=async()=>{
    const container=
      body.querySelector(
        ".employee-points"
      );

    if(
      !container ||
      !body.querySelector(
        "#employeeName"
      )
    ){
      return;
    }

    const token=++syncToken;

    let points=[];

    try{
      points=await loadPointCatalog();
    }catch{
      windowRef.clearTimeout(
        retryTimer
      );

      retryTimer=
        windowRef.setTimeout(
          queueSync,
          900
        );
      return;
    }

    if(
      token!==syncToken ||
      container!==
        body.querySelector(
          ".employee-points"
        )
    ){
      return;
    }

    const existing=
      new Map(
        Array.from(
          container.querySelectorAll(
            "[data-employee-point]"
          )
        ).map(button=>[
          button.dataset.employeePoint,
          button
        ])
      );

    const selectedIds=
      new Set(
        Array.from(existing)
          .filter(([,button])=>
            button.classList.contains(
              "on"
            )
          )
          .map(([id])=>id)
      );

    const signature=
      points
        .map(point=>
          `${point.id}:${point.active===false ? 0 : 1}:${selectedIds.has(String(point.id)) ? 1 : 0}`
        )
        .join("|");

    if(
      container.dataset
        .managementPointCatalog===
      signature
    ){
      return;
    }

    const fragment=
      documentRef.createDocumentFragment();

    points.forEach(point=>{
      const id=String(point.id || "");

      let button=
        existing.get(id);

      if(!button){
        button=createPointButton(
          documentRef,
          point
        );
      }

      syncArchivedState(
        documentRef,
        button,
        point
      );

      fragment.append(button);
    });

    container.replaceChildren(
      fragment
    );

    container.dataset
      .managementPointCatalog=
        signature;
  };

  const observer=
    new windowRef.MutationObserver(
      queueSync
    );

  observer.observe(
    body,
    {
      childList:true,
      subtree:true
    }
  );

  queueSync();

  return ()=>{
    observer.disconnect();
    syncToken++;

    windowRef.clearTimeout(
      retryTimer
    );

    if(frame){
      windowRef.cancelAnimationFrame(
        frame
      );
    }

    if(
      documentRef.body.dataset
        .managementEmployeePoints===
      "ready"
    ){
      delete documentRef.body.dataset
        .managementEmployeePoints;
    }
  };
}

function autoInstall(){
  installManagementEmployeePoints();
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
