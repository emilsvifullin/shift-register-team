import {
  ADVANCE_CAP,
  APP_VERSION,
  FULL_HOURS,
  MAX_MONEY,
  MAX_SHK,
  MAX_YEAR,
  MIN_YEAR,
  MONTHS,
  MONTHS_G,
  RULES_VERSION,
  WD
} from "./config.js";

import {
  DataValidationError,
  calc as domainCalc,
  inMonth as domainInMonth,
  isPlainObject,
  isValidDateString,
  payouts as domainPayouts
} from "./domain.js";

import {
  BACKUP_KEY,
  CHANNEL_NAME,
  DB_KEY,
  LEGACY_DB_KEY,
  StorageCorruptError,
  createAppStorage
} from "./storage.js";

import {
  signOut,
  startAuth
} from "./auth.js";

import {
  normalizePhone,
  optionalPhone,
  phoneLabel
} from "./phone.js";

import {
  addAdminTariff,
  deleteAdminEmployee,
  deleteAdminShift,
  importAdminLegacyShifts,
  loadTeamData,
  rollbackAdminEmployeeCreation,
  saveAdminEmployee,
  saveAdminEmployeeAuth,
  saveAdminPoint,
  saveAdminShift,
  subscribeTeamChanges
} from "./team.js";

import {
  calculateBaseAmount,
  createPricingSnapshot,
  createTeamId,
  legacyShiftPayload,
  normalizeShkTiers,
  tariffForDate
} from "./team-domain.js";

import {
  initEmployeeUi
} from "./employee-ui.js";

import {
  positionAppPicker,
  resetAppPickerPosition
} from "./picker-position.js";

const UI_KEY="shift-register-team-ui-v3";
const LOGIN_ENTRY_KEY="shift-register-login-entry-v1";

const BASE_TABS=Object.freeze([
  "shifts",
  "stats",
  "data"
]);

const ADMIN_TABS=Object.freeze([
  "shifts",
  "stats",
  "manage",
  "data"
]);

const MANAGE_SECTIONS=Object.freeze([
  "home",
  "employees",
  "points"
]);

const store=createAppStorage();
const syncChannel=("BroadcastChannel" in window)
  ? new BroadcastChannel(CHANNEL_NAME)
  : null;

let shifts=[];
let legacyShifts=[];
let tab="shifts";
let cursor=ymOf(new Date());
let draft=null;
let storageRevision=null;
let loadError=null;
let sheetPreviousFocus=null;
let pointPreviousFocus=null;
let monthPreviousFocus=null;
let datePreviousFocus=null;
let isAdmin=false;
let currentUser=null;
let currentProfile=null;
let employeeLinked=true;
let employeeArchived=false;
let serverConnected=false;
let serverDataError=null;
let realtimeStatus="connecting";
let realtimeStop=null;
let realtimeRefreshTimer=0;
let automaticRefreshTimer=0;
let manageSection="home";
let manageTransitionRunning=false;

let teamData={
  employees:[],
  points:[],
  employeePoints:[],
  accounts:[],
  tariffs:[],
  shifts:[],
  employee:null,
  linked:true,
  archived:false
};

let teamDataLoaded=false;
let teamDataLoading=false;
let teamDataError=null;

let employeeDraft=null;
let employeeSaving=false;
let employeeSheetMode="create";
let employeeSheetPreviousFocus=null;

let employeeSearchQuery="";
let employeeStatusFilter="active";
let employeePointFilter=null;
let employeeFilterDraft=null;
let employeeFilterSheetPreviousFocus=null;
let legacyMigrationEmployeeId="";
let legacyMigrationRunning=false;
let legacyMigrationProgress="";
let statsEmployeeId="";
let statsPointId="";
let manageEditorKind=null;
let manageEditorDraft=null;
let manageEditorSaving=false;
let manageEditorPreviousFocus=null;

const employeeSheetElement=
  document.getElementById(
    "employeeSheet"
  );

const employeeFilterSheetElement=
  document.getElementById(
    "employeeFilterSheet"
  );

const manageEditorSheetElement=
  document.getElementById(
    "manageEditorSheet"
  );

function disableFieldSuggestions(
  root=document
){
  const fields=
    root instanceof HTMLInputElement ||
    root instanceof HTMLTextAreaElement
      ? [root]
      : root.querySelectorAll?.(
          "input,textarea"
        ) || [];

  fields.forEach(field=>{
    field.setAttribute(
      "autocomplete",
      "off"
    );

    field.setAttribute(
      "data-1p-ignore",
      "true"
    );

    field.setAttribute(
      "data-lpignore",
      "true"
    );

    field.setAttribute(
      "data-form-type",
      "other"
    );
  });
}

disableFieldSuggestions();

new MutationObserver(records=>{
  records.forEach(record=>{
    record.addedNodes.forEach(node=>{
      if(node instanceof Element){
        disableFieldSuggestions(node);
      }
    });
  });
}).observe(
  document.body,
  {
    childList:true,
    subtree:true
  }
);

function availableTabs(){
  return isAdmin
    ? ADMIN_TABS
    : BASE_TABS;
}

function renderWhenReady(){
  if(
    tabTransitionRunning ||
    monthTransitionRunning ||
    manageTransitionRunning
  ){
    window.setTimeout(
      renderWhenReady,
      60
    );

    return;
  }

  render();
}

async function refreshTeamData({
  renderAfter=true
}={}){
  if(
    !currentUser ||
    teamDataLoading
  ){
    return false;
  }

  teamDataLoading=true;
  teamDataError=null;
  serverDataError=null;

  try{
    teamData=
      await loadTeamData({
        role:currentProfile.role,
        userId:currentUser.id
      });

    shifts=teamData.shifts;
    employeeLinked=
      teamData.linked!==false;
    employeeArchived=
      teamData.archived===true;
    serverConnected=true;

    teamDataLoaded=true;

    if(
      isAdmin &&
      !teamData.employees.some(
        employee=>
          employee.id===
          statsEmployeeId
      )
    ){
      statsEmployeeId=
        teamData.employees.find(
          employee=>
            employee.status==="active"
        )?.id ||
        teamData.employees[0]?.id ||
        "";
    }

    if(
      statsPointId &&
      !teamData.points.some(
        point=>
          point.id===statsPointId
      )
    ){
      statsPointId="";
    }

    return true;
  }catch(error){
    teamDataError=
      error instanceof Error
        ? error.message
        : "Не удалось загрузить данные";

    serverDataError=
      teamDataError;
    serverConnected=false;

    return false;
  }finally{
    teamDataLoading=false;

    if(
      renderAfter
    ){
      renderWhenReady();
    }
  }
}

async function startAutomaticSync(){
  realtimeStop?.();
  realtimeStop=null;

  window.clearInterval(
    automaticRefreshTimer
  );

  realtimeStatus="connecting";

  try{
    realtimeStop=
      await subscribeTeamChanges({
      role:currentProfile.role,
      onChange:()=>{
        window.clearTimeout(
          realtimeRefreshTimer
        );

        realtimeRefreshTimer=
          window.setTimeout(
            ()=>{
              void refreshTeamData();
            },
            180
          );
      },
      onStatus:status=>{
        realtimeStatus=
          status==="SUBSCRIBED"
            ? "connected"
            : [
                "CHANNEL_ERROR",
                "TIMED_OUT",
                "CLOSED"
              ].includes(status)
              ? "polling"
              : "connecting";

        if(tab==="data"){
          renderWhenReady();
        }
      }
      });
  }catch{
    realtimeStatus="polling";
  }

  automaticRefreshTimer=
    window.setInterval(
      ()=>{
        if(
          document.visibilityState===
            "visible" &&
          navigator.onLine
        ){
          void refreshTeamData({
            renderAfter:
              tab==="data"
          });
        }
      },
      30000
    );
}

function safeSessionGet(key){
  try{return sessionStorage.getItem(key);}catch{return null;}
}

function safeSessionSet(key,value){
  try{sessionStorage.setItem(key,value);return true;}catch{return false;}
}

function safeSessionRemove(key){
  try{sessionStorage.removeItem(key);}catch{}
}

function pageScroller(){
  return (
    document.querySelector(
      "#app .shift-scroll"
    ) ||
    document.getElementById("app")
  );
}

function pageScrollTop(){
  const scroller=
    pageScroller();

  return scroller
    ? scroller.scrollTop
    : 0;
}

function setPageScrollTop(value){
  const scroller=
    pageScroller();

  if(!scroller){
    return;
  }

  scroller.scrollTop=
    Math.max(
      0,
      Number(value) || 0
    );
}

function validMonthCursor(value){
  if(typeof value!=="string" || !/^\d{4}-\d{2}$/.test(value)) return false;
  const [year,month]=value.split("-").map(Number);
  return year>=MIN_YEAR && year<=MAX_YEAR && month>=1 && month<=12;
}

function sanitizeUIState(value){
  if(!isPlainObject(value)) return {};
  return {
    tab:ADMIN_TABS.includes(value.tab) ? value.tab : "shifts",
    cursor:validMonthCursor(value.cursor) ? value.cursor : ymOf(new Date()),
    scrollY:Number.isFinite(Number(value.scrollY)) ? Math.max(0,Number(value.scrollY)) : 0,
    sheetOpen:value.sheetOpen===true,
    sheetScrollTop:Number.isFinite(Number(value.sheetScrollTop)) ? Math.max(0,Number(value.sheetScrollTop)) : 0,
    draft:isPlainObject(value.draft) ? value.draft : null,
    manageSection:MANAGE_SECTIONS.includes(value.manageSection) ? value.manageSection : "home"
  };
}

function saveUIState(){
  try{
    if(
      draft &&
      document.body.classList.contains("sheet-open") &&
      typeof readForm==="function"
    ){
      readForm();
    }

    const sheet=document.getElementById("sheet");
    const sheetOpen=Boolean(
      draft &&
      document.body.classList.contains("sheet-open")
    );

    safeSessionSet(UI_KEY,JSON.stringify({
      tab,
      cursor,
      scrollY:pageScrollTop(),
      sheetOpen,
      sheetScrollTop:sheetOpen && sheet ? sheet.scrollTop : 0,
      draft:sheetOpen ? draft : null,
      manageSection
    }));
  }catch{}
}

function loadUIState(){
  const raw=safeSessionGet(UI_KEY);
  if(!raw) return {};
  try{return sanitizeUIState(JSON.parse(raw));}catch{return {};}
}

const savedUI=loadUIState();
tab=savedUI.tab || "shifts";
cursor=savedUI.cursor || ymOf(new Date());
manageSection=savedUI.manageSection || "home";

/* ========== утилиты ========== */
function ymOf(d){
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
}

function ymLabel(ym){
  const [year,month]=ym.split("-");
  return MONTHS[Number(month)-1]+" "+year;
}

function monthNom(ym){return MONTHS[Number(ym.split("-")[1])-1].toLowerCase();}
function monthGen(ym){return MONTHS_G[Number(ym.split("-")[1])-1];}

function shiftMonth(ym,delta){
  const [year,month]=ym.split("-").map(Number);
  const date=new Date(year,month-1+delta,1,12);
  const shifted=ymOf(date);
  const shiftedYear=Number(shifted.slice(0,4));
  if(shiftedYear<MIN_YEAR) return `${MIN_YEAR}-01`;
  if(shiftedYear>MAX_YEAR) return `${MAX_YEAR}-12`;
  return shifted;
}

function lastDayOfMonth(ym){
  const [year,month]=ym.split("-").map(Number);
  return new Date(year,month,0).getDate();
}

function localYMD(date=new Date()){
  return date.getFullYear()+"-"+
    String(date.getMonth()+1).padStart(2,"0")+"-"+
    String(date.getDate()).padStart(2,"0");
}

function nextYMD(ymd){
  const [year,month,day]=
    ymd.split("-").map(Number);

  return localYMD(
    new Date(
      year,
      month-1,
      day+1,
      12
    )
  );
}

function dateLabel(ymd){
  const [year,month,day]=ymd.split("-").map(Number);
  return day+" "+MONTHS_G[month-1]+" "+year;
}

function nf(number){
  return Math.round(number)
    .toLocaleString("ru-RU")
    .replace(/\s/g,"\u00A0");
}

function nfMoney(number){
  const cents=
    Math.round(
      Number(number)*100
    );

  const value=
    cents/100;

  return value
    .toLocaleString(
      "ru-RU",
      {
        minimumFractionDigits:
          Math.abs(cents)%100===0
            ? 0
            : 2,
        maximumFractionDigits:2
      }
    )
    .replace(/\s/g,"\u00A0");
}

