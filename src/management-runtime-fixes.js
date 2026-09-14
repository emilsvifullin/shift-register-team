const CACHE_TTL=30000;

let tariffCache=null;
let tariffCacheAt=0;
let tariffLoadPromise=null;
let activePointId="";
let lastInputModality="pointer";
let tariffCreatePass=false;
let helpSyncFrame=0;

export const MANAGEMENT_RUNTIME_STYLE=`
#pointManageList[data-point-card-summaries-pending="true"]{
  visibility:visible !important;
  pointer-events:auto !important;
}

#pointManageList[data-point-card-summaries-pending="true"] [data-point-card-summary-placeholder="true"]{
  visibility:hidden !important;
}

#prevM[data-pointer-focus-suppressed="true"]:focus,
#prevM[data-pointer-focus-suppressed="true"]:focus-visible,
#prevM[data-pointer-focus-suppressed="true"]:active{
  outline:none !important;
  outline-width:0 !important;
  outline-offset:0 !important;
  box-shadow:none !important;
  background:transparent !important;
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

export function shouldPrimeCurrentTariff({
  createPass,
  text,
  hasCurrent
}){
  return Boolean(
    !createPass &&
    hasCurrent &&
    [
      "Изменить тариф",
      "Изменить текущий тариф"
    ].includes(text)
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

function currentTariff(){
  if(!activePointId || !tariffCache){
    return null;
  }

  return currentTariffForPoint(
    tariffCache,
    activePointId
  );
}

function armCurrentTariffButton(
  documentRef=document
){
  if(tariffCreatePass || !activePointId){
    return false;
  }

  const button=
    documentRef.getElementById(
      "manageTariffAdd"
    );

  if(!button){
    return false;
  }

  const current=currentTariff();
  const text=button.textContent.trim();

  if(
    !shouldPrimeCurrentTariff({
      createPass:tariffCreatePass,
      text,
      hasCurrent:Boolean(current)
    })
  ){
    return false;
  }

  button.dataset.tariffEdit=current.id;
  return true;
}

function warmTariffCache(
  documentRef=document
){
  void loadTariffCache()
    .then(()=>{
      armCurrentTariffButton(documentRef);
    })
    .catch(()=>{});
}

function clearPointerBackFocus({
  previous,
  documentRef,
  force=false
}){
  if(!previous){
    return;
  }

  if(
    force ||
    lastInputModality!=="keyboard"
  ){
    previous.dataset.pointerFocusSuppressed=
      "true";
    previous.classList.remove("touch-active");

    if(
      documentRef.activeElement===previous
    ){
      previous.blur();
    }
  }
}

function restoreKeyboardBackFocusStyle(previous){
  if(!previous){
    return;
  }

  delete previous.dataset.pointerFocusSuppressed;
}

function syncTariffHelp(
  documentRef=document
){
  helpSyncFrame=0;

  const sheet=
    documentRef.getElementById(
      "manageEditorSheet"
    );

  const help=sheet?.querySelector(
    ".tariff-current-editor .employee-help"
  );

  if(!sheet || !help){
    return;
  }

  if(sheet.dataset.tariffIntent==="edit-current"){
    help.textContent=
      "Редактируется текущий тариф. Новая запись в истории не создаётся.";
    return;
  }

  if(sheet.dataset.tariffIntent==="create"){
    help.textContent=
      "Создаётся новая версия тарифа с выбранной даты. Предыдущий тариф останется в истории.";
  }
}

function queueTariffHelpSync({
  windowRef=window,
  documentRef=document
}={}){
  if(helpSyncFrame){
    return;
  }

  helpSyncFrame=windowRef.requestAnimationFrame(
    ()=>syncTariffHelp(documentRef)
  );
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

  const previous=
    documentRef.getElementById("prevM");

  const sheet=
    documentRef.getElementById(
      "manageEditorSheet"
    );

  warmTariffCache(documentRef);

  const syncBackFocus=()=>{
    if(
      lastInputModality!=="keyboard" &&
      previous?.dataset.manageBackProxy===
        "true"
    ){
      clearPointerBackFocus({
        previous,
        documentRef
      });
    }
  };

  const backObserver=previous
    ? new windowRef.MutationObserver(()=>{
        syncBackFocus();
      })
    : null;

  backObserver?.observe(
    previous,
    {
      attributes:true,
      attributeFilter:[
        "data-manage-back-proxy",
        "class",
        "disabled"
      ]
    }
  );

  const sheetObserver=sheet
    ? new windowRef.MutationObserver(()=>{
        armCurrentTariffButton(documentRef);
        queueTariffHelpSync({
          windowRef,
          documentRef
        });
      })
    : null;

  sheetObserver?.observe(
    sheet,
    {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:[
        "class",
        "aria-hidden"
      ]
    }
  );

  documentRef.addEventListener(
    "pointerdown",
    event=>{
      lastInputModality="pointer";

      clearPointerBackFocus({
        previous,
        documentRef,
        force:true
      });

      const row=event.target.closest?.(
        ".point-manage-row[data-point-id]"
      );

      if(row){
        activePointId=
          row.dataset.pointId || "";
        warmTariffCache(documentRef);
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
        restoreKeyboardBackFocusStyle(
          previous
        );
      }
    },
    true
  );

  documentRef.addEventListener(
    "focusin",
    event=>{
      if(
        event.target!==previous ||
        lastInputModality==="keyboard"
      ){
        return;
      }

      clearPointerBackFocus({
        previous,
        documentRef,
        force:true
      });

      windowRef.requestAnimationFrame(()=>{
        clearPointerBackFocus({
          previous,
          documentRef,
          force:true
        });
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
        warmTariffCache(documentRef);
      }

      if(
        event.target.closest?.("#pointAdd")
      ){
        activePointId="";
      }

      const create=
        event.target.closest?.(
          "#manageTariffCreate"
        );

      if(create){
        tariffCreatePass=true;

        if(sheet){
          sheet.dataset.tariffIntent="create";
        }

        const changeButton=
          documentRef.getElementById(
            "manageTariffAdd"
          );

        if(changeButton){
          delete changeButton.dataset.tariffEdit;
        }

        queueMicrotask(()=>{
          tariffCreatePass=false;
          armCurrentTariffButton(
            documentRef
          );
          queueTariffHelpSync({
            windowRef,
            documentRef
          });
        });

        return;
      }

      const tariffButton=
        event.target.closest?.(
          "#manageTariffAdd"
        );

      if(
        tariffButton &&
        !tariffCreatePass &&
        tariffButton.dataset.tariffEdit
      ){
        if(sheet){
          sheet.dataset.tariffIntent=
            "edit-current";
        }

        queueTariffHelpSync({
          windowRef,
          documentRef
        });
      }

      if(
        event.target.closest?.(
          "#manageEditorSave"
        )
      ){
        windowRef.setTimeout(()=>{
          void loadTariffCache({
            force:true
          })
            .then(()=>{
              armCurrentTariffButton(
                documentRef
              );
            })
            .catch(()=>{});
        },700);
      }
    },
    true
  );

  armCurrentTariffButton(documentRef);
  syncBackFocus();
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
