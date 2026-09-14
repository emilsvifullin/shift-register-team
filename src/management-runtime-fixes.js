const CACHE_TTL=30000;
const LOAD_TIMEOUT=1800;

let tariffCache=null;
let tariffCacheAt=0;
let tariffLoadPromise=null;
let activePointId="";
let lastInputModality="pointer";
let toastTimer=0;

export const MANAGEMENT_RUNTIME_STYLE=`
#pointManageList[data-point-card-summaries-pending="true"]{
  visibility:visible !important;
  pointer-events:auto !important;
}

#pointManageList[data-point-card-summaries-pending="true"] [data-point-card-summary-placeholder="true"]{
  visibility:hidden !important;
}
`;

function localYmd(date=new Date()){
  return [
    date.getFullYear(),
    String(date.getMonth()+1).padStart(2,"0"),
    String(date.getDate()).padStart(2,"0")
  ].join("-");
}

export function currentTariffForPoint(
  tariffs,
  pointId,
  today=localYmd()
){
  return (tariffs || [])
    .filter(tariff=>
      String(tariff.point_id)===String(pointId) &&
      tariff.effective_from<=today
    )
    .sort((first,second)=>
      second.effective_from.localeCompare(
        first.effective_from
      )
    )[0] || null;
}

export function shouldClearManagementBackFocus({
  isProxy,
  modality
}){
  return Boolean(
    isProxy &&
    modality!=="keyboard"
  );
}

function notify(message,duration=3200){
  const toast=document.getElementById("toast");

  if(!toast){
    return;
  }

  window.clearTimeout(toastTimer);
  toast.textContent=message;
  toast.classList.add("on");
  toastTimer=window.setTimeout(
    ()=>toast.classList.remove("on"),
    duration
  );
}

function installRuntimeStyle(documentRef=document){
  if(
    documentRef.getElementById(
      "managementRuntimeFixesStyle"
    )
  ){
    return;
  }

  const style=documentRef.createElement("style");
  style.id="managementRuntimeFixesStyle";
  style.textContent=MANAGEMENT_RUNTIME_STYLE;
  documentRef.head.append(style);
}

async function loadTariffCache({force=false}={}){
  const now=Date.now();

  if(
    !force &&
    tariffCache &&
    now-tariffCacheAt<CACHE_TTL
  ){
    return tariffCache;
  }

  if(tariffLoadPromise){
    return tariffLoadPromise;
  }

  tariffLoadPromise=(async()=>{
    const {supabaseClient}=
      await import("./supabase.js");

    const result=await supabaseClient
      .from("point_tariffs")
      .select(
        "id, point_id, effective_from"
      );

    if(result.error){
      throw result.error;
    }

    tariffCache=result.data || [];
    tariffCacheAt=Date.now();

    return tariffCache;
  })().finally(()=>{
    tariffLoadPromise=null;
  });

  return tariffLoadPromise;
}

function warmTariffCache(){
  void loadTariffCache().catch(()=>{});
}

function withTimeout(promise,timeoutMs){
  return new Promise((resolve,reject)=>{
    const timer=window.setTimeout(
      ()=>reject(
        new Error("Не удалось быстро загрузить тариф. Повторите попытку.")
      ),
      timeoutMs
    );

    promise.then(
      value=>{
        window.clearTimeout(timer);
        resolve(value);
      },
      error=>{
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function prepareTariffButton(
  button,
  pointId
){
  const current=currentTariffForPoint(
    tariffCache,
    pointId
  );

  if(!current){
    return false;
  }

  button.dataset.tariffEdit=current.id;
  return true;
}

function install({
  windowRef=window,
  documentRef=document
}={}){
  if(
    documentRef.documentElement.dataset
      .managementRuntimeFixes==="ready"
  ){
    return;
  }

  documentRef.documentElement.dataset
    .managementRuntimeFixes="ready";

  installRuntimeStyle(documentRef);
  warmTariffCache();

  documentRef.addEventListener(
    "pointerdown",
    event=>{
      lastInputModality="pointer";

      const row=event.target.closest?.(
        ".point-manage-row[data-point-id]"
      );

      if(row){
        activePointId=
          row.dataset.pointId || "";
        warmTariffCache();
      }

      if(
        event.target.closest?.("#pointAdd")
      ){
        activePointId="";
      }
    },
    true
  );

  documentRef.addEventListener(
    "keydown",
    event=>{
      if(
        event.key==="Tab" ||
        event.key==="Enter" ||
        event.key===" " ||
        event.key.startsWith("Arrow")
      ){
        lastInputModality="keyboard";
      }
    },
    true
  );

  documentRef.addEventListener(
    "focusin",
    event=>{
      const previous=
        documentRef.getElementById("prevM");

      if(
        event.target!==previous ||
        !shouldClearManagementBackFocus({
          isProxy:
            previous?.dataset
              .manageBackProxy==="true",
          modality:lastInputModality
        })
      ){
        return;
      }

      windowRef.requestAnimationFrame(()=>{
        if(
          documentRef.activeElement===previous &&
          lastInputModality!=="keyboard"
        ){
          previous.classList.remove(
            "touch-active"
          );
          previous.blur();
        }
      });
    },
    true
  );

  documentRef.addEventListener(
    "click",
    event=>{
      const row=event.target.closest?.(
        ".point-manage-row[data-point-id]"
      );

      if(row){
        activePointId=
          row.dataset.pointId || "";
      }

      const button=event.target.closest?.(
        "#manageTariffAdd"
      );

      if(!button || !activePointId){
        return;
      }

      const text=button.textContent.trim();

      if(
        button.dataset.tariffEdit ||
        text==="Отменить" ||
        text==="Загрузка…" ||
        ![
          "Изменить тариф",
          "Изменить текущий тариф"
        ].includes(text)
      ){
        return;
      }

      if(
        prepareTariffButton(
          button,
          activePointId
        )
      ){
        return;
      }

      if(tariffCache){
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const previousText=text;
      button.disabled=true;
      button.textContent="Загрузка…";

      void withTimeout(
        loadTariffCache(),
        LOAD_TIMEOUT
      ).then(()=>{
        button.disabled=false;
        button.textContent=previousText;

        prepareTariffButton(
          button,
          activePointId
        );

        button.click();
      }).catch(error=>{
        button.disabled=false;
        button.textContent=previousText;
        notify(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить тариф"
        );
      });
    },
    true
  );

  documentRef.addEventListener(
    "click",
    event=>{
      if(
        event.target.closest?.(
          "#manageEditorSave"
        )
      ){
        windowRef.setTimeout(
          ()=>{
            void loadTariffCache({
              force:true
            }).catch(()=>{});
          },
          700
        );
      }
    },
    false
  );
}

if(
  typeof window!=="undefined" &&
  typeof document!=="undefined"
){
  if(document.readyState==="loading"){
    document.addEventListener(
      "DOMContentLoaded",
      ()=>install(),
      {once:true}
    );
  }else{
    install();
  }
}