function money(number){
  return nfMoney(number)+"\u00A0₽";
}
function esc(value){
  return String(value??"").replace(/[&<>\"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[char]));
}

function hoursWord(hours){
  return Number(hours)+" ч";
}

function shiftsWord(n){
  const last=n%10,lastTwo=n%100;
  if(last===1 && lastTwo!==11) return n+" смена";
  if(last>=2 && last<=4 && (lastTwo<10 || lastTwo>=20)) return n+" смены";
  return n+" смен";
}

function shiftsAccWord(n){
  const last=n%10,lastTwo=n%100;
  if(last===1 && lastTwo!==11) return n+" смену";
  if(last>=2 && last<=4 && (lastTwo<10 || lastTwo>=20)) return n+" смены";
  return n+" смен";
}

function partialShortWord(n){
  const last=n%10,lastTwo=n%100;
  if(last===1 && lastTwo!==11) return n+" неполная";
  if(last>=2 && last<=4 && (lastTwo<10 || lastTwo>=20)) return n+" неполные";
  return n+" неполных";
}

function extraPartialShortWord(n){
  const last=n%10,lastTwo=n%100;
  if(last===1 && lastTwo!==11) return n+" доп. неполная";
  if(last>=2 && last<=4 && (lastTwo<10 || lastTwo>=20)) return n+" доп. неполные";
  return n+" доп. неполных";
}

function calc(shift){return domainCalc(shift);}
function inMonth(
  ym,
  source=shifts
){
  return domainInMonth(source,ym);
}
function payouts(
  ym,
  source=shifts
){
  const result=domainPayouts(ym,source,{today:localYMD()});
  return {...result,nextYm:shiftMonth(ym,1)};
}

let appConfirmResolve=null;
let appConfirmPreviousFocus=null;
let toastTimer=null;

function focusableElements(container){
  return Array.from(container.querySelectorAll(
    'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )).filter(element=>!element.hidden && element.getClientRects().length>0);
}

function activeModal(){
  const ids=["appConfirm","datePicker","pointPicker","monthPicker","manageEditorSheet","employeeFilterSheet","employeeSheet","sheet"];
  return ids.map(id=>document.getElementById(id)).find(element=>
    element && (element.classList.contains("on") || element.getAttribute("aria-hidden")==="false")
  ) || null;
}

function setBackgroundInert(enabled){
  [document.querySelector("header"),document.querySelector("main"),document.querySelector(".bottom-controls")]
    .filter(Boolean)
    .forEach(element=>{
      if(enabled) element.setAttribute("inert","");
      else element.removeAttribute("inert");
    });
}

function prepareBottomSheetOpen(
  element,
  dragProperty
){
  element
    .getAnimations?.()
    .forEach(animation=>{
      animation.cancel();
    });

  element.dispatchEvent(
    new Event(
      "bottomsheetopen"
    )
  );

  element.style.removeProperty(
    "transition"
  );

  element.style.removeProperty(
    dragProperty
  );
}

function closeAppConfirm(result){
  const modal=document.getElementById("appConfirm");
  if(!modal.classList.contains("on")) return;

  modal.classList.remove("on");
  modal.setAttribute("aria-hidden","true");
  document.body.classList.remove("confirm-open");
  if(!activeModal()) setBackgroundInert(false);

  const resolve=appConfirmResolve;
  appConfirmResolve=null;
  if(resolve) resolve(result);

  setTimeout(()=>{
    if(appConfirmPreviousFocus && document.contains(appConfirmPreviousFocus)){
      appConfirmPreviousFocus.focus();
    }
    appConfirmPreviousFocus=null;
  },100);
}

function appConfirm(message,{okText="Подтвердить",danger=false,detail=""}={}){
  const modal=document.getElementById("appConfirm");
  const title=document.getElementById("appConfirmTitle");
  const detailElement=document.getElementById("appConfirmDetail");
  const ok=document.getElementById("appConfirmOk");
  const cancel=document.getElementById("appConfirmCancel");

  appConfirmPreviousFocus=document.activeElement;
  title.textContent=message;
  detailElement.textContent=detail;
  detailElement.hidden=!detail;
  ok.textContent=okText;
  ok.classList.toggle("danger",danger);
  modal.classList.add("on");
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("confirm-open");
  setBackgroundInert(true);
  setTimeout(()=>cancel.focus(),20);

  return new Promise(resolve=>{appConfirmResolve=resolve;});
}

function toast(message,duration=2200){
  const element=document.getElementById("toast");
  clearTimeout(toastTimer);
  element.textContent=message;
  element.classList.add("on");
  toastTimer=setTimeout(()=>element.classList.remove("on"),duration);
}

document.getElementById("appConfirmCancel").addEventListener("click",()=>closeAppConfirm(false));
document.getElementById("appConfirmOk").addEventListener("click",()=>closeAppConfirm(true));
document.getElementById("appConfirm").addEventListener("click",event=>{
  if(event.target.id==="appConfirm") closeAppConfirm(false);
});

document.addEventListener("keydown",event=>{
  const modal=activeModal();
  if(!modal) return;

  if(event.key==="Tab"){
    const items=focusableElements(modal);
    if(!items.length){event.preventDefault();return;}
    const first=items[0],last=items.at(-1);
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    return;
  }

  if(event.key!=="Escape") return;
  event.preventDefault();

  if(document.getElementById("appConfirm").classList.contains("on")) return closeAppConfirm(false);
  if(document.getElementById("dateJump").classList.contains("on")) return closeDateJump();
  if(document.getElementById("datePicker").classList.contains("on")) return closeDatePicker();
  if(document.getElementById("pointPicker").classList.contains("on")) return closePointPicker();
  if(document.getElementById("monthPicker").classList.contains("on")) return closeMonthPicker();
  if(document.getElementById("manageEditorSheet").classList.contains("on")) return closeManageEditor();
  if(document.getElementById("employeeFilterSheet").classList.contains("on")) return closeEmployeeFilterSheet();
  if(document.getElementById("employeeSheet").classList.contains("on")) return closeEmployeeEditor();
  if(document.getElementById("sheet").classList.contains("on")) return closeSheet();
});

function isRecoverableDraft(value){
  return isPlainObject(value) &&
    typeof value.id==="string" &&
    isValidDateString(value.date) &&
    typeof value.employeeId==="string" &&
    typeof value.dbPointId==="string" &&
    ["main","extra"].includes(value.type) &&
    typeof value.partial==="boolean";
}

async function loadFromStorage({notify=false}={}){
  const result=await store.load();
  legacyShifts=result.shifts;
  storageRevision=result.revision;
  loadError=null;
  if(notify){
    toast(
      "Локальная резервная копия обновлена"
    );
  }
  return result;
}

async function load(){
  const pendingUI=loadUIState();

  try{
    await loadFromStorage();
  }catch(error){
    loadError=error;
    legacyShifts=[];
    storageRevision=null;
  }

  await refreshTeamData({
    renderAfter:false
  });

  render();

  const savedDraft=
    pendingUI.draft;

  if(
    isAdmin &&
    !serverDataError &&
    pendingUI.sheetOpen===true &&
    isRecoverableDraft(savedDraft)
  ){
    openSheet(
      savedDraft.id,
      savedDraft,
      pendingUI.sheetScrollTop || 0
    );
  }

  requestAnimationFrame(()=>{
    setPageScrollTop(
      pendingUI.scrollY || 0
    );

    document.body.classList.remove(
      "app-booting"
    );

    if(
      document.body.classList.contains(
        "auth-login-entering"
      )
    ){
      requestAnimationFrame(
        ()=>{
          document.body.classList.add(
            "auth-login-entering-ready"
          );

          window.setTimeout(
            ()=>{
              document.body.classList.remove(
                "auth-login-entering",
                "auth-login-entering-ready"
              );
            },
            360
          );
        }
      );
    }
  });
}

function exportEnvelopeJson(){
  return JSON.stringify(
    {
      format:
        "shift-register-server-backup",
      version:1,
      scope:
        "operational-data",
      containsPersonalData:true,
      excludes:[
        "auth_accounts",
        "profiles",
        "audit_log"
      ],
      exportedAt:
        new Date().toISOString(),
      shifts,
      points:
        isAdmin
          ? teamData.points
          : undefined,
      tariffs:
        isAdmin
          ? teamData.tariffs
          : undefined,
      employees:
        isAdmin
          ? teamData.employees
          : undefined,
      employeePoints:
        isAdmin
          ? teamData.employeePoints
          : undefined
    },
    null,
    2
  );
}

function exportLegacyJson(){
  return JSON.stringify(
    {
      format:
        "shift-register-backup",
      schemaVersion:3,
      revision:storageRevision,
      shifts:legacyShifts
    },
    null,
    2
  );
}

function downloadText(text,filename,type="application/json"){
  const blob=new Blob([text],{type:`${type};charset=utf-8`});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download=filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}

function backupFilename(){
  return `shift-register-${localYMD()}-v${APP_VERSION}.json`;
}

function handleExternalRevision(){
  loadFromStorage({notify:true})
    .then(render)
    .catch(error=>{
      loadError=error;
      render();
    });
}

window.addEventListener("storage",event=>{
  if([DB_KEY,LEGACY_DB_KEY,BACKUP_KEY].includes(event.key)){
    handleExternalRevision();
  }
});

syncChannel?.addEventListener("message",event=>{
  if(event.data?.type==="revision" && event.data.revision!==storageRevision){
    handleExternalRevision();
  }
});


/* ========== экраны ========== */
const app = document.getElementById("app");

const employeeUi=
  initEmployeeUi({
    app,
    employeeSheet:
      employeeSheetElement
  });

function render(){
  saveUIState();

  if(
    !isAdmin &&
    tab==="manage"
  ){
    tab="shifts";
    manageSection="home";
  }

  const monthTab=
    ["shifts","stats"]
      .includes(tab);

  const period=document.getElementById("period");

  period.textContent=
    tab==="data"
      ? "Данные"
      : tab==="manage"
        ? "Управление"
        : ymLabel(cursor);

  period.classList.toggle(
    "clickable",
    monthTab
  );

  document.getElementById("prevM").disabled=
    !monthTab ||
    cursor===`${MIN_YEAR}-01`;

  document.getElementById("nextM").disabled=
    !monthTab ||
    cursor===`${MAX_YEAR}-12`;

  document.querySelectorAll("#prevM,#nextM").forEach(button=>{
    button.classList.toggle(
      "is-hidden",
      !monthTab
    );
  });

  const manageTab=
    document.getElementById(
      "tab-manage"
    );

  manageTab.hidden=
    !isAdmin;

  if(!isAdmin){
    manageTab.classList.remove(
      "on"
    );

    manageTab.setAttribute(
      "aria-selected",
      "false"
    );

    manageTab.tabIndex=-1;
  }

  availableTabs().forEach(name=>{
    const button=document.getElementById("tab-"+name);
    const selected=name===tab;

    button.classList.toggle(
      "on",
      selected
    );

    button.setAttribute(
      "aria-selected",
      String(selected)
    );

    button.tabIndex=
      selected
        ? 0
        : -1;
  });

  app.classList.toggle(
    "shifts-layout",
    tab==="shifts"
  );

  app.innerHTML=
    tab==="shifts"
      ? viewShifts()
      : tab==="stats"
        ? viewStats()
        : tab==="manage"
          ? viewManage()
          : viewData();

  requestAnimationFrame(
    fitShiftWindow
  );
}

function fitShiftWindow(){
  if(tab!=="shifts"){
    return;
  }

  const frame=
    app.querySelector(
      ".shift-window"
    );

  const scroller=
    app.querySelector(
      ".shift-scroll"
    );

  if(
    !(frame instanceof HTMLElement) ||
    !(scroller instanceof HTMLElement)
  ){
    return;
  }

  frame.style.removeProperty(
    "flex"
  );

  frame.style.removeProperty(
    "height"
  );

  const available=
    scroller.clientHeight;

  const rows=
    Array.from(
      scroller.querySelectorAll(
        ".sh"
      )
    );

  if(
    !rows.length ||
    available<=0
  ){
    return;
  }

  let fittedHeight=0;

  for(const row of rows){
    const rowHeight=
      row.getBoundingClientRect()
        .height;

    if(
      fittedHeight+
      rowHeight>
      available+0.5
    ){
      break;
    }

    fittedHeight+=
      rowHeight;
  }

  if(fittedHeight<=0){
    return;
  }

  const frameStyle=
    getComputedStyle(frame);

  const borderHeight=
    (
      parseFloat(
        frameStyle.borderTopWidth
      ) || 0
    )+
    (
      parseFloat(
        frameStyle.borderBottomWidth
      ) || 0
    );

  const targetHeight=
    Math.min(
      frame.getBoundingClientRect()
        .height,
      fittedHeight+
        borderHeight
    );

  frame.style.flex=
    `0 0 ${targetHeight}px`;

  frame.style.height=
    `${targetHeight}px`;
}

function serverStateCard(){
  if(
    teamDataLoading &&
    !teamDataLoaded
  ){
    return `
      <div class="ml">Синхронизация</div>
      <div class="card">
        <div class="manage-loading">
          Загрузка данных…
        </div>
      </div>
    `;
  }

  if(serverDataError){
    return `
      <div class="ml">Синхронизация</div>
      <div class="card">
        <div class="manage-placeholder">
          <div class="manage-placeholder-title">
            Не удалось загрузить данные
          </div>
          <div class="manage-placeholder-detail">
            ${esc(serverDataError)}
          </div>
        </div>
      </div>
      <button type="button" class="manage-add" id="serverRetry">
        Повторить
      </button>
    `;
  }

  if(
    !isAdmin &&
    !employeeLinked
  ){
    return `
      <div class="ml">Аккаунт</div>
      <div class="card">
        <div class="manage-placeholder">
          <div class="manage-placeholder-title">
            Аккаунт не привязан к сотруднику
          </div>
          <div class="manage-placeholder-detail">
            Обратитесь к администратору, чтобы он выбрал этот аккаунт в карточке сотрудника.
          </div>
        </div>
      </div>
    `;
  }

  if(
    !isAdmin &&
    employeeArchived
  ){
    return `
      <div class="ml">Аккаунт</div>
      <div class="card">
        <div class="manage-placeholder">
          <div class="manage-placeholder-title">
            Сотрудник находится в архиве
          </div>
          <div class="manage-placeholder-detail">
            Доступ к рабочим данным закрыт. Обратитесь к администратору, если сотрудника нужно восстановить.
          </div>
        </div>
      </div>
    `;
  }

  return "";
}

function viewShifts(){
  const state=serverStateCard();

  if(state){
    return state;
  }

  const list=inMonth(cursor);

  const adminControls=
    isAdmin
      ? `
        <div class="ml">Смены</div>
        <button
          type="button"
          class="manage-add"
          id="shiftAdd"
        >
          <span class="manage-add-plus" aria-hidden="true"></span>
          Добавить смену
        </button>
      `
      : "";

  const listLabel=
    isAdmin
      ? "Список"
      : shiftsWord(list.length);

  if(!list.length){
    return `
      ${adminControls}
      <div class="ml">${listLabel}</div>
      <div class="card">
        <div class="employee-empty">
          В этом месяце смен пока нет.
        </div>
      </div>
    `;
  }

  let html=`
    ${adminControls}
    <div class="ml">${listLabel}</div>

    <div class="card shift-window">
      <div
        class="shift-scroll"
        aria-label="Список смен"
      >
  `;

  for(const shift of list){
    const result=calc(shift);
    const parts=shift.date.split("-");
    const tags=[];

    if(shift.type==="extra"){
      tags.push(
        `<span class="tag g">Доп</span>`
      );
    }

    if(shift.partial){
      tags.push(
        `<span class="tag">${hoursWord(result.hours)}</span>`
      );
    }

    if(result.bonus>0){
      tags.push(
        `<span class="tag bonus">+${nfMoney(result.bonus)}</span>`
      );
    }

    if(result.fine>0){
      tags.push(
        `<span class="tag r">−${nfMoney(result.fine)}</span>`
      );
    }

    const shkLabel=
      result.fixed
        ? "Оклад"
        : `${shift.shk==="" ? "—" : nf(shift.shk)} ШК`;

    html+=`
      <button
        type="button"
        class="sh"
        data-edit="${esc(shift.id)}"
        aria-label="${esc(dateLabel(shift.date))}, ${esc(shift.point)}, ${money(result.total)}"
      >
        <span class="day">
          <span class="d">${Number(parts[2])}</span>
          <span class="w">${WD[new Date(shift.date+"T12:00:00").getDay()]}</span>
        </span>

        <span class="mid">
          <span class="p">${esc(shift.point)}</span>

          <span class="meta">
            <span>${shkLabel} · ${nf(result.rate)} ₽${isAdmin ? ` · ${esc(shift.employeeName)}` : ""}</span>
            ${tags.join("")}
          </span>
        </span>

        <span class="amt">${money(result.total)}</span>
      </button>
    `;
  }

  return html+`
      </div>
    </div>
  `;
}

function viewStats(){
  const state=serverStateCard();

  if(state){
    return state;
  }

  const selectedEmployee=
    isAdmin
      ? teamData.employees.find(
          employee=>
            employee.id===
            statsEmployeeId
        ) || null
      : teamData.employee;

  const statsShifts=
    selectedEmployee
      ? shifts.filter(
          shift=>
            shift.employeeId===
              selectedEmployee.id &&
            (
              !statsPointId ||
              shift.dbPointId===
                statsPointId
            )
        )
      : [];

  const payout=
    payouts(
      cursor,
      statsShifts
    );

  const aggregate=
    payout.all;

  const monthShifts=
    inMonth(
      cursor,
      statsShifts
    );

  const today=
    localYMD();

  const workedShifts=
    monthShifts.filter(
      shift=>
        shift.date<=today
    );

  const plannedShifts=
    monthShifts.filter(
      shift=>
        shift.date>today
    );

  const groupDetails=list=>{
    const details=[];

    const counts=
      list.reduce(
        (
          result,
          shift
        )=>{
          if(
            shift.type==="extra" &&
            shift.partial
          ){
            result.extraPartial++;
          }

          else if(
            shift.type==="extra"
          ){
            result.extra++;
          }

          else if(
            shift.partial
          ){
            result.partial++;
          }

          return result;
        },
        {
          extraPartial:0,
          extra:0,
          partial:0
        }
      );

    if(counts.extraPartial){
      details.push(
        extraPartialShortWord(
          counts.extraPartial
        )
      );
    }

    if(counts.extra){
      details.push(
        counts.extra+" доп."
      );
    }

    if(counts.partial){
      details.push(
        partialShortWord(
          counts.partial
        )
      );
    }

    return details.length
      ? ` (${details.join(", ")})`
      : "";
  };

  const statusParts=[];

  if(workedShifts.length){
    statusParts.push(
      `отработано ${workedShifts.length}${groupDetails(workedShifts)}`
    );
  }

  if(plannedShifts.length){
    statusParts.push(
      `запланировано ${plannedShifts.length}${groupDetails(plannedShifts)}`
    );
  }

  const shiftsSummary=
    statusParts.length
      ? `${shiftsWord(aggregate.n)}: ${statusParts.join(", ")}`
      : shiftsWord(aggregate.n);

  const paymentBaseLine=(
    label,
    amount
  )=>{
    if(!amount){
      return "";
    }

    return `
      <div class="s">
        ${label}:
        ${money(amount)}
      </div>
    `;
  };

  const bonusLine=amount=>{
    if(!amount){
      return "";
    }

    return `
      <div class="s">
        Премии:
        <span class="pos">
          + ${money(amount)}
        </span>
      </div>
    `;
  };

  const fineLine=amount=>{
    if(!amount){
      return "";
    }

    const correction=
      amount<0;

    return `
      <div class="s">
        ${
          correction
            ? "Корректировка штрафов:"
            : "Штрафы:"
        }
        <span class="${
          correction
            ? "pos"
            : "neg"
        }">
          ${
            correction
              ? "+"
              : "−"
          }
          ${money(
            Math.abs(amount)
          )}
        </span>
      </div>
    `;
  };

  const payment25Lines=[
    paymentBaseLine(
      "Авансные ПВЗ",
      payout.specialAdvance
    ),

    paymentBaseLine(
      "Остальные ПВЗ",
      payout.regularFirstBase
    ),

    bonusLine(
      payout.bonus25
    ),

    fineLine(
      payout.fine25
    )
  ].join("");

  const payment10Lines=[
    paymentBaseLine(
      "Авансные ПВЗ",
      payout.specialSecondHalfBase
    ),

    paymentBaseLine(
      "Перенос сверх лимита аванса",
      payout.specialCarry
    ),

    paymentBaseLine(
      "Остальные ПВЗ",
      payout.regularSecondBase
    ),

    bonusLine(
      payout.bonus10
    ),

    fineLine(
      payout.fine10
    )
  ].join("");

  const payment25Content=
    payment25Lines ||
    `
      <div class="s">
        Расчёт за 1–15 ${esc(monthGen(cursor))}
      </div>
    `;

  const payment10Content=
    payment10Lines ||
    `
      <div class="s">
        Окончательный расчёт за ${esc(monthNom(cursor))}
      </div>
    `;

  const fineTransferNotes=
    payout.otherFinePayments
      .map(item=>{
        const correction=
          item.amount<0;

        const alreadyApplied=
          item.date<=today;

        return `
          <div class="note">
            ${
              correction
                ? "Корректировка штрафов"
                : "Штрафы"
            }
            за ${esc(monthNom(cursor))}
            <span class="${
              correction
                ? "pos"
                : "neg"
            }">
              ${
                correction
                  ? "+"
                  : "−"
              }
              ${money(
                Math.abs(
                  item.amount
                )
              )}
            </span>
            ${
              alreadyApplied
                ? "учтены"
                : "учтутся"
            }
            в выплате
            ${esc(
              dateLabel(
                item.date
              )
            )}.
          </div>
        `;
      })
      .join("");

  const selectedStatsPoint=
    teamData.points.find(
      point=>
        point.id===statsPointId
    ) || null;

  const statsPointLabel=
    selectedStatsPoint
      ? selectedStatsPoint.name+
        (
          selectedStatsPoint.active===false
            ? " · архив"
            : ""
        )
      : "Все ПВЗ";

  const statsEmployeeLabel=
    selectedEmployee
      ? selectedEmployee.full_name+
        (
          selectedEmployee.status==="inactive"
            ? " · архив"
            : ""
        )
      : "Сотрудники не добавлены";

  const statsFilters=
    isAdmin
      ? `
        <div class="ml">Фильтры</div>
        <div class="card employee-editor">
          <button
            type="button"
            class="row point-row stats-filter-row"
            id="statsPointOpen"
            aria-label="Пункт выдачи для итогов: ${esc(statsPointLabel)}"
          >
            <div class="t">ПВЗ</div>
            <div class="point-value">
              ${esc(statsPointLabel)}
            </div>
          </button>

          <button
            type="button"
            class="row point-row stats-filter-row"
            id="statsEmployeeOpen"
            aria-label="Сотрудник для итогов: ${esc(statsEmployeeLabel)}"
            ${selectedEmployee ? "" : "disabled"}
          >
            <div class="t">Сотрудник</div>
            <div class="point-value">
              ${esc(statsEmployeeLabel)}
            </div>
          </button>
        </div>
      `
      : "";

  return `
    ${statsFilters}

    <div class="card">
      <div class="hero">
        <div class="k">
          Начислено
        </div>

        <div class="n ${
          String(
            Math.abs(
              Math.round(
                aggregate.total
              )
            )
          ).startsWith("1")
            ? "starts-one"
            : ""
        }">
          ${nfMoney(aggregate.total)}
          <small> ₽</small>
        </div>

        <div class="sub">
          ${shiftsSummary}
        </div>
      </div>
    </div>


    <div class="ml">
      Выплаты
    </div>

    <div class="card">
      <div class="row">
        <div class="l">
          <div class="t">
            25 ${esc(monthGen(cursor))}
          </div>

          ${payment25Content}
        </div>

        <div class="v ${
          payout.payment25<0
            ? "neg"
            : ""
        }">
          ${money(
            payout.payment25
          )}
        </div>
      </div>

      <div class="row">
        <div class="l">
          <div class="t">
            10 ${esc(
              monthGen(
                payout.nextYm
              )
            )}
          </div>

          ${payment10Content}
        </div>

        <div class="v ${
          payout.payment10<0
            ? "neg"
            : ""
        }">
          ${money(
            payout.payment10
          )}
        </div>
      </div>
    </div>

    ${fineTransferNotes}

    <div class="ml">
      За месяц
    </div>

    <div class="card">
      <div class="row">
        <div class="l">
          <div class="t">
            Смены
          </div>
        </div>

        <div class="v">
          ${money(aggregate.base)}
        </div>
      </div>

      <div class="row">
        <div class="l">
          <div class="t">
            Премии
          </div>
        </div>

        <div class="v pos">
          ${
            aggregate.bonus
              ? "+ "
              : ""
          }
          ${money(
            aggregate.bonus
          )}
        </div>
      </div>

      <div class="row">
        <div class="l">
          <div class="t">
            Штрафы
          </div>
        </div>

        <div class="v neg">
          ${
            aggregate.fine
              ? "− "
              : ""
          }
          ${money(
            aggregate.fine
          )}
        </div>
      </div>

      <div class="row total">
        <div class="l">
          <div class="t">
            Итого за
            ${esc(monthNom(cursor))}
          </div>
        </div>

        <div class="v">
          ${money(
            aggregate.total
          )}
        </div>
      </div>
    </div>
  `;
}

function viewData(){
  const metadata=
    currentUser?.user_metadata ||
    {};

  const accountName=
    teamData.employee?.full_name ||
    [
      metadata.full_name,
      metadata.fullName,
      metadata.name,
      metadata.display_name
    ].find(value=>
      typeof value==="string" &&
      value.trim()
    )?.trim() ||
    "";

  const title=serverConnected
    ? realtimeStatus==="connected"
      ? "Синхронизация в реальном времени"
      : "Автосинхронизация включена"
    : "Нет соединения с сервером";

  const detail=serverDataError ||
    (
      serverConnected
        ? realtimeStatus==="connected"
          ? "Изменения Supabase появляются автоматически на всех устройствах."
          : "Приложение автоматически проверяет изменения; ручное обновление не требуется."
        : "Проверьте подключение и повторите загрузку."
    );

  const employees=
    teamData.employees || [];

  if(
    !legacyMigrationEmployeeId &&
    employees.length
  ){
    legacyMigrationEmployeeId=
      employees.find(
        employee=>
          employee.status==="active"
      )?.id ||
      employees[0].id;
  }

  const employeeOptions=
    employees
      .map(employee=>`
        <option
          value="${esc(employee.id)}"
          ${employee.id===legacyMigrationEmployeeId ? "selected" : ""}
        >
          ${esc(employee.full_name)}${employee.status==="inactive" ? " · архив" : ""}
        </option>
      `)
      .join("");

  const legacySection=
    isAdmin &&
    (
      legacyShifts.length ||
      loadError
    )
      ? `
        <div class="ml">Локальные смены</div>
        <div class="card">
          <div class="row">
            <div class="l">
              <div class="t">
                ${loadError ? "Локальная копия повреждена" : shiftsWord(legacyShifts.length)}
              </div>
              <div class="s">
                Источник не будет удалён автоматически
              </div>
            </div>
          </div>

          ${loadError ? "" : `
            <label class="row">
              <div class="t">Сотрудник</div>
              <select
                id="legacyEmployee"
                aria-label="Сотрудник для локальных смен"
                ${legacyMigrationRunning ? "disabled" : ""}
              >
                ${employeeOptions}
              </select>
            </label>
          `}
        </div>

        <button class="btn" id="doLegacyExport">
          Скачать локальную копию
        </button>

        ${loadError ? `
          <button class="btn" id="doRawExport">
            Скачать исходные данные
          </button>
        ` : `
          <button
            class="btn gold"
            id="doLegacyMigrate"
            ${!employees.length || legacyMigrationRunning ? "disabled" : ""}
          >
            ${legacyMigrationRunning ? "Импортируем…" : "Перенести в Supabase"}
          </button>
        `}

        ${legacyMigrationProgress ? `
          <div class="manage-loading">
            ${esc(legacyMigrationProgress)}
          </div>
        ` : ""}
      `
      : "";

  return `
    <div class="ml">Синхронизация</div>
    <div class="data-status">
      <div class="dot ${serverConnected ? "" : "off"}"></div>
      <div class="data-status-copy">
        <div class="data-status-title">
          ${esc(title)}
        </div>
        <div class="data-status-detail">
          ${esc(detail)}
        </div>
      </div>
    </div>

    ${serverConnected ? "" : `
      <button class="btn" id="serverRetry">
        Повторить подключение
      </button>
    `}

    ${isAdmin ? `
      <div class="ml">Экспорт данных</div>
      <div class="card">
        <div class="row">
          <div class="l">
            <div class="t">Рабочие данные</div>
            <div class="s">Файл содержит ФИО, телефоны и реквизиты. В него не входят аккаунты входа и журнал аудита; храните файл в защищённом месте.</div>
          </div>
        </div>
      </div>
      <button class="btn gold" id="doExport">
        Скачать экспорт
      </button>
    ` : ""}

    ${legacySection}

    <div class="ml">Аккаунт</div>
    <div class="card">
      <div class="row">
        <div class="l">
          <div class="t">
            ${isAdmin ? "Администратор" : "Сотрудник"}
          </div>
          <div class="s">
            ${esc(accountName || "ФИО не указано")}
          </div>
          <div class="s" dir="ltr">
            ${esc(
              currentUser?.phone ||
              currentUser?.email ||
              "Аккаунт"
            )}
          </div>
        </div>
      </div>
    </div>
    <button class="btn" id="doSignOut">Выйти</button>

    <div class="developer-credit">
      <div>Версия: Shift Register ${APP_VERSION}</div>
      <div>Разработчик: emilsvifullin</div>
    </div>
  `;
}

function manageBackButton(
  id="manageBack",
  label="Управление"
){
  return `
    <button
      type="button"
      class="manage-back"
      id="${id}"
    >
      <svg
        viewBox="0 0 12 16"
        aria-hidden="true"
      >
        <path d="M9 3L3 8L9 13"></path>
      </svg>

      <span>${esc(label)}</span>
    </button>
  `;
}

function viewManageSection(
  title,
  detail
){
  return `
    ${manageBackButton()}

    <div class="ml">
      ${esc(title)}
    </div>

    <div class="card">
      <div class="manage-placeholder">
        <div class="manage-placeholder-title">
          ${esc(title)}
        </div>

        <div class="manage-placeholder-detail">
          ${esc(detail)}
        </div>
      </div>
    </div>
  `;
}

function employeePointIds(
  employeeId
){
  return teamData
    .employeePoints
    .filter(
      item=>
        item.employee_id===
        employeeId &&
        item.active!==false
    )
    .map(
      item=>
        item.point_id
    );
}

function employeeAccount(
  employee
){
  if(!employee.user_id){
    return null;
  }

  return teamData
    .accounts
    .find(
      account=>
        account.user_id===
        employee.user_id
    ) || null;
}

function employeeAccountEmail(
  account
){
  const email=String(
    account?.email || ""
  ).trim();

  return email.endsWith(
    "@phone.shift-register.example.com"
  )
    ? ""
    : email;
}

function employeePointsLabel(
  employeeId
){
  const ids=
    new Set(
      employeePointIds(
        employeeId
      )
    );

  const names=
    teamData
      .points
      .filter(
        point=>
          ids.has(point.id)
      )
      .map(
        point=>
          point.name
      );

  if(!names.length){
    return "ПВЗ не назначены";
  }

  if(names.length===1){
    return names[0];
  }

  return (
    names[0]+
    " · ещё "+
    (names.length-1)
  );
}

function employeePointNames(
  employeeId
){
  const ids=
    new Set(
      employeePointIds(
        employeeId
      )
    );

  return teamData
    .points
    .filter(
      point=>
        ids.has(point.id)
    )
    .map(
      point=>
        point.name
    );
}

function employeeSearchValue(
  value
){
  return String(
    value ?? ""
  )
    .trim()
    .toLocaleLowerCase(
      "ru-RU"
    );
}

function filteredEmployees(){
  const query=
    employeeSearchValue(
      employeeSearchQuery
    );

  return teamData
    .employees
    .filter(employee=>{
      if(
        employeeStatusFilter!=="all" &&
        employee.status!==
          employeeStatusFilter
      ){
        return false;
      }

      if(employeePointFilter){
        const assigned=
          employeePointIds(
            employee.id
          );

        if(
          !employeePointFilter
            .some(
              pointId=>
                assigned.includes(
                  pointId
                )
            )
        ){
          return false;
        }
      }

      if(!query){
        return true;
      }

      const searchValue=
        employeeSearchValue(
          [
            employee.full_name,
            ...employeePointNames(
              employee.id
            )
          ].join(" ")
        );

      return searchValue.includes(
        query
      );
    })
    .sort(
      (
        first,
        second
      )=>
        first.full_name.localeCompare(
          second.full_name,
          "ru",
          {
            sensitivity:"base"
          }
        )
    );
}

function employeeRowHTML(
  employee
){
  const account=
    employeeAccount(
      employee
    );

  const archived=
    employee.status===
    "inactive";

  return `
    <button
      type="button"
      class="manage-row employee-row"
      data-employee-id="${esc(employee.id)}"
    >
      <span class="manage-row-copy">
        <span class="employee-title-line">
          <span class="manage-row-title">
            ${esc(employee.full_name)}
          </span>

          ${
            archived
              ? `
                <span class="employee-state">
                  В архиве
                </span>
              `
              : ""
          }
        </span>

        <span class="manage-row-detail">
          ${esc(
            employeePointsLabel(
              employee.id
            )
          )}
        </span>

        <span class="employee-account-label">
          ${
            account?.login
              ? esc(account.login)
              : "Аккаунт не привязан"
          }
        </span>
      </span>

      <span
        class="manage-chevron"
        aria-hidden="true"
      >
        <svg viewBox="0 0 12 16">
          <path d="M3 3L9 8L3 13"></path>
        </svg>
      </span>
    </button>
  `;
}

function employeeListHTML(){
  const employees=
    filteredEmployees();

  if(employees.length){
    return `
      <div class="card manage-menu">
        ${
          employees
            .map(
              employee=>
                employeeRowHTML(
                  employee
                )
            )
            .join("")
        }
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="employee-empty">
        ${
          teamData.employees.length
            ? "Ничего не найдено."
            : "Сотрудников пока нет."
        }
      </div>
    </div>
  `;
}

function updateEmployeeList(){
  if(
    tab!=="manage" ||
    manageSection!=="employees"
  ){
    return;
  }

  const list=
    document.getElementById(
      "employeeList"
    );

  if(!list){
    return;
  }

  list.innerHTML=
    employeeListHTML();
}

function employeeFilterLabel(){
  const statusLabel=
    employeeStatusFilter==="active"
      ? "Активные"
      : employeeStatusFilter==="inactive"
        ? "Архив"
        : "Все";

  if(!employeePointFilter){
    return statusLabel;
  }

  if(employeePointFilter.length===1){
    const point=
      teamData.points.find(
        item=>
          item.id===
          employeePointFilter[0]
      );

    return point
      ? statusLabel+" · "+point.name
      : statusLabel;
  }

  return (
    statusLabel+
    " · "+
    employeePointFilter.length+
    " ПВЗ"
  );
}

function viewEmployees(){
  if(teamDataLoading && !teamDataLoaded){
    return `
      ${manageBackButton()}

      <div class="ml">
        Сотрудники
      </div>

      <div class="card">
        <div class="manage-loading">
          Загрузка сотрудников…
        </div>
      </div>
    `;
  }

  if(teamDataError && !teamDataLoaded){
    return `
      ${manageBackButton()}

      <div class="ml">
        Сотрудники
      </div>

      <div class="card">
        <div class="manage-placeholder">
          <div class="manage-placeholder-title">
            Не удалось загрузить сотрудников
          </div>

          <div class="manage-placeholder-detail">
            ${esc(teamDataError)}
          </div>
        </div>
      </div>

      <button
        type="button"
        class="manage-add"
        id="employeeRetry"
      >
        Повторить
      </button>
    `;
  }

  return `
    ${manageBackButton()}

    <div class="ml">
      Сотрудники
    </div>

    <button
      type="button"
      class="manage-add"
      id="employeeAdd"
    >
      <span
        class="manage-add-plus"
        aria-hidden="true"
      ></span>

      Добавить сотрудника
    </button>

    <div class="ml">
      Поиск и фильтр
    </div>

    <div class="card employee-editor">
      <label class="row">
        <input
          type="search"
          id="employeeSearch"
          autocomplete="off"
          spellcheck="false"
          value="${esc(employeeSearchQuery)}"
          placeholder="Поиск"
          aria-label="Поиск сотрудников"
        >
      </label>

      <button
        type="button"
        class="row point-row"
        id="employeeFilterOpen"
      >
        <div class="t">
          Фильтр
        </div>

        <div class="point-value">
          ${esc(employeeFilterLabel())}
        </div>
      </button>
    </div>

    <div class="ml">
      Список
    </div>

    <div id="employeeList">
      ${employeeListHTML()}
    </div>
  `;
}

function drawEmployeeFilterSheet(){
  if(!employeeFilterDraft){
    return;
  }

  const pointRows=
    [
      {
        id:"",
        name:"Все ПВЗ"
      },
      ...teamData.points.map(
        point=>({
          id:point.id,
          name:point.name
        })
      )
    ]
      .map(point=>{
        const selected=
          !point.id
            ? employeeFilterDraft
                .pointIds===null
            : employeeFilterDraft
                .pointIds===null ||
              employeeFilterDraft
                .pointIds
                .includes(point.id);

        return `
          <button
            type="button"
            class="employee-point ${selected ? "on" : ""}"
            data-employee-filter-point="${esc(point.id)}"
          >
            <span
              class="employee-point-check"
              aria-hidden="true"
            >
              ${selected ? "✓" : ""}
            </span>

            <span class="employee-point-name">
              ${esc(point.name)}
            </span>
          </button>
        `;
      })
      .join("");

  document
    .getElementById(
      "employeeFilterSheetBody"
    )
    .innerHTML=`
      <div class="ml">
        Статус
      </div>

      <div class="card segbox">
        <div class="seg">
          <button
            type="button"
            data-employee-filter-status="active"
            class="${employeeFilterDraft.status==="active" ? "on" : ""}"
          >
            Активные
          </button>

          <button
            type="button"
            data-employee-filter-status="inactive"
            class="${employeeFilterDraft.status==="inactive" ? "on" : ""}"
          >
            Архив
          </button>

          <button
            type="button"
            data-employee-filter-status="all"
            class="${employeeFilterDraft.status==="all" ? "on" : ""}"
          >
            Все
          </button>
        </div>
      </div>

      <div class="ml">
        Пункт выдачи
      </div>

      <div class="card employee-points">
        ${pointRows}
      </div>

      <button
        type="button"
        class="btn"
        id="employeeFilterReset"
      >
        Сбросить фильтр
      </button>

      <div
        class="sheet-spacer"
        aria-hidden="true"
      ></div>
    `;
}

function openEmployeeFilterSheet(){
  const sheet=
    employeeFilterSheetElement;

  const veil=
    document.getElementById(
      "employeeFilterVeil"
    );

  employeeFilterSheetPreviousFocus=
    document.activeElement;

  employeeFilterDraft={
    status:
      employeeStatusFilter,
    pointIds:
      employeePointFilter
        ? [...employeePointFilter]
        : null
  };

  drawEmployeeFilterSheet();

  prepareBottomSheetOpen(
    sheet,
    "--sheet-drag"
  );

  sheet.style.display="block";

  sheet.classList.remove("on");

  sheet.setAttribute(
    "aria-hidden",
    "false"
  );

  veil.setAttribute(
    "aria-hidden",
    "false"
  );

  setBackgroundInert(true);

  void sheet.offsetHeight;

  document.body.classList.add(
    "sheet-open"
  );

  veil.classList.add(
    "on"
  );

  sheet.classList.add(
    "on"
  );

  requestAnimationFrame(()=>{
    sheet.scrollTop=0;

    sheet.focus({
      preventScroll:true
    });
  });
}

function closeEmployeeFilterSheet(){
  const sheet=
    employeeFilterSheetElement;

  if(
    !sheet.classList.contains(
      "on"
    )
  ){
    return;
  }

  const veil=
    document.getElementById(
      "employeeFilterVeil"
    );

  veil.classList.remove(
    "on"
  );

  veil.setAttribute(
    "aria-hidden",
    "true"
  );

  sheet.classList.remove(
    "on"
  );

  sheet.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.classList.remove(
    "sheet-open"
  );

  employeeFilterDraft=null;

  if(!activeModal()){
    setBackgroundInert(false);
  }

  const previousFocus=
    employeeFilterSheetPreviousFocus;

  employeeFilterSheetPreviousFocus=null;

  setTimeout(()=>{
    if(
      previousFocus &&
      document.contains(
        previousFocus
      )
    ){
      previousFocus.focus();
    }
  },100);
}

function applyEmployeeFilter(){
  if(!employeeFilterDraft){
    return;
  }

  employeeStatusFilter=
    employeeFilterDraft.status;

  employeePointFilter=
    employeeFilterDraft.pointIds===null
      ? null
      : [...employeeFilterDraft.pointIds];

  closeEmployeeFilterSheet();
  render();
}

function pointTariffs(pointId){
  return teamData.tariffs
    .filter(
      tariff=>
        tariff.point_id===pointId
    )
    .sort((first,second)=>
      second.effective_from
        .localeCompare(
          first.effective_from
        )
    );
}

function tariffTypeLabel(tariff){
  return tariff?.pricing_type===
    "fixed"
      ? "Фиксированный"
      : "По ШК";
}

function tariffRateRowsHTML(tariff){
  if(!tariff){
    return "";
  }

  if(tariff.pricing_type==="fixed"){
    return `
      <div class="tariff-rate-row">
        <span>Полная смена</span>
        <strong>${money(tariff.fixed_rate)}</strong>
      </div>
    `;
  }

  let previousLimit=null;

  return (tariff.shk_tiers || [])
    .map(tier=>{
      const range=
        tier.up_to===null
          ? previousLimit===null
            ? "Без верхней границы"
            : `Свыше ${nf(previousLimit)} ШК`
          : `До ${nf(tier.up_to)} ШК`;

      if(tier.up_to!==null){
        previousLimit=
          Number(tier.up_to);
      }

      return `
        <div class="tariff-rate-row">
          <span>${esc(range)}</span>
          <strong>${money(tier.rate)}</strong>
        </div>
      `;
    })
    .join("");
}

function tariffCardHTML(
  tariff,
  {
    datePrefix="Действует с"
  }={}
){
  if(!tariff){
    return `
      <div class="card">
        <div class="employee-empty">
          Тариф пока не задан.
        </div>
      </div>
    `;
  }

  return `
    <div class="card tariff-info-card">
      <div class="tariff-info-head">
        <div>
          <div class="t">
            ${tariffTypeLabel(tariff)}
          </div>
        </div>

        <div class="tariff-info-date">
          ${esc(datePrefix)}
          ${esc(dateLabel(tariff.effective_from))}
        </div>
      </div>

      <div class="tariff-rate-list">
        ${tariffRateRowsHTML(tariff)}
      </div>
    </div>
  `;
}

function nextTariffEffectiveFrom(pointId){
  const occupied=
    new Set(
      pointTariffs(pointId)
        .map(
          tariff=>
            tariff.effective_from
        )
    );

  let value=localYMD();

  while(occupied.has(value)){
    value=nextYMD(value);
  }

  return value;
}

function tariffHistoryItemHTML(
  tariff,
  {
    planned=false
  }={}
){
  return `
    <details class="tariff-history-item">
      <summary>
        <span>
          <strong>${tariffTypeLabel(tariff)}</strong>
          <small>
            ${planned ? "Начнёт действовать" : "Действовал с"}
            ${esc(dateLabel(tariff.effective_from))}
          </small>
        </span>
        <span class="tariff-history-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="tariff-history-body">
        ${tariffRateRowsHTML(tariff)}
      </div>
    </details>
  `;
}

function pointTariffHistoryHTML(
  pointId,
  current
){
  const today=localYMD();
  const tariffs=pointTariffs(pointId);
  const planned=tariffs
    .filter(
      tariff=>
        tariff.effective_from>today
    )
    .sort(
      (a,b)=>
        a.effective_from.localeCompare(
          b.effective_from
        )
    );
  const history=tariffs
    .filter(
      tariff=>
        tariff.effective_from<=today &&
        tariff.id!==current?.id
    );

  return `
    ${planned.length ? `
      <div class="ml">Запланированные тарифы</div>
      <div class="card tariff-history-list">
        ${planned
          .map(tariff=>
            tariffHistoryItemHTML(
              tariff,
              {planned:true}
            )
          )
          .join("")}
      </div>
    ` : ""}

    <div class="ml">История тарифов</div>
    <div class="card tariff-history-list">
      ${history.length
        ? history
          .map(tariff=>
            tariffHistoryItemHTML(
              tariff
            )
          )
          .join("")
        : `
          <div class="employee-empty">
            Предыдущих тарифов пока нет.
          </div>
        `}
    </div>
  `;
}

function pointInformationHTML(
  point,
  current
){
  return `
    <div class="ml">Пункт выдачи</div>
    <div class="card employee-detail point-info-card">
      <div class="row">
        <div class="l">
          <div class="s">Название</div>
          <div class="t">${esc(point.name)}</div>
        </div>
      </div>
      <div class="row">
        <div class="l">
          <div class="s">Статус</div>
          <div class="t">${point.active===false ? "В архиве" : "Активен"}</div>
        </div>
      </div>
      <div class="row">
        <div class="l">
          <div class="s">Порядок</div>
          <div class="t">${nf(Number(point.sort_order) || 1)}</div>
        </div>
      </div>
      <div class="row">
        <div class="l">
          <div class="s">Аванс</div>
          <div class="t">${point.advance_enabled===true ? "Включён" : "Выключен"}</div>
        </div>
      </div>
    </div>

    <div class="ml">Текущий тариф</div>
    ${tariffCardHTML(current)}
    ${pointTariffHistoryHTML(point.id,current)}
    <div class="sheet-spacer" aria-hidden="true"></div>
  `;
}

function viewPoints(){
  if(teamDataLoading && !teamDataLoaded){
    return `
      ${manageBackButton()}

      <div class="ml">
        Пункты выдачи и тарифы
      </div>

      <div class="card">
        <div class="manage-loading">
          Загрузка пунктов…
        </div>
      </div>
    `;
  }

  if(teamDataError && !teamDataLoaded){
    return `
      ${manageBackButton()}

      <div class="ml">
        Пункты выдачи и тарифы
      </div>

      <div class="card">
        <div class="manage-placeholder">
          <div class="manage-placeholder-title">
            Не удалось загрузить пункты
          </div>

          <div class="manage-placeholder-detail">
            ${esc(teamDataError)}
          </div>
        </div>
      </div>

      <button
        type="button"
        class="manage-add"
        id="pointRetry"
      >
        Повторить
      </button>
    `;
  }

  const rows=
    teamData.points
      .map(point=>`
          <button
            type="button"
            class="manage-row"
            data-point-id="${esc(point.id)}"
          >
            <span class="manage-row-copy">
              <span class="manage-row-title">
                ${esc(point.name)}
              </span>
            </span>
            <span class="manage-chevron" aria-hidden="true">
              <svg viewBox="0 0 12 16">
                <path d="M3 3L9 8L3 13"></path>
              </svg>
            </span>
          </button>
        `)
      .join("");

  return `
    ${manageBackButton()}

    <div class="ml">
      Пункты выдачи и тарифы
    </div>

    <button
      type="button"
      class="manage-add"
      id="pointAdd"
    >
      <span class="manage-add-plus" aria-hidden="true"></span>
      Добавить ПВЗ
    </button>

    ${
      rows
        ? `
          <div class="card manage-menu">
            ${rows}
          </div>
        `
        : `
          <div class="card">
            <div class="employee-empty">
              Пунктов пока нет.
            </div>
          </div>
        `
    }
  `;
}

function defaultTariffTiers(){
  const existing=
    teamData.tariffs.find(
      tariff=>
        tariff.pricing_type===
        "shk_tiers"
    )?.shk_tiers;

  return (existing || [
    {up_to:350,rate:3000},
    {up_to:450,rate:3500},
    {up_to:550,rate:4500},
    {up_to:650,rate:5500},
    {up_to:null,rate:6500}
  ]).map(tier=>({...tier}));
}

function readManageEditor(){
  if(!manageEditorDraft){
    return;
  }

  const value=id=>
    document.getElementById(id)
      ?.value ?? "";

  if(manageEditorKind==="point"){
    manageEditorDraft.name=
      value("managePointName");
    manageEditorDraft.sortOrder=
      value("managePointSort");
  }

  if(
    manageEditorDraft.isNew ||
    manageEditorDraft.tariffOpen
  ){
    if(
      document.getElementById(
        "manageFixedRate"
      )
    ){
      manageEditorDraft.fixedRate=
        value("manageFixedRate");
    }

    document
      .querySelectorAll(
        "[data-tier-index]"
      )
      .forEach(row=>{
        const index=Number(
          row.dataset.tierIndex
        );

        const limit=
          row.querySelector(
            "[data-tier-limit]"
          );

        const rate=
          row.querySelector(
            "[data-tier-rate]"
          );

        if(limit){
          manageEditorDraft
            .tiers[index]
            .up_to=limit.value;
        }

        if(rate){
          manageEditorDraft
            .tiers[index]
            .rate=rate.value;
        }
      });
  }
}

function tierEditorHTML(tiers){
  return tiers.map((tier,index)=>{
    const final=index===tiers.length-1;

    return `
      <div class="row tariff-tier" data-tier-index="${index}">
        <div class="tariff-tier-fields">
          <label class="tariff-tier-field">
            <span>${final ? "Диапазон" : "ШК до"}</span>
            ${final ? `
              <strong class="tariff-tier-open">Без границы</strong>
            ` : `
              <input type="number" inputmode="numeric" data-tier-limit value="${esc(tier.up_to)}" min="1" step="1" aria-label="ШК до">
            `}
          </label>
          <label class="tariff-tier-field">
            <span>Ставка, ₽</span>
            <input type="text" inputmode="decimal" data-tier-rate value="${esc(tier.rate)}" aria-label="Ставка">
          </label>
        </div>
        ${!final && tiers.length>2 ? `
          <button type="button" class="tariff-tier-remove" data-tier-remove="${index}" aria-label="Удалить границу">×</button>
        ` : `<span class="tariff-tier-remove-space" aria-hidden="true"></span>`}
      </div>
    `;
  }).join("");
}

function updateManageEditorHeader(){
  const viewing=
    manageEditorDraft &&
    !manageEditorDraft.isNew &&
    !manageEditorDraft.editing;

  document.getElementById(
    "manageEditorCancel"
  ).textContent=
    viewing
      ? "Закрыть"
      : "Отмена";

  document.getElementById(
    "manageEditorSave"
  ).textContent=
    viewing
      ? "Изменить"
      : "Готово";
}

function drawManageEditor(){
  if(!manageEditorDraft){
    return;
  }

  const body=
    document.getElementById(
      "manageEditorBody"
    );

  updateManageEditorHeader();

  if(manageEditorKind==="point"){
    const current=
      manageEditorDraft.point
        ? tariffForDate(
            teamData.tariffs,
            manageEditorDraft.point.id,
            localYMD()
          )
        : null;

    if(
      !manageEditorDraft.isNew &&
      !manageEditorDraft.editing
    ){
      body.innerHTML=
        pointInformationHTML(
          manageEditorDraft.point,
          current
        );
      return;
    }

    const tariffSection=
      manageEditorDraft.isNew
        ? `
          <div class="ml">Тариф</div>
          <div class="card segbox"><div class="seg">
            <button type="button" data-pricing-type="fixed" class="${manageEditorDraft.pricingType==="fixed" ? "on" : ""}">Фикс</button>
            <button type="button" data-pricing-type="shk_tiers" class="${manageEditorDraft.pricingType==="shk_tiers" ? "on" : ""}">По ШК</button>
          </div></div>
          ${tariffDraftFields()}
        `
        : `
          <div class="ml">Тариф</div>
          ${tariffCardHTML(current)}

          <button
            type="button"
            class="btn tariff-change-button"
            id="manageTariffAdd"
          >
            ${manageEditorDraft.tariffOpen ? "Отменить" : "Изменить тариф"}
          </button>

          ${manageEditorDraft.tariffOpen ? `
            <div class="tariff-new-block">
              <div class="ml">Новая версия тарифа</div>
              <div class="card segbox"><div class="seg">
                <button type="button" data-pricing-type="fixed" class="${manageEditorDraft.pricingType==="fixed" ? "on" : ""}">Фикс</button>
                <button type="button" data-pricing-type="shk_tiers" class="${manageEditorDraft.pricingType==="shk_tiers" ? "on" : ""}">По ШК</button>
              </div></div>
              ${tariffDraftFields()}
              <div class="employee-help">
                После сохранения предыдущие тарифы и исторические смены не изменятся.
              </div>
            </div>
          ` : ""}
        `;

    body.innerHTML=`
      <div class="ml">Пункт выдачи</div>
      <div class="card employee-editor">
        <label class="row">
          <div class="t">Название</div>
          <input type="text" id="managePointName" value="${esc(manageEditorDraft.name)}" autocomplete="off">
        </label>
        <label class="row">
          <div class="t">Порядок</div>
          <input type="number" id="managePointSort" value="${esc(manageEditorDraft.sortOrder)}" min="1" step="1" inputmode="numeric">
        </label>
      </div>

      <div class="ml">Статус</div>
      <div class="card segbox"><div class="seg">
        <button type="button" data-point-active="1" class="${manageEditorDraft.active ? "on" : ""}">Активен</button>
        <button type="button" data-point-active="0" class="${!manageEditorDraft.active ? "on" : ""}">В архиве</button>
      </div></div>

      <div class="ml">Аванс</div>
      <div class="card segbox"><div class="seg">
        <button type="button" data-point-advance="1" class="${manageEditorDraft.advanceEnabled ? "on" : ""}">Включён</button>
        <button type="button" data-point-advance="0" class="${!manageEditorDraft.advanceEnabled ? "on" : ""}">Выключен</button>
      </div></div>

      ${tariffSection}
      <div class="sheet-spacer" aria-hidden="true"></div>
    `;
    return;
  }
}

function tariffDraftFields(){
  return `
    <div class="card employee-editor">
      <button
        type="button"
        class="row point-row"
        id="manageTariffDateOpen"
      >
        <div class="t">Действует с</div>
        <div class="point-value">
          ${esc(dateLabel(manageEditorDraft.effectiveFrom))}
        </div>
      </button>
      ${manageEditorDraft.pricingType==="fixed" ? `
        <label class="row">
          <div class="t">Ставка</div>
          <input type="text" inputmode="decimal" id="manageFixedRate" value="${esc(manageEditorDraft.fixedRate)}">
        </label>
      ` : ""}
    </div>
    ${manageEditorDraft.pricingType==="shk_tiers" ? `
      <div class="ml">Границы и ставки</div>
      <div class="card tariff-tiers">
        ${tierEditorHTML(manageEditorDraft.tiers)}
      </div>
      <button type="button" class="btn" id="tierAdd">Добавить границу</button>
    ` : ""}
  `;
}

function openManageEditor(kind,id=null){
  if(!isAdmin){
    return;
  }

  manageEditorKind=kind;
  manageEditorPreviousFocus=
    document.activeElement;

  if(kind!=="point"){
    return;
  }

  const point=teamData.points.find(
    item=>item.id===id
  );

  const current=point
    ? tariffForDate(
        teamData.tariffs,
        point.id,
        localYMD()
      )
    : null;

  manageEditorDraft=point
    ? {
        id:point.id,
        point,
        isNew:false,
        editing:false,
        name:point.name,
        sortOrder:point.sort_order || 1,
        active:point.active!==false,
        advanceEnabled:point.advance_enabled===true,
        tariffOpen:false,
        pricingType:
          current?.pricing_type ||
          "fixed",
        fixedRate:
          current?.fixed_rate ||
          3000,
        tiers:
          current?.shk_tiers
            ? current.shk_tiers.map(
                tier=>({...tier})
              )
            : defaultTariffTiers(),
        effectiveFrom:
          nextTariffEffectiveFrom(
            point.id
          )
      }
    : {
        id:null,
        point:null,
        isNew:true,
        editing:true,
        name:"",
        sortOrder:
          Math.max(
            0,
            ...teamData.points.map(
              item=>Number(item.sort_order) || 0
            )
          )+1,
        active:true,
        advanceEnabled:false,
        tariffOpen:true,
        pricingType:"fixed",
        fixedRate:3000,
        tiers:defaultTariffTiers(),
        effectiveFrom:localYMD()
      };

  document.getElementById(
    "manageEditorTitle"
  ).textContent=
    manageEditorDraft.isNew
      ? "Новый ПВЗ"
      : "Пункт выдачи";

  drawManageEditor();

  const veil=document.getElementById(
    "manageEditorVeil"
  );

  prepareBottomSheetOpen(
    manageEditorSheetElement,
    "--sheet-drag"
  );

  manageEditorSheetElement.style.display="block";
  manageEditorSheetElement.classList.remove("on");
  manageEditorSheetElement.setAttribute("aria-hidden","false");
  veil.setAttribute("aria-hidden","false");
  setBackgroundInert(true);
  void manageEditorSheetElement.offsetHeight;
  document.body.classList.add("sheet-open");
  veil.classList.add("on");
  manageEditorSheetElement.classList.add("on");
  requestAnimationFrame(()=>{
    manageEditorSheetElement.scrollTop=0;
    manageEditorSheetElement.focus({
      preventScroll:true
    });
  });
}

function closeManageEditor(){
  if(!manageEditorSheetElement.classList.contains("on")){
    return;
  }

  const veil=document.getElementById("manageEditorVeil");
  veil.classList.remove("on");
  veil.setAttribute("aria-hidden","true");
  manageEditorSheetElement.classList.remove("on");
  manageEditorSheetElement.setAttribute("aria-hidden","true");
  document.body.classList.remove("sheet-open");
  manageEditorDraft=null;
  manageEditorKind=null;
  if(!activeModal()) setBackgroundInert(false);

  const previous=manageEditorPreviousFocus;
  manageEditorPreviousFocus=null;
  setTimeout(()=>{
    if(previous && document.contains(previous)) previous.focus();
    if(!manageEditorSheetElement.classList.contains("on")) manageEditorSheetElement.style.display="none";
  },100);
}

function manageEditorPrimaryAction(){
  if(
    manageEditorDraft &&
    !manageEditorDraft.isNew &&
    !manageEditorDraft.editing
  ){
    manageEditorDraft.editing=true;
    drawManageEditor();
    manageEditorSheetElement.scrollTop=0;
    return;
  }

  void saveManageEditor();
}

async function saveManageEditor(){
  if(!manageEditorDraft || manageEditorSaving){
    return;
  }

  readManageEditor();

  let tiers=null;
  const tariffAdded=
    !manageEditorDraft.isNew &&
    manageEditorDraft.tariffOpen;

  try{
    if(
      manageEditorKind==="point"
    ){
      if(!manageEditorDraft.name.trim()){
        throw new Error("Введите название ПВЗ");
      }

      const sortOrder=
        Number(
          manageEditorDraft.sortOrder
        );

      if(
        !Number.isSafeInteger(sortOrder) ||
        sortOrder<=0 ||
        sortOrder>1000000
      ){
        throw new Error(
          "Порядок должен быть целым числом от 1 до 1 000 000"
        );
      }

      manageEditorDraft.sortOrder=
        sortOrder;
    }

    if(
      manageEditorDraft.isNew ||
      manageEditorDraft.tariffOpen
    ){
      if(
        !isValidDateString(
          manageEditorDraft.effectiveFrom
        )
      ){
        throw new Error(
          `Выберите дату с ${MIN_YEAR} по ${MAX_YEAR} год`
        );
      }

      if(
        manageEditorDraft.pricingType===
        "fixed"
      ){
        const rateError=
          validateMoneyField(
            manageEditorDraft.fixedRate,
            "Ставка",
            {
              allowEmpty:false,
              max:MAX_MONEY
            }
          );

        if(
          rateError ||
          Number(
            String(
              manageEditorDraft.fixedRate
            ).replace(",",".")
          )<=0
        ){
          throw new Error(
            rateError ||
            "Ставка должна быть больше 0"
          );
        }

        manageEditorDraft.fixedRate=
          Number(
            String(
              manageEditorDraft.fixedRate
            ).replace(",",".")
          );
      }
    }

    if(
      (
        manageEditorDraft.isNew ||
        manageEditorDraft.tariffOpen
      ) &&
      manageEditorDraft.pricingType===
      "shk_tiers"
    ){
      tiers=normalizeShkTiers(
        manageEditorDraft.tiers
      );
    }

    if(
      !manageEditorDraft.isNew &&
      manageEditorDraft.tariffOpen &&
      pointTariffs(
        manageEditorDraft.point.id
      ).some(
        tariff=>
          tariff.effective_from===
          manageEditorDraft.effectiveFrom
      )
    ){
      throw new Error(
        "На эту дату тариф уже задан. Выберите другую дату."
      );
    }

    manageEditorSaving=true;
    document.getElementById("manageEditorSave").disabled=true;

    await saveAdminPoint({
      id:manageEditorDraft.id,
      name:manageEditorDraft.name,
      sortOrder:manageEditorDraft.sortOrder,
      active:manageEditorDraft.active,
      advanceEnabled:manageEditorDraft.advanceEnabled,
      pricingType:manageEditorDraft.isNew
        ? manageEditorDraft.pricingType
        : null,
      fixedRate:manageEditorDraft.isNew && manageEditorDraft.pricingType==="fixed"
        ? manageEditorDraft.fixedRate
        : null,
      shkTiers:manageEditorDraft.isNew && manageEditorDraft.pricingType==="shk_tiers"
        ? tiers
        : null,
      effectiveFrom:manageEditorDraft.isNew
        ? manageEditorDraft.effectiveFrom
        : null
    });

    if(
      !manageEditorDraft.isNew &&
      manageEditorDraft.tariffOpen
    ){
      await addAdminTariff({
        pointId:manageEditorDraft.point.id,
        effectiveFrom:manageEditorDraft.effectiveFrom,
        pricingType:manageEditorDraft.pricingType,
        fixedRate:manageEditorDraft.pricingType==="fixed"
          ? manageEditorDraft.fixedRate
          : null,
        shkTiers:manageEditorDraft.pricingType==="shk_tiers"
          ? tiers
          : null
      });
    }

    closeManageEditor();
    await refreshTeamData();
    toast(
      tariffAdded
        ? "ПВЗ и новый тариф сохранены"
        : "ПВЗ сохранён"
    );
  }catch(error){
    toast(
      error instanceof Error
        ? error.message
        : "Не удалось сохранить",
      4200
    );
  }finally{
    manageEditorSaving=false;
    const button=document.getElementById("manageEditorSave");
    if(button) button.disabled=false;
  }
}

function drawEmployeeSheet(){
  if(!employeeDraft){
    return;
  }

  const body=
    document.getElementById(
      "employeeSheetBody"
    );

  if(employeeSheetMode==="view"){
    const employee=
      teamData.employees.find(
        item=>
          item.id===
          employeeDraft.id
      );

    if(!employee){
      body.innerHTML=`
        <div class="card">
          <div class="employee-empty">
            Сотрудник не найден.
          </div>
        </div>
      `;

      return;
    }

    const account=
      employeeAccount(
        employee
      );

    const pointNames=
      employeePointNames(
        employee.id
      );

    const pointRows=
      pointNames.length
        ? pointNames
            .map(name=>`
              <div class="row">
                <div class="l">
                  <div class="t">
                    ${esc(name)}
                  </div>
                </div>
              </div>
            `)
            .join("")
        : `
            <div class="row">
              <div class="l">
                <div class="t">
                  ПВЗ не назначены
                </div>
              </div>
            </div>
          `;

    body.innerHTML=`
      <div class="ml">
        Сотрудник
      </div>

      <div class="card employee-detail">
        <div class="row">
          <div class="l">
            <div class="s">
              ФИО
            </div>

            <div class="t">
              ${esc(employee.full_name)}
            </div>
          </div>
        </div>

        <div class="row">
          <div class="l">
            <div class="s">
              Статус
            </div>

            <div class="t">
              ${
                employee.status==="active"
                  ? "Активен"
                  : "В архиве"
              }
            </div>
          </div>
        </div>

        <div class="row">
          <div class="l">
            <div class="s">
              Аккаунт
            </div>

            <div class="t">
              ${
                employeeAccountEmail(
                  account
                )
                  ? esc(
                      employeeAccountEmail(
                        account
                      )
                    )
                  : account
                    ? "Требуется email"
                    : "Не привязан"
              }
            </div>
          </div>
        </div>

        <div class="row">
          <div class="l">
            <div class="s">Основной телефон</div>
            <div class="t" dir="ltr">
              ${esc(phoneLabel(employee.phone || "Не указан"))}
            </div>
          </div>
        </div>
      </div>

      <div class="ml">Реквизиты для переводов</div>
      <div class="card employee-detail">
        <div class="row">
          <div class="l">
            <div class="s">Телефон для перевода</div>
            <div class="t" dir="ltr">
              ${esc(phoneLabel(employee.transfer_phone || employee.phone || "Не указан"))}
            </div>
          </div>
        </div>
        <div class="row">
          <div class="l">
            <div class="s">Банк</div>
            <div class="t">${esc(employee.transfer_bank || "Не указан")}</div>
          </div>
        </div>
        <div class="row">
          <div class="l">
            <div class="s">Получатель</div>
            <div class="t">${esc(employee.transfer_recipient || "Не указан")}</div>
          </div>
        </div>
      </div>

      <div class="ml">
        Пункты выдачи
      </div>

      <div class="card">
        ${pointRows}
      </div>

      <button
        type="button"
        class="btn warn"
        id="employeeDelete"
      >
        Удалить сотрудника
      </button>

      <div
        class="sheet-spacer"
        aria-hidden="true"
      ></div>
    `;

    return;
  }

  const isCreate=
    employeeSheetMode==="create";

  const selectedPoints=
    new Set(
      employeeDraft.pointIds
    );

  const pointRows=
    teamData
      .points
      .filter(
        point=>
          point.active ||
          selectedPoints.has(point.id)
      )
      .map(point=>{
        const selected=
          selectedPoints.has(
            point.id
          );

        return `
          <button
            type="button"
            class="employee-point ${selected ? "on" : ""}"
            data-employee-point="${esc(point.id)}"
          >
            <span
              class="employee-point-check"
              aria-hidden="true"
            >
              ${selected ? "✓" : ""}
            </span>

            <span class="employee-point-name">
              ${esc(point.name)}
            </span>
          </button>
        `;
      })
      .join("");

  body.innerHTML=`
    <div class="ml">
      Сотрудник
    </div>

    <div class="card employee-editor">
      <label class="row">
        <div class="t">
          ФИО
        </div>

        <input
          type="text"
          id="employeeName"
          autocomplete="off"
          value="${esc(employeeDraft.fullName)}"
          aria-label="ФИО сотрудника"
        >
      </label>

      <label class="row">
        <div class="t">Телефон</div>
        <input
          type="tel"
          id="employeePhone"
          inputmode="tel"
          autocomplete="off"
          dir="ltr"
          value="${esc(employeeDraft.phone)}"
          aria-label="Телефон сотрудника"
        >
      </label>
    </div>

    <div class="ml">Реквизиты для переводов</div>
    <div class="card employee-editor">
      <label class="row">
        <div class="t">Телефон</div>
        <input
          type="tel"
          id="employeeTransferPhone"
          inputmode="tel"
          autocomplete="off"
          dir="ltr"
          value="${esc(employeeDraft.transferPhone)}"
          aria-label="Телефон для перевода"
        >
      </label>
      <label class="row">
        <div class="t">Банк</div>
        <input
          type="text"
          id="employeeTransferBank"
          autocomplete="off"
          value="${esc(employeeDraft.transferBank)}"
          aria-label="Банк для перевода"
        >
      </label>
      <label class="row">
        <div class="t">Получатель</div>
        <input
          type="text"
          id="employeeTransferRecipient"
          autocomplete="off"
          value="${esc(employeeDraft.transferRecipient)}"
          aria-label="Получатель перевода"
        >
      </label>
    </div>

    ${
      isCreate
        ? ""
        : `
          <div class="ml">
            Статус
          </div>

          <div class="card segbox">
            <div class="seg">
              <button
                type="button"
                data-employee-status="active"
                class="${employeeDraft.status==="active" ? "on" : ""}"
              >
                Активен
              </button>

              <button
                type="button"
                data-employee-status="inactive"
                class="${employeeDraft.status==="inactive" ? "on" : ""}"
              >
                В архиве
              </button>
            </div>
          </div>
        `
    }

    <div class="ml">
      Аккаунт
    </div>

    <div class="card employee-editor">
      <label class="row employee-account-row">
        <div class="t">Почта</div>
        <input
          type="email"
          id="employeeEmail"
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          value="${esc(employeeDraft.email || "")}"
          aria-label="Почта сотрудника"
        >
      </label>

      <div class="row employee-password-row">
        <div class="t">${employeeDraft.userId ? "Новый пароль" : "Пароль"}</div>

        <div class="employee-password-control">
          <input
            type="password"
            id="employeePassword"
            autocomplete="off"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            value="${esc(employeeDraft.password || "")}"
            aria-label="${employeeDraft.userId ? "Новый пароль сотрудника" : "Пароль сотрудника"}"
          >

          <button
            type="button"
            class="employee-password-toggle"
            id="employeePasswordToggle"
            aria-label="Показать пароль"
            aria-pressed="false"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
              <circle cx="12" cy="12" r="2.7"></circle>
              <path class="employee-password-slash" d="M4 4l16 16"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div class="employee-help">
      ${employeeDraft.userId
        ? "Почту можно изменить. Пустой пароль сохранит текущий."
        : "Почта и пароль создадут подтверждённый аккаунт с правами сотрудника. Публичной регистрации нет."}
    </div>

    <div class="ml">
      Пункты выдачи
    </div>

    <div class="card employee-points">
      ${pointRows}
    </div>
  `;

}

function employeeSaveError(
  error
){
  const message=
    error instanceof Error
      ? error.message
      : String(error || "");

  if(
    message.includes(
      "account_already_linked"
    )
  ){
    return "Этот аккаунт уже привязан к другому сотруднику";
  }

  if(
    message.includes(
      "account_profile_not_found"
    )
  ){
    return "Для выбранного аккаунта не найден профиль";
  }

  if(
    message.includes(
      "employee_not_found"
    )
  ){
    return "Сотрудник больше не существует";
  }

  if(
    message.includes(
      "employees_phone_uidx"
    ) ||
    message.includes(
      "duplicate key"
    ) ||
    message.includes(
      "user_already_exists"
    ) ||
    message.includes(
      "phone_exists"
    )
  ){
    return "Этот номер уже используется другим сотрудником или аккаунтом";
  }

  if(
    message.includes(
      "password_required_for_new_account"
    )
  ){
    return "Для нового аккаунта задайте пароль";
  }

  if(
    message.includes(
      "employee_auth_request_failed"
    ) ||
    message.includes(
      "employee_auth_http_"
    ) ||
    message.includes(
      "employee_delete_begin_failed"
    ) ||
    message.includes(
      "employee_delete_cancel_failed"
    ) ||
    message.includes(
      "employee_delete_finalize_failed"
    )
  ){
    return "Сервер создания аккаунта недоступен. Повторите попытку.";
  }

  if(
    message.includes(
      "email_exists"
    ) ||
    message.includes(
      "user_already_exists"
    )
  ){
    return "Аккаунт с этой почтой уже существует";
  }

  if(
    message.includes(
      "invalid_employee_auth_payload"
    ) ||
    message.includes(
      "email_address_invalid"
    )
  ){
    return "Проверьте почту и пароль сотрудника";
  }

  if(
    message.includes(
      "admin_account_protected"
    )
  ){
    return "Аккаунт администратора нельзя назначить сотруднику";
  }

  if(
    message.includes(
      "invalid_employee_phone"
    ) ||
    message.includes(
      "invalid_transfer_phone"
    )
  ){
    return "Проверьте номер телефона";
  }

  return (
    message ||
    "Не удалось сохранить сотрудника"
  );
}

function createEmployeeDraft(
  employeeId=null
){
  if(!employeeId){
    return {
      id:null,
      fullName:"",
      status:"active",
      hiredAt:"",
      userId:null,
      email:"",
      phone:"",
      transferPhone:"",
      transferBank:"",
      transferRecipient:"",
      password:"",
      pointIds:[]
    };
  }

  const employee=
    teamData.employees.find(
      item=>
        item.id===
        employeeId
    );

  if(!employee){
    return null;
  }

  const account=
    employeeAccount(
      employee
    );

  return {
    id:employee.id,
    fullName:employee.full_name,
    status:employee.status,
    hiredAt:employee.hired_at || "",
    userId:employee.user_id || null,
    email:
      employeeAccountEmail(
        account
      ),
    phone:employee.phone || "",
    transferPhone:
      employee.transfer_phone || "",
    transferBank:
      employee.transfer_bank || "",
    transferRecipient:
      employee.transfer_recipient || "",
    password:"",
    pointIds:
      employeePointIds(
        employee.id
      )
  };
}

function animateManageView(
  apply,
  direction=1
){
  if(
    manageTransitionRunning ||
    tabTransitionRunning ||
    monthTransitionRunning
  ){
    return;
  }

  if(
    prefersReducedMotion() ||
    typeof app.animate!=="function"
  ){
    apply();
    return;
  }

  manageTransitionRunning=true;

  const oldApp=
    makeMonthTransitionGhost(
      app,
      19
    );

  app.style.opacity="0";

  const oldX=
    direction>0
      ? -20
      : 20;

  const newX=
    -oldX;

  let animations=[];

  try{
    apply();

    const options={
      duration:260,
      easing:
        "cubic-bezier(.22,.72,.22,1)",
      fill:"both"
    };

    animations=[
      oldApp.animate(
        [
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          },
          {
            opacity:0,
            transform:
              `translate3d(${oldX}px,0,0)`
          }
        ],
        options
      ),

      app.animate(
        [
          {
            opacity:0,
            transform:
              `translate3d(${newX}px,0,0)`
          },
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          }
        ],
        options
      )
    ];

    app.style.removeProperty(
      "opacity"
    );

    Promise.allSettled(
      animations.map(
        animation=>
          animation.finished
      )
    ).finally(()=>{
      animations.forEach(
        animation=>
          animation.cancel()
      );

      oldApp.remove();

      app.style.removeProperty(
        "opacity"
      );

      manageTransitionRunning=false;
    });
  }catch{
    animations.forEach(
      animation=>
        animation.cancel()
    );

    oldApp.remove();

    app.style.removeProperty(
      "opacity"
    );

    manageTransitionRunning=false;
  }
}

function syncEmployeeSheetHeader(){
  const title=
    document.getElementById(
      "employeeSheetTitle"
    );

  const cancelButton=
    document.getElementById(
      "employeeSheetCancel"
    );

  const actionButton=
    document.getElementById(
      "employeeSheetSave"
    );

  if(employeeSheetMode==="create"){
    title.textContent=
      "Новый сотрудник";

    cancelButton.textContent=
      "Отмена";

    actionButton.textContent=
      "Готово";

    actionButton.disabled=
      employeeSaving;

    return;
  }

  if(employeeSheetMode==="view"){
    title.textContent=
      "Сотрудник";

    cancelButton.textContent=
      "Закрыть";

    actionButton.textContent=
      "Изменить";

    actionButton.disabled=false;

    return;
  }

  title.textContent=
    "Редактирование";

  cancelButton.textContent=
    "Назад";

  actionButton.textContent=
    "Готово";

  actionButton.disabled=
    employeeSaving;
}

function showEmployeeView(
  employeeId
){
  const nextDraft=
    createEmployeeDraft(
      employeeId
    );

  if(!nextDraft){
    toast(
      "Сотрудник не найден",
      3000
    );

    closeEmployeeEditor();

    return;
  }

  employeeDraft=
    nextDraft;

  employeeSheetMode=
    "view";

  employeeSaving=false;

  syncEmployeeSheetHeader();
  drawEmployeeSheet();

  employeeSheetElement
    .scrollTop=0;
}

function startEmployeeEdit(){
  if(!employeeDraft?.id){
    return;
  }

  const nextDraft=
    createEmployeeDraft(
      employeeDraft.id
    );

  if(!nextDraft){
    toast(
      "Сотрудник не найден",
      3000
    );

    return;
  }

  employeeDraft=
    nextDraft;

  employeeSheetMode=
    "edit";

  employeeSaving=false;

  syncEmployeeSheetHeader();
  drawEmployeeSheet();

  employeeSheetElement
    .scrollTop=0;
}

function cancelEmployeeSheet(){
  if(
    employeeSheetMode==="edit" &&
    employeeDraft?.id
  ){
    showEmployeeView(
      employeeDraft.id
    );

    return;
  }

  closeEmployeeEditor();
}

function employeeSheetPrimaryAction(){
  if(employeeSheetMode==="view"){
    startEmployeeEdit();
    return;
  }

  void saveEmployeeDraft();
}

function openEmployeeEditor(
  employeeId=null
){
  const nextDraft=
    createEmployeeDraft(
      employeeId
    );

  if(!nextDraft){
    toast(
      "Сотрудник не найден",
      3000
    );

    return;
  }

  const sheet=
    employeeSheetElement;

  const veil=
    document.getElementById(
      "employeeVeil"
    );

  employeeSheetPreviousFocus=
    document.activeElement;

  employeeDraft=
    nextDraft;

  employeeSheetMode=
    employeeId
      ? "view"
      : "create";

  employeeSaving=false;

  syncEmployeeSheetHeader();
  drawEmployeeSheet();

  prepareBottomSheetOpen(
    sheet,
    "--sheet-drag"
  );

  sheet.style.display="block";

  sheet.classList.remove("on");

  sheet.setAttribute(
    "aria-hidden",
    "false"
  );

  veil.setAttribute(
    "aria-hidden",
    "false"
  );

  setBackgroundInert(true);

  void sheet.offsetHeight;

  document.body.classList.add(
    "sheet-open"
  );

  veil.classList.add(
    "on"
  );

  sheet.classList.add(
    "on"
  );

  requestAnimationFrame(()=>{
    sheet.scrollTop=0;

    sheet.focus({
      preventScroll:true
    });
  });
}

function closeEmployeeEditor(){
  const sheet=
    employeeSheetElement;

  if(
    !sheet.classList.contains(
      "on"
    )
  ){
    return;
  }

  const veil=
    document.getElementById(
      "employeeVeil"
    );

  veil.classList.remove(
    "on"
  );

  veil.setAttribute(
    "aria-hidden",
    "true"
  );

  sheet.classList.remove(
    "on"
  );

  sheet.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.classList.remove(
    "sheet-open"
  );

  employeeDraft=null;
  employeeSaving=false;
  employeeSheetMode="create";

  if(!activeModal()){
    setBackgroundInert(false);
  }

  const previousFocus=
    employeeSheetPreviousFocus;

  employeeSheetPreviousFocus=null;

  setTimeout(()=>{
    if(
      previousFocus &&
      document.contains(
        previousFocus
      )
    ){
      previousFocus.focus();
    }
  },100);
}

async function saveEmployeeDraft(){
  if(
    !employeeDraft ||
    employeeSaving ||
    employeeSheetMode==="view"
  ){
    return;
  }

  syncEmployeeDraftFromForm();

  const name=
    employeeDraft.fullName
      .trim();

  if(!name){
    toast(
      "Укажите ФИО сотрудника",
      3000
    );

    document
      .getElementById(
        "employeeName"
      )
      ?.focus();

    return;
  }

  let phone;
  let transferPhone;

  try{
    phone=normalizePhone(
      employeeDraft.phone
    );

    transferPhone=optionalPhone(
      employeeDraft.transferPhone
    );
  }catch(error){
    toast(
      error instanceof Error
        ? error.message
        : "Проверьте телефон сотрудника",
      3200
    );

    document
      .getElementById(
        "employeePhone"
      )
      ?.focus();

    return;
  }

  const password=
    employeeDraft.password || "";

  const email=
    String(
      employeeDraft.email || ""
    )
      .trim()
      .toLowerCase();

  if(
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u
      .test(email)
  ){
    toast(
      "Введите корректную почту сотрудника",
      3200
    );

    document
      .getElementById(
        "employeeEmail"
      )
      ?.focus();

    return;
  }

  if(
    employeeDraft.userId &&
    !email
  ){
    toast(
      "Укажите почту привязанного аккаунта",
      3200
    );

    document
      .getElementById(
        "employeeEmail"
      )
      ?.focus();

    return;
  }

  if(
    !employeeDraft.userId &&
    Boolean(email)!==Boolean(password)
  ){
    toast(
      email
        ? "Для нового аккаунта задайте пароль"
        : "Для нового аккаунта укажите почту",
      3200
    );

    document
      .getElementById(
        email
          ? "employeePassword"
          : "employeeEmail"
      )
      ?.focus();

    return;
  }

  if(
    password &&
    (
      password.length<8 ||
      password.length>72
    )
  ){
    toast(
      "Пароль должен содержать от 8 до 72 символов",
      3200
    );

    document
      .getElementById(
        "employeePassword"
      )
      ?.focus();

    return;
  }

  const wasExisting=
    Boolean(
      employeeDraft.id
    );

  const hadLinkedAccount=
    Boolean(
      employeeDraft.userId
    );

  const saveButton=
    document.getElementById(
      "employeeSheetSave"
    );

  employeeSaving=true;
  saveButton.disabled=true;

  try{
    const employeeId=
      await saveAdminEmployee({
        id:employeeDraft.id,
        fullName:name,
        status:
          employeeDraft.status,
        hiredAt:
          employeeDraft.hiredAt ||
          null,
        userId:
          employeeDraft.userId ||
          null,
        phone,
        transferPhone,
        transferBank:
          employeeDraft.transferBank
            .trim() || null,
        transferRecipient:
          employeeDraft.transferRecipient
            .trim() || null,
        pointIds:
          employeeDraft.pointIds
      });

    employeeDraft.id=
      employeeId;

    let authFailure=null;
    let creationRolledBack=false;

    if(
      employeeDraft.userId ||
      email
    ){
      try{
        await saveAdminEmployeeAuth({
          employeeId,
          email,
          password
        });
      }catch(error){
        authFailure=
          employeeSaveError(error);
      }
    }

    if(
      authFailure &&
      !wasExisting &&
      !hadLinkedAccount
    ){
      try{
        await rollbackAdminEmployeeCreation(
          employeeId
        );

        creationRolledBack=true;
      }catch{}
    }

    const refreshed=
      await refreshTeamData({
        renderAfter:false
      });

    if(!refreshed){
      if(creationRolledBack){
        employeeDraft.id=null;
      }

      employeeSaving=false;
      saveButton.disabled=false;

      toast(
        creationRolledBack
          ? `Аккаунт не создан, карточка не сохранена: ${authFailure}`
          : "Сотрудник сохранён, но список не удалось обновить",
        creationRolledBack
          ? 5600
          : 4000
      );

      return;
    }

    if(creationRolledBack){
      employeeDraft.id=null;
      employeeSaving=false;
      saveButton.disabled=false;

      updateEmployeeList();

      toast(
        `Аккаунт не создан, карточка не сохранена: ${authFailure}`,
        5600
      );

      return;
    }

    if(authFailure){
      const savedEmployee=
        teamData.employees.find(
          employee=>
            employee.id===employeeId
        );

      if(savedEmployee?.user_id){
        authFailure=null;
      }
    }

    employeeSaving=false;

    if(wasExisting){
      updateEmployeeList();

      showEmployeeView(
        employeeId
      );

      toast(
        authFailure
          ? `Карточка сохранена. Вход не настроен: ${authFailure}`
          : "Сотрудник сохранён",
        authFailure
          ? 5200
          : 2200
      );

      return;
    }

    closeEmployeeEditor();
    render();

    toast(
      authFailure
        ? `Карточка сохранена. Вход не настроен: ${authFailure}`
        : "Сотрудник сохранён",
      authFailure
        ? 5200
        : 2200
    );
  }catch(error){
    employeeSaving=false;
    saveButton.disabled=false;

    toast(
      employeeSaveError(
        error
      ),
      4000
    );
  }
}

function employeeDeleteError(
  error
){
  const message=
    error instanceof Error
      ? error.message
      : String(
          error || ""
        );

  if(
    message.includes(
      "employee_has_history"
    ) ||
    message.includes(
      "shifts_employee_id_fkey"
    )
  ){
    return (
      "У сотрудника есть история смен. "+
      "Переведите его в архив."
    );
  }

  if(
    message.includes(
      "employee_not_found"
    )
  ){
    return "Сотрудник больше не существует";
  }

  if(
    message.includes(
      "employee_auth_delete_failed"
    ) ||
    message.includes(
      "employee_history_read_failed"
    ) ||
    message.includes(
      "employee_auth_request_failed"
    ) ||
    message.includes(
      "employee_auth_http_"
    )
  ){
    return "Не удалось полностью удалить аккаунт сотрудника. Повторите попытку.";
  }

  if(
    message.includes(
      "admin_account_protected"
    )
  ){
    return "Аккаунт администратора нельзя удалить вместе с сотрудником";
  }

  return (
    message ||
    "Не удалось удалить сотрудника"
  );
}

async function deleteEmployeeDraft(){
  if(
    !employeeDraft?.id ||
    employeeSheetMode!=="view"
  ){
    return;
  }

  const employeeId=
    employeeDraft.id;

  const confirmed=
    await appConfirm(
      "Удалить сотрудника?",
      {
        okText:"Удалить",
        danger:true,
        detail:
          "Если у сотрудника нет истории смен, карточка и привязанный аккаунт входа будут удалены полностью."
      }
    );

  if(!confirmed){
    return;
  }

  try{
    await deleteAdminEmployee(
      employeeId
    );

    const refreshed=
      await refreshTeamData({
        renderAfter:false
      });

    closeEmployeeEditor();

    if(!refreshed){
      render();

      toast(
        "Сотрудник удалён, но список не удалось обновить",
        4000
      );

      return;
    }

    render();

    toast(
      "Сотрудник удалён"
    );
  }catch(error){
    toast(
      employeeDeleteError(
        error
      ),
      4200
    );
  }
}

function viewManage(){
  if(manageSection==="employees"){
    return viewEmployees();
  }

  if(manageSection==="points"){
    return viewPoints();
  }

  return `
    <div class="ml">
      Команда
    </div>

    <div class="card manage-menu">
      <button
        type="button"
        class="manage-row"
        data-manage-section="employees"
      >
        <span class="manage-row-copy">
          <span class="manage-row-title">
            Сотрудники
          </span>

          <span class="manage-row-detail">
            Аккаунты, статусы и назначенные ПВЗ
          </span>
        </span>

        <span
          class="manage-chevron"
          aria-hidden="true"
        >
          <svg viewBox="0 0 12 16">
            <path d="M3 3L9 8L3 13"></path>
          </svg>
        </span>
      </button>
    </div>

    <div class="ml">
      Пункты и расчёт
    </div>

    <div class="card manage-menu">
      <button
        type="button"
        class="manage-row"
        data-manage-section="points"
      >
        <span class="manage-row-copy">
          <span class="manage-row-title">
            Пункты выдачи и тарифы
          </span>

          <span class="manage-row-detail">
            Пункты, активность, ставки и история изменений
          </span>
        </span>

        <span
          class="manage-chevron"
          aria-hidden="true"
        >
          <svg viewBox="0 0 12 16">
            <path d="M3 3L9 8L3 13"></path>
          </svg>
        </span>
      </button>

    </div>
  `;
}

function changeManageSection(
  nextSection,
  direction=1
){
  if(
    !isAdmin ||
    tab!=="manage" ||
    !MANAGE_SECTIONS.includes(
      nextSection
    ) ||
    nextSection===manageSection
  ){
    return;
  }

  animateManageView(
    ()=>{
      manageSection=
        nextSection;

      employeeDraft=null;
      employeeSaving=false;

      setPageScrollTop(0);
      render();

      if(
        [
          "employees",
          "points",
          "tariffs"
        ].includes(
          nextSection
        ) &&
        !teamDataLoaded &&
        !teamDataLoading
      ){
        void refreshTeamData();
      }
    },
    direction
  );
}

/* ========== форма ========== */
function defaultShiftDate(){
  const today=localYMD();

  if(cursor===today.slice(0,7)){
    return today;
  }

  const [year,month]=
    cursor
      .split("-")
      .map(Number);

  const todayDay=
    Number(
      today.slice(8,10)
    );

  const lastDay=
    new Date(
      year,
      month,
      0,
      12
    ).getDate();

  const day=
    Math.min(
      todayDay,
      lastDay
    );

  return (
    cursor+
    "-"+
    String(day).padStart(2,"0")
  );
}

function assignedPointIds(
  employeeId
){
  return teamData.employeePoints
    .filter(item=>
      item.employee_id===employeeId &&
      item.active!==false
    )
    .map(item=>item.point_id);
}

function shiftEmployeeOptions(
  value=draft
){
  return teamData.employees
    .filter(employee=>
      employee.status==="active" ||
      employee.id===value?.employeeId
    );
}

function shiftPointOptions(
  value=draft
){
  const assigned=new Set(
    assignedPointIds(
      value?.employeeId
    )
  );

  return teamData.points
    .filter(point=>
      (
        assigned.has(point.id) &&
        point.active!==false
      ) ||
      point.id===value?.dbPointId
    );
}

function cloneShiftDraft(value){
  return {
    ...value,
    bonuses:(value.bonuses || [])
      .map(item=>({...item})),
    penalties:(value.penalties || [])
      .map(item=>({...item}))
  };
}

function openSheet(id,restoredDraft=null,restoredScrollTop=0){
  if(serverDataError){
    tab="data";
    render();
    toast("Сначала обновите данные с сервера",3000);
    return;
  }

  const sheet=document.getElementById("sheet");
  const savedShift=shifts.find(item=>item.id===id);

  if(!savedShift && !isAdmin){
    return;
  }

  if(
    !savedShift &&
    !teamData.employees.some(
      employee=>
        employee.status==="active"
    )
  ){
    tab="manage";
    manageSection="employees";
    render();
    toast("Сначала добавьте активного сотрудника",3200);
    return;
  }

  sheetPreviousFocus=document.activeElement;

  prepareBottomSheetOpen(
    sheet,
    "--sheet-drag"
  );

  sheet.style.display="block";

  draft=restoredDraft
    ? cloneShiftDraft(restoredDraft)
    : savedShift
      ? cloneShiftDraft(savedShift)
      : (()=>{
          const employee=
            teamData.employees.find(
              item=>
                item.status==="active" &&
                assignedPointIds(item.id)
                  .some(pointId=>
                    teamData.points.some(
                      point=>
                        point.id===pointId &&
                        point.active!==false
                    )
                  )
            ) ||
            teamData.employees.find(
              item=>
                item.status==="active"
            );

          const assigned=
            new Set(
              assignedPointIds(
                employee.id
              )
            );

          const point=
            teamData.points.find(
              item=>
                item.active!==false &&
                assigned.has(item.id)
            ) || null;

          return {
          v:3,
          id:createTeamId(),
          employeeId:employee.id,
          employeeName:employee.full_name,
          date:defaultShiftDate(),
          dbPointId:point?.id || "",
          pointId:point?.code || point?.id || "",
          point:point?.name || "ПВЗ не назначен",
          type:"main",
          shk:"",
          partial:false,
          hours:"",
          bonuses:[],
          penalties:[],
          note:""
        };
        })();

  const isEdit=Boolean(savedShift);
  document.getElementById("sheetTitle").textContent=isEdit ? "Смена" : "Новая смена";
  document.getElementById("sheetSave").hidden=!isAdmin;
  drawSheet(isEdit);

  const restoring=Boolean(restoredDraft);
  const veil=document.getElementById("veil");
  sheet.classList.remove("on");
  sheet.setAttribute("aria-hidden","false");
  veil.setAttribute("aria-hidden","false");
  setBackgroundInert(true);

  if(restoring){
    sheet.style.transition="none";
    veil.style.transition="none";
  }

  void sheet.offsetHeight;
  document.body.classList.add("sheet-open");
  veil.classList.add("on");
  sheet.classList.add("on");

  if(restoring){
    sheet.scrollTop=Math.max(
      0,
      restoredScrollTop
    );

    void sheet.offsetHeight;

    requestAnimationFrame(()=>{
      sheet.style.removeProperty(
        "transition"
      );

      veil.style.removeProperty(
        "transition"
      );

      sheet.focus({
        preventScroll:true
      });
    });
  }else{
    requestAnimationFrame(()=>{
      sheet.scrollTop=Math.max(
        0,
        restoredScrollTop
      );

      sheet.focus({
        preventScroll:true
      });
    });
  }

  saveUIState();
}

function closeSheet(){
  const sheet=document.getElementById("sheet");

  if(document.getElementById("datePicker").classList.contains("on")) closeDatePicker();
  if(document.getElementById("pointPicker").classList.contains("on")) closePointPicker();

  const veil=document.getElementById("veil");
  veil.classList.remove("on");
  veil.setAttribute("aria-hidden","true");
  sheet.classList.remove("on");
  sheet.setAttribute("aria-hidden","true");
  document.body.classList.remove("sheet-open");

  draft=null;
  saveUIState();
  if(!activeModal()) setBackgroundInert(false);

  const previousFocus=sheetPreviousFocus;
  sheetPreviousFocus=null;

  setTimeout(()=>{
    if(!sheet.classList.contains("on")) sheet.style.display="none";
    sheet.style.removeProperty("transition");
    sheet.style.removeProperty("--sheet-drag");
    if(previousFocus && document.contains(previousFocus)) previousFocus.focus();
  },500);
}

let datePickerHideTimer;
let dateCalendarCursor="";
let datePickerValue="";
let datePickerTarget="shift";
let dateJumpYear=0;
let dateJumpValue="";
let dateSwipe=null;
let dateSwipeBlockClick=false;

function drawDatePicker(){
  const [year,month]=dateCalendarCursor.split("-").map(Number);

  document.getElementById("datePickerMonth").textContent=
    MONTHS[month-1]+" "+year;

  document.getElementById("datePrev").disabled=dateCalendarCursor===`${MIN_YEAR}-01`;
  document.getElementById("dateNext").disabled=dateCalendarCursor===`${MAX_YEAR}-12`;

  const firstDay=new Date(year,month-1,1,12);
  const mondayOffset=(firstDay.getDay()+6)%7;

  const gridStart=new Date(
    year,
    month-1,
    1-mondayOffset,
    12
  );

  const today=localYMD();

  let html="";

  for(let index=0;index<42;index++){
    const day=new Date(gridStart);

    day.setDate(gridStart.getDate()+index);

    const ymd=localYMD(day);
    const outside=day.getMonth()!==month-1;
    const selected=ymd===datePickerValue;
    const isToday=ymd===today;
    const outOfRange=day.getFullYear()<MIN_YEAR || day.getFullYear()>MAX_YEAR;

    html+=`
      <button
        type="button"
        class="date-day
          ${outside?"outside":""}
          ${selected?"on":""}
          ${isToday?"today":""}
        "
        data-date="${ymd}"
        aria-label="${esc(dateLabel(ymd))}"
        ${outOfRange?"disabled":""}
      >
        ${day.getDate()}
      </button>
    `;
  }

  document.getElementById("dateGrid").innerHTML=html;
}

function drawDateJump(){
  document.getElementById("dateJumpYear").textContent=
    dateJumpYear;

  document.getElementById("dateJumpPrevYear").disabled=dateJumpYear<=MIN_YEAR;
  document.getElementById("dateJumpNextYear").disabled=dateJumpYear>=MAX_YEAR;

  document.getElementById("dateJumpMonths").innerHTML=
    MONTHS.map((month,index)=>{
      const ym=
        dateJumpYear+"-"+
        String(index+1).padStart(2,"0");

      return `
        <button
          type="button"
          class="date-jump-month ${ym===dateJumpValue?"on":""}"
          data-calendar-month="${ym}"
        >
          ${month}
        </button>
      `;
    }).join("");
}

let dateCalendarTransitionRunning=false;

function makeDateCalendarGhost(
  element,
  picker
){
  const rect=
    element.getBoundingClientRect();

  const pickerRect=
    picker.getBoundingClientRect();

  const ghost=
    element.cloneNode(true);

  ghost.removeAttribute("id");
  ghost.setAttribute(
    "aria-hidden",
    "true"
  );
  ghost.setAttribute(
    "inert",
    ""
  );

  ghost.style.position="absolute";

  ghost.style.left=
    rect.left-pickerRect.left+"px";

  ghost.style.top=
    rect.top-pickerRect.top+"px";

  ghost.style.width=
    rect.width+"px";

  ghost.style.height=
    rect.height+"px";

  ghost.style.margin="0";
  ghost.style.zIndex="5";
  ghost.style.pointerEvents="none";

  picker.appendChild(ghost);

  return ghost;
}

function changeDateCalendarMonth(
  nextCursor,
  direction,
  {value}={}
){
  if(
    !nextCursor ||
    dateCalendarTransitionRunning
  ){
    return;
  }

  if(
    nextCursor===dateCalendarCursor
  ){
    if(value!==undefined){
      datePickerValue=value;
      drawDatePicker();
    }

    return;
  }

  const grid=
    document.getElementById(
      "dateGrid"
    );

  const title=
    document.getElementById(
      "datePickerMonth"
    );

  const picker=
    document.getElementById(
      "datePicker"
    );

  const apply=()=>{
    dateCalendarCursor=
      nextCursor;

    if(value!==undefined){
      datePickerValue=value;
    }

    drawDatePicker();
  };

  if(
    prefersReducedMotion() ||
    typeof grid.animate!=="function"
  ){
    apply();
    return;
  }

  dateCalendarTransitionRunning=true;

  const oldGrid=
    makeDateCalendarGhost(
      grid,
      picker
    );

  const oldTitle=
    makeDateCalendarGhost(
      title,
      picker
    );

  apply();

  grid.style.pointerEvents="none";

  const oldX=
    direction>0
      ? -28
      : 28;

  const newX=
    -oldX;

  const oldTitleX=
    direction>0
      ? -10
      : 10;

  const newTitleX=
    -oldTitleX;

  const options={
    duration:320,
    easing:
      "cubic-bezier(.22,.72,.22,1)",
    fill:"both"
  };

  const animations=[
    oldGrid.animate(
      [
        {
          opacity:1,
          transform:
            "translate3d(0,0,0)"
        },
        {
          opacity:0,
          transform:
            `translate3d(${oldX}px,0,0)`
        }
      ],
      options
    ),

    grid.animate(
      [
        {
          opacity:0,
          transform:
            `translate3d(${newX}px,0,0)`
        },
        {
          opacity:1,
          transform:
            "translate3d(0,0,0)"
        }
      ],
      options
    ),

    oldTitle.animate(
      [
        {
          opacity:1,
          transform:
            "translate3d(0,0,0)"
        },
        {
          opacity:0,
          transform:
            `translate3d(${oldTitleX}px,0,0)`
        }
      ],
      options
    ),

    title.animate(
      [
        {
          opacity:0,
          transform:
            `translate3d(${newTitleX}px,0,0)`
        },
        {
          opacity:1,
          transform:
            "translate3d(0,0,0)"
        }
      ],
      options
    )
  ];

  Promise.allSettled(
    animations.map(
      animation=>animation.finished
    )
  ).finally(()=>{
    animations.forEach(
      animation=>animation.cancel()
    );

    oldGrid.remove();
    oldTitle.remove();

    grid.style.removeProperty(
      "pointer-events"
    );

    dateCalendarTransitionRunning=false;
  });
}

function openDateJump(){
  dateJumpValue=
    dateCalendarCursor;

  dateJumpYear=
    Number(
      dateJumpValue.slice(0,4)
    );

  drawDateJump();

  document
    .getElementById("dateJump")
    .classList.add("on");

  document
    .getElementById("datePicker")
    .classList.add("jump-open");

  document
    .getElementById("datePickerMonth")
    .setAttribute(
      "aria-expanded",
      "true"
    );
}

function closeDateJump(){
  document.getElementById("dateJump").classList.remove("on");
  document.getElementById("datePicker").classList.remove("jump-open");

  document
    .getElementById("datePickerMonth")
    .setAttribute("aria-expanded","false");
}

document.getElementById("dateJumpDismiss").addEventListener(
  "click",
  e=>{
    e.preventDefault();
    e.stopImmediatePropagation();
    closeDateJump();
  }
);

function toggleDateJump(){
  const jump=document.getElementById("dateJump");

  if(jump.classList.contains("on")){
    closeDateJump();
  } else {
    openDateJump();
  }
}

function openDatePicker(
  target="shift"
){
  if(
    target==="shift" &&
    !draft
  ) return;

  if(
    target==="tariff" &&
    !manageEditorDraft
  ) return;

  datePickerTarget=target;

  if(target==="shift"){
    readForm();
  }else{
    readManageEditor();
  }

  datePreviousFocus=document.activeElement;
  const picker=document.getElementById("datePicker");
  const veil=document.getElementById("dateVeil");
  clearTimeout(datePickerHideTimer);

  prepareBottomSheetOpen(
    picker,
    "--date-drag"
  );

  datePickerValue=
    target==="shift"
      ? draft.date
      : manageEditorDraft
          .effectiveFrom;
  dateCalendarCursor=datePickerValue.slice(0,7);
  closeDateJump();
  drawDatePicker();

  picker.style.display="block";
  picker.classList.remove("on");
  picker.setAttribute("aria-hidden","false");
  veil.setAttribute("aria-hidden","false");
  document.body.classList.add("date-picker-open");
  veil.classList.add("on");
  void picker.offsetHeight;
  picker.classList.add("on");
  requestAnimationFrame(()=>document.getElementById("dateCancel").focus());
}

function closeDatePicker(){
  const picker=document.getElementById("datePicker");
  if(!picker.classList.contains("on") && picker.getAttribute("aria-hidden")==="true") return;

  closeDateJump();
  picker.style.removeProperty("transition");
  picker.classList.remove("on");
  picker.setAttribute("aria-hidden","true");

  const veil=document.getElementById("dateVeil");
  veil.classList.remove("on");
  veil.setAttribute("aria-hidden","true");
  document.body.classList.remove("date-picker-open");
  clearTimeout(datePickerHideTimer);

  const previousFocus=datePreviousFocus;
  datePreviousFocus=null;
  datePickerHideTimer=setTimeout(()=>{
    if(!picker.classList.contains("on")) picker.style.display="none";
    picker.style.removeProperty("--date-drag");
    picker.style.removeProperty("transition");
    if(previousFocus && document.contains(previousFocus)) previousFocus.focus();
  },460);
}

function selectDate(ymd){
  if(datePickerTarget==="tariff"){
    if(!manageEditorDraft) return;

    manageEditorDraft.effectiveFrom=
      ymd;

    closeDatePicker();
    drawManageEditor();
    return;
  }

  if(!draft) return;

  draft.date=ymd;

  closeDatePicker();

  const isEdit=shifts.some(item=>item.id===draft.id);

  drawSheet(isEdit);
  saveUIState();
}

let pointPickerHideTimer;
let pointPickerValue="";
let pointPickerKind="point";

function openChoicePicker({
  kind,
  value,
  title,
  options
}){
  pointPickerKind=kind;
  pointPreviousFocus=
    document.activeElement;

  const list=document.getElementById("pointList");
  const picker=document.getElementById("pointPicker");
  const veil=document.getElementById("pointVeil");
  clearTimeout(pointPickerHideTimer);

  prepareBottomSheetOpen(
    picker,
    "--point-drag"
  );

  picker.style.transition="none";
  picker.style.display="block";
  picker.classList.remove("on");
  picker.setAttribute("aria-hidden","false");
  veil.setAttribute("aria-hidden","false");

  pointPickerValue=value || "";

  document
    .getElementById(
      "pointPickerTitle"
    )
    .textContent=title;

  list.innerHTML=options
    .map(option=>`
    <button
      type="button"
      class="point-option ${option.value===pointPickerValue?"on":""}"
      data-picker-value="${esc(option.value)}"
    >
      <span class="point-check">
        ${option.value===pointPickerValue?"✓":""}
      </span>

      <span class="point-name">
        ${esc(option.label)}
      </span>
    </button>
  `).join("");

  const anchored=
    positionAppPicker(
      picker,
      pointPreviousFocus
    );

  veil.classList.toggle(
    "app-picker-anchored-veil",
    anchored
  );

  document.body.classList.toggle(
    "app-picker-anchored-open",
    anchored
  );

  document.body.classList.add("point-picker-open");
  veil.classList.add("on");
  void picker.offsetHeight;
  picker.style.removeProperty("transition");
  void picker.offsetHeight;
  picker.classList.add("on");

  requestAnimationFrame(()=>{
    const selected=list.querySelector(".point-option.on") || list.querySelector(".point-option");
    if(selected){
      selected.scrollIntoView({block:"center"});
      selected.focus();
    }
  });
}

function openPointPicker(){
  if(!draft) return;

  openChoicePicker({
    kind:"point",
    value:draft.dbPointId,
    title:"Выберите пункт",
    options:shiftPointOptions()
      .map(point=>({
        value:point.id,
        label:
          point.name+
          (
            point.active===false
              ? " · в архиве"
              : ""
          )
      }))
  });
}

function openEmployeePicker(){
  if(!draft) return;

  openChoicePicker({
    kind:"employee",
    value:draft.employeeId,
    title:"Выберите сотрудника",
    options:shiftEmployeeOptions()
      .map(employee=>({
        value:employee.id,
        label:
          employee.full_name+
          (
            employee.status==="inactive"
              ? " · в архиве"
              : ""
          )
      }))
  });
}

function openStatsPointPicker(){
  openChoicePicker({
    kind:"stats-point",
    value:statsPointId,
    title:"ПВЗ для итогов",
    options:[
      {
        value:"",
        label:"Все ПВЗ"
      },
      ...teamData.points.map(point=>({
        value:point.id,
        label:
          point.name+
          (
            point.active===false
              ? " · архив"
              : ""
          )
      }))
    ]
  });
}

function openStatsEmployeePicker(){
  openChoicePicker({
    kind:"stats-employee",
    value:statsEmployeeId,
    title:"Сотрудник для итогов",
    options:teamData.employees
      .map(employee=>({
        value:employee.id,
        label:
          employee.full_name+
          (
            employee.status==="inactive"
              ? " · архив"
              : ""
          )
      }))
  });
}

function closePointPicker(){
  const picker=document.getElementById("pointPicker");
  if(!picker.classList.contains("on") && picker.getAttribute("aria-hidden")==="true") return;

  const anchored=
    picker.classList.contains(
      "app-picker-anchored"
    );

  picker.style.removeProperty("transition");
  picker.classList.remove("on");
  picker.setAttribute("aria-hidden","true");

  const veil=document.getElementById("pointVeil");

  if(!anchored){
    veil.classList.remove("on");
    veil.setAttribute("aria-hidden","true");
    document.body.classList.remove("point-picker-open");
    document.body.classList.remove(
      "app-picker-anchored-open"
    );
  }

  clearTimeout(pointPickerHideTimer);

  const previousFocus=pointPreviousFocus;
  pointPreviousFocus=null;

  const finishClose=()=>{
    if(!picker.classList.contains("on")){
      picker.style.display="none";
      resetAppPickerPosition(
        picker
      );
      veil.classList.remove("on");
      veil.setAttribute("aria-hidden","true");

      if(anchored){
        void veil.offsetHeight;
        veil.classList.remove(
          "app-picker-anchored-veil"
        );
      }

      document.body.classList.remove("point-picker-open");
      document.body.classList.remove(
        "app-picker-anchored-open"
      );
    }
    picker.style.removeProperty("--point-drag");
    if(previousFocus && document.contains(previousFocus)) previousFocus.focus();
  };

  if(anchored){
    pointPickerHideTimer=setTimeout(
      finishClose,
      160
    );
    return;
  }

  pointPickerHideTimer=setTimeout(
    finishClose,
    460
  );
}

function shiftPricingDriversEqual(
  existing,
  value
){
  return Boolean(
    existing &&
    existing.employeeId===value.employeeId &&
    existing.dbPointId===value.dbPointId &&
    existing.date===value.date &&
    existing.type===value.type &&
    (Number(existing.shk) || 0)===(Number(value.shk) || 0) &&
    existing.partial===value.partial &&
    (
      existing.partial
        ? Number(existing.hours)===Number(value.hours)
        : true
    )
  );
}

function previewCalc(value){
  const existing=shifts.find(item=>item.id===value.id);
  const point=
    teamData.points.find(
      item=>
        item.id===value.dbPointId
    );
  let pricing;
  let pricingError="";

  try{
    const sameDrivers=
      shiftPricingDriversEqual(
        existing,
        value
      );

    const tariff=
      point
        ? tariffForDate(
            teamData.tariffs,
            point.id,
            value.date
          )
        : null;

    pricing=(existing?.pricing && sameDrivers)
      ? existing.pricing
      : createPricingSnapshot({
          tariff,
          point,
          shiftDate:value.date,
          shk:value.shk
        });
  }catch(error){
    pricingError=
      error instanceof Error
        ? error.message
        : "Тариф на выбранную дату не задан";

    pricing={
      fixed:
        point?.pricing_type===
          "fixed",
      rate:0,
      fullHours:FULL_HOURS,
      rulesVersion:RULES_VERSION
    };
  }

  const hours=value.partial ? (Number(value.hours)||0) : pricing.fullHours;
  const perHour=pricing.rate/pricing.fullHours;
  const base=value.partial
    ? Math.round(perHour*hours)
    : pricing.rate;
  const bonus=(value.bonuses || [])
    .reduce(
      (sum,item)=>
        sum+(Number(item.amount)||0),
      0
    );
  const fine=(value.penalties || [])
    .reduce(
      (sum,item)=>
        sum+(Number(item.amount)||0),
      0
    );

  return {
    available:!pricingError,
    error:pricingError,
    fixed:pricing.fixed,
    rate:pricing.rate,
    hours,
    perHour,
    base,
    bonus,
    fine,
    total:base+bonus-fine
  };
}

function adjustmentEditorHTML(
  kind,
  rows
){
  const label=
    kind==="bonuses"
      ? "Премия"
      : "Штраф";

  const addLabel=
    kind==="bonuses"
      ? "Добавить премию"
      : "Добавить штраф";

  return `
    <div class="card adjustment-list">
      ${(rows || []).map((item,index)=>`
        <div class="adjustment-row" data-adjustment-kind="${kind}" data-adjustment-index="${index}">
          <label class="row">
            <div class="t">${label}</div>
            <input type="text" inputmode="decimal" data-adjustment-amount value="${esc(String(item.amount ?? "").replace(".",","))}" placeholder="0" autocomplete="off">
          </label>
          <label class="row">
            <div class="t">Комментарий</div>
            <input type="text" data-adjustment-comment value="${esc(item.comment || "")}" autocomplete="off">
          </label>
          <button type="button" class="adjustment-remove" data-adjustment-remove="${kind}:${index}">
            Удалить
          </button>
        </div>
      `).join("")}

      <button
        type="button"
        class="adjustment-add-row"
        data-adjustment-add="${kind}"
      >
        <span>${rows?.length ? "Добавить ещё" : addLabel}</span>
        <span class="adjustment-add-plus" aria-hidden="true">+</span>
      </button>
    </div>
  `;
}

function adjustmentReadOnlyHTML(
  title,
  rows,
  negative=false
){
  if(!rows?.length){
    return "";
  }

  return `
    <div class="ml">${title}</div>
    <div class="card">
      ${rows.map(item=>`
        <div class="row">
          <div class="l">
            <div class="t">${esc(item.comment)}</div>
          </div>
          <div class="v ${negative ? "neg" : "pos"}">
            ${negative ? "− " : "+ "}${money(item.amount)}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function calcHTML(){
  const result=previewCalc(draft);

  if(!result.available){
    return `
      <div class="calc-error">
        ${esc(result.error)}. Добавьте исторический тариф в карточке ПВЗ.
      </div>
    `;
  }

  return `
    <div class="ln">
      <span>${result.fixed ? "Оклад смены" : "Ставка по объёму"}</span>
      <b>${money(result.rate)}</b>
    </div>
    ${draft.partial?`<div class="ln"><span>${nf(result.perHour)} ₽/час × ${hoursWord(result.hours)}</span><b>${money(result.base)}</b></div>`:""}
    ${result.bonus?`<div class="ln"><span>Премии</span><b class="pos">+ ${money(result.bonus)}</b></div>`:""}
    ${result.fine?`<div class="ln"><span>Штрафы</span><b class="neg">− ${money(result.fine)}</b></div>`:""}
    <div class="tot"><span>За смену</span><span>${money(result.total)}</span></div>`;
}

function drawSheet(isEdit){
  const result=previewCalc(draft);
  const fixed=result.fixed;

  if(!isAdmin){
    document.getElementById("sheetBody").innerHTML=`
      <div class="ml">Смена</div>
      <div class="card">
        <div class="row"><div class="l"><div class="t">${esc(dateLabel(draft.date))}</div><div class="s">Дата</div></div></div>
        <div class="row"><div class="l"><div class="t">${esc(draft.point)}</div><div class="s">ПВЗ</div></div></div>
        <div class="row"><div class="l"><div class="t">${draft.type==="extra" ? "Дополнительная" : "Основная"}</div><div class="s">Тип</div></div></div>
        <div class="row"><div class="l"><div class="t">${hoursWord(result.hours)}</div><div class="s">Часы</div></div></div>
        ${fixed ? "" : `<div class="row"><div class="l"><div class="t">${nf(Number(draft.shk)||0)} ШК</div><div class="s">Объём</div></div></div>`}
        <div class="row"><div class="l"><div class="t">${money(result.base)}</div><div class="s">Смена</div></div></div>
      </div>
      ${adjustmentReadOnlyHTML("Премии",draft.bonuses)}
      ${adjustmentReadOnlyHTML("Штрафы",draft.penalties,true)}
      ${draft.note ? `
        <div class="ml">Комментарий</div>
        <div class="card"><div class="row"><div class="l"><div class="t">${esc(draft.note)}</div></div></div></div>
      ` : ""}
      <div class="ml">Итого</div>
      <div class="calc">${calcHTML()}</div>
      <div class="sheet-spacer" aria-hidden="true"></div>
    `;
    return;
  }

  const selectedEmployee=
    shiftEmployeeOptions()
      .find(
        employee=>
          employee.id===
          draft.employeeId
      );

  document.getElementById("sheetBody").innerHTML=`
    <div class="ml">Смена</div>
    <div class="card">
      <button type="button" class="row point-row" id="f-date-open">
        <div class="t">Дата</div>
        <div class="point-value">${esc(dateLabel(draft.date))}</div>
      </button>
      <button type="button" class="row point-row" id="f-point-open">
        <div class="t">Пункт</div>
        <div class="point-value">${esc(draft.point)}</div>
      </button>
      <button
        type="button"
        class="row point-row shift-employee-row"
        id="f-employee-open"
      >
        <div class="t">Сотрудник</div>
        <div class="point-value">
          ${esc(selectedEmployee?.full_name || "Выберите сотрудника")}
        </div>
      </button>
      ${fixed ? "" : `
        <label class="row">
          <div class="t">ШК</div>
          <input type="number" inputmode="numeric" id="f-shk" min="0" max="${MAX_SHK}" step="1" value="${esc(draft.shk)}" placeholder="0" aria-label="ШК" autocomplete="off">
        </label>
      `}
    </div>

    <div class="ml">Тип</div>
    <div class="card segbox"><div class="seg">
      <button type="button" data-type="main" class="${draft.type==="main"?"on":""}">Основная</button>
      <button type="button" data-type="extra" class="${draft.type==="extra"?"on":""}">Дополнительная</button>
    </div></div>

    <div class="ml">Отработано</div>
    <div class="card">
      <div class="segbox"><div class="seg">
        <button type="button" data-part="0" class="${!draft.partial?"on":""}">Полная смена</button>
        <button type="button" data-part="1" class="${draft.partial?"on":""}">Неполная смена</button>
      </div></div>
      ${draft.partial?`<label class="row"><div class="t">Часов</div><input type="text" inputmode="decimal" id="f-hours" min="0.5" max="${FULL_HOURS-0.5}" step="0.5" value="${esc(draft.hours==="" ? "" : String(draft.hours).replace(".",","))}" placeholder="0" aria-label="Часов" autocomplete="off"></label>`:""}
    </div>

    <div class="ml">Премии</div>
    ${adjustmentEditorHTML("bonuses",draft.bonuses)}

    <div class="ml">Штрафы</div>
    ${adjustmentEditorHTML("penalties",draft.penalties)}

    <div class="ml">Комментарий</div>
    <div class="card">
      <label class="row">
        <div class="t">Комментарий к смене</div>
        <input type="text" id="f-note" value="${esc(draft.note || "")}" autocomplete="off">
      </label>
    </div>

    <div class="ml">Расчёт</div>
    <div class="calc" id="calcBox">${calcHTML()}</div>
    ${isEdit?`<button type="button" class="btn warn" id="f-del">Удалить смену</button>`:""}
    <div class="sheet-spacer" aria-hidden="true"></div>`;
}

function readForm(){
  const get=id=>document.getElementById(id);

  if(get("f-shk")){
    draft.shk=
      get("f-shk").value;
  }

  if(get("f-hours")){
    const value=
      get("f-hours")
        .value
        .trim();

    draft.hours=
      value===""
        ? ""
        : Number(
            value.replace(",",".")
          );
  }

  if(get("f-note")){
    draft.note=
      get("f-note").value;
  }

  document
    .querySelectorAll(
      "[data-adjustment-kind]"
    )
    .forEach(row=>{
      const kind=
        row.dataset.adjustmentKind;

      const index=Number(
        row.dataset.adjustmentIndex
      );

      const item=draft[kind]?.[index];

      if(!item){
        return;
      }

      item.amount=
        row.querySelector(
          "[data-adjustment-amount]"
        )?.value
          .trim()
          .replace(",",".") || "";

      item.comment=
        row.querySelector(
          "[data-adjustment-comment]"
        )?.value
          .trim() || "";
    });
}

function validateWholeField(value,label,{allowEmpty=true,max=Number.MAX_SAFE_INTEGER}={}){
  if(value==="" || value===null || value===undefined){
    return allowEmpty ? null : `${label} не заполнено`;
  }

  const number=Number(value);
  if(!Number.isSafeInteger(number) || number<0 || number>max){
    return `${label} должно быть целым числом от 0 до ${nf(max)}`;
  }
  return null;
}

function validateMoneyField(value,label,{allowEmpty=true,max=MAX_MONEY}={}){
  if(value==="" || value===null || value===undefined){
    return allowEmpty ? null : `${label} не заполнено`;
  }

  const number=
    Number(
      typeof value==="string"
        ? value.replace(",",".")
        : value
    );

  if(!Number.isFinite(number)){
    return `${label} должно быть числом`;
  }

  const cents=
    Math.round(
      number*100
    );

  if(
    number<0 ||
    number>max ||
    Math.abs(
      number*100-cents
    )>1e-7
  ){
    return `${label} должно быть от 0 до ${nf(max)} ₽, не более 2 знаков после запятой`;
  }

  return null;
}

function validateDraft(value){
  if(!isValidDateString(value.date)) return {message:`Выберите дату с ${MIN_YEAR} по ${MAX_YEAR} год`,fieldId:"f-date-open"};
  if(!shiftEmployeeOptions(value).some(employee=>employee.id===value.employeeId)) return {message:"Выберите сотрудника",fieldId:"f-employee-open"};
  if(!shiftPointOptions(value).some(point=>point.id===value.dbPointId)) return {message:"Выберите назначенный ПВЗ",fieldId:"f-point-open"};

  if(!previewCalc(value).fixed){
    const error=validateWholeField(value.shk,"ШК",{allowEmpty:true,max:MAX_SHK});
    if(error) return {message:error,fieldId:"f-shk"};
  }

  if(value.partial){
    const hours=
      Number(
        typeof value.hours==="string"
          ? value.hours.replace(",",".")
          : value.hours
      );

    const maxPartialHours=
      FULL_HOURS-0.5;

    if(
      !Number.isFinite(hours) ||
      hours<0.5 ||
      hours>maxPartialHours ||
      !Number.isInteger(hours*2)
    ){
      return {
        message:
          `Укажите часы от 0,5 до ${String(maxPartialHours).replace(".",",")} с шагом 0,5`,
        fieldId:"f-hours"
      };
    }
  }

  try{
    const point=teamData.points.find(item=>item.id===value.dbPointId);
    const existing=shifts.find(item=>item.id===value.id);

    if(
      !shiftPricingDriversEqual(
        existing,
        value
      )
    ){
      const tariff=tariffForDate(teamData.tariffs,point.id,value.date);
      const pricing=createPricingSnapshot({tariff,point,shiftDate:value.date,shk:value.shk});
      calculateBaseAmount(
        pricing,
        {
          partial:value.partial,
          hours:value.hours
        }
      );
    }

    for(const [kind,label] of [["bonuses","Премия"],["penalties","Штраф"]]){
      for(const [index,item] of (value[kind] || []).entries()){
        const moneyError=validateMoneyField(item.amount,label,{allowEmpty:false,max:MAX_MONEY});
        if(moneyError || Number(item.amount)<=0){
          return {message:moneyError || `${label} должна быть больше 0`,fieldId:null};
        }
        if(!String(item.comment || "").trim()){
          return {message:`Добавьте комментарий: ${label.toLocaleLowerCase("ru-RU")} ${index+1}`,fieldId:null};
        }
      }
    }
  }catch(error){
    return {message:error instanceof Error ? error.message : "Некорректные данные смены",fieldId:null};
  }

  return null;
}

function normalizedDraft(value){
  const point=teamData.points.find(
    item=>item.id===value.dbPointId
  );

  const employee=teamData.employees.find(
    item=>item.id===value.employeeId
  );

  return {
    ...cloneShiftDraft(value),
    point:point.name,
    pointId:point.code || point.id,
    employeeName:employee.full_name,
    shk:value.shk==="" ? "" : Number(value.shk),
    hours:value.partial ? Number(value.hours) : "",
    note:String(value.note || "").trim(),
    bonuses:value.bonuses.map(item=>({
      ...item,
      amount:Number(item.amount),
      comment:item.comment.trim()
    })),
    penalties:value.penalties.map(item=>({
      ...item,
      amount:Number(item.amount),
      comment:item.comment.trim()
    }))
  };
}

function showValidationError(error){
  toast(error.message,3000);

  setTimeout(()=>{
    const field=document.getElementById(error.fieldId);
    if(field) field.focus();
  },50);
}

let monthPickerHideTimer;
let monthPickerValue=cursor;
let monthPickerYear=Number(cursor.slice(0,4));

function drawMonthPicker(){
  const grid=
    document.getElementById("monthGrid");

  document
    .getElementById("monthPickerYear")
    .textContent=monthPickerYear;

  document.getElementById("monthYearPrev").disabled=monthPickerYear<=MIN_YEAR;
  document.getElementById("monthYearNext").disabled=monthPickerYear>=MAX_YEAR;

  grid.innerHTML=MONTHS.map(
    (name,index)=>{
      const ym=
        monthPickerYear+"-"+
        String(index+1).padStart(2,"0");

      return `
        <button
          type="button"
          class="
            month-option
            ${ym===monthPickerValue?"on":""}
          "
          data-month="${ym}"
        >
          ${name}
        </button>
      `;
    }
  ).join("");
}

function openMonthPicker(){
  if(
    !["shifts","stats"].includes(tab) ||
    document.body.classList.contains("sheet-open") ||
    document.body.classList.contains("point-picker-open")
  ) return;

  monthPreviousFocus=document.activeElement;
  const picker=document.getElementById("monthPicker");
  const veil=document.getElementById("monthVeil");
  clearTimeout(monthPickerHideTimer);

  prepareBottomSheetOpen(
    picker,
    "--month-drag"
  );

  monthPickerValue=cursor;
  monthPickerYear=Math.min(MAX_YEAR,Math.max(MIN_YEAR,Number(monthPickerValue.slice(0,4))));
  drawMonthPicker();
  picker.style.display="block";
  picker.classList.remove("on");
  picker.setAttribute("aria-hidden","false");
  veil.setAttribute("aria-hidden","false");
  document.body.classList.add("month-picker-open");
  veil.classList.add("on");
  setBackgroundInert(true);
  void picker.offsetHeight;
  picker.classList.add("on");
  requestAnimationFrame(()=>document.getElementById("monthCancel").focus());
}

function closeMonthPicker(){
  const picker=document.getElementById("monthPicker");
  if(!picker.classList.contains("on") && picker.getAttribute("aria-hidden")==="true") return;

  picker.style.removeProperty("transition");
  picker.classList.remove("on");
  picker.setAttribute("aria-hidden","true");
  const veil=document.getElementById("monthVeil");
  veil.classList.remove("on");
  veil.setAttribute("aria-hidden","true");
  document.body.classList.remove("month-picker-open");
  clearTimeout(monthPickerHideTimer);

  const previousFocus=monthPreviousFocus;
  monthPreviousFocus=null;
  if(!activeModal()) setBackgroundInert(false);

  monthPickerHideTimer=setTimeout(()=>{
    if(!picker.classList.contains("on")) picker.style.display="none";
    picker.style.removeProperty("--month-drag");
    picker.style.removeProperty("transition");
    if(previousFocus && document.contains(previousFocus)) previousFocus.focus();
  },460);
}

let monthTransitionRunning=false;
let tabTransitionRunning=false;

function prefersReducedMotion(){
  return window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches===true;
}

function makeMonthTransitionGhost(
  element,
  zIndex
){
  const rect=
    element.getBoundingClientRect();

  const ghost=
    element.cloneNode(true);

  ghost.removeAttribute(
    "id"
  );

  ghost
    .querySelectorAll("[id]")
    .forEach(node=>{
      node.removeAttribute(
        "id"
      );
    });

  ghost.setAttribute(
    "aria-hidden",
    "true"
  );

  ghost.setAttribute(
    "inert",
    ""
  );

  ghost.style.position=
    "fixed";

  ghost.style.left=
    rect.left+"px";

  ghost.style.top=
    rect.top+"px";

  ghost.style.width=
    rect.width+"px";

  ghost.style.height=
    rect.height+"px";

  ghost.style.margin=
    "0";

  ghost.style.zIndex=
    String(zIndex);

  ghost.style.pointerEvents=
    "none";

  ghost.style.willChange=
    "transform, opacity";

  ghost.style.setProperty(
    "view-transition-name",
    "none"
  );

  document.body.appendChild(
    ghost
  );

  if(
    element instanceof HTMLElement &&
    ghost instanceof HTMLElement
  ){
    ghost.scrollTop=
      element.scrollTop;

    ghost.scrollLeft=
      element.scrollLeft;

    const sourceShiftScroll=
      element.querySelector(
        ".shift-scroll"
      );

    const ghostShiftScroll=
      ghost.querySelector(
        ".shift-scroll"
      );

    if(
      sourceShiftScroll instanceof HTMLElement &&
      ghostShiftScroll instanceof HTMLElement
    ){
      ghostShiftScroll.scrollTop=
        sourceShiftScroll.scrollTop;

      ghostShiftScroll.scrollLeft=
        sourceShiftScroll.scrollLeft;
    }
  }

  return ghost;
}

function changeMonth(
  nextCursor,
  direction,
  {scrollTop=true}={}
){
  if(
    nextCursor===cursor ||
    monthTransitionRunning ||
    tabTransitionRunning ||
    manageTransitionRunning
  ){
    return;
  }

  const period=
    document.getElementById(
      "period"
    );

  const apply=()=>{
    cursor=nextCursor;

    /*
      Реальную страницу переводим
      к началу нового месяца, пока
      старый экран уже удерживается
      отдельным fixed-слепком.
    */
    if(scrollTop){
      setPageScrollTop(0);
    }

    render();
  };

  if(
    prefersReducedMotion() ||
    typeof app.animate!=="function" ||
    typeof period.animate!=="function"
  ){
    apply();
    return;
  }

  monthTransitionRunning=true;

  const oldApp=
    makeMonthTransitionGhost(
      app,
      19
    );

  const oldPeriod=
    makeMonthTransitionGhost(
      period,
      21
    );

  const oldContentX=
    direction>0
      ? -28
      : 28;

  const newContentX=
    -oldContentX;

  const oldPeriodX=
    direction>0
      ? -10
      : 10;

  const newPeriodX=
    -oldPeriodX;

  /*
    Скрываем настоящие элементы до
    момента, когда в них уже будет
    отрисован новый месяц.
  */
  app.style.opacity=
    "0";

  period.style.opacity=
    "0";

  let animations=[];

  try{
    apply();

    const options={
      duration:320,
      easing:
        "cubic-bezier(.22,.72,.22,1)",
      fill:"both"
    };

    animations=[
      oldApp.animate(
        [
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          },
          {
            opacity:0,
            transform:
              `translate3d(${oldContentX}px,0,0)`
          }
        ],
        options
      ),

      app.animate(
        [
          {
            opacity:0,
            transform:
              `translate3d(${newContentX}px,0,0)`
          },
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          }
        ],
        options
      ),

      oldPeriod.animate(
        [
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          },
          {
            opacity:0,
            transform:
              `translate3d(${oldPeriodX}px,0,0)`
          }
        ],
        options
      ),

      period.animate(
        [
          {
            opacity:0,
            transform:
              `translate3d(${newPeriodX}px,0,0)`
          },
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          }
        ],
        options
      )
    ];

    app.style.removeProperty(
      "opacity"
    );

    period.style.removeProperty(
      "opacity"
    );

    Promise.allSettled(
      animations.map(
        animation=>
          animation.finished
      )
    ).finally(()=>{
      animations.forEach(
        animation=>
          animation.cancel()
      );

      oldApp.remove();
      oldPeriod.remove();

      app.style.removeProperty(
        "opacity"
      );

      period.style.removeProperty(
        "opacity"
      );

      monthTransitionRunning=false;
      flushPendingMonthWheel();
    });
  }catch{
    animations.forEach(
      animation=>
        animation.cancel()
    );

    oldApp.remove();
    oldPeriod.remove();

    app.style.removeProperty(
      "opacity"
    );

    period.style.removeProperty(
      "opacity"
    );

    monthTransitionRunning=false;
    flushPendingMonthWheel();
  }
}

