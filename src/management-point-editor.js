const MONTH_INDEX=new Map([
  ["января",1],
  ["февраля",2],
  ["марта",3],
  ["апреля",4],
  ["мая",5],
  ["июня",6],
  ["июля",7],
  ["августа",8],
  ["сентября",9],
  ["октября",10],
  ["ноября",11],
  ["декабря",12]
]);

let activePointId="";
let tariffMode="";
let tariffEditId="";
let allowOriginalTariffAdd=false;
let saveBusy=false;
let toastTimer=0;

export function localYmd(date=new Date()){
  return [
    date.getFullYear(),
    String(date.getMonth()+1).padStart(2,"0"),
    String(date.getDate()).padStart(2,"0")
  ].join("-");
}

export function dateLabelToYmd(value){
  const match=String(value || "")
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})$/u);

  if(!match){
    return "";
  }

  const month=MONTH_INDEX.get(match[2]);

  if(!month){
    return "";
  }

  const day=Number(match[1]);
  const year=Number(match[3]);
  const date=new Date(year,month-1,day,12);

  if(
    date.getFullYear()!==year ||
    date.getMonth()!==month-1 ||
    date.getDate()!==day
  ){
    return "";
  }

  return [
    year,
    String(month).padStart(2,"0"),
    String(day).padStart(2,"0")
  ].join("-");
}

export function currentTariffForDate(
  tariffs,
  today=localYmd()
){
  return [...tariffs]
    .filter(tariff=>
      tariff.effective_from<=today
    )
    .sort((first,second)=>
      second.effective_from.localeCompare(
        first.effective_from
      )
    )[0] || null;
}

export function assertCurrentTariffDate({
  tariffs,
  tariffId,
  effectiveFrom,
  today=localYmd()
}){
  if(effectiveFrom>today){
    throw new Error(
      "Текущий тариф нельзя перенести в будущее. Используйте «Новый тариф с даты»."
    );
  }

  const previous=tariffs
    .filter(tariff=>
      tariff.id!==tariffId &&
      tariff.effective_from<=today
    )
    .sort((first,second)=>
      second.effective_from.localeCompare(
        first.effective_from
      )
    )[0];

  if(
    previous &&
    effectiveFrom<=previous.effective_from
  ){
    throw new Error(
      "Дата текущего тарифа должна быть позже предыдущего тарифа."
    );
  }
}

export function assertNewTariffDate({
  tariffs,
  effectiveFrom,
  today=localYmd()
}){
  if(
    tariffs.some(tariff=>
      tariff.effective_from===effectiveFrom
    )
  ){
    throw new Error(
      "На эту дату тариф уже задан."
    );
  }

  const current=
    currentTariffForDate(
      tariffs,
      today
    );

  if(
    current &&
    effectiveFrom<=current.effective_from
  ){
    throw new Error(
      "Для более ранней даты измените текущий тариф, а не создавайте новый."
    );
  }
}