function selectMonth(ym){
  const direction=
    ym>cursor
      ? 1
      : ym<cursor
        ? -1
        : 0;

  closeMonthPicker();

  if(direction===0){
    return;
  }

  changeMonth(
    ym,
    direction,
    {scrollTop:true}
  );
}

/* ========== события ========== */
document.getElementById("prevM").onclick=()=>{
  changeMonth(
    shiftMonth(cursor,-1),
    -1
  );
};

document.getElementById("nextM").onclick=()=>{
  changeMonth(
    shiftMonth(cursor,1),
    1
  );
};

document.getElementById("period").onclick=openMonthPicker;

let monthPickerYearTransitionRunning=false;
let dateJumpYearTransitionRunning=false;

function animatePickerYearChange({
  container,
  grid,
  label,
  direction,
  apply,
  onFinish
}){
  const finish=()=>{
    if(onFinish){
      onFinish();
    }
  };

  if(
    prefersReducedMotion() ||
    typeof grid.animate!=="function"
  ){
    apply();
    finish();
    return;
  }

  let oldGrid=null;
  let oldLabel=null;
  let animations=[];
  let applied=false;

  try{
    oldGrid=
      makeDateCalendarGhost(
        grid,
        container
      );

    oldLabel=
      makeDateCalendarGhost(
        label,
        container
      );

    apply();
    applied=true;

    grid.style.pointerEvents="none";

    const oldGridX=
      direction>0
        ? -28
        : 28;

    const newGridX=
      -oldGridX;

    const oldLabelX=
      direction>0
        ? -10
        : 10;

    const newLabelX=
      -oldLabelX;

    const options={
      duration:320,
      easing:
        "cubic-bezier(.22,.72,.22,1)",
      fill:"both"
    };

    animations=[
      oldGrid.animate(
        [
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          },
          {
            opacity:0,
            transform:
              `translate3d(${oldGridX}px,0,0)`
          }
        ],
        options
      ),

      grid.animate(
        [
          {
            opacity:0,
            transform:
              `translate3d(${newGridX}px,0,0)`
          },
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          }
        ],
        options
      ),

      oldLabel.animate(
        [
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          },
          {
            opacity:0,
            transform:
              `translate3d(${oldLabelX}px,0,0)`
          }
        ],
        options
      ),

      label.animate(
        [
          {
            opacity:0,
            transform:
              `translate3d(${newLabelX}px,0,0)`
          },
          {
            opacity:1,
            transform:
              "translate3d(0,0,0)"
          }
        ],
        options
      )
    ];

    Promise.allSettled(
      animations.map(
        animation=>animation.finished
      )
    ).finally(()=>{
      animations.forEach(
        animation=>animation.cancel()
      );

      oldGrid?.remove();
      oldLabel?.remove();

      grid.style.removeProperty(
        "pointer-events"
      );

      finish();
    });
  }catch{
    animations.forEach(
      animation=>animation.cancel()
    );

    oldGrid?.remove();
    oldLabel?.remove();

    grid.style.removeProperty(
      "pointer-events"
    );

    if(!applied){
      apply();
    }

    finish();
  }
}

function changeMonthPickerYear(direction){
  if(monthPickerYearTransitionRunning){
    return;
  }

  const nextYear=
    Math.min(
      MAX_YEAR,
      Math.max(
        MIN_YEAR,
        monthPickerYear+direction
      )
    );

  if(nextYear===monthPickerYear){
    return;
  }

  monthPickerYearTransitionRunning=true;

  animatePickerYearChange({
    container:
      document.getElementById(
        "monthPicker"
      ),

    grid:
      document.getElementById(
        "monthGrid"
      ),

    label:
      document.getElementById(
        "monthPickerYear"
      ),

    direction,

    apply:()=>{
      monthPickerYear=nextYear;
      drawMonthPicker();
    },

    onFinish:()=>{
      monthPickerYearTransitionRunning=false;
    }
  });
}

function changeDateJumpYear(direction){
  if(dateJumpYearTransitionRunning){
    return;
  }

  const nextYear=
    Math.min(
      MAX_YEAR,
      Math.max(
        MIN_YEAR,
        dateJumpYear+direction
      )
    );

  if(nextYear===dateJumpYear){
    return;
  }

  dateJumpYearTransitionRunning=true;

  animatePickerYearChange({
    container:
      document.getElementById(
        "dateJump"
      ),

    grid:
      document.getElementById(
        "dateJumpMonths"
      ),

    label:
      document.getElementById(
        "dateJumpYear"
      ),

    direction,

    apply:()=>{
      dateJumpYear=
        nextYear;

      drawDateJump();
    },

    onFinish:()=>{
      dateJumpYearTransitionRunning=false;
    }
  });
}