function notify(message,duration=2400){
  const toast=
    document.getElementById("toast");

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

async function loadPointContext(pointId){
  const {supabaseClient}=
    await import("./supabase.js");

  const [pointResult,tariffsResult]=
    await Promise.all([
      supabaseClient
        .from("points")
        .select(
          "id, sort_order"
        )
        .eq("id",pointId)
        .single(),
      supabaseClient
        .from("point_tariffs")
        .select(
          "id, point_id, effective_from, pricing_type, fixed_rate, shk_tiers"
        )
        .eq("point_id",pointId)
        .order(
          "effective_from",
          {ascending:false}
        )
    ]);

  if(pointResult.error){
    throw pointResult.error;
  }

  if(tariffsResult.error){
    throw tariffsResult.error;
  }

  return {
    point:pointResult.data,
    tariffs:tariffsResult.data || []
  };
}

function selectedBoolean(selector,key){
  const selected=
    document.querySelector(
      `${selector}.on`
    );

  return selected
    ? selected.dataset[key]==="1"
    : false;
}

function pointDraft(point){
  const name=
    document.getElementById(
      "managePointName"
    )?.value.trim() || "";

  if(!name){
    throw new Error(
      "Введите название ПВЗ"
    );
  }

  return {
    id:activePointId,
    name,
    sortOrder:
      Number(point?.sort_order) || 0,
    active:selectedBoolean(
      "[data-point-active]",
      "pointActive"
    ),
    advanceEnabled:selectedBoolean(
      "[data-point-advance]",
      "pointAdvance"
    ),
    pricingType:null,
    fixedRate:null,
    shkTiers:null,
    effectiveFrom:null
  };
}

async function tariffDraft(){
  const dateLabel=
    document.querySelector(
      "#manageTariffDateOpen .point-value"
    )?.textContent || "";

  const effectiveFrom=
    dateLabelToYmd(dateLabel);

  if(!effectiveFrom){
    throw new Error(
      "Не удалось определить дату тарифа"
    );
  }

  const pricingButton=
    document.querySelector(
      ".tariff-current-editor [data-pricing-type].on"
    );

  const pricingType=
    pricingButton?.dataset.pricingType;

  if(
    pricingType!=="fixed" &&
    pricingType!=="shk_tiers"
  ){
    throw new Error(
      "Выберите тип тарифа"
    );
  }

  if(pricingType==="fixed"){
    const fixedRate=Number(
      String(
        document.getElementById(
          "manageFixedRate"
        )?.value || ""
      ).replace(",",".")
    );

    if(
      !Number.isFinite(fixedRate) ||
      fixedRate<=0
    ){
      throw new Error(
        "Ставка должна быть больше 0"
      );
    }

    return {
      effectiveFrom,
      pricingType,
      fixedRate,
      shkTiers:null
    };
  }

  const rawTiers=[
    ...document.querySelectorAll(
      ".tariff-current-editor [data-tier-index]"
    )
  ].map(row=>({
    up_to:
      row.querySelector(
        "[data-tier-limit]"
      )?.value || null,
    rate:
      row.querySelector(
        "[data-tier-rate]"
      )?.value || ""
  }));

  const {normalizeShkTiers}=
    await import("./team-domain.js");

  return {
    effectiveFrom,
    pricingType,
    fixedRate:null,
    shkTiers:normalizeShkTiers(
      rawTiers
    )
  };
}

function editorHasTariffDraft(){
  return Boolean(
    document.querySelector(
      "#manageEditorSheet .tariff-current-editor"
    )
  );
}

async function saveExistingPoint(button){
  if(
    saveBusy ||
    !activePointId
  ){
    return;
  }

  saveBusy=true;
  button.disabled=true;
  button.textContent="Сохранение…";

  try{
    const context=
      await loadPointContext(
        activePointId
      );

    const {
      saveAdminPoint,
      addAdminTariff,
      updateAdminTariff
    }=await import("./api/points.js");

    await saveAdminPoint(
      pointDraft(context.point)
    );

    if(editorHasTariffDraft()){
      const payload=
        await tariffDraft();

      if(tariffMode==="create"){
        assertNewTariffDate({
          tariffs:context.tariffs,
          effectiveFrom:
            payload.effectiveFrom
        });

        const createdId=
          await addAdminTariff({
            pointId:activePointId,
            ...payload
          });

        tariffEditId=
          String(createdId || "");
        tariffMode="edit-created";
      }else{
        const tariff=
          tariffEditId
            ? context.tariffs.find(
                item=>
                  item.id===tariffEditId
              )
            : currentTariffForDate(
                context.tariffs
              );

        if(!tariff){
          throw new Error(
            "Тариф не найден"
          );
        }

        tariffEditId=tariff.id;

        if(tariffMode==="edit-created"){
          assertNewTariffDate({
            tariffs:context.tariffs
              .filter(item=>
                item.id!==tariff.id
              ),
            effectiveFrom:
              payload.effectiveFrom
          });
        }else{
          assertCurrentTariffDate({
            tariffs:context.tariffs,
            tariffId:tariff.id,
            effectiveFrom:
              payload.effectiveFrom
          });
        }

        await updateAdminTariff({
          id:tariff.id,
          ...payload
        });

        if(tariffMode!=="edit-created"){
          tariffMode="edit-current";
        }
      }
    }

    button.textContent="Сохранено";
    notify("Изменения сохранены");

    window.setTimeout(()=>{
      if(
        document.getElementById(
          "manageEditorSheet"
        )?.classList.contains("on")
      ){
        button.textContent="Сохранить";
        button.disabled=false;
      }
    },900);
  }catch(error){
    button.textContent="Сохранить";
    button.disabled=false;
    notify(
      error instanceof Error
        ? error.message
        : "Не удалось сохранить",
      4200
    );
  }finally{
    saveBusy=false;
  }
}

async function openCurrentTariffEditor(button){
  if(!activePointId){
    return;
  }

  button.disabled=true;
  const previousText=button.textContent;
  button.textContent="Загрузка…";

  try{
    const {tariffs}=
      await loadPointContext(
        activePointId
      );

    const current=
      currentTariffForDate(tariffs);

    if(!current){
      tariffMode="create";
      tariffEditId="";
      allowOriginalTariffAdd=true;
      button.disabled=false;
      button.textContent=previousText;
      button.click();
      allowOriginalTariffAdd=false;
      return;
    }

    tariffMode="edit-current";
    tariffEditId=current.id;

    button.disabled=false;
    button.textContent=previousText;
    button.dataset.tariffEdit=current.id;
    button.click();
  }catch(error){
    button.disabled=false;
    button.textContent=previousText;
    notify(
      error instanceof Error
        ? error.message
        : "Не удалось открыть тариф",
      4200
    );
  }
}

function cancelCurrentTariffEditor(){
  const sheet=
    document.getElementById(
      "manageEditorSheet"
    );

  if(!sheet){
    return;
  }

  const cancel=
    document.createElement("button");

  cancel.type="button";
  cancel.hidden=true;
  cancel.dataset.tariffEditCancel="";
  sheet.append(cancel);
  cancel.click();
  cancel.remove();
  tariffMode="";
  tariffEditId="";
}

function openNewTariffEditor(){
  const changeButton=
    document.getElementById(
      "manageTariffAdd"
    );

  if(!changeButton){
    return;
  }

  tariffMode="create";
  tariffEditId="";
  allowOriginalTariffAdd=true;

  try{
    changeButton.click();
  }finally{
    allowOriginalTariffAdd=false;
  }
}

function syncTariffHelp(){
  const help=
    document.querySelector(
      "#manageEditorSheet .tariff-current-editor .employee-help"
    );

  if(!help){
    return;
  }

  help.textContent=
    tariffMode==="edit-current"
      ? "Редактируется текущий тариф. Новая запись в истории не создаётся."
      : "Создаётся новая версия тарифа с выбранной даты. Предыдущий тариф останется в истории.";
}

function ensureTariffActions(){
  const button=
    document.getElementById(
      "manageTariffAdd"
    );

  if(!button){
    return;
  }

  const text=
    button.textContent.trim();

  if(text==="Изменить тариф"){
    button.textContent=
      "Изменить текущий тариф";
  }

  if(
    button.textContent.trim()!==
      "Изменить текущий тариф" ||
    document.getElementById(
      "manageTariffCreate"
    )
  ){
    syncTariffHelp();
    return;
  }

  const create=
    document.createElement("button");

  create.type="button";
  create.className=
    "btn tariff-change-button";
  create.id="manageTariffCreate";
  create.textContent=
    "Новый тариф с даты";
  create.style.marginTop="8px";
  button.insertAdjacentElement(
    "afterend",
    create
  );

  let hint=
    document.getElementById(
      "manageTariffActionHint"
    );

  if(!hint){
    hint=document.createElement("div");
    hint.id="manageTariffActionHint";
    hint.className="employee-help";
    hint.textContent=
      "Изменение текущего тарифа не создаёт новую запись. Новый тариф с даты создаёт отдельную версию и сохраняет предыдущую в истории.";
    create.insertAdjacentElement(
      "afterend",
      hint
    );
  }
}

function syncSaveLabel(){
  const button=
    document.getElementById(
      "manageEditorSave"
    );

  if(
    button &&
    button.textContent.trim()==="Готово"
  ){
    button.textContent="Сохранить";
  }
}

function syncEditorUi(){
  const sheet=
    document.getElementById(
      "manageEditorSheet"
    );

  if(!sheet){
    return;
  }

  if(
    sheet.getAttribute("aria-hidden")===
      "true"
  ){
    tariffMode="";
    tariffEditId="";
    activePointId="";
    return;
  }

  syncSaveLabel();
  ensureTariffActions();
  syncTariffHelp();
}

function install(){
  const sheet=
    document.getElementById(
      "manageEditorSheet"
    );

  const saveButton=
    document.getElementById(
      "manageEditorSave"
    );

  if(!sheet || !saveButton){
    return;
  }

  const originalSave=
    saveButton.onclick;

  saveButton.onclick=function(event){
    const title=
      document.getElementById(
        "manageEditorTitle"
      )?.textContent.trim();

    const viewing=
      this.textContent.trim()===
      "Изменить";

    if(
      !activePointId ||
      title==="Новый ПВЗ" ||
      viewing
    ){
      return originalSave?.call(
        this,
        event
      );
    }

    event.preventDefault();

    queueMicrotask(()=>{
      void saveExistingPoint(this);
    });
  };

  document.addEventListener(
    "click",
    event=>{
      const pointRow=
        event.target.closest(
          ".point-manage-row[data-point-id]"
        );

      if(pointRow){
        activePointId=
          pointRow.dataset.pointId || "";
      }

      if(
        event.target.closest(
          "#pointAdd"
        )
      ){
        activePointId="";
      }
    },
    true
  );

  document.addEventListener(
    "click",
    event=>{
      const create=
        event.target.closest(
          "#manageTariffCreate"
        );

      if(create){
        event.preventDefault();
        event.stopImmediatePropagation();
        openNewTariffEditor();
        return;
      }

      const button=
        event.target.closest(
          "#manageTariffAdd"
        );

      if(!button){
        return;
      }

      if(allowOriginalTariffAdd){
        return;
      }

      const text=
        button.textContent.trim();

      if(
        button.dataset.tariffEdit ||
        text==="Загрузка…"
      ){
        return;
      }

      if(text==="Отменить"){
        if(tariffMode==="edit-current"){
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelCurrentTariffEditor();
        }else{
          tariffMode="";
          tariffEditId="";
        }
        return;
      }

      if(
        text==="Изменить тариф" ||
        text==="Изменить текущий тариф"
      ){
        event.preventDefault();
        event.stopImmediatePropagation();
        void openCurrentTariffEditor(
          button
        );
      }
    },
    true
  );

  const observer=
    new MutationObserver(
      syncEditorUi
    );

  observer.observe(
    sheet,
    {
      subtree:true,
      childList:true,
      attributes:true,
      attributeFilter:[
        "aria-hidden",
        "class"
      ]
    }
  );

  syncEditorUi();
}

if(typeof document!=="undefined"){
  window.setTimeout(
    install,
    0
  );
}