function bindYearSwipe(
  element,
  changeYear
){
  let swipe=null;

  element.addEventListener(
    "pointerdown",
    e=>{
      if(
        !e.isPrimary ||
        !["touch","pen"].includes(
          e.pointerType
        )
      ){
        return;
      }

      swipe={
        id:e.pointerId,
        x:e.clientX,
        y:e.clientY,
        time:performance.now(),
        axis:null
      };

      try{
        element.setPointerCapture(
          e.pointerId
        );
      }catch{}
    }
  );

  element.addEventListener(
    "pointermove",
    e=>{
      if(
        !swipe ||
        e.pointerId!==swipe.id
      ){
        return;
      }

      const dx=
        e.clientX-swipe.x;

      const dy=
        e.clientY-swipe.y;

      const absX=
        Math.abs(dx);

      const absY=
        Math.abs(dy);

      if(swipe.axis===null){
        if(
          absX<8 &&
          absY<8
        ){
          return;
        }

        if(
          absX>=10 &&
          absX>absY*1.10
        ){
          swipe.axis="x";
        }else if(
          absY>=14 &&
          absY>absX*1.25
        ){
          swipe.axis="y";
          return;
        }else{
          return;
        }
      }

      if(swipe.axis!=="x"){
        return;
      }

      if(e.cancelable){
        e.preventDefault();
      }
    }
  );

  const finish=e=>{
    if(
      !swipe ||
      e.pointerId!==swipe.id
    ){
      return;
    }

    const current=swipe;
    swipe=null;

    try{
      if(
        element.hasPointerCapture(
          e.pointerId
        )
      ){
        element.releasePointerCapture(
          e.pointerId
        );
      }
    }catch{}

    const dx=
      e.clientX-current.x;

    const dy=
      e.clientY-current.y;

    const absX=
      Math.abs(dx);

    const absY=
      Math.abs(dy);

    const duration=
      Math.max(
        1,
        performance.now()-current.time
      );

    const velocity=
      absX/duration;

    const horizontal=
      absX>absY*1.08;

    const enoughDistance=
      absX>=35;

    const fastSwipe=
      absX>=22 &&
      velocity>=0.30;

    if(
      current.axis!=="x" ||
      !horizontal ||
      (
        !enoughDistance &&
        !fastSwipe
      )
    ){
      return;
    }

    changeYear(
      dx<0
        ? 1
        : -1
    );
  };

  element.addEventListener(
    "pointerup",
    finish
  );

  element.addEventListener(
    "pointercancel",
    e=>{
      if(
        !swipe ||
        e.pointerId!==swipe.id
      ){
        return;
      }

      swipe=null;
    }
  );
}

bindYearSwipe(
  document.getElementById("monthGrid"),
  changeMonthPickerYear
);

bindYearSwipe(
  document.getElementById("dateJumpMonths"),
  changeDateJumpYear
);

document.getElementById("monthVeil").onclick=closeMonthPicker;

document.getElementById("monthYearPrev").onclick=()=>{
  changeMonthPickerYear(-1);
};

document.getElementById("monthYearNext").onclick=()=>{
  changeMonthPickerYear(1);
};

document.getElementById("monthGrid").onclick=e=>{
  const option=e.target.closest("[data-month]");

  if(!option) return;

  monthPickerValue=
    option.dataset.month;

  monthPickerYear=Number(
    monthPickerValue.slice(0,4)
  );

  drawMonthPicker();
};

document.getElementById("monthToday").onclick=()=>{
  if(monthPickerYearTransitionRunning){
    return;
  }

  const currentMonth=
    ymOf(new Date());

  const currentYear=
    Number(
      currentMonth.slice(0,4)
    );

  if(currentYear===monthPickerYear){
    monthPickerValue=
      currentMonth;

    drawMonthPicker();
    return;
  }

  monthPickerYearTransitionRunning=true;

  animatePickerYearChange({
    container:
      document.getElementById(
        "monthPicker"
      ),

    grid:
      document.getElementById(
        "monthGrid"
      ),

    label:
      document.getElementById(
        "monthPickerYear"
      ),

    direction:
      currentYear>monthPickerYear
        ? 1
        : -1,

    apply:()=>{
      monthPickerYear=
        currentYear;

      monthPickerValue=
        currentMonth;

      drawMonthPicker();
    },

    onFinish:()=>{
      monthPickerYearTransitionRunning=false;
    }
  });
};

document.getElementById("monthCancel").onclick=()=>{
  closeMonthPicker();
};

document.getElementById("monthDone").onclick=()=>{
  if(!monthPickerValue) return;

  selectMonth(monthPickerValue);
};

const monthPickerElement=
  document.getElementById("monthPicker");

function bindBottomSheetDismiss({
  element,
  dragProperty,
  close,
  canStart=()=>true,
  onBegin=()=>{}
}){
  let gesture=null;
  let dragFrame=0;
  let pendingDistance=0;
  let snapTimer=0;
  let suppressClickUntil=0;
  let wheelTimer=0;
  let wheelSequence=null;

  const blockedTarget=target=>
    target instanceof Element &&
    Boolean(
      target.closest(
        'input,textarea,select,[contenteditable="true"]'
      )
    );

  const queueDistance=distance=>{
    pendingDistance=distance;

    if(dragFrame){
      return;
    }

    dragFrame=requestAnimationFrame(()=>{
      dragFrame=0;

      element.style.setProperty(
        dragProperty,
        pendingDistance+"px"
      );
    });
  };

  const flushDistance=()=>{
    if(!dragFrame){
      return;
    }

    cancelAnimationFrame(dragFrame);
    dragFrame=0;

    element.style.setProperty(
      dragProperty,
      pendingDistance+"px"
    );
  };

  const beginDrag=()=>{
    clearTimeout(snapTimer);

    onBegin();

    element.style.transition="none";
  };

  const snapBack=()=>{
    element.style.transition=
      "transform .42s cubic-bezier(.4,0,.2,1)";

    requestAnimationFrame(()=>{
      element.style.setProperty(
        dragProperty,
        "0px"
      );
    });

    snapTimer=setTimeout(()=>{
      if(
        element.classList.contains("on")
      ){
        element.style.removeProperty(
          "transition"
        );

        element.style.removeProperty(
          dragProperty
        );
      }
    },440);
  };

  const resetInteraction=()=>{
    clearTimeout(snapTimer);
    clearTimeout(wheelTimer);

    snapTimer=0;
    wheelTimer=0;
    wheelSequence=null;
    gesture=null;

    if(dragFrame){
      cancelAnimationFrame(
        dragFrame
      );

      dragFrame=0;
    }

    pendingDistance=0;

    element.style.removeProperty(
      dragProperty
    );
  };

  element.addEventListener(
    "bottomsheetopen",
    resetInteraction
  );

  const animateClose=distance=>{
    const endDistance=
      element.getBoundingClientRect()
        .height+40;

    if(
      prefersReducedMotion() ||
      typeof element.animate!=="function"
    ){
      element.style.removeProperty(
        "transition"
      );

      close();
      return;
    }

    element.style.removeProperty(
      "transition"
    );

    const animation=
      element.animate(
        [
          {
            transform:
              `translate3d(0,${distance}px,0)`
          },
          {
            transform:
              `translate3d(0,${endDistance}px,0)`
          }
        ],
        {
          duration:420,
          easing:
            "cubic-bezier(.4,0,.2,1)",
          fill:"both"
        }
      );

    close();

    animation.finished
      .catch(()=>{})
      .finally(()=>{
        animation.cancel();
      });
  };

  const finishDrag=({
    allowClose=true
  }={})=>{
    if(
      !gesture ||
      gesture.axis!=="y"
    ){
      gesture=null;
      return;
    }

    flushDistance();

    const distance=
      gesture.distance;

    const duration=Math.max(
      1,
      performance.now()-
        gesture.started
    );

    const fastSwipe=
      distance>=22 &&
      distance/duration>=0.32;

    const shouldClose=
      allowClose &&
      (
        distance>=56 ||
        fastSwipe
      );

    gesture=null;

    suppressClickUntil=
      performance.now()+650;

    if(shouldClose){
      animateClose(distance);
      return;
    }

    snapBack();
  };

  const lockAxis=(
    dx,
    dy
  )=>{
    if(!gesture){
      return false;
    }

    const absX=Math.abs(dx);
    const absY=Math.abs(dy);

    if(gesture.axis!==null){
      return gesture.axis==="y";
    }

    if(
      absX<8 &&
      absY<8
    ){
      return false;
    }

    if(
      absX>=10 &&
      absX>absY*1.10
    ){
      gesture.axis="x";
      return false;
    }

    if(
      dy<0 &&
      absY>=10 &&
      absY>absX*1.10
    ){
      gesture.axis="scroll";
      return false;
    }

    if(
      dy>0 &&
      absY>=10 &&
      absY>absX*1.08
    ){
      if(!canStart(gesture.target)){
        gesture.axis="scroll";
        return false;
      }

      gesture.axis="y";
      beginDrag();
      return true;
    }

    return false;
  };

  element.addEventListener(
    "touchstart",
    event=>{
      if(
        event.touches.length!==1 ||
        !element.classList.contains("on") ||
        blockedTarget(event.target)
      ){
        gesture=null;
        return;
      }

      const touch=
        event.touches[0];

      gesture={
        kind:"touch",
        id:touch.identifier,
        target:event.target,
        startX:touch.clientX,
        startY:touch.clientY,
        distance:0,
        started:performance.now(),
        axis:null
      };
    },
    {passive:true}
  );

  element.addEventListener(
    "touchmove",
    event=>{
      if(
        !gesture ||
        gesture.kind!=="touch"
      ){
        return;
      }

      const touch=
        findTouch(
          event.touches,
          gesture.id
        );

      if(!touch){
        return;
      }

      const dx=
        touch.clientX-
        gesture.startX;

      const dy=
        touch.clientY-
        gesture.startY;

      if(!lockAxis(dx,dy)){
        return;
      }

      gesture.distance=
        Math.max(0,dy);

      queueDistance(
        gesture.distance
      );

      if(event.cancelable){
        event.preventDefault();
      }
    },
    {passive:false}
  );

  element.addEventListener(
    "touchend",
    event=>{
      if(
        !gesture ||
        gesture.kind!=="touch"
      ){
        return;
      }

      const touch=
        findTouch(
          event.changedTouches,
          gesture.id
        );

      if(
        touch &&
        gesture.axis==="y"
      ){
        gesture.distance=
          Math.max(
            0,
            touch.clientY-
              gesture.startY
          );

        pendingDistance=
          gesture.distance;
      }

      finishDrag();
    }
  );

  element.addEventListener(
    "touchcancel",
    ()=>{
      if(
        !gesture ||
        gesture.kind!=="touch"
      ){
        return;
      }

      finishDrag({
        allowClose:false
      });
    }
  );

  element.addEventListener(
    "pointerdown",
    event=>{
      if(
        event.pointerType==="touch" ||
        !event.isPrimary ||
        !element.classList.contains("on") ||
        blockedTarget(event.target)
      ){
        return;
      }

      gesture={
        kind:"pointer",
        id:event.pointerId,
        target:event.target,
        startX:event.clientX,
        startY:event.clientY,
        distance:0,
        started:performance.now(),
        axis:null
      };
    }
  );

  element.addEventListener(
    "pointermove",
    event=>{
      if(
        !gesture ||
        gesture.kind!=="pointer" ||
        event.pointerId!==gesture.id
      ){
        return;
      }

      const dx=
        event.clientX-
        gesture.startX;

      const dy=
        event.clientY-
        gesture.startY;

      const wasDragging=
        gesture.axis==="y";

      if(!lockAxis(dx,dy)){
        return;
      }

      if(!wasDragging){
        try{
          element.setPointerCapture(
            event.pointerId
          );
        }catch{}
      }

      gesture.distance=
        Math.max(0,dy);

      queueDistance(
        gesture.distance
      );

      event.preventDefault();
    }
  );

  element.addEventListener(
    "pointerup",
    event=>{
      if(
        !gesture ||
        gesture.kind!=="pointer" ||
        event.pointerId!==gesture.id
      ){
        return;
      }

      if(gesture.axis==="y"){
        gesture.distance=
          Math.max(
            0,
            event.clientY-
              gesture.startY
          );

        pendingDistance=
          gesture.distance;
      }

      try{
        if(
          element.hasPointerCapture(
            event.pointerId
          )
        ){
          element.releasePointerCapture(
            event.pointerId
          );
        }
      }catch{}

      finishDrag();
    }
  );

  element.addEventListener(
    "pointercancel",
    event=>{
      if(
        !gesture ||
        gesture.kind!=="pointer" ||
        event.pointerId!==gesture.id
      ){
        return;
      }

      finishDrag({
        allowClose:false
      });
    }
  );

  element.addEventListener(
    "wheel",
    event=>{
      if(
        !element.classList.contains("on") ||
        Math.abs(event.deltaX)>
          Math.abs(event.deltaY)*1.15 ||
        (
          gesture &&
          gesture.kind!=="wheel"
        )
      ){
        return;
      }

      if(event.deltaY>=0){
        clearTimeout(wheelTimer);
        wheelTimer=0;
        wheelSequence=null;

        if(
          gesture?.kind==="wheel"
        ){
          finishDrag({
            allowClose:false
          });
        }

        return;
      }

      const now=performance.now();

      if(
        !wheelSequence ||
        now-wheelSequence.lastAt>130
      ){
        wheelSequence={
          lastAt:now,
          canDismiss:
            canStart(event.target)
        };
      }else{
        wheelSequence.lastAt=now;
      }

      clearTimeout(wheelTimer);
      wheelTimer=setTimeout(()=>{
        wheelTimer=0;
        wheelSequence=null;

        if(
          gesture?.kind==="wheel"
        ){
          finishDrag();
        }
      },90);

      if(!wheelSequence.canDismiss){
        return;
      }

      if(!gesture){
        gesture={
          kind:"wheel",
          target:event.target,
          distance:0,
          started:performance.now(),
          axis:"y"
        };

        beginDrag();
      }

      if(event.cancelable){
        event.preventDefault();
      }

      gesture.distance+=Math.min(
        34,
        Math.abs(event.deltaY)*.72
      );

      queueDistance(
        gesture.distance
      );
    },
    {passive:false}
  );

  element.addEventListener(
    "click",
    event=>{
      if(
        performance.now()>
        suppressClickUntil
      ){
        return;
      }

      suppressClickUntil=0;

      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );
}

bindBottomSheetDismiss({
  element:monthPickerElement,
  dragProperty:"--month-drag",
  close:closeMonthPicker
});

let monthSwipe=null;
let suppressMonthClick=false;

const monthSwipeArea=document;

function resetMonthSwipe(){
  monthSwipe=null;
  document.body.classList.remove("month-swiping");
}

function findTouch(list,id){
  for(let i=0;i<list.length;i++){
    const touch=list[i];

    if(touch.identifier===id){
      return touch;
    }
  }

  return null;
}

function monthSwipeStartBlocked(target){
  if(!(target instanceof Element)){
    return true;
  }

  return Boolean(
    target.closest(
      "input,textarea,select,a,button:not(.sh)"
    )
  );
}

monthSwipeArea.addEventListener(
  "touchstart",
  e=>{
    if(
      !["shifts","stats"].includes(tab) ||
      monthTransitionRunning ||
      e.touches.length!==1 ||
      document.body.classList.contains("sheet-open") ||
      document.body.classList.contains("point-picker-open") ||
      document.body.classList.contains("month-picker-open") ||
      monthSwipeStartBlocked(e.target)
    ){
      resetMonthSwipe();
      return;
    }

    const touch=e.touches[0];

    monthSwipe={
      id:touch.identifier,
      x:touch.clientX,
      y:touch.clientY,
      lastX:touch.clientX,
      lastY:touch.clientY,
      time:performance.now(),
      axis:null
    };
  },
  {passive:true}
);

monthSwipeArea.addEventListener(
  "touchmove",
  e=>{
    if(!monthSwipe){
      return;
    }

    const touch=
      findTouch(
        e.touches,
        monthSwipe.id
      );

    if(!touch){
      return;
    }

    monthSwipe.lastX=
      touch.clientX;

    monthSwipe.lastY=
      touch.clientY;

    const dx=
      touch.clientX-monthSwipe.x;

    const dy=
      touch.clientY-monthSwipe.y;

    const absX=
      Math.abs(dx);

    const absY=
      Math.abs(dy);

    /*
      Не определяем направление по первым
      2–6 пикселям движения пальца.

      Это специально оставляет небольшой
      dead zone для естественного дрожания
      пальца на iPhone.
    */
    if(monthSwipe.axis===null){
      if(
        absX<8 &&
        absY<8
      ){
        return;
      }

      /*
        Горизонтальный жест определяем
        немного охотнее вертикального.
      */
      if(
        absX>=10 &&
        absX>absY*1.10
      ){
        monthSwipe.axis="x";
      }

      /*
        Вертикальный scroll блокируем
        только когда вертикальное намерение
        уже достаточно очевидно.
      */
      else if(
        absY>=14 &&
        absY>absX*1.25
      ){
        monthSwipe.axis="y";
      }

      else{
        return;
      }
    }

    if(monthSwipe.axis==="x"){
      document.body.classList.add(
        "month-swiping"
      );

      /*
        Только после уверенного определения
        горизонтального свайпа забираем
        жест у Safari.
      */
      if(e.cancelable){
        e.preventDefault();
      }
    }
  },
  {passive:false}
);

function finishMonthSwipe(e){
  if(!monthSwipe){
    return;
  }

  const swipe=monthSwipe;

  const touch=
    findTouch(
      e.changedTouches,
      swipe.id
    );

  const endX=
    touch
      ? touch.clientX
      : swipe.lastX;

  const endY=
    touch
      ? touch.clientY
      : swipe.lastY;

  const dx=
    endX-swipe.x;

  const dy=
    endY-swipe.y;

  const absX=
    Math.abs(dx);

  const absY=
    Math.abs(dy);

  const duration=
    Math.max(
      1,
      performance.now()-swipe.time
    );

  const velocity=
    absX/duration;

  resetMonthSwipe();

  /*
    Финальная страховка от вертикального
    скролла и диагонального жеста.
  */
  const horizontal=
    absX>absY*1.08;

  /*
    Обычный осознанный свайп.
  */
  const enoughDistance=
    absX>=38;

  /*
    Или короткий, но быстрый flick.
  */
  const fastSwipe=
    absX>=22 &&
    velocity>=0.30;

  if(
    swipe.axis==="y" ||
    !horizontal ||
    (
      !enoughDistance &&
      !fastSwipe
    )
  ){
    return;
  }

  const nextCursor=
    shiftMonth(
      cursor,
      dx<0 ? 1 : -1
    );

  if(nextCursor===cursor){
    return;
  }

  /*
    Не даём iOS после свайпа открыть
    случайно ту смену, на которой
    закончился палец.
  */
  suppressMonthClick=true;

  changeMonth(
    nextCursor,
    dx<0 ? 1 : -1,
    {scrollTop:true}
  );

  setTimeout(()=>{
    suppressMonthClick=false;
  },400);
}

monthSwipeArea.addEventListener(
  "touchend",
  finishMonthSwipe,
  {passive:true}
);

monthSwipeArea.addEventListener(
  "touchcancel",
  resetMonthSwipe,
  {passive:true}
);

monthSwipeArea.addEventListener(
  "pointerdown",
  event=>{
    if(
      event.pointerType==="touch" ||
      !event.isPrimary ||
      !["shifts","stats"].includes(tab) ||
      monthTransitionRunning ||
      document.body.classList.contains("sheet-open") ||
      document.body.classList.contains("point-picker-open") ||
      document.body.classList.contains("month-picker-open") ||
      monthSwipeStartBlocked(event.target)
    ){
      return;
    }

    monthSwipe={
      id:event.pointerId,
      x:event.clientX,
      y:event.clientY,
      lastX:event.clientX,
      lastY:event.clientY,
      time:performance.now(),
      axis:null,
      pointer:true
    };
  }
);

monthSwipeArea.addEventListener(
  "pointermove",
  event=>{
    if(
      !monthSwipe?.pointer ||
      event.pointerId!==monthSwipe.id
    ){
      return;
    }

    monthSwipe.lastX=event.clientX;
    monthSwipe.lastY=event.clientY;

    const dx=event.clientX-monthSwipe.x;
    const dy=event.clientY-monthSwipe.y;
    const absX=Math.abs(dx);
    const absY=Math.abs(dy);

    if(monthSwipe.axis===null){
      if(absX<8 && absY<8) return;

      if(absX>=10 && absX>absY*1.10){
        monthSwipe.axis="x";
      }else if(absY>=14 && absY>absX*1.25){
        monthSwipe.axis="y";
      }else{
        return;
      }
    }

    if(monthSwipe.axis==="x"){
      document.body.classList.add("month-swiping");

      try{
        monthSwipeArea.setPointerCapture?.(
          event.pointerId
        );
      }catch{}

      event.preventDefault();
    }
  }
);

monthSwipeArea.addEventListener(
  "pointerup",
  event=>{
    if(
      !monthSwipe?.pointer ||
      event.pointerId!==monthSwipe.id
    ){
      return;
    }

    finishMonthSwipe({
      changedTouches:[{
        identifier:event.pointerId,
        clientX:event.clientX,
        clientY:event.clientY
      }]
    });
  }
);

monthSwipeArea.addEventListener(
  "pointercancel",
  event=>{
    if(
      monthSwipe?.pointer &&
      event.pointerId===monthSwipe.id
    ){
      resetMonthSwipe();
    }
  }
);

let monthWheelX=0;
let monthWheelY=0;
let monthWheelTimer=0;
let monthWheelLastAt=0;
let monthWheelDirection=0;
let monthWheelGestureHandled=false;
let pendingMonthWheelDirections=[];

function resetMonthWheelGesture(){
  monthWheelX=0;
  monthWheelY=0;
  monthWheelLastAt=0;
  monthWheelDirection=0;
  monthWheelGestureHandled=false;
}

function queueMonthWheelDirection(
  direction
){
  if(
    pendingMonthWheelDirections
      .length>=4
  ){
    return;
  }

  pendingMonthWheelDirections.push(
    direction
  );
}

function flushPendingMonthWheel(){
  if(
    monthTransitionRunning ||
    tabTransitionRunning ||
    manageTransitionRunning
  ){
    return;
  }

  if(
    !["shifts","stats"]
      .includes(tab) ||
    activeModal()
  ){
    pendingMonthWheelDirections=[];
    return;
  }

  const direction=
    pendingMonthWheelDirections
      .shift();

  if(!direction){
    return;
  }

  changeMonth(
    shiftMonth(cursor,direction),
    direction,
    {scrollTop:true}
  );
}

monthSwipeArea.addEventListener(
  "wheel",
  event=>{
    if(
      !["shifts","stats"].includes(tab) ||
      activeModal() ||
      Math.abs(event.deltaX)<=
        Math.abs(event.deltaY)
    ){
      return;
    }

    const now=performance.now();

    const direction=
      event.deltaX>0
        ? 1
        : -1;

    const newGesture=
      !monthWheelLastAt ||
      now-monthWheelLastAt>72 ||
      (
        monthWheelDirection &&
        direction!==monthWheelDirection
      );

    if(newGesture){
      resetMonthWheelGesture();
      monthWheelDirection=direction;
    }

    monthWheelLastAt=now;

    window.clearTimeout(
      monthWheelTimer
    );

    monthWheelTimer=
      window.setTimeout(()=>{
        resetMonthWheelGesture();
      },90);

    if(
      monthWheelGestureHandled
    ){
      if(event.cancelable){
        event.preventDefault();
      }

      return;
    }

    monthWheelX+=event.deltaX;
    monthWheelY+=event.deltaY;

    if(
      Math.abs(monthWheelX)<48 ||
      Math.abs(monthWheelX)<=
        Math.abs(monthWheelY)*1.12
    ){
      return;
    }

    if(event.cancelable){
      event.preventDefault();
    }

    monthWheelX=0;
    monthWheelY=0;
    monthWheelGestureHandled=true;

    if(monthTransitionRunning){
      queueMonthWheelDirection(
        direction
      );

      return;
    }

    changeMonth(
      shiftMonth(cursor,direction),
      direction,
      {scrollTop:true}
    );
  },
  {passive:false}
);

let pointerPressGuard=null;
let suppressMovedPointerClickUntil=0;

document.addEventListener(
  "pointerdown",
  e=>{
    if(
      !e.isPrimary ||
      !["touch","pen"].includes(e.pointerType)
    ){
      return;
    }

    /*
      Поля ввода оставляем полностью
      нативными: курсор, выделение,
      перемещение пальца и т. д.
    */
    if(
      e.target instanceof Element &&
      e.target.closest(
        "input,textarea,select,[contenteditable='true']"
      )
    ){
      pointerPressGuard=null;
      suppressMovedPointerClickUntil=0;
      return;
    }

    /*
      Новый настоящий тап всегда очищает
      старую страховку.
    */
    suppressMovedPointerClickUntil=0;

    pointerPressGuard={
      id:e.pointerId,
      x:e.clientX,
      y:e.clientY,
      moved:false
    };
  },
  true
);

document.addEventListener(
  "pointermove",
  e=>{
    if(
      !pointerPressGuard ||
      e.pointerId!==pointerPressGuard.id
    ){
      return;
    }

    const dx=
      e.clientX-pointerPressGuard.x;

    const dy=
      e.clientY-pointerPressGuard.y;

    if(
      Math.hypot(dx,dy)>=8
    ){
      pointerPressGuard.moved=true;
    }
  },
  true
);

document.addEventListener(
  "pointerup",
  e=>{
    if(
      !pointerPressGuard ||
      e.pointerId!==pointerPressGuard.id
    ){
      return;
    }

    const moved=
      pointerPressGuard.moved;

    pointerPressGuard=null;

    if(moved){
      suppressMovedPointerClickUntil=
        performance.now()+650;
    }
  },
  true
);

document.addEventListener(
  "pointercancel",
  e=>{
    if(
      !pointerPressGuard ||
      e.pointerId!==pointerPressGuard.id
    ){
      return;
    }

    pointerPressGuard=null;

    suppressMovedPointerClickUntil=
      performance.now()+650;
  },
  true
);

document.addEventListener(
  "click",
  e=>{
    const movedPointerClick=
      e.detail!==0 &&
      performance.now()<=
        suppressMovedPointerClickUntil;

    if(
      !suppressMonthClick &&
      !movedPointerClick
    ){
      return;
    }

    suppressMovedPointerClickUntil=0;

    e.preventDefault();
    e.stopImmediatePropagation();
  },
  true
);

function changeTab(
  nextTab,
  {
    direction=null,
    focus=false
  }={}
){
  const tabOrder=
    availableTabs();

  if(
    !tabOrder.includes(nextTab)
  ){
    return;
  }

  if(nextTab===tab){
    setPageScrollTop(0);

    if(focus){
      document
        .getElementById(
          "tab-"+nextTab
        )
        ?.focus();
    }

    return;
  }

  if(
    tabTransitionRunning ||
    monthTransitionRunning ||
    manageTransitionRunning
  ){
    return;
  }

  const currentIndex=
    tabOrder.indexOf(tab);

  const nextIndex=
    tabOrder.indexOf(nextTab);

  const resolvedDirection=
    direction ??
    (
      nextIndex>currentIndex
        ? 1
        : -1
    );

  const apply=()=>{
    tab=nextTab;
    setPageScrollTop(0);
    render();
  };

  const finish=()=>{
    if(focus){
      document
        .getElementById(
          "tab-"+nextTab
        )
        ?.focus();
    }
  };

  if(
    prefersReducedMotion() ||
    typeof app.animate!=="function"
  ){
    apply();
    finish();
    return;
  }

  tabTransitionRunning=true;

  apply();

  const startX=
    resolvedDirection>0
      ? 24
      : -24;

  app.style.left=
    `${startX}px`;

  void app.offsetWidth;

  let animation;

  try{
    animation=app.animate(
      [
        {
          left:
            `${startX}px`
        },
        {
          left:"0px"
        }
      ],
      {
        duration:250,
        easing:
          "cubic-bezier(.22,.72,.22,1)",
        fill:"both"
      }
    );

    app.style.left="0px";
  }catch{
    app.style.removeProperty(
      "left"
    );

    tabTransitionRunning=false;

    finish();
    return;
  }

  animation.finished
    .catch(()=>{})
    .finally(()=>{
      animation.cancel();

      app.style.removeProperty(
        "left"
      );

      tabTransitionRunning=false;

      finish();
    });
}

ADMIN_TABS.forEach(name=>{
  const button=
    document.getElementById(
      "tab-"+name
    );

  button.onclick=()=>{
    changeTab(name);
  };

  button.addEventListener(
    "keydown",
    e=>{
      if(
        ![
          "ArrowLeft",
          "ArrowRight"
        ].includes(e.key)
      ){
        return;
      }

      e.preventDefault();

      const tabOrder=
        availableTabs();

      const current=
        tabOrder.indexOf(tab);

      const direction=
        e.key==="ArrowRight"
          ? 1
          : -1;

      const next=
        tabOrder[
          (
            current+
            direction+
            tabOrder.length
          )%
          tabOrder.length
        ];

      changeTab(
        next,
        {
          direction,
          focus:true
        }
      );
    }
  );
});

document.getElementById("veil").onclick=closeSheet;
document.getElementById("sheetCancel").onclick=closeSheet;
document.getElementById("pointVeil").onclick=closePointPicker;
document.getElementById("dateVeil").onclick=closeDatePicker;

document.getElementById("datePrev").onclick=()=>{
  changeDateCalendarMonth(
    shiftMonth(
      dateCalendarCursor,
      -1
    ),
    -1
  );
};

document.getElementById("dateNext").onclick=()=>{
  changeDateCalendarMonth(
    shiftMonth(
      dateCalendarCursor,
      1
    ),
    1
  );
};

document.getElementById("datePickerMonth").onclick=()=>{
  toggleDateJump();
};

document.getElementById("dateJumpPrevYear").onclick=()=>{
  changeDateJumpYear(-1);
};

document.getElementById("dateJumpNextYear").onclick=()=>{
  changeDateJumpYear(1);
};

const dateJumpCancelButton=
  document.getElementById(
    "dateJumpCancel"
  );

if(dateJumpCancelButton){
  dateJumpCancelButton.onclick=()=>{
    closeDateJump();
  };
}

const dateJumpDoneButton=
  document.getElementById(
    "dateJumpDone"
  );

if(dateJumpDoneButton){
  dateJumpDoneButton.onclick=()=>{
    if(!dateJumpValue){
      return;
    }

    const nextCursor=
      dateJumpValue;

    const direction=
      nextCursor>dateCalendarCursor
        ? 1
        : nextCursor<dateCalendarCursor
          ? -1
          : 0;

    closeDateJump();

    if(direction===0){
      return;
    }

    changeDateCalendarMonth(
      nextCursor,
      direction
    );
  };
}

document.getElementById("dateJumpCurrent")?.addEventListener("click",()=>{
  if(dateJumpYearTransitionRunning){
    return;
  }

  const currentMonth=
    ymOf(new Date());

  const currentYear=
    Number(
      currentMonth.slice(0,4)
    );

  if(currentYear===dateJumpYear){
    dateJumpValue=
      currentMonth;

    drawDateJump();
    return;
  }

  dateJumpYearTransitionRunning=true;

  animatePickerYearChange({
    container:
      document.getElementById(
        "dateJump"
      ),

    grid:
      document.getElementById(
        "dateJumpMonths"
      ),

    label:
      document.getElementById(
        "dateJumpYear"
      ),

    direction:
      currentYear>dateJumpYear
        ? 1
        : -1,

    apply:()=>{
      dateJumpYear=
        currentYear;

      dateJumpValue=
        currentMonth;

      drawDateJump();
    },

    onFinish:()=>{
      dateJumpYearTransitionRunning=false;
    }
  });
});

document.getElementById("dateJumpMonths").onclick=e=>{
  const month=
    e.target.closest(
      "[data-calendar-month]"
    );

  if(!month){
    return;
  }

  dateJumpValue=
    month.dataset.calendarMonth;

  dateJumpYear=
    Number(
      dateJumpValue.slice(0,4)
    );

  drawDateJump();
};

const datePickerElement=
  document.getElementById("datePicker");

bindBottomSheetDismiss({
  element:datePickerElement,
  dragProperty:"--date-drag",
  close:closeDatePicker,
  onBegin:closeDateJump
});

const dateGrid=document.getElementById("dateGrid");

dateGrid.onclick=e=>{
  if(dateSwipeBlockClick) return;

  const day=
    e.target.closest(
      "[data-date]"
    );

  if(!day) return;

  const value=
    day.dataset.date;

  const nextCursor=
    value.slice(0,7);

  closeDateJump();

  if(
    nextCursor!==
    dateCalendarCursor
  ){
    changeDateCalendarMonth(
      nextCursor,
      nextCursor>dateCalendarCursor
        ? 1
        : -1,
      {value}
    );

    return;
  }

  datePickerValue=value;

  drawDatePicker();
};

dateGrid.addEventListener("pointerdown",e=>{
  if(
    !e.isPrimary ||
    e.pointerType==="mouse"
  ){
    return;
  }

  dateGrid.classList.remove("date-swiping");

  dateSwipe={
    id:e.pointerId,
    x:e.clientX,
    y:e.clientY
  };

  dateSwipeBlockClick=false;
  dateGrid.setPointerCapture(e.pointerId);
});

dateGrid.addEventListener("pointermove",e=>{
  if(!dateSwipe || e.pointerId!==dateSwipe.id) return;

  const dx=e.clientX-dateSwipe.x;
  const dy=e.clientY-dateSwipe.y;

  if(Math.abs(dx)>8 && Math.abs(dx)>Math.abs(dy)){
    dateSwipeBlockClick=true;
    dateGrid.classList.add("date-swiping");
    e.preventDefault();
  }
});

function finishDateSwipe(e){
  if(!dateSwipe || e.pointerId!==dateSwipe.id) return;

  const dx=e.clientX-dateSwipe.x;
  const dy=e.clientY-dateSwipe.y;

  if(dateGrid.hasPointerCapture(e.pointerId)){
    dateGrid.releasePointerCapture(e.pointerId);
  }

  dateSwipe=null;
  dateGrid.classList.remove("date-swiping");

  const accepted=
    Math.abs(dx)>=35 &&
    Math.abs(dx)>Math.abs(dy)*1.15;

  if(accepted){
    const direction=
      dx<0
        ? 1
        : -1;

    const nextCursor=
      shiftMonth(
        dateCalendarCursor,
        direction
      );

    closeDateJump();

    changeDateCalendarMonth(
      nextCursor,
      direction
    );

    dateSwipeBlockClick=true;
  }

  setTimeout(()=>{
    dateSwipeBlockClick=false;
  },250);
}

dateGrid.addEventListener("pointerup",finishDateSwipe);

dateGrid.addEventListener("pointercancel",e=>{
  dateSwipe=null;
  dateGrid.classList.remove("date-swiping");

  setTimeout(()=>{
    dateSwipeBlockClick=false;
  },250);
});

let dateWheelX=0;
let dateWheelY=0;
let dateWheelTimer=0;
let dateWheelGestureLocked=false;

dateGrid.addEventListener(
  "wheel",
  event=>{
    if(
      Math.abs(event.deltaX)<=
        Math.abs(event.deltaY)
    ){
      return;
    }

    dateWheelX+=event.deltaX;
    dateWheelY+=event.deltaY;

    window.clearTimeout(
      dateWheelTimer
    );

    dateWheelTimer=
      window.setTimeout(()=>{
        dateWheelX=0;
        dateWheelY=0;
        dateWheelGestureLocked=false;
      },140);

    if(dateWheelGestureLocked){
      if(event.cancelable){
        event.preventDefault();
      }

      return;
    }

    if(
      Math.abs(dateWheelX)<42 ||
      Math.abs(dateWheelX)<=
        Math.abs(dateWheelY)*1.12
    ){
      return;
    }

    if(event.cancelable){
      event.preventDefault();
    }

    const direction=
      dateWheelX>0
        ? 1
        : -1;

    dateWheelX=0;
    dateWheelY=0;
    dateWheelGestureLocked=true;

    changeDateCalendarMonth(
      shiftMonth(
        dateCalendarCursor,
        direction
      ),
      direction
    );
  },
  {passive:false}
);

document.getElementById("dateToday").onclick=()=>{
  const value=
    localYMD();

  const nextCursor=
    value.slice(0,7);

  closeDateJump();

  if(
    nextCursor!==
    dateCalendarCursor
  ){
    changeDateCalendarMonth(
      nextCursor,
      nextCursor>dateCalendarCursor
        ? 1
        : -1,
      {value}
    );

    return;
  }

  datePickerValue=value;

  drawDatePicker();
};

document.getElementById("dateCancel").onclick=()=>{
  closeDatePicker();
};

document.getElementById("dateDone").onclick=()=>{
  if(!datePickerValue) return;

  selectDate(datePickerValue);
};

document
  .getElementById(
    "employeeVeil"
  )
  .onclick=
    closeEmployeeEditor;

document
  .getElementById(
    "employeeSheetCancel"
  )
  .onclick=
    cancelEmployeeSheet;

document
  .getElementById(
    "employeeSheetSave"
  )
  .onclick=
    employeeSheetPrimaryAction;

document
  .getElementById(
    "employeeFilterVeil"
  )
  .onclick=
    closeEmployeeFilterSheet;

document
  .getElementById(
    "employeeFilterCancel"
  )
  .onclick=
    closeEmployeeFilterSheet;

document
  .getElementById(
    "employeeFilterDone"
  )
  .onclick=
    applyEmployeeFilter;

document
  .getElementById(
    "manageEditorVeil"
  )
  .onclick=
    closeManageEditor;

document
  .getElementById(
    "manageEditorCancel"
  )
  .onclick=
    closeManageEditor;

document
  .getElementById(
    "manageEditorSave"
  )
  .onclick=
    manageEditorPrimaryAction;

manageEditorSheetElement.addEventListener(
  "click",
  event=>{
    const button=
      event.target.closest(
        "button"
      );

    if(
      !button ||
      !manageEditorDraft
    ){
      return;
    }

    readManageEditor();

    if(button.id==="manageTariffDateOpen"){
      openDatePicker("tariff");
      return;
    }

    if(button.id==="manageTariffAdd"){
      manageEditorDraft.tariffOpen=
        !manageEditorDraft.tariffOpen;

      if(
        manageEditorDraft.tariffOpen
      ){
        const current=
          tariffForDate(
            teamData.tariffs,
            manageEditorDraft.point.id,
            localYMD()
          );

        manageEditorDraft.pricingType=
          current?.pricing_type ||
          "fixed";
        manageEditorDraft.fixedRate=
          current?.fixed_rate ||
          3000;
        manageEditorDraft.tiers=
          current?.shk_tiers
            ? current.shk_tiers.map(
                tier=>({...tier})
              )
            : defaultTariffTiers();
        manageEditorDraft.effectiveFrom=
          nextTariffEffectiveFrom(
            manageEditorDraft.point.id
          );
      }

      drawManageEditor();
      return;
    }

    if(
      button.dataset.pointActive!==
      undefined
    ){
      manageEditorDraft.active=
        button.dataset.pointActive==="1";
      drawManageEditor();
      return;
    }

    if(
      button.dataset.pointAdvance!==
      undefined
    ){
      manageEditorDraft.advanceEnabled=
        button.dataset.pointAdvance==="1";
      drawManageEditor();
      return;
    }

    if(button.dataset.pricingType){
      manageEditorDraft.pricingType=
        button.dataset.pricingType;
      drawManageEditor();
      return;
    }

    if(button.id==="tierAdd"){
      const final=
        manageEditorDraft.tiers.at(-1);

      const previous=
        manageEditorDraft.tiers.at(-2);

      manageEditorDraft.tiers.splice(
        -1,
        0,
        {
          up_to:
            (
              Number(previous?.up_to) ||
              0
            )+100,
          rate:
            Number(final?.rate) ||
            3000
        }
      );

      drawManageEditor();
      return;
    }

    if(
      button.dataset.tierRemove!==
      undefined
    ){
      manageEditorDraft.tiers.splice(
        Number(
          button.dataset.tierRemove
        ),
        1
      );
      drawManageEditor();
    }
  }
);

employeeFilterSheetElement.addEventListener(
  "click",
  event=>{
    const button=
      event.target.closest(
        "button"
      );

    if(
      !button ||
      !employeeFilterDraft
    ){
      return;
    }

    if(
      button.id===
      "employeeFilterReset"
    ){
      employeeFilterDraft={
        status:"active",
        pointIds:null
      };

      drawEmployeeFilterSheet();

      return;
    }

    if(
      button.dataset
        .employeeFilterStatus
    ){
      employeeFilterDraft.status=
        button.dataset
          .employeeFilterStatus;

      drawEmployeeFilterSheet();

      return;
    }

    if(
      button.dataset
        .employeeFilterPoint!==
      undefined
    ){
      const pointId=
        button.dataset
          .employeeFilterPoint;

      if(!pointId){
        employeeFilterDraft.pointIds=
          null;
      }else{
        const allIds=
          teamData.points.map(
            point=>point.id
          );

        const selected=
          employeeFilterDraft
            .pointIds===null
            ? new Set(allIds)
            : new Set(
                employeeFilterDraft
                  .pointIds
              );

        if(selected.has(pointId)){
          selected.delete(pointId);
        }else{
          selected.add(pointId);
        }

        employeeFilterDraft.pointIds=
          selected.size===allIds.length
            ? null
            : Array.from(selected);
      }

      drawEmployeeFilterSheet();
    }
  }
);

employeeSheetElement.addEventListener(
  "click",
  event=>{
    const button=
      event.target.closest(
        "button"
      );

    if(
      !button ||
      !employeeDraft
    ){
      return;
    }

    syncEmployeeDraftFromForm();

    if(
      button.id===
      "employeePasswordToggle"
    ){
      const field=
        document.getElementById(
          "employeePassword"
        );

      if(!field){
        return;
      }

      const visible=
        field.type==="text";

      field.type=
        visible
          ? "password"
          : "text";

      button.setAttribute(
        "aria-pressed",
        String(!visible)
      );

      button.setAttribute(
        "aria-label",
        visible
          ? "Показать пароль"
          : "Скрыть пароль"
      );

      field.focus({
        preventScroll:true
      });

      return;
    }

    if(
      button.id===
      "employeeDelete"
    ){
      void deleteEmployeeDraft();
      return;
    }

    if(
      button.dataset.employeeStatus
    ){
      employeeDraft.status=
        button.dataset.employeeStatus;

      employeeSheetElement
        .querySelectorAll(
          "[data-employee-status]"
        )
        .forEach(item=>{
          item.classList.toggle(
            "on",
            item.dataset.employeeStatus===
              employeeDraft.status
          );
        });

      return;
    }

    if(
      button.dataset.employeePoint
    ){
      const pointId=
        button.dataset.employeePoint;

      const selected=
        employeeDraft.pointIds
          .includes(pointId);

      employeeDraft.pointIds=
        selected
          ? employeeDraft.pointIds
              .filter(
                id=>
                  id!==pointId
              )
          : [
              ...employeeDraft.pointIds,
              pointId
            ];

      button.classList.toggle(
        "on",
        !selected
      );

      const check=
        button.querySelector(
          ".employee-point-check"
        );

      if(check){
        check.textContent=
          selected
            ? ""
            : "✓";
      }
    }
  }
);

bindBottomSheetDismiss({
  element:
    employeeSheetElement,

  dragProperty:
    "--sheet-drag",

  close:
    closeEmployeeEditor,

  canStart:target=>{
    if(
      target instanceof Element &&
      target.closest(
        ".grab,.shead"
      )
    ){
      return true;
    }

    return (
      employeeSheetElement
        .scrollTop<=0
    );
  }
});

bindBottomSheetDismiss({
  element:
    employeeFilterSheetElement,

  dragProperty:
    "--sheet-drag",

  close:
    closeEmployeeFilterSheet,

  canStart:target=>{
    if(
      target instanceof Element &&
      target.closest(
        ".grab,.shead"
      )
    ){
      return true;
    }

    return (
      employeeFilterSheetElement
        .scrollTop<=0
    );
  }
});

bindBottomSheetDismiss({
  element:
    manageEditorSheetElement,

  dragProperty:
    "--sheet-drag",

  close:
    closeManageEditor,

  canStart:target=>{
    if(
      target instanceof Element &&
      target.closest(
        ".grab,.shead"
      )
    ){
      return true;
    }

    return (
      manageEditorSheetElement
        .scrollTop<=0
    );
  }
});

const shiftSheet=
  document.getElementById("sheet");

bindBottomSheetDismiss({
  element:shiftSheet,
  dragProperty:"--sheet-drag",
  close:closeSheet,

  canStart:target=>{
    if(
      target instanceof Element &&
      target.closest(".grab,.shead")
    ){
      return true;
    }

    return shiftSheet.scrollTop<=0;
  }
});

const pointPicker=
  document.getElementById("pointPicker");

bindBottomSheetDismiss({
  element:pointPicker,
  dragProperty:"--point-drag",
  close:closePointPicker,

  canStart:target=>{
    if(!(target instanceof Element)){
      return true;
    }

    const list=
      target.closest(".point-list");

    return (
      !list ||
      list.scrollTop<=0
    );
  }
});

document.getElementById("sheetSave").onclick=async()=>{
  if(!isAdmin){
    return;
  }

  const button=document.getElementById("sheetSave");

  readForm();

  const error=validateDraft(draft);

  if(error){
    showValidationError(error);
    return;
  }

  const savedDraft=normalizedDraft(draft);

  button.disabled=true;

  try{
    await saveAdminShift(
      savedDraft
    );

    await refreshTeamData({
      renderAfter:false
    });

    cursor=savedDraft.date.slice(0,7);
    closeSheet();
    render();
    toast("Смена сохранена");
  }catch(error){
    console.error(
      "Не удалось сохранить смену:",
      error
    );

    toast(
      navigator.onLine
        ? error instanceof Error
          ? error.message
          : "Не удалось сохранить смену"
        : "Нет подключения. Смена не сохранена.",
      4400
    );
  }finally{
    button.disabled=false;
  }
};

document.getElementById("sheetBody").addEventListener("click",async e=>{
  const t=e.target.closest("button");

  if(!t || !draft) return;

  const isEdit=shifts.some(x=>x.id===draft.id);

  if(t.id==="f-date-open"){
    openDatePicker();
    return;
  }

  if(t.id==="f-employee-open"){
    readForm();
    openEmployeePicker();
    return;
  }

  if(t.id==="f-point-open"){
    readForm();
    openPointPicker();
    return;
  }

  if(t.dataset.adjustmentAdd){
    readForm();

    draft[
      t.dataset.adjustmentAdd
    ].push({
      id:createTeamId(),
      amount:"",
      comment:""
    });

    drawSheet(isEdit);
    saveUIState();
    return;
  }

  if(t.dataset.adjustmentRemove){
    readForm();

    const [kind,index]=
      t.dataset.adjustmentRemove
        .split(":");

    draft[kind].splice(
      Number(index),
      1
    );

    drawSheet(isEdit);
    saveUIState();
    return;
  }

  if(t.dataset.type){
    readForm();
    draft.type=t.dataset.type;
    drawSheet(isEdit);
    saveUIState();
  }

  else if(t.dataset.part){
    readForm();

    const nextPartial=
      t.dataset.part==="1";

    if(nextPartial && !draft.partial){
      draft.hours="";
    }

    draft.partial=nextPartial;
    drawSheet(isEdit);
    saveUIState();
  }

  else if(t.id==="f-del"){
    const confirmed=await appConfirm(
      "Удалить эту смену?",
      {
        okText:"Удалить",
        danger:true
      }
    );

    if(!confirmed) return;

    try{
      await deleteAdminShift(
        draft.id
      );

      await refreshTeamData({
        renderAfter:false
      });

      closeSheet();
      render();
      toast("Смена удалена");
    }catch(error){
      toast(
        navigator.onLine
          ? error instanceof Error
            ? error.message
            : "Не удалось удалить смену"
          : "Нет подключения. Смена не удалена.",
        4200
      );
    }
  }
});

document
  .getElementById("pointList")
  .addEventListener(
    "click",
    e=>{
      const option=
        e.target.closest(
          "[data-picker-value]"
        );

      if(!option){
        return;
      }

      pointPickerValue=
        option.dataset
          .pickerValue;

      document
        .querySelectorAll(
          "#pointList .point-option"
        )
        .forEach(button=>{
          const selected=
            button.dataset
              .pickerValue===
              pointPickerValue;

          button.classList.toggle(
            "on",
            selected
          );

          const check=
            button.querySelector(
              ".point-check"
            );

          if(check){
            check.textContent=
              selected ? "✓" : "";
          }
        });

      if(
        pointPicker.classList.contains(
          "app-picker-anchored"
        )
      ){
        applyPointPickerValue();
      }
    }
  );

document
  .getElementById("pointCancel")
  .onclick=()=>{
    closePointPicker();
  };

function applyPointPickerValue(){
    if(pointPickerKind==="stats-point"){
      statsPointId=
        pointPickerValue;

      closePointPicker();
      saveUIState();
      render();
      return;
    }

    if(pointPickerKind==="stats-employee"){
      if(!pointPickerValue){
        return;
      }

      statsEmployeeId=
        pointPickerValue;

      closePointPicker();
      saveUIState();
      render();
      return;
    }

    if(
      !draft ||
      !pointPickerValue
    ){
      return;
    }

    if(pointPickerKind==="employee"){
      const employee=
        shiftEmployeeOptions()
          .find(
            item=>
              item.id===
              pointPickerValue
          );

      if(!employee){
        return;
      }

      readForm();

      draft.employeeId=
        employee.id;
      draft.dbPointId="";

      const point=
        shiftPointOptions(draft)[0] ||
        null;

      draft.dbPointId=
        point?.id || "";
      draft.pointId=
        point?.code ||
        point?.id || "";
      draft.point=
        point?.name ||
        "ПВЗ не назначен";
      draft.shk="";

      closePointPicker();

      drawSheet(
        shifts.some(
          item=>
            item.id===draft.id
        )
      );
      saveUIState();
      return;
    }

    const wasFixed=
      previewCalc(draft).fixed;

    readForm();

    const point=
      teamData.points.find(
        item=>
          item.id===pointPickerValue
      );

    if(!point){
      return;
    }

    draft.dbPointId=point.id;
    draft.pointId=
      point.code || point.id;
    draft.point=point.name;

    const nowFixed=
      previewCalc(draft).fixed;

    if(nowFixed){
      draft.shk=0;
    }else if(wasFixed){
      draft.shk="";
    }

    closePointPicker();

    const isEdit=
      shifts.some(
        x=>x.id===draft.id
      );

    drawSheet(isEdit);
    saveUIState();
}

document
  .getElementById("pointDone")
  .onclick=applyPointPickerValue;

document.getElementById("sheetBody").addEventListener("input",e=>{
  if(e.target.id==="f-hours"){
    const maxHours=
      FULL_HOURS-0.5;

    let value=
      e.target.value
        .replace(/\./g,",")
        .replace(/[^\d,]/g,"");

    const commaIndex=
      value.indexOf(",");

    if(commaIndex>=0){
      value=
        value.slice(
          0,
          commaIndex+1
        )+
        value
          .slice(
            commaIndex+1
          )
          .replace(/,/g,"")
          .slice(0,1);
    }

    const numericValue=
      Number(
        value.replace(",",".")
      );

    if(
      value &&
      !value.endsWith(",") &&
      Number.isFinite(numericValue) &&
      numericValue>maxHours
    ){
      value=
        String(maxHours)
          .replace(".",",");
    }

    e.target.value=value;
  }

  if(
    e.target.matches(
      "[data-adjustment-amount]"
    )
  ){
    let value=
      e.target.value
        .replace(/\./g,",")
        .replace(/[^\d,]/g,"");

    const commaIndex=
      value.indexOf(",");

    if(commaIndex>=0){
      value=
        value.slice(
          0,
          commaIndex+1
        )+
        value
          .slice(
            commaIndex+1
          )
          .replace(/,/g,"")
          .slice(0,2);
    }

    e.target.value=value;
  }

  if(
    [
      "f-shk",
      "f-hours"
    ].includes(e.target.id) ||
    e.target.matches(
      "[data-adjustment-amount]"
    )
  ){
    readForm();

    const box=
      document.getElementById(
        "calcBox"
      );

    if(box){
      box.innerHTML=
        calcHTML();
    }

    saveUIState();
  }

  if(e.target.id==="f-note"){
    readForm();
    saveUIState();
  }
});

function moveFieldCaretToEnd(field){
  const allowed=[
    "f-shk",
    "f-hours"
  ];

  if(
    !field ||
    !allowed.includes(field.id) &&
    !field.matches?.(
      "[data-adjustment-amount]"
    ) ||
    field.value===""
  ){
    return;
  }

  setTimeout(()=>{
    if(document.activeElement!==field) return;

    const value=field.value;

    try{
      field.setSelectionRange(
        value.length,
        value.length
      );
    }catch{
      /*
        Для input type="number" iPhone
        не всегда разрешает setSelectionRange.
        Повторная установка значения
        переносит курсор в конец.
      */
      field.value="";
      field.value=value;
    }
  },0);
}

const sheetBody=
  document.getElementById("sheetBody");

sheetBody.addEventListener("focusin",e=>{
  moveFieldCaretToEnd(e.target);
});

sheetBody.addEventListener("click",e=>{
  moveFieldCaretToEnd(e.target);
});

function updateEmployeeDraftField(
  target
){
  if(
    !employeeDraft ||
    !(target instanceof HTMLElement)
  ){
    return;
  }

  if(target.id==="employeeName"){
    employeeDraft.fullName=
      target.value;
  }

  if(target.id==="employeeAccount"){
    employeeDraft.userId=
      target.value ||
      null;
  }

  if(target.id==="employeeEmail"){
    employeeDraft.email=
      target.value;
  }

  if(target.id==="employeePhone"){
    employeeDraft.phone=
      target.value;
  }

  if(target.id==="employeeTransferPhone"){
    employeeDraft.transferPhone=
      target.value;
  }

  if(target.id==="employeeTransferBank"){
    employeeDraft.transferBank=
      target.value;
  }

  if(target.id==="employeeTransferRecipient"){
    employeeDraft.transferRecipient=
      target.value;
  }

  if(target.id==="employeePassword"){
    employeeDraft.password=
      target.value;
  }
}

function syncEmployeeDraftFromForm(){
  employeeSheetElement
    .querySelectorAll(
      "input,select"
    )
    .forEach(
      updateEmployeeDraftField
    );
}

employeeSheetElement.addEventListener(
  "input",
  event=>{
    updateEmployeeDraftField(
      event.target
    );
  }
);

employeeSheetElement.addEventListener(
  "change",
  event=>{
    updateEmployeeDraftField(
      event.target
    );
  }
);

app.addEventListener(
  "input",
  event=>{
    if(
      !(
        event.target instanceof
        HTMLInputElement
      ) ||
      event.target.id!==
        "employeeSearch"
    ){
      return;
    }

    employeeSearchQuery=
      event.target.value;

    updateEmployeeList();
  }
);

app.addEventListener("click",async event=>{
  const row=event.target.closest("[data-edit]");
  if(row){
    openSheet(row.dataset.edit);
    return;
  }

  const button=event.target.closest("button");
  if(!button) return;

  if(button.id==="statsPointOpen"){
    openStatsPointPicker();
    return;
  }

  if(button.id==="statsEmployeeOpen"){
    openStatsEmployeePicker();
    return;
  }

  if(
    [
      "employeeRetry",
      "pointRetry",
      "serverRetry"
    ].includes(button.id)
  ){
    await refreshTeamData();
    return;
  }

  if(
    button.id==="pointAdd" &&
    isAdmin &&
    tab==="manage"
  ){
    openManageEditor("point");
    return;
  }

  if(
    button.dataset.pointId &&
    isAdmin &&
    tab==="manage"
  ){
    openManageEditor(
      "point",
      button.dataset.pointId
    );
    return;
  }

  if(
    button.id==="employeeFilterOpen" &&
    isAdmin &&
    tab==="manage" &&
    manageSection==="employees"
  ){
    openEmployeeFilterSheet();
    return;
  }

  if(
    button.id==="employeeAdd" &&
    isAdmin &&
    tab==="manage"
  ){
    openEmployeeEditor();
    return;
  }

  if(
    button.dataset.employeeId &&
    isAdmin &&
    tab==="manage"
  ){
    openEmployeeEditor(
      button.dataset.employeeId
    );

    return;
  }

  if(
    button.dataset.manageSection &&
    isAdmin &&
    tab==="manage"
  ){
    changeManageSection(
      button.dataset.manageSection,
      1
    );

    return;
  }

  if(
    button.id==="manageBack" &&
    isAdmin &&
    tab==="manage"
  ){
    changeManageSection(
      "home",
      -1
    );

    return;
  }

  if(button.id==="shiftAdd"){
    openSheet(null);
    return;
  }

  if(button.id==="doExport"){
    downloadText(exportEnvelopeJson(),backupFilename());
    toast("Экспорт скачан");
    return;
  }

  if(button.id==="doLegacyExport"){
    if(loadError){
      const raw=(loadError instanceof StorageCorruptError && loadError.raw)
        ? loadError.raw
        : store.getCurrentRaw();

      if(raw){
        downloadText(
          raw,
          `shift-register-legacy-raw-${localYMD()}.json`
        );
      }
    }else{
      downloadText(
        exportLegacyJson(),
        `shift-register-legacy-${localYMD()}.json`
      );
    }

    toast("Локальная копия скачана");
    return;
  }

  if(
    button.id==="doLegacyMigrate" &&
    isAdmin &&
    !legacyMigrationRunning
  ){
    const employee=teamData.employees.find(
      item=>item.id===legacyMigrationEmployeeId
    );

    if(!employee){
      toast("Выберите сотрудника",3000);
      return;
    }

    let payloads;

    try{
      payloads=legacyShifts.map(source=>
        legacyShiftPayload({
          source,
          employeeId:employee.id,
          points:teamData.points
        })
      );
    }catch(error){
      toast(
        error instanceof Error
          ? error.message
          : "Локальные смены не прошли проверку",
        4400
      );
      return;
    }

    const confirmed=await appConfirm(
      `Перенести ${shiftsAccWord(payloads.length)}?`,
      {
        okText:"Перенести",
        detail:`Сотрудник: ${employee.full_name}. Перед импортом будет скачана локальная резервная копия.`
      }
    );

    if(!confirmed){
      return;
    }

    downloadText(
      exportLegacyJson(),
      `shift-register-legacy-before-import-${localYMD()}.json`
    );

    legacyMigrationRunning=true;
    legacyMigrationProgress=
      `0 из ${payloads.length}`;
    render();

    try{
      await importAdminLegacyShifts(
        payloads,
        {
          onProgress:({completed,total})=>{
            legacyMigrationProgress=
              `${completed} из ${total}`;

            const progress=
              document.querySelector(
                ".manage-loading"
              );

            if(progress){
              progress.textContent=
                legacyMigrationProgress;
            }
          }
        }
      );

      await refreshTeamData({
        renderAfter:false
      });

      legacyMigrationProgress=
        `Перенесено: ${payloads.length}. Локальный источник сохранён.`;
      toast("Локальные смены перенесены");
    }catch(error){
      legacyMigrationProgress=
        "Импорт остановлен. Локальный источник не изменён; повторный запуск безопасен.";
      toast(
        navigator.onLine
          ? error instanceof Error
            ? error.message
            : "Не удалось перенести смены"
          : "Нет подключения. Локальные смены не удалены.",
        4600
      );
    }finally{
      legacyMigrationRunning=false;
      render();
    }

    return;
  }

  if(button.id==="doRawExport"){
    const raw=(loadError instanceof StorageCorruptError && loadError.raw)
      ? loadError.raw
      : store.getCurrentRaw();

    if(!raw){
      toast("Исходные данные отсутствуют");
      return;
    }

    downloadText(raw,`shift-register-raw-${localYMD()}.json`);
    toast("Исходные данные скачаны");
    return;
  }


  if(button.id==="doSignOut"){
    const confirmed=await appConfirm(
      "Выйти из аккаунта?",
      {
        okText:"Выйти"
      }
    );

    if(!confirmed) return;

    try{
      await signOut();
    }catch(error){
      console.error(
        "Не удалось выйти:",
        error
      );

      toast(
        "Не удалось выйти из аккаунта",
        3200
      );
    }

    return;
  }

});

app.addEventListener("change",event=>{
  if(event.target.id==="legacyEmployee"){
    legacyMigrationEmployeeId=
      event.target.value;
  }
});

let scrollTimer;
document.getElementById("app").addEventListener("scroll",()=>{
  clearTimeout(scrollTimer);
  scrollTimer=setTimeout(saveUIState,150);
},{
  passive:true,
  capture:true
});

let sheetScrollTimer;
document.getElementById("sheet").addEventListener("scroll",()=>{
  clearTimeout(sheetScrollTimer);
  sheetScrollTimer=setTimeout(saveUIState,150);
},{passive:true});

window.addEventListener("pagehide",saveUIState);
document.addEventListener("freeze",saveUIState);

window.addEventListener("pageshow",()=>{
  const ui=loadUIState();

  setPageScrollTop(
    ui.scrollY || 0
  );
});

window.addEventListener(
  "online",
  ()=>{
    void refreshTeamData();
  }
);

if("serviceWorker" in navigator){
  window.addEventListener("load",async()=>{
    try{
      const registration=
        await navigator.serviceWorker.register(
          "./sw.js",
          {
            updateViaCache:"none"
          }
        );

      /*
        Проверяем только сам service worker.
        CSS/JS при обычном открытии всё равно
        берутся network-first.
      */
      await registration.update();
    }catch(error){
      console.error(
        "Service worker не зарегистрирован:",
        error
      );
    }
  });

  document.addEventListener(
    "visibilitychange",
    async()=>{
      if(
        document.visibilityState!=="visible"
      ){
        saveUIState();
        return;
      }

      try{
        const registration=
          await navigator.serviceWorker
            .getRegistration();

        await registration?.update();
      }catch(error){
        console.error(
          "Не удалось проверить service worker:",
          error
        );
      }
    }
  );
}

let touchActiveState=null;
let touchActiveReleaseTimer=null;

function clearTouchActive(){
  if(touchActiveState){
    clearTimeout(touchActiveState.timer);

    touchActiveState.element.classList.remove(
      "touch-active"
    );

    touchActiveState=null;
  }

  clearTimeout(touchActiveReleaseTimer);
  touchActiveReleaseTimer=null;

  document
    .querySelectorAll(".touch-active")
    .forEach(element=>{
      element.classList.remove("touch-active");
    });
}

document.addEventListener("pointerdown",e=>{
  if(
    !e.isPrimary ||
    e.pointerType==="mouse"
  ){
    return;
  }

  const element=e.target.closest(
    "button:not(:disabled)," +
    ".period.clickable," +
    ".sh"
  );

  if(!element) return;

  clearTouchActive();

  const state={
    id:e.pointerId,
    element,
    x:e.clientX,
    y:e.clientY,
    timer:null
  };

  state.timer=setTimeout(()=>{
    if(touchActiveState===state){
      element.classList.add("touch-active");
    }
  },80);

  touchActiveState=state;
});

document.addEventListener("pointermove",e=>{
  const state=touchActiveState;

  if(
    !state ||
    e.pointerId!==state.id
  ){
    return;
  }

  const dx=e.clientX-state.x;
  const dy=e.clientY-state.y;

  if(Math.hypot(dx,dy)<8) return;

  clearTouchActive();
});

document.addEventListener("pointerup",e=>{
  const state=touchActiveState;

  if(
    !state ||
    e.pointerId!==state.id
  ){
    return;
  }

  clearTimeout(state.timer);
  touchActiveState=null;

  const dx=e.clientX-state.x;
  const dy=e.clientY-state.y;

  if(Math.hypot(dx,dy)>=8){
    state.element.classList.remove(
      "touch-active"
    );

    return;
  }

  state.element.classList.add("touch-active");

  clearTimeout(touchActiveReleaseTimer);

  touchActiveReleaseTimer=setTimeout(()=>{
    state.element.classList.remove(
      "touch-active"
    );

    touchActiveReleaseTimer=null;
  },110);
});

document.addEventListener("pointercancel",e=>{
  if(
    !touchActiveState ||
    e.pointerId!==touchActiveState.id
  ){
    return;
  }

  clearTouchActive();
});

document.addEventListener(
  "scroll",
  clearTouchActive,
  true
);

window.addEventListener(
  "blur",
  clearTouchActive
);

startAuth({
  onAuthenticated:async({
    freshLogin,
    profile,
    user
  })=>{
    currentUser=user;
    currentProfile=profile;

    isAdmin=
      profile.role==="admin";

    document
      .getElementById(
        "tab-manage"
      )
      .hidden=!isAdmin;

    if(
      !isAdmin &&
      tab==="manage"
    ){
      tab="shifts";
      manageSection="home";
    }

    const loginEntry=
      safeSessionGet(
        LOGIN_ENTRY_KEY
      )==="1";

    if(
      freshLogin ||
      loginEntry
    ){
      tab="shifts";
      manageSection="home";

      safeSessionRemove(
        UI_KEY
      );
    }

    if(loginEntry){
      safeSessionRemove(
        LOGIN_ENTRY_KEY
      );

      document.body.classList.add(
        "auth-login-entering"
      );
    }

    await load();
    void startAutomaticSync();
  }
});
