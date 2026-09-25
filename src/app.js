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
} from "./config.js?shell=7";

import {
  DataValidationError,
  calc as domainCalc,
  inMonth as domainInMonth,
  isPlainObject,
  isValidDateString,
  payouts as domainPayouts
} from "./domain.js?shell=7";

import {
  BACKUP_KEY,
  CHANNEL_NAME,
  DB_KEY,
  LEGACY_DB_KEY,
  StorageCorruptError,
  createAppStorage
} from "./storage.js?shell=7";

import {
  signOut,
  startAuth
} from "./auth.js";

import {
  normalizePhone,
  optionalPhone,
  phoneLabel
} from "./phone.js?shell=7";

import {
  addAdminEmployeeRate,
  addAdminTariff,
  deleteAdminEmployee,
  deleteAdminEmployeeRate,
  deleteAdminPayout,
  deleteAdminPointWithHistory,
  deleteAdminTariff,
  deleteAdminShift,
  importAdminLegacyShifts,
  loadTeamData,
  rollbackAdminEmployeeCreation,
  saveAdminEmployee,
  saveAdminEmployeeAuth,
  saveAdminPoint,
  saveAdminPayout,
  repriceAdminShift,
  saveAdminShift,
  subscribeTeamChanges,
  updateAdminEmployeeRate,
  updateAdminTariff
} from "./team.js?shell=7";

import {
  calculateBaseAmount,
  createPricingSnapshot,
  createTeamId,
  legacyShiftPayload,
  normalizeShkTiers,
  pricingDriversChanged,
  rateForTariff,
  shiftEmployeeChoices,
  shiftRateForDate,
  shiftPointChoices,
  sortPointsAlphabetically,
  tariffForDate
} from "./team-domain.js?shell=7";

import {
  initManageSwipe
} from "./manage-swipe.js";

import {
  positionAppPicker,
  resetAppPickerPosition
} from "./picker-position.js";

import {
  createWheelGesture
} from "./wheel-gesture.js";

import {
  fieldRevealHTML,
  REVEAL_DURATION
} from "./field-reveal.js";

import {
  installInputBehavior
} from "./ui/input-behavior.js";

import {
  patchChildren
} from "./render/dom-patch.js";

import {
  createDeferredRender,
  whenAnimationsSettle
} from "./render/schedule.js";

import {
  installPwa
} from "./pwa.js";

import {
  formatAmount,
  formatMoney,
  formatNumber,
  plural
} from "./format.js";

import {
  pointEmployeeSummary,
  pointTariffSummary
} from "./point-summary.js";

import {
  assertCurrentTariffDate,
  assertNewTariffDate,
  assertTariffVersionDate,
  tariffIntentHelp,
  tariffIntentUpdatesRecord
} from "./tariff-rules.js";

import {
  employeeSearchText,
  filterChoiceOptions,
  filterOptionSelected,
  filterMonthShifts,
  paymentProgress,
  toggleFilterSelection
} from "./workflow.js?shell=7";

import {
  SHIFT_VIEW_MODES,
  afterShiftViewRender,
  calendarViewHTML,
  controlViewHTML,
  installShiftViewChips,
  shiftViewSwitcherHTML
} from "./shift-views.js";

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
let shiftSheetMode="create";
let shiftOriginalDraft=null;

/*
  Дата, пункт и сотрудник раскрываются внутри карточки «Смена». Открытой
  может быть только одна строка: две раскрытые подряд превращают карточку
  в ленту и теряют связь с тем, что человек сейчас выбирает.
*/
let shiftInlineField=null;
let shiftInlineQuery="";
let shiftDateCursor="";
let shiftDateJumpOpen=false;
let shiftDateJumpYear=0;

function resetShiftInline(){
  shiftInlineField=null;
  shiftInlineQuery="";
  shiftDateJumpOpen=false;
  adjustmentEntering.clear();
  adjustmentLeaving.clear();
}

/*
  Премии и штрафы появляются и исчезают тем же раскрытием, что и
  продолжения плиток.

  Переходное состояние держится по идентификатору строки, а не флагом
  внутри самой записи: черновик целиком уходит в сохранение и посимвольно
  сравнивается с исходным, когда приложение решает, были ли правки, —
  служебный флаг в записи попал бы и туда, и в базу.

  Добавленная строка рисуется свёрнутой и раскрывается следующим кадром.
  Удаляемая сначала сворачивается и только после перехода уходит из
  черновика: иначе сворачивать было бы нечего.
*/
const adjustmentEntering=new Set();
const adjustmentLeaving=new Set();
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
  employeeRates:[],
  shifts:[],
  payouts:[],
  employee:null,
  linked:true,
  archived:false
};

let teamDataLoaded=false;
let teamDataLoading=false;
let teamDataError=null;

let employeeDraft=null;
let employeeSaving=false;

/*
  Редактор индивидуальной ставки внутри карточки сотрудника.

  Держит одну открытую ставку: пару «сотрудник + ПВЗ», саму запись (если
  правится существующая) и её поля. Ставка живёт рядом с назначением на
  ПВЗ, потому что это условие работы именно на этом пункте, а не свойство
  человека вообще.

  Редактор задаёт фиксированную ставку — ровно ту договорённость, ради
  которой он и нужен: «здесь этот сотрудник работает за столько». Таблица
  и сервер принимают и ступени по ШК, как у тарифа ПВЗ, но заводить их
  руками пока негде: для этого нет ни одного живого случая.
*/
let employeeRateEditor=null;
let employeeRateSaving=false;
let employeeSheetMode="create";
let employeeSheetPreviousFocus=null;

let employeeSearchQuery="";
let employeeStatusFilter="active";
let employeePointFilter=null;
let pointStatusFilter="active";
let pointSearchQuery="";
let pointAdvanceFilter="all";
let employeeFilterDraft=null;
let employeeFilterSheetPreviousFocus=null;
let shiftSearchQuery="";
let shiftFilter={
  pointIds:null,
  employeeIds:null,
  fromDay:1,
  toDay:31,
  period:"all"
};
let shiftFilterDraft=null;
let shiftFilterSheetPreviousFocus=null;
let expandedPayoutKind="";
let payoutEditor=null;
let payoutSaving=false;
let legacyMigrationEmployeeId="";
let legacyMigrationRunning=false;
let legacyMigrationProgress="";
let statsEmployeeId="";

/*
  Список сотрудников для итогов раскрывается внутри своей плитки, поэтому
  его состояние живёт рядом с выбранным значением, а не в отдельном окне.
*/
let statsEmployeeOpen=false;
let statsEmployeeQuery="";
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

const shiftFilterSheetElement=
  document.getElementById(
    "shiftFilterSheet"
  );

const manageEditorSheetElement=
  document.getElementById(
    "manageEditorSheet"
  );

installInputBehavior();

function availableTabs(){
  return isAdmin
    ? ADMIN_TABS
    : BASE_TABS;
}

/*
  Перерисовка откладывается, пока идёт переход между вкладками, месяцами
  или разделами управления: иначе экран меняется под запущенной анимацией.
  Ожидание одно, идёт по кадрам и ограничено сверху — см. render/schedule.js.
*/
function transitionsRunning(){
  return (
    tabTransitionRunning ||
    monthTransitionRunning ||
    manageTransitionRunning
  );
}

const renderWhenReady=createDeferredRender({
  shouldDefer:transitionsRunning,
  render:()=>render()
});

/*
  Навигация во время идущего перехода раньше молча игнорировалась:
  быстрый повторный тап по вкладке, месяцу или кнопке «назад» просто
  пропадал. Последнее намерение запоминается и выполняется, как только
  анимация завершится.
*/
let pendingNavigation=null;

function queueNavigation(run,{month=null}={}){
  pendingNavigation={run,month};
}

/*
  Последний тап отменяет то, что стоит в очереди, даже если сам никуда не
  ведёт.

  Пока идёт переход, tab и manageSection ещё прежние, поэтому тап по
  разделу, в котором человек визуально уже стоит, выглядел повтором и
  молча пропадал. В очереди при этом оставался предыдущий выбор, и через
  полсекунды экран уезжал туда — против последнего, самого свежего
  намерения. «Смены → Данные → Управление → Смены» подряд уводили в
  «Управление».

  Месяцы сюда не входят: их шаги складываются (три «вперёд» — три месяца
  вперёд), и очередь там хранит накопленную цель, а не отменяемый пункт.
*/
function dropPendingNavigation(){
  pendingNavigation=null;
}

function runPendingNavigation(){
  const next=pendingNavigation;

  if(!next){
    return;
  }

  /*
    Переходы накладываются друг на друга: месяц ещё листается, когда уже
    заканчивается переход вкладки. Намерение при этом снималось с очереди
    и выбрасывалось — последний тап терялся ровно в тот момент, ради
    которого очередь и заведена. Ждём: очередь разберёт тот переход,
    который закончится последним, а его конец всегда вызывает эту
    функцию.
  */
  if(transitionsRunning()){
    return;
  }

  pendingNavigation=null;
  next.run();
}

function monthOffset(from,to){
  const [fromYear,fromMonth]=from.split("-").map(Number);
  const [toYear,toMonth]=to.split("-").map(Number);

  return (toYear-fromYear)*12+(toMonth-fromMonth);
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
      statsEmployeeId &&
      !statsEmployeeOptions()
        .some(
          employee=>
            employee.id===
            statsEmployeeId
        )
    ){
      statsEmployeeId="";
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

let lastSavedUIState="";

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

    const serialized=JSON.stringify({
      tab,
      cursor,
      scrollY:pageScrollTop(),
      sheetOpen,
      sheetScrollTop:sheetOpen && sheet ? sheet.scrollTop : 0,
      draft:sheetOpen ? draft : null,
      manageSection
    });

    /*
      Рендер вызывается на каждое нажатие клавиши в поиске, а запись в
      sessionStorage синхронная. Повторять её без изменений незачем.
    */
    if(serialized===lastSavedUIState){
      return;
    }

    lastSavedUIState=serialized;
    safeSessionSet(UI_KEY,serialized);
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

/* Без года: в списке выбранных дат он повторялся бы у каждой. */
function shortDateLabel(ymd){
  const [,month,day]=ymd.split("-").map(Number);
  return day+" "+MONTHS_G[month-1];
}


function esc(value){
  return String(value??"").replace(/[&<>\"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[char]));
}

/*
  Единственная точка, через которую разметка попадает в живой DOM.
  Реконсилятор применяет её как правки, поэтому рендер не сбрасывает
  фокус, каретку, прокрутку и не отбирает у пальца нажатый элемент.
*/
function setHTML(element,html){
  if(element){
    patchChildren(element,html);
  }
}

function hoursWord(hours){
  return Number(hours)+" ч";
}

const nf=formatNumber;
const nfMoney=formatAmount;
const money=formatMoney;

const shiftsWord=n=>plural(n,["смена","смены","смен"]);
const datesWord=n=>plural(n,["дата","даты","дат"]);
const shiftsAccWord=n=>plural(n,["смену","смены","смен"]);
const partialShortWord=n=>plural(n,["неполная","неполные","неполных"]);

const extraPartialShortWord=n=>plural(
  n,
  ["доп. неполная","доп. неполные","доп. неполных"]
);

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
let appConfirmExpected=null;
let appConfirmPreviousFocus=null;
let toastTimer=null;

function focusableElements(container){
  return Array.from(container.querySelectorAll(
    'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )).filter(element=>!element.hidden && element.getClientRects().length>0);
}

function activeModal(){
  const ids=["appConfirm","datePicker","pointPicker","monthPicker","manageEditorSheet","shiftFilterSheet","employeeFilterSheet","employeeSheet","sheet"];
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

/*
  Лист забирает фокус на следующем кадре после открытия. Если человек успел
  коснуться поля внутри листа раньше, чем этот кадр наступил, фокус остаётся
  у него: иначе ввод продолжается в поле без фокуса, а реконсилятор при
  следующей перерисовке берёт значение такого поля из разметки — набранное
  пропадало вместе с ним.
*/
function focusSheetSurface(sheet){
  if(
    sheet.contains(
      sheet.ownerDocument.activeElement
    )
  ){
    return;
  }

  sheet.focus({
    preventScroll:true
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

  document.getElementById("appConfirmOk").disabled=false;
  appConfirmExpected=null;

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

/*
  `confirm` — имя, которое нужно набрать, чтобы кнопка ожила. Для
  необратимых действий одной кнопки мало: по ней промахиваются, а по
  набранному вручную имени — нет. Заодно человек видит, что именно
  удаляет, и не путает соседние записи.
*/
function appConfirm(message,{
  okText="Подтвердить",
  danger=false,
  detail="",
  confirm=null,
  confirmLabel="Введите название для подтверждения"
}={}){
  const modal=document.getElementById("appConfirm");
  const title=document.getElementById("appConfirmTitle");
  const detailElement=document.getElementById("appConfirmDetail");
  const check=document.getElementById("appConfirmCheck");
  const checkLabel=document.getElementById("appConfirmCheckLabel");
  const input=document.getElementById("appConfirmInput");
  const ok=document.getElementById("appConfirmOk");
  const cancel=document.getElementById("appConfirmCancel");

  appConfirmPreviousFocus=document.activeElement;
  title.textContent=message;
  detailElement.textContent=detail;
  detailElement.hidden=!detail;
  ok.textContent=okText;
  ok.classList.toggle("danger",danger);

  appConfirmExpected=
    confirm
      ? String(confirm).trim().toLocaleLowerCase("ru-RU")
      : null;

  check.hidden=!confirm;
  checkLabel.textContent=confirmLabel;
  input.value="";
  input.placeholder=confirm || "";
  ok.disabled=Boolean(confirm);

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

document
  .getElementById("manageBack")
  .addEventListener("click",()=>{
    if(isAdmin && tab==="manage"){
      changeManageSection("home",-1);
    }
  });

document.getElementById("appConfirmCancel").addEventListener("click",()=>closeAppConfirm(false));
document.getElementById("appConfirmOk").addEventListener("click",()=>closeAppConfirm(true));

document
  .getElementById("appConfirmInput")
  .addEventListener("input",event=>{
    if(appConfirmExpected===null){
      return;
    }

    document.getElementById("appConfirmOk").disabled=
      event.target.value
        .trim()
        .toLocaleLowerCase("ru-RU")!==
      appConfirmExpected;
  });

/* Enter в поле подтверждения работает как нажатие живой кнопки. */
document
  .getElementById("appConfirmInput")
  .addEventListener("keydown",event=>{
    if(event.key!=="Enter"){
      return;
    }

    event.preventDefault();

    if(!document.getElementById("appConfirmOk").disabled){
      closeAppConfirm(true);
    }
  });
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
  if(document.getElementById("shiftFilterSheet").classList.contains("on")) return closeShiftFilterSheet();
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
          : undefined,
      payouts:
        isAdmin
          ? teamData.payouts
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

initManageSwipe({app});

/* Прокрутка ленты ПВЗ в календаре: колесо, стрелки, жест. */
installShiftViewChips(app);

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

  /*
    В подразделе управления шапка показывает «назад» вместо стрелки
    месяца — в том же слоте, поэтому заголовок остаётся по центру.
  */
  const manageDetail=
    isAdmin &&
    tab==="manage" &&
    manageSection!=="home";

  /*
    Флаг живёт на самом #app: слепок экрана при переходе копирует его вместе
    с разметкой и сохраняет геометрию старого экрана.
  */
  if(manageDetail){
    app.dataset.manageDetail="true";
  }else{
    delete app.dataset.manageDetail;
  }

  document.getElementById(
    "manageBack"
  ).hidden=!manageDetail;

  document.querySelectorAll("#prevM,#nextM").forEach(button=>{
    button.classList.toggle(
      "is-hidden",
      !monthTab
    );
  });

  document.getElementById("prevM").hidden=
    manageDetail;

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

  /*
    shifts-layout — нерастущая раскладка реестра: список подгоняется под
    остаток высоты, и страница не прокручивается. Календарю и контролю
    она не подходит — у них высота своя, и страница должна прокручиваться
    как везде.
  */
  app.classList.toggle(
    "shifts-layout",
    tab==="shifts" &&
    shiftViewMode==="registry"
  );

  setHTML(
    app,
    tab==="shifts"
      ? viewShifts()
      : tab==="stats"
        ? viewStats()
        : tab==="manage"
          ? viewManage()
          : viewData()
  );

  requestAnimationFrame(
    fitShiftWindow
  );

  /*
    Состояние ленты ПВЗ считается по готовой разметке: помещается ли она,
    видны ли стрелки, не уехал ли выбранный пункт за край.
  */
  requestAnimationFrame(()=>
    afterShiftViewRender(app)
  );
}

/*
  Окно снимается с экрана после того, как движение закончилось, а не под
  конец него: контракт выезжающих поверхностей — 480мс на сдвиг.
*/
const MODAL_HIDE_DELAY=520;

/*
  Подогнанная высота списка смен — инлайновая геометрия, которую ставит
  рантайм. Снимать её нужно с того узла, которому она была поставлена, а не
  с того, что сейчас подходит под селектор: реконсилятор переиспользует узлы,
  и после удаления последней смены этот же узел становится карточкой
  «В этом месяце смен пока нет» — уже без класса .shift-window. Прежний
  код искал .shift-window заново, не находил его и оставлял чужую высоту:
  карточка пустого списка была на 16px ниже, чем при первом открытии.
*/
let fittedShiftFrame=null;

/*
  Подгонка — инлайновая высота, и она устаревает.

  Окно списка растягивается флексом, но подогнанная высота прибивает его
  к числу строк, помещавшихся в момент последней отрисовки. Когда окно
  становится выше — при изменении размера, входе и выходе из полноэкранного
  режима — флекс уже даёт место, а прибитая высота его не отдаёт: под
  последней сменой остаётся пустой участок до нижней панели. Когда окно
  становится ниже, та же высота уводит список под панель. Снималось это
  только следующей перерисовкой, отсюда и «внезапно занял место».

  Поэтому за доступной высотой следит наблюдатель: подгонка пересчитывается
  тогда же, когда меняется место под список. Наблюдаем контейнер, а не само
  окно списка: его высоту флекс держит независимо от подогнанной, поэтому
  пересчёт не может вызвать сам себя.
*/
let shiftFitObserver=null;
let observedShiftArea=null;
let shiftFitFrame=0;

function queueShiftWindowFit(){
  if(shiftFitFrame){
    return;
  }

  shiftFitFrame=
    requestAnimationFrame(()=>{
      shiftFitFrame=0;
      fitShiftWindow();
    });
}

function observeShiftWindowArea(area){
  if(
    typeof ResizeObserver!=="function" ||
    area===observedShiftArea
  ){
    return;
  }

  if(!shiftFitObserver){
    shiftFitObserver=
      new ResizeObserver(
        queueShiftWindowFit
      );
  }

  shiftFitObserver.disconnect();
  observedShiftArea=area;

  if(area){
    shiftFitObserver.observe(area);
  }
}

function releaseShiftWindowFit(){
  if(!fittedShiftFrame){
    return;
  }

  fittedShiftFrame.style.removeProperty(
    "flex"
  );

  fittedShiftFrame.style.removeProperty(
    "height"
  );

  fittedShiftFrame=null;
}

function fitShiftWindow(){
  releaseShiftWindowFit();

  if(tab!=="shifts"){
    observeShiftWindowArea(null);
    return;
  }

  observeShiftWindowArea(
    app.querySelector(
      "#shiftListArea"
    )
  );

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

  fittedShiftFrame=frame;
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
            Обратитесь к администратору, чтобы восстановить доступ.
          </div>
        </div>
      </div>
    `;
  }

  return "";
}

function filteredMonthShifts(){
  return filterMonthShifts(
    inMonth(cursor),
    {
      query:shiftSearchQuery,
      pointIds:shiftFilter.pointIds,
      employeeIds:isAdmin
        ? shiftFilter.employeeIds
        : null,
      fromDay:shiftFilter.fromDay,
      toDay:shiftFilter.toDay
    },
    shift=>{
      const result=calc(shift);
      return [
        dateLabel(shift.date),
        result.rate,
        result.base,
        result.total,
        result.hours,
        money(result.total)
      ];
    }
  );
}

function shiftFilterLabel(){
  const labels=[];
  if(shiftFilter.pointIds!==null){
    labels.push(`${shiftFilter.pointIds.length} ПВЗ`);
  }
  if(isAdmin && shiftFilter.employeeIds!==null){
    labels.push(`${shiftFilter.employeeIds.length} сотр.`);
  }
  if(shiftFilter.period==="first") labels.push("1–15");
  else if(shiftFilter.period==="second") labels.push("16–конец");
  else if(shiftFilter.period==="custom"){
    labels.push(`${shiftFilter.fromDay}–${shiftFilter.toDay}`);
  }
  return labels.length ? labels.join(" · ") : "Все смены";
}

function shiftListAreaHTML(){
  const all=inMonth(cursor);
  const list=filteredMonthShifts();
  const filtered=
    shiftSearchQuery.trim() ||
    shiftFilter.pointIds!==null ||
    (isAdmin && shiftFilter.employeeIds!==null) ||
    shiftFilter.period!=="all";
  const label=isAdmin
    ? `Список${filtered ? ` · ${list.length} из ${all.length}` : ""}`
    : shiftsWord(list.length);

  if(!list.length){
    return `
      <div class="ml">${label}</div>
      <div class="card"><div class="employee-empty">
        ${filtered ? "По заданным условиям смен не найдено." : "В этом месяце смен пока нет."}
      </div></div>
    `;
  }

  let html=`
    <div class="ml">${label}</div>
    <div class="card shift-window"><div class="shift-scroll" aria-label="Список смен">
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
        data-key="shift-${esc(shift.id)}"
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

  return html+`</div></div>`;
}

function updateShiftList(){
  const area=document.getElementById("shiftListArea");
  if(!area) return;

  setHTML(area,shiftListAreaHTML());

  requestAnimationFrame(
    fitShiftWindow
  );
}

/*
  Состояние представлений «Смен»: выбранный режим, ПВЗ в календаре и
  открытый день.

  Это настройки экрана, а не место, где человек остановился: они
  переживают перерисовку и переход в другой раздел — по тому же правилу,
  что месяц, поиск и фильтры (см. resetSectionOnLeave). В sessionStorage
  они намеренно не попадают: раздел открывается реестром, а реестр —
  ответ на вопрос «что записано», с которого и начинают.
*/
let shiftViewMode="registry";
let shiftViewPointId="";
let shiftViewDay="";

/*
  Пункты для календаря и контроля: действующие плюс те, по которым в
  этом месяце есть смены. Архивный ПВЗ со сменами прятать нельзя —
  именно по нему и проверяют, всё ли закрыто.
*/
function shiftViewPoints(monthShifts){
  const used=new Set(
    monthShifts.map(shift=>
      shift.dbPointId || shift.pointId
    )
  );

  return (teamData.points || []).filter(
    point=>
      point.active!==false ||
      used.has(point.id)
  );
}

function shiftViewFormat(){
  return {
    esc,
    money,
    calc,
    dateLabel,
    shortDateLabel
  };
}

/* Открыть форму новой смены из конкретного дня календаря. */
function openShiftForCalendarDay(date){
  openSheet(null);

  if(!draft){
    return;
  }

  /*
    Дату человек выбрал сам, поэтому datesTouched=true: следующий тап по
    календарю в форме добавит день, а не заменит подставленный. Иначе
    мультивыбор из календаря был бы недоступен.
  */
  draft.date=date;
  draft.dates=[date];
  draft.datesTouched=true;

  const point=(teamData.points || []).find(
    item=>item.id===shiftViewPointId
  );

  /* Контекст ПВЗ из календаря переносится в форму. */
  if(point){
    draft.dbPointId=point.id;
    draft.pointId=point.code || point.id;
    draft.point=point.name;
  }

  shiftDateCursor=date.slice(0,7);

  drawSheet(false);
  saveUIState();
}

function viewShifts(){
  const state=serverStateCard();
  if(state) return state;

  const adminControls=isAdmin ? `
    <div class="ml">Смены</div>
    <button type="button" class="manage-add" id="shiftAdd">
      <span class="manage-add-plus" aria-hidden="true"></span>
      Добавить смену
    </button>
  ` : "";

  /* Реестр собирается ниже, общим путём. */
  if(shiftViewMode!=="registry"){
    const monthShifts=inMonth(cursor);
    const points=shiftViewPoints(monthShifts);

    return `
      ${adminControls}
      ${shiftViewSwitcherHTML(shiftViewMode)}
      ${shiftViewMode==="control"
        ? controlViewHTML({
            cursor,
            shifts:monthShifts,
            points,
            today:localYMD(),
            format:shiftViewFormat()
          })
        : calendarViewHTML({
            cursor,
            shifts:monthShifts,
            points,
            pointId:shiftViewPointId,
            selectedDay:shiftViewDay,
            today:localYMD(),
            isAdmin,
            format:shiftViewFormat()
          })}
    `;
  }

  return `
    ${adminControls}
    ${shiftViewSwitcherHTML(shiftViewMode)}
    <div class="ml">Поиск и фильтр</div>
    <div class="card employee-editor">
      <label class="row">
        <input type="search" id="shiftSearch" autocomplete="off" spellcheck="false"
          value="${esc(shiftSearchQuery)}" placeholder="Поиск" aria-label="Поиск смен">
      </label>
      <button type="button" class="row point-row" id="shiftFilterOpen">
        <div class="t">Фильтр</div>
        <div class="point-value">${esc(shiftFilterLabel())}</div>
      </button>
    </div>
    <div id="shiftListArea">${shiftListAreaHTML()}</div>
  `;
}

function payoutRecords(employeeId,kind){
  const periodMonth=`${cursor}-01`;
  return (teamData.payouts || []).filter(item=>
    item.employee_id===employeeId &&
    item.period_month===periodMonth &&
    item.payout_kind===kind
  ).sort((a,b)=>b.paid_on.localeCompare(a.paid_on));
}

/*
  Состояние выплаты описывается фактическими данными.

  Нулевая или отрицательная сумма к выплате — это не «не выплачено», а
  отсутствие выплаты: платить нечего. Раньше такая строка попадала в общую
  ветку и сообщала о невыплаченном нуле.
*/
/*
  Начислений нет, а деньги выплачены — «Частично выплачено» про такое
  врёт: выплачивать больше нечего. Так выглядит период, из которого ушли
  смены (например, вместе с удалённым ПВЗ), и выплата, записанная раньше
  смен. Сама запись о выплате остаётся: деньги действительно отданы.
*/
function payoutStateLabel(progress){
  if(progress.complete) return "Выплачено";
  if(progress.due<=0 && progress.paid>0) return "Переплата";
  if(progress.paid>0) return "Частично выплачено";
  if(progress.due<=0) return "Без выплаты";
  return "Не выплачено";
}

/*
  Строка итога в раскрытой выплате отвечает на вопрос «сколько ещё должны»,
  поэтому показывает остаток, а не выплаченную часть. Пара «Не выплачено
  0 ₽ из 15 000 ₽» описывала ровно противоположное фактическому состоянию:
  невыплаченными оставались все 15 000 ₽.
*/
function payoutRemainderLabel(progress){
  if(progress.complete) return "Выплачено";
  if(progress.due<=0 && progress.paid>0) return "Выплачено сверх начисленного";
  if(progress.paid>0) return "Осталось выплатить";
  if(progress.due<=0) return "Без выплаты";
  return "Не выплачено";
}

function payoutRemainderValue(progress){
  if(progress.complete){
    return progress.overpaid>0
      ? `${money(progress.paid)} · переплата ${money(progress.overpaid)}`
      : money(progress.paid);
  }

  if(progress.due<=0 && progress.paid>0){
    return money(progress.paid);
  }

  if(progress.paid>0){
    return `${money(progress.remaining)} из ${money(progress.due)}`;
  }

  return money(progress.due);
}

function resolvedPenaltyPayoutKind(
  shift,
  penalty
){
  const explicit=
    penalty?.payoutKind ||
    penalty?.payout_kind ||
    "";

  if(explicit){
    return explicit==="second_half"
      ? "final"
      : explicit;
  }

  const day=Number(
    shift.date.slice(8,10)
  );

  const advanceEnabled=
    typeof shift.pricing
      ?.advanceEnabled===
      "boolean"
      ? shift.pricing
          .advanceEnabled
      : false;

  return advanceEnabled || day>15
    ? "final"
    : "first_half";
}

function payoutSourceRows(shiftsList,kind){
  const matching=inMonth(cursor,shiftsList).filter(shift=>{
    const day=Number(shift.date.slice(8,10));
    const advanceEnabled=
      typeof shift.pricing
        ?.advanceEnabled===
        "boolean"
        ? shift.pricing
            .advanceEnabled
        : false;
    const penalties=
      shift.penalties || [];
    const baseMatches=
      kind==="first_half"
        ? day<=15
        : advanceEnabled ||
          day>15;

    return baseMatches || penalties.some(
      item=>
        resolvedPenaltyPayoutKind(
          shift,
          item
        )===kind
    );
  });

  if(!matching.length){
    return `<div class="payout-empty">В этой части месяца смен нет.</div>`;
  }

  return matching.map(shift=>{
    const result=calc(shift);
    const penalties=
      (shift.penalties || [])
        .filter(
          item=>
            resolvedPenaltyPayoutKind(
              shift,
              item
            )===kind
        );
    const adjustments=[
      ...(shift.bonuses || []).map(item=>`Премия: ${item.comment} (+${money(item.amount)})`),
      ...penalties.map(item=>`Штраф: ${item.comment} (−${money(item.amount)})`),
      shift.note ? `Комментарий: ${shift.note}` : ""
    ].filter(Boolean);
    return `
      <div class="payout-source-row">
        <div class="payout-source-main">
          <strong>${esc(dateLabel(shift.date))} · ${esc(shift.point)}</strong>
          <span>${shift.type==="extra" ? "Дополнительная" : "Основная"}${shift.partial ? ` · ${hoursWord(result.hours)}` : ""}${kind==="final" && Number(shift.date.slice(8,10))<=15 ? " · первая половина" : ""}</span>
          ${adjustments.map(text=>`<small>${esc(text)}</small>`).join("")}
        </div>
        <b>${money(result.total)}</b>
      </div>
    `;
  }).join("");
}

/*
  Состав суммы уже стоит на самой плитке выплаты и остаётся на экране в
  раскрытом виде, поэтому внутри раскрытого блока он не повторяется: там
  разворачиваются только смены, из которых сумма собрана.
*/
function payoutExpandedHTML({kind,due,employee,statsShifts}){
  const records=payoutRecords(employee?.id,kind);
  const progress=paymentProgress(due,records);
  const editor=payoutEditor?.kind===kind ? payoutEditor : null;
  return `
    <div class="payout-expanded">
      <div class="payout-breakdown">
        <div class="payout-detail-title">Из чего сформирована сумма</div>
        <div class="payout-source-list">${payoutSourceRows(statsShifts,kind)}</div>
      </div>
      <div class="payout-progress">
        <span>${payoutRemainderLabel(progress)}</span>
        <strong>${payoutRemainderValue(progress)}</strong>
      </div>
      ${records.length ? `
        <div class="payout-history">
          ${records.map(record=>`
            <div class="payout-record">
              <div><strong>${esc(dateLabel(record.paid_on))}</strong>${record.comment ? `<small>${esc(record.comment)}</small>` : ""}</div>
              <b>${money(record.amount)}</b>
              ${isAdmin ? `<button type="button" data-payout-delete="${esc(record.id)}" aria-label="Удалить запись выплаты">×</button>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${isAdmin && employee ? `
        ${editor ? `
          <div class="payout-editor">
            <label class="payout-field">
              <span>Сумма</span>
              <input id="payoutAmount" class="payout-field-input amount" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${esc(editor.amount)}">
            </label>
            <div class="payout-field">
              <span>Дата выплаты</span>
              <button type="button" class="payout-field-input payout-date" data-payout-date-open>${esc(dateLabel(editor.paidOn))}</button>
            </div>
            <label class="payout-field">
              <span>Комментарий</span>
              <input id="payoutComment" class="payout-field-input" type="text" maxlength="500" autocomplete="off" enterkeyhint="done" value="${esc(editor.comment)}" placeholder="Необязательно">
            </label>
            <div class="payout-editor-actions">
              <button type="button" class="btn" data-payout-cancel>Отмена</button>
              <button type="button" class="btn primary" data-payout-save ${payoutSaving ? "disabled" : ""}>Сохранить</button>
            </div>
          </div>
        ` : `
          <button type="button" class="btn payout-add" data-payout-add="${kind}" ${progress.remaining<=0 ? "disabled" : ""}>
            ${progress.paid ? "Добавить часть выплаты" : "Отметить выплату"}
          </button>
        `}
      ` : ""}
    </div>
  `;
}

function payoutSummaryRowHTML({kind,label,due,employee,statsShifts,content}){
  const progress=paymentProgress(due,payoutRecords(employee?.id,kind));
  const open=expandedPayoutKind===kind;
  return `
    <div class="payout-block ${open ? "open" : ""}">
      <button type="button" class="row payout-summary" data-payout-toggle="${kind}" aria-expanded="${open}">
        <div class="l"><div class="t">${label}</div>${content}</div>
        <div class="payout-summary-right">
          <span class="payout-status ${progress.complete ? "paid" : progress.paid ? "partial" : ""}">${payoutStateLabel(progress)}</span>
          <span class="v ${due<0 ? "neg" : ""}">${money(due)}</span>
        </div>
      </button>
      ${fieldRevealHTML({
        key:`payoutReveal-${kind}`,
        open,
        body:payoutExpandedHTML({
          kind,
          due,
          employee,
          statsShifts
        })
      })}
    </div>
  `;
}

function currentStatsPayoutContext(kind){
  const employee=isAdmin
    ? teamData.employees.find(item=>item.id===statsEmployeeId)
    : teamData.employee;
  if(!employee) return null;
  const employeeShifts=shifts.filter(shift=>shift.employeeId===employee.id);
  const calculated=payouts(cursor,employeeShifts);
  return {
    employee,
    due:kind==="first_half" ? calculated.payment25 : calculated.payment10
  };
}

async function persistPayout(){
  if(!payoutEditor || payoutSaving) return;
  const context=currentStatsPayoutContext(payoutEditor.kind);
  if(!context) return;
  const amount=Number(String(payoutEditor.amount).replace(",","."));
  if(!Number.isFinite(amount) || amount<=0){
    toast("Введите сумму выплаты больше 0");
    return;
  }
  const progress=paymentProgress(
    context.due,
    payoutRecords(
      context.employee.id,
      payoutEditor.kind
    )
  );
  if(amount>progress.remaining){
    toast(
      `Осталось выплатить ${money(progress.remaining)}`
    );
    return;
  }
  if(!isValidDateString(payoutEditor.paidOn)){
    toast("Выберите дату выплаты");
    return;
  }
  payoutSaving=true;
  render();
  try{
    await saveAdminPayout({
      employeeId:context.employee.id,
      periodMonth:`${cursor}-01`,
      payoutKind:payoutEditor.kind,
      amount,
      paidOn:payoutEditor.paidOn,
      comment:payoutEditor.comment
    });
    payoutEditor=null;
    await refreshTeamData({renderAfter:false});
    render();
    toast("Выплата сохранена");
  }catch(error){
    toast(error instanceof Error ? error.message : "Не удалось сохранить выплату",4200);
    render();
  }finally{
    payoutSaving=false;
  }
}

function viewStats(){
  const state=serverStateCard();

  if(state){
    return state;
  }

  const selectedEmployee=
    isAdmin
      ? statsEmployeeOptions().find(
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
              selectedEmployee.id
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

  const availableStatsEmployees=
    statsEmployeeOptions();

  const statsEmployeeLabel=
    selectedEmployee
      ? selectedEmployee.full_name+
        (
          selectedEmployee.status==="inactive"
            ? " · архив"
            : ""
        )
      : availableStatsEmployees.length
        ? "Выберите сотрудника"
        : "Сотрудники не добавлены";

  const statsFilters=
    isAdmin
      ? `
        <div class="ml">Фильтры</div>
        <div class="card employee-editor">
          <button
            type="button"
            class="row point-row stats-filter-row"
            id="statsEmployeeOpen"
            aria-expanded="${statsEmployeeOpen ? "true" : "false"}"
            aria-label="Сотрудник для итогов: ${esc(statsEmployeeLabel)}"
            ${
              availableStatsEmployees.length
                ? ""
                : "disabled"
            }
          >
            <div class="t">Сотрудник</div>
            <div class="point-value">
              ${esc(statsEmployeeLabel)}
            </div>
          </button>

          ${fieldRevealHTML({
            key:"statsEmployeeReveal",
            open:statsEmployeeOpen,
            body:inlineChoiceHTML({
              options:
                availableStatsEmployees
                  .map(employee=>({
                    value:employee.id,
                    label:
                      employee.full_name+
                      (
                        employee.status==="inactive"
                          ? " · архив"
                          : ""
                      ),
                    searchText:[
                      employee.full_name,
                      employee.phone,
                      employee.transfer_phone,
                      employee.transfer_bank,
                      employee.transfer_recipient,
                      employeeAccountEmail(
                        employee
                      )
                    ].filter(Boolean).join(" ")
                  })),
              value:statsEmployeeId,
              attribute:"data-stats-employee",
              searchId:"statsEmployeeSearch",
              searchQuery:statsEmployeeQuery,
              searchLabel:"Поиск сотрудника"
            })
          })}
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

    <div class="card payout-card">
      ${payoutSummaryRowHTML({
        kind:"first_half",
        label:`25 ${esc(monthGen(cursor))}`,
        due:payout.payment25,
        employee:selectedEmployee,
        statsShifts,
        content:payment25Content
      })}
      ${payoutSummaryRowHTML({
        kind:"final",
        label:`10 ${esc(monthGen(payout.nextYm))}`,
        due:payout.payment10,
        employee:selectedEmployee,
        statsShifts,
        content:payment10Content
      })}
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
        ? "Данные обновляются автоматически."
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
            <div class="s">ФИО, телефоны и реквизиты сотрудников.</div>
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
    orderedTeamPoints()
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

/* Назначенные ПВЗ сотрудника, в том же порядке, что и везде. */
function employeePointsOf(employeeId){
  const ids=
    new Set(
      employeePointIds(
        employeeId
      )
    );

  return orderedTeamPoints()
    .filter(
      point=>
        ids.has(point.id)
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

  return orderedTeamPoints()
    .filter(
      point=>
        ids.has(point.id)
    )
    .map(
      point=>
        point.name
    );
}

function orderedTeamPoints(){
  return sortPointsAlphabetically(
    teamData.points
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

      const account=employeeAccount(employee);
      const searchValue=employeeSearchText(
        employee,
        {
          pointNames:employeePointNames(employee.id),
          account:[account?.login,account?.email].filter(Boolean).join(" ")
        }
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

function isSystemSubstitute(
  employee
){
  return (
    employee?.is_system_substitute===
    true
  );
}

function employeeRowHTML(
  employee
){
  const systemSubstitute=
    isSystemSubstitute(
      employee
    );

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
      data-key="employee-${esc(employee.id)}"
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
          ${
            systemSubstitute
              ? "Для смен на всех ПВЗ"
              : esc(
                  employeePointsLabel(
                    employee.id
                  )
                )
          }
        </span>

        <span class="employee-account-label">
          ${
            systemSubstitute
              ? "Без итогов и аккаунта"
              : account?.login
              ? esc(account.login)
              : "Без аккаунта"
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

  setHTML(list,employeeListHTML());
}

function employeeFilterLabel(){
  if(!employeePointFilter){
    return "Все ПВЗ";
  }

  if(employeePointFilter.length===1){
    const point=
      teamData.points.find(
        item=>
          item.id===
          employeePointFilter[0]
      );

    return point
      ? point.name
      : "Все ПВЗ";
  }

  return (
    employeePointFilter.length+
    " ПВЗ"
  );
}

function viewEmployees(){
  if(teamDataLoading && !teamDataLoaded){
    return `
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

    <button type="button" class="btn employee-archive-button" id="employeeArchiveToggle">
      ${employeeStatusFilter==="inactive" ? "Активные сотрудники" : "Архив"}
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

function shiftFilterChoiceRows(items,selectedIds,attribute,allLabel){
  return [
    {id:"",name:allLabel},
    ...items
  ].map(item=>{
    const selected=!item.id
      ? selectedIds===null
      : filterOptionSelected(
          selectedIds,
          item.id
        );
    return `
      <button type="button" class="employee-point ${selected ? "on" : ""}"
        ${attribute}="${esc(item.id)}">
        <span class="employee-point-check" aria-hidden="true">${selected ? "✓" : ""}</span>
        <span class="employee-point-name">${esc(item.name)}</span>
      </button>
    `;
  }).join("");
}

function applyShiftFilterPeriod(period){
  shiftFilterDraft.period=period;
  if(period==="all"){
    shiftFilterDraft.fromDay=1;
    shiftFilterDraft.toDay=31;
  }else if(period==="first"){
    shiftFilterDraft.fromDay=1;
    shiftFilterDraft.toDay=15;
  }else if(period==="second"){
    shiftFilterDraft.fromDay=16;
    shiftFilterDraft.toDay=31;
  }
}

function drawShiftFilterSheet(){
  if(!shiftFilterDraft) return;
  const pointItems=orderedTeamPoints()
    .map(point=>({id:point.id,name:point.name}));
  const employeeItems=teamData.employees.map(employee=>({id:employee.id,name:employee.full_name}));
  setHTML(
    document.getElementById("shiftFilterSheetBody"),
    `
    <div class="ml">Период месяца</div>
    <div class="card segbox"><div class="seg shift-period-seg">
      <button type="button" data-shift-period="all" class="${shiftFilterDraft.period==="all" ? "on" : ""}">Весь</button>
      <button type="button" data-shift-period="first" class="${shiftFilterDraft.period==="first" ? "on" : ""}">1–15</button>
      <button type="button" data-shift-period="second" class="${shiftFilterDraft.period==="second" ? "on" : ""}">16–конец</button>
      <button type="button" data-shift-period="custom" class="${shiftFilterDraft.period==="custom" ? "on" : ""}">Даты</button>
    </div></div>
    ${shiftFilterDraft.period==="custom" ? `
      <div class="card shift-range-card">
        <label class="row"><div class="t">С числа</div><input id="shiftFilterFrom" type="number" inputmode="numeric" min="1" max="31" value="${esc(shiftFilterDraft.fromDay)}"></label>
        <label class="row"><div class="t">По число</div><input id="shiftFilterTo" type="number" inputmode="numeric" min="1" max="31" value="${esc(shiftFilterDraft.toDay)}"></label>
      </div>
    ` : ""}
    <div class="ml">Пункты выдачи</div>
    <div class="card employee-points">
      ${shiftFilterChoiceRows(pointItems,shiftFilterDraft.pointIds,"data-shift-filter-point","Все ПВЗ")}
    </div>
    ${isAdmin ? `
      <div class="ml">Сотрудники</div>
      <div class="card employee-points">
        ${shiftFilterChoiceRows(employeeItems,shiftFilterDraft.employeeIds,"data-shift-filter-employee","Все сотрудники")}
      </div>
    ` : ""}
    <button type="button" class="btn" id="shiftFilterReset">Сбросить фильтр</button>
    <div class="sheet-spacer" aria-hidden="true"></div>
  `
  );
}

function openShiftFilterSheet(){
  shiftFilterSheetPreviousFocus=document.activeElement;
  shiftFilterDraft={
    pointIds:shiftFilter.pointIds===null ? null : [...shiftFilter.pointIds],
    employeeIds:shiftFilter.employeeIds===null ? null : [...shiftFilter.employeeIds],
    fromDay:shiftFilter.fromDay,
    toDay:shiftFilter.toDay,
    period:shiftFilter.period
  };
  drawShiftFilterSheet();
  const veil=document.getElementById("shiftFilterVeil");
  prepareBottomSheetOpen(shiftFilterSheetElement,"--sheet-drag");
  shiftFilterSheetElement.style.display="block";
  shiftFilterSheetElement.classList.remove("on");
  shiftFilterSheetElement.setAttribute("aria-hidden","false");
  veil.setAttribute("aria-hidden","false");
  setBackgroundInert(true);
  void shiftFilterSheetElement.offsetHeight;
  document.body.classList.add("sheet-open");
  veil.classList.add("on");
  shiftFilterSheetElement.classList.add("on");
  requestAnimationFrame(()=>{
    shiftFilterSheetElement.scrollTop=0;
    focusSheetSurface(shiftFilterSheetElement);
  });
}

function closeShiftFilterSheet(){
  if(!shiftFilterSheetElement.classList.contains("on")) return;
  const veil=document.getElementById("shiftFilterVeil");
  veil.classList.remove("on");
  veil.setAttribute("aria-hidden","true");
  shiftFilterSheetElement.classList.remove("on");
  shiftFilterSheetElement.setAttribute("aria-hidden","true");
  document.body.classList.remove("sheet-open");
  shiftFilterDraft=null;
  if(!activeModal()) setBackgroundInert(false);
  const previous=shiftFilterSheetPreviousFocus;
  shiftFilterSheetPreviousFocus=null;
  setTimeout(()=>{
    if(previous && document.contains(previous)) previous.focus();
    if(!shiftFilterSheetElement.classList.contains("on")) shiftFilterSheetElement.style.display="none";
  },100);
}

function applyShiftFilter(){
  if(!shiftFilterDraft) return;
  const from=Math.max(1,Math.min(31,Number(shiftFilterDraft.fromDay)||1));
  const to=Math.max(from,Math.min(31,Number(shiftFilterDraft.toDay)||31));
  shiftFilter={...shiftFilterDraft,fromDay:from,toDay:to};
  closeShiftFilterSheet();
  render();
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
      ...orderedTeamPoints().map(
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
            : filterOptionSelected(
                employeeFilterDraft
                  .pointIds,
                point.id
              );

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

  setHTML(
    document .getElementById( "employeeFilterSheetBody" ),
    `
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
    `
  );
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

    focusSheetSurface(sheet);
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

/*
  Открытие редактора тарифа. Намерение фиксируется в черновике, а не
  вычитывается потом из текста кнопок: сохранение по нему выбирает,
  изменить текущую запись или создать следующую версию.
*/
function openTariffEditor(intent,tariff=null){
  if(!manageEditorDraft?.point){
    return;
  }

  const source=tariff ||
    (
      intent==="edit-current"
        ? tariffForDate(
            teamData.tariffs,
            manageEditorDraft.point.id,
            localYMD()
          )
        : null
    );

  if(intent==="edit-current" && !source){
    toast("Текущий тариф не найден");
    return;
  }

  const shape=source ||
    tariffForDate(
      teamData.tariffs,
      manageEditorDraft.point.id,
      localYMD()
    );

  manageEditorDraft.tariffOpen=true;
  manageEditorDraft.tariffIntent=intent;
  manageEditorDraft.tariffInlineEditId=
    intent==="create"
      ? null
      : source?.id || null;
  manageEditorDraft.pricingType=
    shape?.pricing_type || "fixed";
  manageEditorDraft.fixedRate=
    shape?.fixed_rate || 3000;
  manageEditorDraft.tiers=
    shape?.shk_tiers
      ? shape.shk_tiers.map(
          tier=>({...tier})
        )
      : defaultTariffTiers();
  manageEditorDraft.effectiveFrom=
    intent==="create"
      ? nextTariffEffectiveFrom(
          manageEditorDraft.point.id
        )
      : source.effective_from;
}

function closeTariffEditor(){
  if(!manageEditorDraft){
    return;
  }

  manageEditorDraft.tariffOpen=false;
  manageEditorDraft.tariffIntent="create";
  manageEditorDraft.tariffInlineEditId=null;
}

function tariffHistoryItemHTML(
  tariff,
  {
    planned=false,
    editing=false
  }={}
){
  if(editing){
    return `
      <div class="tariff-history-item tariff-history-editing">
        <div class="tariff-history-edit-head">
          <span>
            <strong>${tariffTypeLabel(tariff)}</strong>
            <small>${esc(dateLabel(tariff.effective_from))}</small>
          </span>
          <button type="button" class="tariff-inline-close" data-tariff-edit-cancel>Отмена</button>
        </div>
        <div class="tariff-history-edit-body">
          ${tariffBoxHTML()}
          <button type="button" class="btn gold tariff-inline-save" data-tariff-edit-save>Сохранить тариф</button>
        </div>
      </div>
    `;
  }

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
        <div class="tariff-history-actions">
          <button type="button" data-tariff-edit="${esc(tariff.id)}">Изменить</button>
          <button type="button" class="warn" data-tariff-delete="${esc(tariff.id)}">Удалить</button>
        </div>
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
              {
                planned:true,
                editing:
                  manageEditorDraft
                    ?.tariffInlineEditId===
                  tariff.id
              }
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
              tariff,
              {
                editing:
                  manageEditorDraft
                    ?.tariffInlineEditId===
                  tariff.id
              }
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

  return `
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

    <button type="button" class="btn employee-archive-button" id="pointArchiveToggle">
      ${pointStatusFilter==="inactive" ? "Активные ПВЗ" : "Архив"}
    </button>

    <div class="ml">
      Поиск и фильтр
    </div>

    <div class="card employee-editor">
      <label class="row">
        <input
          type="search"
          id="pointSearch"
          autocomplete="off"
          spellcheck="false"
          value="${esc(pointSearchQuery)}"
          placeholder="Поиск"
          aria-label="Поиск пунктов выдачи"
        >
      </label>

      <button
        type="button"
        class="row point-row"
        id="pointFilterOpen"
      >
        <div class="t">
          Фильтр
        </div>

        <div class="point-value">
          ${esc(pointAdvanceFilterLabel())}
        </div>
      </button>
    </div>

    <div class="ml">
      Список
    </div>

    <div id="pointManageList">
      ${pointManageListHTML()}
    </div>
  `;
}

function pointAdvanceFilterLabel(){
  if(pointAdvanceFilter==="advance"){
    return "Авансные ПВЗ";
  }

  if(pointAdvanceFilter==="regular"){
    return "Остальные ПВЗ";
  }

  return "Все ПВЗ";
}

function pointManageSearchText(point){
  const tariffs=teamData.tariffs
    .filter(tariff=>tariff.point_id===point.id)
    .flatMap(tariff=>[
      tariff.pricing_type==="fixed"
        ? "фиксированный фикс"
        : "по шк шк",
      tariff.effective_from,
      tariff.fixed_rate,
      ...(tariff.shk_tiers || []).flatMap(
        tier=>[tier.up_to,tier.rate]
      )
    ]);

  return employeeSearchValue([
    point.name,
    point.code,
    point.id,
    point.active===false ? "архив" : "активен",
    point.advance_enabled===true
      ? "аванс авансный авансные"
      : "остальные обычный без аванса",
    ...tariffs
  ].filter(value=>value!==null && value!==undefined).join(" "));
}

function filteredManagePoints(){
  const query=employeeSearchValue(pointSearchQuery);

  return orderedTeamPoints()
    .filter(point=>{
      const statusMatches=
        pointStatusFilter==="inactive"
          ? point.active===false
          : point.active!==false;

      if(!statusMatches){
        return false;
      }

      if(
        pointAdvanceFilter==="advance" &&
        point.advance_enabled!==true
      ){
        return false;
      }

      if(
        pointAdvanceFilter==="regular" &&
        point.advance_enabled===true
      ){
        return false;
      }

      return !query ||
        pointManageSearchText(point)
          .includes(query);
    });
}

function pointManageListHTML(){
  const points=filteredManagePoints();

  if(points.length){
    return `
      <div class="card manage-menu point-manage-menu">
        ${points.map(point=>`
          <button
            type="button"
            class="manage-row point-manage-row"
            data-key="point-${esc(point.id)}"
            data-point-id="${esc(point.id)}"
          >
            <span class="manage-row-copy">
              <span class="manage-row-title">
                ${esc(point.name)}
              </span>
              <span class="manage-row-detail">
                ${esc(
                  pointEmployeeSummary(
                    point.id,
                    teamData.employees,
                    teamData.employeePoints
                  )
                )}
              </span>
              <span class="manage-row-detail">
                ${esc(
                  pointTariffSummary(
                    point,
                    tariffForDate(
                      teamData.tariffs,
                      point.id,
                      localYMD()
                    )
                  )
                )}
              </span>
            </span>
            <span class="manage-chevron" aria-hidden="true">
              <svg viewBox="0 0 12 16">
                <path d="M3 3L9 8L3 13"></path>
              </svg>
            </span>
          </button>
        `).join("")}
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="employee-empty">
        ${
          teamData.points.length
            ? "Ничего не найдено."
            : "Пунктов пока нет."
        }
      </div>
    </div>
  `;
}

function updatePointManageList(){
  if(
    tab!=="manage" ||
    manageSection!=="points"
  ){
    return;
  }

  const list=document.getElementById("pointManageList");

  if(list){
    setHTML(list,pointManageListHTML());
  }
}

function openManagePointFilterPicker(){
  openChoicePicker({
    kind:"manage-point-filter",
    value:pointAdvanceFilter,
    title:"Фильтр ПВЗ",
    options:[
      {value:"all",label:"Все ПВЗ"},
      {value:"advance",label:"Авансные ПВЗ"},
      {value:"regular",label:"Остальные ПВЗ"}
    ]
  });
}

/*
  Новый тариф начинается с одной пустой строки.

  Раньше он подставлял границы чужого ПВЗ, а если их не было — набор
  350/450/550/650 из старой конфигурации. Менеджер получал готовую
  сетку, которую не задавал, и достаточно было не заметить лишнюю
  строку, чтобы ПВЗ начал считать по чужим ставкам.
*/
function defaultTariffTiers(){
  return [{up_to:"",rate:""}];
}

function readManageEditor(){
  if(!manageEditorDraft){
    return;
  }

  const value=id=>
    document.getElementById(id)
      ?.value ?? "";

  if(manageEditorKind==="point"){
    if(
      document.getElementById(
        "managePointName"
      )
    ){
      manageEditorDraft.name=
        value("managePointName");
    }
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

/*
  Строки редакторов списков получают ключ по самому объекту черновика: при
  удалении строки из середины её поля не достаются соседней строке.
*/
const rowKeys=new WeakMap();
let nextRowKey=0;

function rowKey(item){
  if(!rowKeys.has(item)){
    nextRowKey+=1;
    rowKeys.set(item,nextRowKey);
  }

  return rowKeys.get(item);
}

/*
  Каждая строка тарифа заканчивается числом, включая последнюю: строки
  «Без границы» больше нет. Нули в полях — подсказка о том, что сюда
  вводят значение, а не заранее принятое решение.
*/
function tierEditorHTML(tiers){
  /*
    Место под кнопку удаления держится, только пока строки можно удалять:
    иначе поля «ШК до» и «Ставка» без всякой причины уже остальной формы.
  */
  const removable=tiers.length>1;

  return tiers.map((tier,index)=>`
      <div class="row tariff-tier" data-key="tier-${rowKey(tier)}" data-tier-index="${index}">
        <div class="tariff-tier-fields">
          <label class="tariff-tier-field">
            <span>ШК до</span>
            <input type="number" inputmode="numeric" data-tier-limit value="${esc(tier.up_to ?? "")}" min="1" step="1" placeholder="0" aria-label="ШК до">
          </label>
          <label class="tariff-tier-field">
            <span>Ставка, ₽</span>
            <input type="text" inputmode="decimal" data-tier-rate value="${esc(tier.rate ?? "")}" placeholder="0" aria-label="Ставка">
          </label>
        </div>
        ${removable ? `
          <button type="button" class="tariff-tier-remove" data-tier-remove="${index}" aria-label="Удалить границу">×</button>
        ` : ""}
      </div>
    `).join("");
}

function updateManageEditorHeader(){
  const viewing=
    manageEditorDraft &&
    !manageEditorDraft.isNew &&
    !manageEditorDraft.editing;

  /*
    Отказ от правок существующего ПВЗ возвращает в его карточку, а не
    закрывает лист, поэтому кнопка называется «Назад» — как у сотрудника.
    «Отмена» остаётся только у нового ПВЗ, где отказ закрывает лист.
  */
  const editingExisting=
    manageEditorDraft &&
    !manageEditorDraft.isNew &&
    manageEditorDraft.editing;

  document.getElementById(
    "manageEditorCancel"
  ).textContent=
    viewing
      ? "Закрыть"
      : editingExisting
        ? "Назад"
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
      setHTML(
        body,
        pointInformationHTML(
          manageEditorDraft.point,
          current
        )
      );
      return;
    }

    /*
      История тарифов нужна и в режиме правки, а не только в просмотре.
      Тариф сохраняется, не закрывая карточку, и результат должен быть
      виден сразу: новый тариф с будущей даты не меняет текущий, и без
      списка «Запланированные тарифы» сохранение выглядело бы как
      ничего не сделавшее. Пока открыт редактор тарифа, список скрыт —
      иначе правка версии из истории открыла бы вторую форму с теми же
      идентификаторами полей.
    */
    const tariffSection=
      manageEditorDraft.isNew
        ? `
          <div class="ml">Тариф</div>
          ${tariffBoxHTML()}
        `
        : `
          <div class="ml">Тариф</div>
          ${manageEditorDraft.tariffOpen ? `
            <div class="tariff-current-editor">
              ${tariffBoxHTML()}
              <div class="tariff-editor-help">
                ${esc(
                  tariffIntentHelp(
                    manageEditorDraft.tariffIntent
                  )
                )}
              </div>
            </div>

            <div class="tariff-editor-actions">
              <button
                type="button"
                class="btn tariff-change-button"
                id="manageTariffCancel"
              >
                Отменить
              </button>

              <button
                type="button"
                class="btn gold tariff-change-button"
                id="manageTariffSave"
              >
                ${manageEditorDraft.tariffIntent==="create"
                  ? "Добавить тариф"
                  : "Сохранить тариф"}
              </button>
            </div>
          ` : `
            ${tariffCardHTML(current)}

            ${current ? `
              <button
                type="button"
                class="btn tariff-change-button"
                data-tariff-intent="edit-current"
              >
                Изменить текущий тариф
              </button>
            ` : ""}

            <button
              type="button"
              class="btn tariff-change-button"
              data-tariff-intent="create"
            >
              ${current ? "Новый тариф" : "Задать тариф"}
            </button>

            ${current ? `
              <div class="tariff-editor-help">
                Новый тариф сохраняет прежний в истории.
              </div>
            ` : ""}

            ${pointTariffHistoryHTML(
              manageEditorDraft.point.id,
              current
            )}
          `}
        `;

    /*
      Удаление ПВЗ — действие режима редактирования: в режиме просмотра
      разрушительной кнопки нет, как и было до 7.0.
    */
    setHTML(
      body,
      `
      <div class="ml">Пункт выдачи</div>
      <div class="card employee-editor">
        <label class="row">
          <div class="t">Название</div>
          <input type="text" id="managePointName" value="${esc(manageEditorDraft.name)}" autocomplete="off">
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

      ${!manageEditorDraft.isNew ? `
        <button
          type="button"
          class="btn warn manage-point-delete"
          id="managePointDelete"
        >
          Удалить ПВЗ
        </button>
      ` : ""}

      <div class="sheet-spacer" aria-hidden="true"></div>
    `
    );
    return;
  }
}

/*
  Тариф — один компонент: переключатель сверху, под ним внутри той же
  плитки только те параметры, которые относятся к выбранному варианту.
  Ставка принадлежит «Фиксу», границы — «По ШК», а «Действует с» общее для
  обоих и потому стоит первым.
*/
function tariffBoxHTML(){
  const fixed=
    manageEditorDraft.pricingType===
      "fixed";

  return `
    <div class="card reveal-box tariff-box">
      <div class="segbox">
        <div class="seg">
          <button type="button" data-pricing-type="fixed" class="${fixed ? "on" : ""}">Фикс</button>
          <button type="button" data-pricing-type="shk_tiers" class="${fixed ? "" : "on"}">По ШК</button>
        </div>
      </div>

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

      ${fieldRevealHTML({
        key:"tariffFixedReveal",
        open:fixed,
        body:`
          <label class="row">
            <div class="t">Ставка</div>
            <input type="text" inputmode="decimal" id="manageFixedRate" value="${esc(manageEditorDraft.fixedRate)}">
          </label>
        `
      })}

      ${fieldRevealHTML({
        key:"tariffTiersReveal",
        open:!fixed,
        body:`
          <div class="tariff-tiers-head">Границы и ставки</div>

          <div class="tariff-tiers">
            ${tierEditorHTML(manageEditorDraft.tiers)}
          </div>

          <div class="tariff-tier-add-row">
            <button type="button" class="btn" id="tierAdd">Добавить границу</button>
          </div>
        `
      })}
    </div>
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

  manageEditorDraft=createPointDraft(id);

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
    focusSheetSurface(manageEditorSheetElement);
  });
}

function createPointDraft(id){
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

  return point
    ? {
        id:point.id,
        point,
        isNew:false,
        editing:false,
        name:point.name,
        active:point.active!==false,
        advanceEnabled:point.advance_enabled===true,
        tariffOpen:false,
        tariffIntent:"create",
        tariffInlineEditId:null,
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
        active:true,
        advanceEnabled:false,
        tariffOpen:true,
        tariffIntent:"create",
        tariffInlineEditId:null,
        pricingType:"fixed",
        fixedRate:3000,
        tiers:defaultTariffTiers(),
        effectiveFrom:localYMD()
      };
}

/*
  Правка существующего ПВЗ отменяется в его карточку, как у сотрудника:
  «Отмена» возвращает к просмотру, а закрывает лист только «Закрыть» или
  отмена нового ПВЗ, у которого карточки ещё нет.
*/
function cancelManageEditor(){
  if(
    manageEditorKind!=="point" ||
    !manageEditorDraft ||
    manageEditorDraft.isNew ||
    !manageEditorDraft.editing ||
    manageEditorSaving
  ){
    closeManageEditor();
    return;
  }

  const draft=createPointDraft(
    manageEditorDraft.id
  );

  if(!draft || draft.isNew){
    closeManageEditor();
    return;
  }

  manageEditorDraft=draft;
  drawManageEditor();
  manageEditorSheetElement.scrollTop=0;
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
  const tariffSaved=
    !manageEditorDraft.isNew &&
    manageEditorDraft.tariffOpen;

  const tariffIntent=
    manageEditorDraft.tariffIntent;

  const tariffEdited=
    tariffSaved &&
    tariffIntentUpdatesRecord(tariffIntent);

  try{
    if(
      manageEditorKind==="point" &&
      !manageEditorDraft.name.trim()
    ){
      throw new Error("Введите название ПВЗ");
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
        manageEditorDraft.tiers,
        {allowOpenTail:false}
      );
    }

    if(
      !manageEditorDraft.isNew &&
      manageEditorDraft.tariffOpen
    ){
      const tariffs=pointTariffs(
        manageEditorDraft.point.id
      );

      if(
        manageEditorDraft.tariffIntent===
        "edit-current"
      ){
        assertCurrentTariffDate({
          tariffs,
          tariffId:
            manageEditorDraft
              .tariffInlineEditId,
          effectiveFrom:
            manageEditorDraft.effectiveFrom,
          today:localYMD()
        });
      }else if(
        manageEditorDraft.tariffIntent===
        "edit-version"
      ){
        assertTariffVersionDate({
          tariffs,
          tariffId:
            manageEditorDraft
              .tariffInlineEditId,
          effectiveFrom:
            manageEditorDraft.effectiveFrom
        });
      }else{
        assertNewTariffDate({
          tariffs,
          effectiveFrom:
            manageEditorDraft.effectiveFrom,
          today:localYMD()
        });
      }
    }

    manageEditorSaving=true;
    document.getElementById("manageEditorSave").disabled=true;

    await saveAdminPoint({
      id:manageEditorDraft.id,
      name:manageEditorDraft.name,
      sortOrder:
        Number(
          manageEditorDraft.point
            ?.sort_order
        ) ||
        Math.max(
          0,
          ...teamData.points.map(
            point=>
              Number(point.sort_order) ||
              0
          )
        )+1,
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
      const payload={
        effectiveFrom:manageEditorDraft.effectiveFrom,
        pricingType:manageEditorDraft.pricingType,
        fixedRate:manageEditorDraft.pricingType==="fixed"
          ? manageEditorDraft.fixedRate
          : null,
        shkTiers:manageEditorDraft.pricingType==="shk_tiers"
          ? tiers
          : null
      };

      if(tariffIntentUpdatesRecord(tariffIntent)){
        await updateAdminTariff({
          id:manageEditorDraft
            .tariffInlineEditId,
          ...payload
        });
      }else{
        await addAdminTariff({
          pointId:manageEditorDraft.point.id,
          ...payload
        });
      }
    }

    closeManageEditor();
    await refreshTeamData();
    toast(
      tariffEdited
        ? tariffIntent==="edit-version"
          ? "ПВЗ и тариф из истории сохранены"
          : "ПВЗ и текущий тариф сохранены"
        : tariffSaved
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

function normalizedTariffEditorDraft({
  excludeId=""
}={}){
  readManageEditor();

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
    pointTariffs(
      manageEditorDraft.point.id
    ).some(
      tariff=>
        tariff.id!==excludeId &&
        tariff.effective_from===
          manageEditorDraft.effectiveFrom
    )
  ){
    throw new Error(
      "На эту дату тариф уже задан"
    );
  }

  if(
    manageEditorDraft.pricingType===
    "fixed"
  ){
    const error=validateMoneyField(
      manageEditorDraft.fixedRate,
      "Ставка",
      {
        allowEmpty:false,
        max:MAX_MONEY
      }
    );

    const fixedRate=Number(
      String(
        manageEditorDraft.fixedRate
      ).replace(",",".")
    );

    if(error || fixedRate<=0){
      throw new Error(
        error ||
        "Ставка должна быть больше 0"
      );
    }

    return {
      effectiveFrom:
        manageEditorDraft.effectiveFrom,
      pricingType:"fixed",
      fixedRate,
      shkTiers:null
    };
  }

  return {
    effectiveFrom:
      manageEditorDraft.effectiveFrom,
    pricingType:"shk_tiers",
    fixedRate:null,
    shkTiers:normalizeShkTiers(
      manageEditorDraft.tiers,
      {allowOpenTail:false}
    )
  };
}

/*
  Сохранение тарифа само по себе, без карточки ПВЗ.

  Раньше открытый тариф сохраняла только верхняя «Готово», и она же
  закрывала карточку: чтобы поправить ставку, приходилось выходить из
  ПВЗ и заходить обратно — посмотреть, что получилось. Теперь у тарифа
  своя кнопка, а карточка остаётся открытой и сразу показывает новое
  состояние вместе с историей.

  Все три намерения проходят здесь одним путём: правка текущего тарифа,
  правка записи из истории и новый тариф отличаются только тем, какую
  запись писать и какие ограничения на дату проверять. Проверки те же,
  что и у «Готово», — иначе одна кнопка пропускала бы то, что другая
  запрещает.
*/
async function saveOpenTariff(){
  if(
    !manageEditorDraft?.tariffOpen ||
    !manageEditorDraft.point ||
    manageEditorSaving
  ){
    return;
  }

  const intent=
    manageEditorDraft.tariffIntent;

  const id=
    manageEditorDraft.tariffInlineEditId;

  const updatesRecord=
    tariffIntentUpdatesRecord(intent);

  if(updatesRecord && !id){
    toast("Тариф не найден");
    return;
  }

  try{
    const payload=
      normalizedTariffEditorDraft({
        excludeId:id || ""
      });

    const tariffs=pointTariffs(
      manageEditorDraft.point.id
    );

    if(intent==="edit-current"){
      assertCurrentTariffDate({
        tariffs,
        tariffId:id,
        effectiveFrom:payload.effectiveFrom,
        today:localYMD()
      });
    }else if(intent==="edit-version"){
      assertTariffVersionDate({
        tariffs,
        tariffId:id,
        effectiveFrom:payload.effectiveFrom
      });
    }else{
      assertNewTariffDate({
        tariffs,
        effectiveFrom:payload.effectiveFrom,
        today:localYMD()
      });
    }

    manageEditorSaving=true;

    if(updatesRecord){
      await updateAdminTariff({
        id,
        ...payload
      });
    }else{
      await addAdminTariff({
        pointId:manageEditorDraft.point.id,
        ...payload
      });
    }

    await refreshTeamData({
      renderAfter:false
    });

    /*
      Карточка остаётся открытой, поэтому её черновик берёт свежий ПВЗ:
      иначе она показывала бы состояние до сохранения.
    */
    manageEditorDraft.point=
      teamData.points.find(
        point=>
          point.id===
          manageEditorDraft.id
      ) || manageEditorDraft.point;

    closeTariffEditor();
    drawManageEditor();

    toast(
      updatesRecord
        ? intent==="edit-version"
          ? "Тариф из истории сохранён"
          : "Текущий тариф сохранён"
        : "Новый тариф добавлен"
    );
  }catch(error){
    toast(
      error instanceof Error
        ? error.message
        : "Не удалось сохранить тариф",
      4200
    );
  }finally{
    manageEditorSaving=false;
  }
}

async function removeHistoricalTariff(id){
  if(
    !await appConfirm(
      "Удалить тариф из истории?",
      {
        detail:"Тариф, по которому есть смены, и последний тариф ПВЗ удалить нельзя.",
        okText:"Удалить",
        danger:true
      }
    )
  ){
    return;
  }

  try{
    await deleteAdminTariff(id);
    await refreshTeamData({
      renderAfter:false
    });
    closeTariffEditor();
    drawManageEditor();
    toast("Тариф удалён");
  }catch(error){
    toast(
      error instanceof Error
        ? error.message
        : "Не удалось удалить тариф",
      4400
    );
  }
}

/*
  Опись того, что уйдёт вместе с ПВЗ. Считается по уже загруженным
  данным: человек должен увидеть объём потери до того, как подтвердит, а
  не узнать о нём из сообщения об успехе.
*/
function pointDeletionSummary(pointId){
  const pointShifts=
    shifts.filter(item=>
      item.dbPointId===pointId
    );

  const months=new Set(
    pointShifts.map(item=>
      item.date.slice(0,7)
    )
  );

  const employees=new Set(
    pointShifts.map(item=>
      item.employeeId
    )
  );

  return {
    shifts:pointShifts.length,
    months:months.size,
    employees:employees.size,
    amount:pointShifts.reduce(
      (sum,item)=>
        sum+(Number(item.baseAmount) || 0),
      0
    ),
    /*
      Считаются все назначения, а не только активные: каскад унесёт и те,
      что помечены снятыми.
    */
    links:teamData.employeePoints.filter(
      item=>item.point_id===pointId
    ).length,
    tariffs:pointTariffs(pointId).length
  };
}

function pointDeletionDetail(point){
  const summary=
    pointDeletionSummary(point.id);

  const parts=[
    `Тарифов: ${summary.tariffs}`,
    `Сотрудников: ${summary.links}`
  ];

  if(summary.shifts){
    parts.unshift(
      `Смен: ${summary.shifts} за ${summary.months} мес. на ${money(summary.amount)}`
    );
  }

  /*
    Название ПВЗ стоит в заголовке, в поле подтверждения и на его
    подсказке; «навсегда» — в заголовке и на кнопке. Здесь остаётся
    только опись: что именно будет стёрто.
  */
  return parts.join(" · ");
}

async function deleteManagedPoint(){
  const point=manageEditorDraft?.point;

  if(!point || manageEditorSaving){
    return;
  }

  /*
    Название набирается вручную: удаление необратимо и уносит смены, по
    которым считались выплаты, — промахнуться по такому нельзя.
  */
  if(
    !await appConfirm(
      `Удалить «${point.name}» навсегда?`,
      {
        detail:pointDeletionDetail(point),
        okText:"Удалить навсегда",
        danger:true,
        confirm:point.name,
        confirmLabel:"Наберите название ПВЗ"
      }
    )
  ){
    return;
  }

  manageEditorSaving=true;

  try{
    const removed=
      await deleteAdminPointWithHistory({
        id:point.id,
        name:point.name
      });

    closeManageEditor();
    await refreshTeamData();

    toast(
      removed?.shifts
        ? `ПВЗ удалён вместе с ${removed.shifts} сменами`
        : "ПВЗ удалён",
      3600
    );
  }catch(error){
    toast(
      pointDeleteError(error),
      4400
    );
  }finally{
    manageEditorSaving=false;
  }
}

function pointDeleteError(error){
  const message=
    error instanceof Error
      ? error.message
      : String(error || "");

  if(message.includes("point_name_mismatch")){
    return "Название не совпадает: ПВЗ не удалён";
  }

  if(
    message.includes("point_has_history") ||
    message.includes("shifts_point_id_fkey")
  ){
    return "Не удалось удалить историю ПВЗ. Обновите страницу и попробуйте снова.";
  }

  if(message.includes("point_not_found")){
    return "ПВЗ больше не существует";
  }

  if(message.includes("forbidden")){
    return "Недостаточно прав для удаления ПВЗ";
  }

  return message || "Не удалось удалить ПВЗ";
}

/*
  Ставки сотрудника на одном ПВЗ, новые сверху.
*/
function employeeRatesFor(employeeId,pointId){
  return (teamData.employeeRates || [])
    .filter(
      rate=>
        rate.employee_id===employeeId &&
        rate.point_id===pointId
    )
    .sort((a,b)=>
      b.effective_from.localeCompare(
        a.effective_from
      )
    );
}

/* Ставка, действующая сегодня. Её и видно в строке ПВЗ. */
function currentEmployeeRate(employeeId,pointId){
  const today=localYMD();

  return employeeRatesFor(
    employeeId,
    pointId
  ).find(
    rate=>
      rate.effective_from<=today
  ) || null;
}

function employeeRateLabel(rate){
  if(!rate){
    return "По тарифу ПВЗ";
  }

  return rate.pricing_type==="fixed"
    ? `${money(rate.fixed_rate)} с ${shortDateLabel(rate.effective_from)}`
    : `По ШК с ${shortDateLabel(rate.effective_from)}`;
}

/*
  Дата, с которой предлагается начать новую ставку: день после последней
  имеющейся, но не раньше сегодня — задним числом ставка меняла бы уже
  посчитанные смены только после явного пересчёта, и предлагать такое по
  умолчанию не стоит.
*/
function nextEmployeeRateDate(employeeId,pointId){
  const today=localYMD();

  const last=employeeRatesFor(
    employeeId,
    pointId
  )[0];

  if(!last){
    return today;
  }

  const next=nextYMD(
    last.effective_from
  );

  return next>today ? next : today;
}

function openEmployeeRateEditor(
  pointId,
  rate=null
){
  const pending=
    rate
      ? null
      : pendingEmployeeRate(pointId);

  employeeRateEditor={
    pointId,
    id:rate?.id || null,
    rate:
      pending
        ? String(pending.rate).replace(".",",")
        : rate && rate.pricing_type==="fixed"
          ? String(rate.fixed_rate).replace(".",",")
          : "",
    effectiveFrom:
      pending?.effectiveFrom ||
      rate?.effective_from ||
      nextEmployeeRateDate(
        employeeDraft?.id,
        pointId
      ),
    /* Ступени по ШК редактором не правятся — см. employeeRateEditor. */
    readOnlyTiers:
      Boolean(rate) &&
      rate.pricing_type!=="fixed"
  };
}

function closeEmployeeRateEditor(){
  employeeRateEditor=null;
  employeeRateSaving=false;
}

function readEmployeeRateEditor(){
  if(!employeeRateEditor){
    return;
  }

  const field=
    document.getElementById(
      "employeeRateAmount"
    );

  if(field){
    employeeRateEditor.rate=
      field.value;
  }
}

/*
  Ставка, которую человек задал в карточке, но она ещё не сохранена: так
  бывает у нового сотрудника и у ПВЗ, который только что отметили. Пока
  назначения нет в базе, сервер ставку принять не может — её негде
  привязать. Поэтому она ждёт в черновике и создаётся сразу после того,
  как карточка сохранена.
*/
function pendingEmployeeRate(pointId){
  return employeeDraft?.pendingRates?.[pointId] || null;
}

/*
  Назначение уже есть в базе — значит ставку можно сохранять сразу, своей
  кнопкой. Иначе она попадёт в черновик и уедет вместе с карточкой.
*/
function assignmentSaved(pointId){
  return Boolean(
    employeeDraft?.id &&
    (teamData.employeePoints || []).some(
      link=>
        link.employee_id===
          employeeDraft.id &&
        link.point_id===pointId &&
        link.active!==false
    )
  );
}

/*
  Что написано в строке ПВЗ справа: сохранённая ставка, ещё не
  сохранённая или «по тарифу ПВЗ».
*/
function employeeRowRateLabel(pointId){
  const pending=pendingEmployeeRate(pointId);

  if(pending){
    return `${money(pending.rate)} с ${shortDateLabel(pending.effectiveFrom)}`;
  }

  return employeeRateLabel(
    currentEmployeeRate(
      employeeDraft?.id,
      pointId
    )
  );
}

function employeeRowHasRate(pointId){
  return Boolean(
    pendingEmployeeRate(pointId) ||
    currentEmployeeRate(
      employeeDraft?.id,
      pointId
    )
  );
}

/*
  Редактор ставки раскрывается под своим ПВЗ — там же, где человек
  только что отметил этот пункт. Отдельного списка ставок нет: ставка
  принадлежит назначению, а не сотруднику вообще, и второй проход по тем
  же ПВЗ был бы тем же списком дважды.
*/
function employeeRateEditorHTML(point){
  const history=employeeRatesFor(
    employeeDraft.id,
    point.id
  );

  const pending=pendingEmployeeRate(point.id);

  const rows=history
    .map(rate=>`
      <div class="employee-rate-history-row">
        <span class="employee-rate-history-main">
          ${esc(employeeRateLabel(rate))}
        </span>

        <span class="employee-rate-history-actions">
          <button
            type="button"
            data-employee-rate-edit="${esc(rate.id)}"
          >
            Изменить
          </button>

          <button
            type="button"
            class="warn"
            data-employee-rate-delete="${esc(rate.id)}"
          >
            Убрать
          </button>
        </span>
      </div>
    `)
    .join("");

  return `
    <div class="employee-rate-editor">
      ${employeeRateEditor.readOnlyTiers ? `
        <div class="employee-rate-note">
          Ставка по ШК меняется в тарифе ПВЗ. Здесь её можно убрать.
        </div>
      ` : `
        <label class="row">
          <div class="t">Ставка</div>
          <input
            type="text"
            inputmode="decimal"
            id="employeeRateAmount"
            value="${esc(employeeRateEditor.rate)}"
            placeholder="0"
            aria-label="Индивидуальная ставка на ${esc(point.name)}"
            autocomplete="off"
          >
        </label>

        <button
          type="button"
          class="row point-row"
          id="employeeRateDateOpen"
        >
          <div class="t">Действует с</div>
          <div class="point-value">
            ${esc(dateLabel(employeeRateEditor.effectiveFrom))}
          </div>
        </button>
      `}

      <div class="employee-rate-actions">
        <button
          type="button"
          class="btn"
          id="employeeRateCancel"
        >
          Отменить
        </button>

        ${employeeRateEditor.readOnlyTiers ? "" : `
          <button
            type="button"
            class="btn gold"
            id="employeeRateSave"
            ${employeeRateSaving ? "disabled" : ""}
          >
            ${
              employeeRateEditor.id || pending
                ? "Сохранить ставку"
                : "Задать ставку"
            }
          </button>
        `}
      </div>

      ${pending ? `
        <div class="employee-rate-note">
          Сохранится вместе с карточкой.
        </div>
      ` : ""}

      ${employeeRowHasRate(point.id) && !employeeRateEditor.readOnlyTiers ? `
        <button
          type="button"
          class="btn warn employee-rate-drop"
          data-employee-rate-drop="${esc(point.id)}"
        >
          Вернуть на тариф ПВЗ
        </button>
      ` : ""}

      ${/*
          История показывается, когда ей есть что добавить. Одна
          единственная запись — это и есть та ставка, что в строке ПВЗ и
          в полях выше; повторять её третий раз значит превращать
          карточку в список одного и того же.
        */""}
      ${history.length>1 ? `
        <div class="employee-rate-history">
          <div class="employee-rate-history-title">
            История ставок
          </div>
          ${rows}
        </div>
      ` : ""}
    </div>
  `;
}

/*
  Сохранение ставки живёт отдельно от сохранения карточки сотрудника:
  это отдельная запись в своей таблице, и её «Готово» — своя кнопка. То
  же решение, что у тарифа ПВЗ, и по той же причине: карточка остаётся
  открытой и сразу показывает новое состояние.
*/
/*
  Создаёт ставки, дожидавшиеся сохранения карточки. Возвращает текст
  ошибки, если хоть одна не создалась, и ничего — если всё прошло.
*/
async function createPendingEmployeeRates(employeeId){
  const pending=
    employeeDraft?.pendingRates || {};

  const entries=Object.entries(pending);

  if(!entries.length){
    return null;
  }

  employeeDraft.pendingRates={};

  for(const [pointId,value] of entries){
    try{
      await addAdminEmployeeRate({
        employeeId,
        pointId,
        effectiveFrom:value.effectiveFrom,
        pricingType:"fixed",
        fixedRate:value.rate
      });
    }catch(error){
      return error instanceof Error
        ? error.message
        : "не удалось сохранить";
    }
  }

  return null;
}

async function saveEmployeeRate(){
  if(
    !employeeRateEditor ||
    !employeeDraft ||
    employeeRateSaving
  ){
    return;
  }

  readEmployeeRateEditor();

  const {
    pointId,
    id,
    effectiveFrom
  }=employeeRateEditor;

  try{
    if(!isValidDateString(effectiveFrom)){
      throw new Error(
        `Выберите дату с ${MIN_YEAR} по ${MAX_YEAR} год`
      );
    }

    const amount=
      validateMoneyField(
        employeeRateEditor.rate
          .trim()
          .replace(",","."),
        "Ставка",
        {
          allowEmpty:false,
          max:MAX_MONEY
        }
      );

    if(amount){
      throw new Error(amount);
    }

    const value=Number(
      employeeRateEditor.rate
        .trim()
        .replace(",",".")
    );

    if(!(value>0)){
      throw new Error(
        "Ставка должна быть больше нуля"
      );
    }

    /*
      Две ставки с одной датой начала — это противоречие: какая из них
      действует, ответить нечем. Сервер ловит это ограничением, но
      сказать об этом понятнее стоит здесь.
    */
    const clash=employeeRatesFor(
      employeeDraft.id,
      pointId
    ).some(
      rate=>
        rate.id!==id &&
        rate.effective_from===
          effectiveFrom
    );

    if(clash){
      throw new Error(
        "Ставка с этой даты уже есть"
      );
    }

    /*
      Назначения ещё нет в базе — привязать ставку не к чему. Она ждёт
      в черновике и создаётся сразу после сохранения карточки, поэтому
      нового сотрудника заводят за один проход, не открывая карточку
      второй раз.
    */
    if(!assignmentSaved(pointId)){
      employeeDraft.pendingRates={
        ...employeeDraft.pendingRates,
        [pointId]:{
          rate:value,
          effectiveFrom
        }
      };

      closeEmployeeRateEditor();
      drawEmployeeSheet();
      toast("Ставка сохранится вместе с карточкой");
      return;
    }

    employeeRateSaving=true;

    if(id){
      await updateAdminEmployeeRate({
        id,
        effectiveFrom,
        pricingType:"fixed",
        fixedRate:value
      });
    }else{
      await addAdminEmployeeRate({
        employeeId:employeeDraft.id,
        pointId,
        effectiveFrom,
        pricingType:"fixed",
        fixedRate:value
      });
    }

    await refreshTeamData({
      renderAfter:false
    });

    closeEmployeeRateEditor();
    drawEmployeeSheet();

    toast(
      id
        ? "Ставка сохранена"
        : "Индивидуальная ставка задана"
    );
  }catch(error){
    toast(
      error instanceof Error
        ? error.message
        : "Не удалось сохранить ставку",
      4200
    );
  }finally{
    employeeRateSaving=false;
  }
}

/*
  «Вернуть на тариф ПВЗ» убирает действующую ставку. Незаписанную —
  просто из черновика, сохранённую — записью, с подтверждением: это
  меняет условия работы, а не оформление.
*/
async function dropEmployeeRate(pointId){
  if(!employeeDraft){
    return;
  }

  if(pendingEmployeeRate(pointId)){
    const rest={...employeeDraft.pendingRates};

    delete rest[pointId];

    employeeDraft.pendingRates=rest;

    closeEmployeeRateEditor();
    drawEmployeeSheet();
    toast("Ставка убрана");
    return;
  }

  const current=currentEmployeeRate(
    employeeDraft.id,
    pointId
  );

  if(!current){
    closeEmployeeRateEditor();
    drawEmployeeSheet();
    return;
  }

  await removeEmployeeRate(current.id);
}

async function removeEmployeeRate(id){
  const rate=(teamData.employeeRates || [])
    .find(item=>item.id===id);

  if(!rate){
    toast("Ставка не найдена");
    return;
  }

  const agreed=await appConfirm(
    "Убрать индивидуальную ставку?",
    {
      detail:"Новые смены будут считаться по тарифу ПВЗ. Сохранённые не изменятся.",
      okText:"Убрать",
      danger:true
    }
  );

  if(!agreed){
    return;
  }

  try{
    await deleteAdminEmployeeRate(id);

    await refreshTeamData({
      renderAfter:false
    });

    closeEmployeeRateEditor();
    drawEmployeeSheet();
    toast("Ставка убрана");
  }catch(error){
    toast(
      error instanceof Error
        ? error.message
        : "Не удалось убрать ставку",
      4200
    );
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
      setHTML(
        body,
        `
        <div class="card">
          <div class="employee-empty">
            Сотрудник не найден.
          </div>
        </div>
      `
      );

      return;
    }

    if(isSystemSubstitute(employee)){
      setHTML(
        body,
        `
        <div class="ml">
          Системная карточка
        </div>

        <div class="card employee-detail">
          <div class="row">
            <div class="l">
              <div class="s">Название</div>
              <div class="t">Подмена</div>
            </div>
          </div>

          <div class="row">
            <div class="l">
              <div class="s">Назначение</div>
              <div class="t">Для учёта смен подменного сотрудника</div>
            </div>
          </div>

          <div class="row">
            <div class="l">
              <div class="s">Пункты выдачи</div>
              <div class="t">Доступна на всех ПВЗ</div>
            </div>
          </div>

          <div class="row">
            <div class="l">
              <div class="s">Расчёты</div>
              <div class="t">Не отображается в итогах</div>
            </div>
          </div>

          <div class="row">
            <div class="l">
              <div class="s">Аккаунт</div>
              <div class="t">Не создаётся</div>
            </div>
          </div>
        </div>

        <div class="employee-help">
          Карточка защищена от изменений. Нужна для смен подменных сотрудников.
        </div>

        <div
          class="sheet-spacer"
          aria-hidden="true"
        ></div>
      `
      );

      return;
    }

    const account=
      employeeAccount(
        employee
      );

    /*
      Ставка — свойство назначения, а не отдельный список: у каждого ПВЗ
      сразу видно, по чему здесь считаются смены.
    */
    const assignedPoints=
      employeePointsOf(employee.id);

    const pointRows=
      assignedPoints.length
        ? assignedPoints
            .map(point=>{
              const rate=
                currentEmployeeRate(
                  employee.id,
                  point.id
                );

              return `
                <div class="row">
                  <div class="l">
                    <div class="t">
                      ${esc(point.name)}
                    </div>
                    <div class="s ${rate ? "employee-rate-own" : ""}">
                      ${esc(employeeRateLabel(rate))}
                    </div>
                  </div>
                </div>
              `;
            })
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

    setHTML(
      body,
      `
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
                    : "Без аккаунта"
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

      <div
        class="sheet-spacer"
        aria-hidden="true"
      ></div>
    `
    );

    return;
  }

  const isCreate=
    employeeSheetMode==="create";

  const selectedPoints=
    new Set(
      employeeDraft.pointIds
    );

  const availablePoints=
    orderedTeamPoints()
      .filter(
        point=>
          point.active!==false ||
          selectedPoints.has(point.id)
      );

  /*
    Архивный ПВЗ нельзя назначить заново, но уже существующее
    назначение остаётся кликабельным, чтобы его можно было снять.
  */
  const pointRows=
    availablePoints.length
      ? availablePoints
        .map(point=>{
          const selected=
            selectedPoints.has(
              point.id
            );

          const archived=
            point.active===false;

          const archivedLabel=archived
            ? `
              <span class="employee-point-state">
                В архиве
              </span>
            `
            : "";

          /*
            Ставка показывается только у назначенного ПВЗ: у не
            отмеченного пункта её негде применить, и предлагать её
            значило бы звать задать условие для работы, которой нет.
          */
          const rateControl=
            selected && isAdmin && !employeeDraft.isSystem
              ? `
                <button
                  type="button"
                  class="employee-point-rate"
                  data-employee-rate-point="${esc(point.id)}"
                  aria-expanded="${
                    employeeRateEditor?.pointId===point.id
                      ? "true"
                      : "false"
                  }"
                  aria-label="Ставка на ${esc(point.name)}: ${esc(employeeRowRateLabel(point.id))}"
                >
                  <span class="employee-point-rate-value ${
                    employeeRowHasRate(point.id)
                      ? "employee-rate-own"
                      : ""
                  }">
                    ${esc(employeeRowRateLabel(point.id))}
                  </span>
                </button>
              `
              : "";

          return `
            <div
              class="employee-point-item ${
                employeeRateEditor?.pointId===point.id
                  ? "is-open"
                  : ""
              }"
              data-key="employee-point-${esc(point.id)}"
            >
              <div class="employee-point-line">
                <button
                  type="button"
                  class="employee-point ${selected ? "on" : ""} ${archived ? "employee-point-archived" : ""}"
                  data-employee-point="${esc(point.id)}"
                  aria-label="${esc(point.name)}, ${archived ? "в архиве" : "активен"}, ${selected ? "назначен" : "не назначен"}"
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

                  ${archivedLabel}
                </button>

                ${rateControl}
              </div>

              ${
                employeeRateEditor?.pointId===point.id
                  ? employeeRateEditorHTML(point)
                  : ""
              }
            </div>
          `;
        })
        .join("")
      : `
        <div class="employee-points-empty" role="status">
          <div class="employee-points-empty-title">
            Пункты выдачи ещё не добавлены
          </div>
          <div class="employee-points-empty-detail">
            Добавьте ПВЗ в разделе «Пункты выдачи и тарифы».
          </div>
        </div>
      `;

  setHTML(
    body,
    `
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

    <div class="card reveal-box employee-account-box">
      ${
        employeeDraft.userId
          ? ""
          : `
            <div class="segbox employee-account-mode">
              <div class="seg">
                <button
                  type="button"
                  data-employee-account-mode="none"
                  class="${employeeDraft.accountEnabled ? "" : "on"}"
                >
                  Без аккаунта
                </button>

                <button
                  type="button"
                  data-employee-account-mode="create"
                  class="${employeeDraft.accountEnabled ? "on" : ""}"
                >
                  Создать аккаунт
                </button>
              </div>
            </div>
          `
      }

      ${fieldRevealHTML({
        key:"employeeAccountReveal",
        open:Boolean(
          employeeDraft.userId ||
          employeeDraft.accountEnabled
        ),
        body:`
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
              <div class="employee-secret-input">
                <input
                  type="text"
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

                <span
                  class="employee-secret-mask"
                  aria-hidden="true"
                >${"•".repeat((employeeDraft.password || "").length)}</span>
              </div>

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
        `
      })}
    </div>

    <div class="employee-help">
      ${employeeDraft.userId
        ? "Пустой пароль сохранит текущий."
        : employeeDraft.accountEnabled
          ? "Сотрудник сможет войти с этой почтой и паролем."
          : "Смены и расчёты работают и без входа сотрудника."}
    </div>

    <div class="ml">
      Пункты выдачи
    </div>

    <div class="card employee-points">
      ${pointRows}
    </div>

    <div class="note employee-rate-hint">
      Новая ставка не меняет уже сохранённые смены.
    </div>

    ${!isCreate && employeeDraft.id && !employeeDraft.isSystem ? `
      <button
        type="button"
        class="btn warn manage-employee-delete"
        id="employeeDelete"
      >
        Удалить сотрудника
      </button>
    ` : ""}
  `
  );

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

  /*
    Речь только об аккаунте: номер сотрудника делить можно, вход — нет.
    Раньше сюда же попадал employees_phone_uidx и любой «duplicate key»,
    и один номер у матери и сына читался как ошибка.
  */
  if(
    message.includes(
      "user_already_exists"
    ) ||
    message.includes(
      "phone_exists"
    ) ||
    message.includes(
      "email_exists"
    )
  ){
    return "Этот номер или почта уже заняты другим аккаунтом";
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
      isSystem:false,
      hiredAt:"",
      userId:null,
      accountEnabled:false,
      email:"",
      phone:"",
      transferPhone:"",
      transferBank:"",
      transferRecipient:"",
      password:"",
      pointIds:[],
      /*
        Ставки, заданные до того, как появилось назначение в базе. См.
        pendingEmployeeRate.
      */
      pendingRates:{}
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
    pendingRates:{},
    id:employee.id,
    fullName:employee.full_name,
    status:employee.status,
    isSystem:
      isSystemSubstitute(
        employee
      ),
    hiredAt:employee.hired_at || "",
    userId:employee.user_id || null,
    accountEnabled:
      Boolean(employee.user_id),
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

    whenAnimationsSettle(
      animations,
      ()=>{
        animations.forEach(
          animation=>
            animation.cancel()
        );

        oldApp.remove();

        app.style.removeProperty(
          "opacity"
        );

        manageTransitionRunning=false;
        runPendingNavigation();
      }
    );
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
    runPendingNavigation();
  }
}

/*
  Архив — такой же переход вглубь раздела, как и переход между разделами
  «Управления», поэтому он идёт тем же движением: уход в архив сдвигает
  содержимое вперёд, возврат — назад. Раньше список подменялся мгновенно,
  и было непонятно, что именно сменилось — список или его фильтр.
*/
function toggleArchiveView(toArchive,apply){
  if(transitionsRunning()){
    queueNavigation(()=>
      toggleArchiveView(toArchive,apply)
    );

    return;
  }

  animateManageView(
    ()=>{
      apply();
      setPageScrollTop(0);
      render();
    },
    toArchive ? 1 : -1
  );
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

  actionButton.hidden=false;

  if(
    employeeSheetMode==="view" &&
    employeeDraft?.isSystem
  ){
    title.textContent="Подмена";
    cancelButton.textContent="Закрыть";
    actionButton.hidden=true;
    actionButton.disabled=true;
    return;
  }

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
  if(
    !employeeDraft?.id ||
    employeeDraft.isSystem
  ){
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

  closeEmployeeRateEditor();

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

    focusSheetSurface(sheet);
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
  closeEmployeeRateEditor();

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

  const accountEnabled=
    Boolean(
      employeeDraft.userId ||
      employeeDraft.accountEnabled
    );

  const password=
    accountEnabled
      ? employeeDraft.password || ""
      : "";

  const email=
    accountEnabled
      ? String(
          employeeDraft.email || ""
        )
          .trim()
          .toLowerCase()
      : "";

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
    accountEnabled &&
    (!email || !password)
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
        employmentType:"staff",
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

    /*
      Ставки, заданные до появления назначения, создаются сразу после
      карточки — назначения к этому моменту уже записаны, и привязать их
      есть к чему. Отказ ставки карточку не отменяет: сотрудник сохранён,
      а ставку можно задать ещё раз, поэтому о ней сообщается отдельно.
    */
    const pendingRateFailure=
      await createPendingEmployeeRates(
        employeeId
      );

    let authFailure=null;
    let creationRolledBack=false;

    if(
      employeeDraft.userId ||
      accountEnabled
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
          : pendingRateFailure
            ? `Карточка сохранена. Ставка не задана: ${pendingRateFailure}`
            : "Сотрудник сохранён",
        authFailure || pendingRateFailure
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
        : pendingRateFailure
          ? `Карточка сохранена. Ставка не задана: ${pendingRateFailure}`
          : "Сотрудник сохранён",
      authFailure || pendingRateFailure
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
    employeeSheetMode!=="edit" ||
    employeeDraft.isSystem
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
          "Карточка и аккаунт входа будут удалены. Сотрудника со сменами удалить нельзя."
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
    )
  ){
    return;
  }

  if(nextSection===manageSection){
    dropPendingNavigation();
    return;
  }

  if(transitionsRunning()){
    queueNavigation(()=>
      changeManageSection(
        nextSection,
        direction
      )
    );

    return;
  }

  animateManageView(
    ()=>{
      manageSection=
        nextSection;

      employeeDraft=null;
      employeeSaving=false;
      closeEmployeeRateEditor();

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

function shiftEmployeeOptions(
  value=draft
){
  return shiftEmployeeChoices({
    employees:teamData.employees,
    employeePoints:
      teamData.employeePoints,
    pointId:
      value?.dbPointId || "",
    selectedEmployeeId:
      value?.employeeId || ""
  });
}

function shiftPointOptions(
  value=draft
){
  return shiftPointChoices(
    orderedTeamPoints(),
    value?.dbPointId || ""
  );
}

function statsEmployeeOptions(){
  return teamData.employees
    .filter(
      employee=>
        !isSystemSubstitute(
          employee
        )
    );
}

function cloneShiftDraft(value){
  return {
    ...value,
    dates:Array.isArray(value.dates)
      ? [...value.dates]
      : undefined,
    bonuses:(value.bonuses || [])
      .map(item=>({...item})),
    penalties:(value.penalties || [])
      .map(item=>({...item}))
  };
}

/*
  Несколько дат живут только у новой смены. У сохранённой правится
  ровно та смена, которую открыли, — список дат там сбивал бы с толку и
  плодил записи при каждом сохранении.
*/
function draftDates(value){
  if(!Array.isArray(value?.dates) || !value.dates.length){
    return value?.date ? [value.date] : [];
  }

  return [...new Set(value.dates)].sort();
}

function multiDateMode(){
  return (
    shiftSheetMode==="create" &&
    Boolean(draft) &&
    !shifts.some(item=>item.id===draft.id)
  );
}

/*
  Дата смены — всегда первая из выбранных: по ней считаются тариф и
  расчёт, её же показывает строка при одной дате.
*/
function syncDraftDates(list){
  const sorted=[...new Set(list)].sort();

  draft.dates=sorted;
  draft.date=sorted[0] || draft.date;
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

  resetShiftInline();

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
      : {
          v:3,
          id:createTeamId(),
          employeeId:"",
          employeeName:"",
          date:defaultShiftDate(),
          /*
            Новую смену заводят сразу на несколько дней: `dates` — все
            выбранные даты, `date` — первая из них. Всё, что считает
            смену (тариф, расчёт, проверки), продолжает работать с одной
            датой, а сохранение обходит список.
          */
          dates:[defaultShiftDate()],
          /*
            Дата подставлена приложением, а не выбрана человеком: первый
            же тап по календарю её заменит. Иначе выбравший один день
            получил бы две смены — свою и подставленную.
          */
          datesTouched:false,
          dbPointId:"",
          pointId:"",
          point:"",
          type:"main",
          shk:"",
          partial:false,
          hours:"",
          baseOverride:"",
          baseOverrideReason:"",
          baseOverrideMode:
            "tariff",
          bonuses:[],
          penalties:[],
          note:""
        };

  shiftOriginalDraft=savedShift
    ? cloneShiftDraft(savedShift)
    : null;

  shiftSheetMode=savedShift
    ? restoredDraft
      ? "edit"
      : "view"
    : "create";

  if(
    ![
      "tariff",
      "manual"
    ].includes(
      draft.baseOverrideMode
    )
  ){
    draft.baseOverrideMode=
      draft.baseOverride===""
        ? "tariff"
        : "manual";
  }

  const isEdit=Boolean(savedShift);
  document.getElementById("sheetTitle").textContent=isEdit ? "Смена" : "Новая смена";
  document.getElementById("sheetCancel").textContent=
    shiftSheetMode==="view"
      ? "Закрыть"
      : shiftSheetMode==="edit"
        ? "Назад"
        : "Отмена";
  document.getElementById("sheetSave").textContent=
    shiftSheetMode==="view"
      ? "Изменить"
      : "Готово";
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

      focusSheetSurface(sheet);
    });
  }else{
    requestAnimationFrame(()=>{
      sheet.scrollTop=Math.max(
        0,
        restoredScrollTop
      );

      focusSheetSurface(sheet);
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
  shiftOriginalDraft=null;
  shiftSheetMode="create";
  resetShiftInline();
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

function shiftDraftChanged(){
  if(!draft){
    return false;
  }

  readForm();

  if(shiftOriginalDraft){
    return JSON.stringify(draft)!==
      JSON.stringify(shiftOriginalDraft);
  }

  return Boolean(
    draft.dbPointId ||
    draft.employeeId ||
    /* Набранные даты — такая же несохранённая работа, как и поля. */
    draftDates(draft).length>1 ||
    draft.shk!=="" ||
    draft.partial ||
    draft.baseOverride!=="" ||
    draft.baseOverrideReason?.trim() ||
    draft.bonuses?.length ||
    draft.penalties?.length ||
    draft.note?.trim()
  );
}

async function requestCloseShiftSheet(){
  if(!draft){
    closeSheet();
    return;
  }

  if(shiftSheetMode==="view"){
    closeSheet();
    return;
  }

  if(
    shiftDraftChanged() &&
    !await appConfirm(
      "Закрыть без сохранения?",
      {
        detail:"Внесённые в смену данные будут потеряны.",
        okText:"Закрыть",
        danger:true
      }
    )
  ){
    return;
  }

  if(
    shiftSheetMode==="edit" &&
    shiftOriginalDraft
  ){
    draft=cloneShiftDraft(
      shiftOriginalDraft
    );
    shiftSheetMode="view";
    document.getElementById("sheetCancel").textContent="Закрыть";
    document.getElementById("sheetSave").textContent="Изменить";
    drawSheet(true);
    document.getElementById("sheet").scrollTop=0;
    saveUIState();
    return;
  }

  closeSheet();
}

let datePickerHideTimer;
let dateCalendarCursor="";
let datePickerValue="";
let datePickerTarget="shift";
let dateJumpYear=0;
let dateJumpValue="";
let dateSwipe=null;
let dateSwipeBlockClick=false;

/*
  Поиск и список, раскрытые внутри плитки. Оформление здесь то же, что у
  строк карточки: разделители, отступы и подсветка выбранного совпадают с
  остальным приложением — от отдельного окна остаётся только содержимое.
*/
function inlineSearchHTML({
  id,
  value,
  label
}){
  return `
    <label class="inline-search">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5"></circle>
        <path d="M12.5 12.5L17 17"></path>
      </svg>

      <input
        type="search"
        id="${id}"
        value="${esc(value || "")}"
        placeholder="Поиск"
        autocomplete="off"
        spellcheck="false"
        aria-label="${esc(label)}"
      >
    </label>
  `;
}

/*
  Поле, в котором человек прямо сейчас набирает текст.

  Проверяется не «есть ли фокус», а «можно ли туда печатать»: забирать
  фокус у кнопки или у страницы безобидно, у поля ввода — нет.
*/
function typingTarget(element){
  if(!(element instanceof HTMLElement)){
    return false;
  }

  if(element.isContentEditable){
    return true;
  }

  if(
    element.tagName!=="INPUT" &&
    element.tagName!=="TEXTAREA"
  ){
    return false;
  }

  return (
    !element.disabled &&
    !element.readOnly
  );
}

/*
  Поле поиска забирает фокус только там, где есть аппаратная клавиатура:
  на телефоне раскрытие списка не должно поднимать клавиатуру поверх него.

  И не отбирает поле у того, кто уже печатает.

  Фокус ставится следующим кадром: раскрытие только что перерисовало
  форму, и до кадра поля ещё нет. Кадр может задержаться — на медленном
  устройстве, в фоновой вкладке, под идущей анимацией, — и прийти, когда
  человек уже ушёл в соседнее поле и набирает там. Тогда фокус
  перепрыгивал, а набранное уходило в чужое поле: в «Фактическую оплату»
  оно попадало под фильтр цифр и исчезало совсем.

  Поэтому перед тем, как забрать фокус, смотрим, не печатает ли человек
  уже где-то ещё. Печатает — значит фокус принадлежит ему.
*/
function focusInlineSearch(id){
  if(
    !window.matchMedia(
      "(hover:hover) and (pointer:fine)"
    ).matches
  ){
    return;
  }

  requestAnimationFrame(()=>{
    const field=document.getElementById(id);

    if(!field){
      return;
    }

    const active=document.activeElement;

    if(
      active!==field &&
      typingTarget(active)
    ){
      return;
    }

    field.focus({preventScroll:true});
  });
}

function inlineOptionsHTML({
  options,
  value,
  attribute
}){
  if(!options.length){
    return `
      <div class="inline-empty">
        Ничего не найдено
      </div>
    `;
  }

  return `
    <div class="inline-options">
      ${options.map(option=>`
        <button
          type="button"
          class="point-option ${option.value===value?"on":""}"
          ${attribute}="${esc(option.value)}"
        >
          <span class="point-check">
            ${option.value===value?"\u2713":""}
          </span>

          <span class="point-name">
            ${esc(option.label)}
          </span>
        </button>
      `).join("")}
    </div>
  `;
}

/*
  Раскрытый список — отдельная область внутри плитки, а не продолжение
  её строк: он лежит на утопленном фоне и отделён от параметров формы
  заметной чертой. Подписи у него нет — строка, из которой он вырос, и
  поле поиска уже говорят, что именно выбирают.

  Поиск стоит всегда, а не по числу текущих записей: сотрудников и ПВЗ
  заводят со временем, и список, короткий на пустой базе, у живой команды
  длинный. Пропадающее поле поиска пришлось бы искать заново.
*/
function inlineChoiceHTML({
  options,
  value,
  attribute,
  searchId,
  searchQuery,
  searchLabel,
  searchable=true
}){
  const visible=
    searchable
      ? filterChoiceOptions(
          options,
          searchQuery
        )
      : options;

  return `
    <div class="inline-choice">
      ${searchable
        ? inlineSearchHTML({
            id:searchId,
            value:searchQuery,
            label:searchLabel
          })
        : ""}

      ${inlineOptionsHTML({
        options:visible,
        value,
        attribute
      })}
    </div>
  `;
}

/*
  Календарь внутри плитки: те же навигация, сетка и переход к месяцу и
  году, что и в модальном окне, только без самого окна.
*/
/*
  Календарь внутри плитки: те же навигация, сетка и переход к месяцу и
  году, что и в модальном окне, только без самого окна.

  Заголовок стоит в обоих режимах и работает в обе стороны. Раньше режим
  месяца и года подменял собой всё содержимое, включая заголовок, и
  выйти из него можно было только выбрав месяц: передумавшему некуда
  было нажать. По той же причине здесь есть «Текущий месяц» — иначе из
  далёкого года возвращаться приходилось стрелками.
*/
function inlineCalendarHTML({
  cursor,
  selected,
  jumpOpen,
  jumpYear,
  prefix,
  taken=null,
  footer=""
}){
  const [year,month]=
    cursor.split("-").map(Number);

  const head=`
    <div class="date-calendar-head">
      <button
        type="button"
        class="date-calendar-nav"
        data-${prefix}-step="-1"
        aria-label="${jumpOpen ? "Предыдущий год" : "Предыдущий месяц"}"
        ${
          jumpOpen
            ? (jumpYear<=MIN_YEAR ? "disabled" : "")
            : (cursor===`${MIN_YEAR}-01` ? "disabled" : "")
        }
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M13 4L7 10L13 16"></path>
        </svg>
      </button>

      <button
        type="button"
        class="date-calendar-title"
        data-${prefix}-jump="${jumpOpen ? "close" : "open"}"
        aria-expanded="${jumpOpen ? "true" : "false"}"
      >
        ${jumpOpen
          ? jumpYear
          : `${MONTHS[month-1]} ${year}`}
      </button>

      <button
        type="button"
        class="date-calendar-nav"
        data-${prefix}-step="1"
        aria-label="${jumpOpen ? "Следующий год" : "Следующий месяц"}"
        ${
          jumpOpen
            ? (jumpYear>=MAX_YEAR ? "disabled" : "")
            : (cursor===`${MAX_YEAR}-12` ? "disabled" : "")
        }
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M7 4L13 10L7 16"></path>
        </svg>
      </button>
    </div>
  `;

  if(jumpOpen){
    return `
      <div class="inline-calendar">
        ${head}

        <div class="date-jump-months">
          ${calendarMonthsHTML(
            jumpYear,
            cursor,
            `data-${prefix}-month`
          )}
        </div>

        <button
          type="button"
          class="date-today"
          data-${prefix}-current="1"
        >
          Текущий месяц
        </button>
      </div>
    `;
  }

  return `
    <div class="inline-calendar">
      ${head}

      <div class="date-weekdays">
        <span>Пн</span>
        <span>Вт</span>
        <span>Ср</span>
        <span>Чт</span>
        <span>Пт</span>
        <span>Сб</span>
        <span>Вс</span>
      </div>

      <div class="date-grid">
        ${calendarDaysHTML(cursor,selected,taken)}
      </div>

      <button
        type="button"
        class="date-today"
        data-${prefix}-today="1"
      >
        Сегодня
      </button>

      ${footer}
    </div>
  `;
}

/*
  Сетка дней одна и та же в модальном окне и в календаре, раскрытом
  внутри плитки «Смена»: отличается только то, куда её кладут.
*/
/*
  `selected` — одна дата или несколько: при создании смены календарь
  набирает сразу все дни, на которые её заводят.

  `taken` — дни, на которые у выбранного сотрудника смена такого же типа
  уже есть. Они не запрещены (основная и дополнительная в один день —
  обычное дело), но помечены: человек видит совпадение до сохранения, а
  не после.
*/
function calendarDaysHTML(
  cursor,
  selected,
  taken=null
){
  const chosen=
    selected instanceof Set
      ? selected
      : new Set(
          Array.isArray(selected)
            ? selected
            : [selected].filter(Boolean)
        );

  const [year,month]=
    cursor.split("-").map(Number);

  const firstDay=
    new Date(year,month-1,1,12);

  const mondayOffset=
    (firstDay.getDay()+6)%7;

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
    const isSelected=chosen.has(ymd);
    const isToday=ymd===today;
    const isTaken=taken?.has(ymd)===true;
    const outOfRange=day.getFullYear()<MIN_YEAR || day.getFullYear()>MAX_YEAR;

    html+=`
      <button
        type="button"
        class="date-day
          ${outside?"outside":""}
          ${isSelected?"on":""}
          ${isToday?"today":""}
          ${isTaken?"taken":""}
        "
        data-date="${ymd}"
        aria-label="${esc(dateLabel(ymd))}${isSelected?", выбрана":""}${isTaken?", смена уже есть":""}"
        aria-pressed="${isSelected?"true":"false"}"
        ${outOfRange?"disabled":""}
      >
        ${day.getDate()}
      </button>
    `;
  }

  return html;
}

function calendarMonthsHTML(
  year,
  selected,
  attribute="data-calendar-month"
){
  return MONTHS
    .map((month,index)=>{
      const ym=
        year+"-"+
        String(index+1)
          .padStart(2,"0");

      return `
        <button
          type="button"
          class="date-jump-month ${ym===selected?"on":""}"
          ${attribute}="${ym}"
        >
          ${month}
        </button>
      `;
    })
    .join("");
}

function drawDatePicker(){
  const [year,month]=dateCalendarCursor.split("-").map(Number);

  document.getElementById("datePickerMonth").textContent=
    MONTHS[month-1]+" "+year;

  document.getElementById("datePrev").disabled=dateCalendarCursor===`${MIN_YEAR}-01`;
  document.getElementById("dateNext").disabled=dateCalendarCursor===`${MAX_YEAR}-12`;

  setHTML(
    document.getElementById("dateGrid"),
    calendarDaysHTML(
      dateCalendarCursor,
      datePickerValue
    )
  );
}

function drawDateJump(){
  document.getElementById("dateJumpYear").textContent=
    dateJumpYear;

  document.getElementById("dateJumpPrevYear").disabled=dateJumpYear<=MIN_YEAR;
  document.getElementById("dateJumpNextYear").disabled=dateJumpYear>=MAX_YEAR;

  setHTML(
    document.getElementById("dateJumpMonths"),
    calendarMonthsHTML(
      dateJumpYear,
      dateJumpValue
    )
  );
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

  whenAnimationsSettle(
    animations,
    ()=>{
      animations.forEach(
        animation=>animation.cancel()
      );

      oldGrid.remove();
      oldTitle.remove();

      grid.style.removeProperty(
        "pointer-events"
      );

      dateCalendarTransitionRunning=false;
    }
  );
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

  if(
    target==="employeeRate" &&
    !employeeRateEditor
  ) return;

  if(
    target==="payout" &&
    !payoutEditor
  ) return;

  datePickerTarget=target;

  if(target==="shift"){
    readForm();
  }else if(target==="tariff"){
    readManageEditor();
  }else if(target==="employeeRate"){
    readEmployeeRateEditor();
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
      : target==="payout"
        ? payoutEditor.paidOn
        : target==="employeeRate"
          ? employeeRateEditor.effectiveFrom
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
  },MODAL_HIDE_DELAY);
}

function selectDate(ymd){
  if(datePickerTarget==="payout"){
    if(!payoutEditor) return;

    payoutEditor.paidOn=ymd;

    closeDatePicker();
    render();
    return;
  }

  if(datePickerTarget==="employeeRate"){
    if(!employeeRateEditor) return;

    employeeRateEditor.effectiveFrom=
      ymd;

    closeDatePicker();
    drawEmployeeSheet();
    return;
  }

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
let pointPickerOptions=[];
let pointPickerSearchQuery="";
let pointPickerSearchable=false;

function drawChoicePickerOptions(){
  const list=
    document.getElementById(
      "pointList"
    );

  const options=
    filterChoiceOptions(
      pointPickerOptions,
      pointPickerSearchQuery
    );

  setHTML(
    list,
    options.length
      ? options.map(option=>`
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
        `).join("")
      : `
          <div class="point-picker-empty">
            Ничего не найдено
          </div>
        `
  );
}

function openChoicePicker({
  kind,
  value,
  title,
  options,
  searchable=false
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
  pointPickerOptions=
    options.map(option=>({
      ...option
    }));

  pointPickerSearchQuery="";
  pointPickerSearchable=
    searchable===true;

  picker.classList.toggle(
    "has-search",
    pointPickerSearchable
  );

  const searchWrap=
    document.getElementById(
      "pointPickerSearchWrap"
    );

  const search=
    document.getElementById(
      "pointPickerSearch"
    );

  searchWrap.hidden=
    !pointPickerSearchable;

  search.value="";
  search.setAttribute(
    "aria-label",
    `Поиск: ${title}`
  );

  document
    .getElementById(
      "pointPickerTitle"
    )
    .textContent=title;

  drawChoicePickerOptions();

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
    const desktop=
      window.matchMedia(
        "(hover:hover) and (pointer:fine)"
      ).matches;

    if(
      pointPickerSearchable &&
      desktop
    ){
      search.focus({
        preventScroll:true
      });
      return;
    }

    const selected=
      list.querySelector(
        ".point-option.on"
      ) ||
      list.querySelector(
        ".point-option"
      );

    if(selected){
      selected.scrollIntoView({
        block:"center"
      });
      selected.focus();
    }
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
    MODAL_HIDE_DELAY
  );
}

function shiftPricingDriversEqual(
  existing,
  value
){
  return Boolean(
    existing &&
    !pricingDriversChanged(
      existing,
      value
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

    if(existing?.pricing && sameDrivers){
      pricing=existing.pricing;
    }else{
      if(!point){
        throw new Error(
          "Выберите ПВЗ"
        );
      }

      /*
        Ставка выбирается тем же правилом, что и на сервере: сначала
        индивидуальная ставка сотрудника на этом ПВЗ, потом тариф ПВЗ.
        Иначе расчёт в форме расходился бы с сохранённой суммой.
      */
      const resolved=shiftRateForDate({
        tariffs:teamData.tariffs,
        employeeRates:teamData.employeeRates,
        employeeId:value.employeeId,
        pointId:point.id,
        shiftDate:value.date
      });

      pricing=createPricingSnapshot({
        tariff:resolved.tariff,
        point,
        shiftDate:value.date,
        shk:value.shk,
        source:resolved.source,
        employeeId:value.employeeId || null
      });
    }
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
  const calculatedBase=value.partial
    ? Math.round(perHour*hours)
    : pricing.rate;
  const override=
    value.baseOverride==="" ||
    value.baseOverride===null ||
    value.baseOverride===undefined
      ? null
      : Number(value.baseOverride);
  const base=
    override!==null &&
    Number.isFinite(override) &&
    override>=0
      ? override
      : calculatedBase;
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
    /* Снимок нужен целиком: по нему видно, откуда взялась ставка. */
    pricing,
    fixed:pricing.fixed,
    rate:pricing.rate,
    hours,
    perHour,
    calculatedBase,
    baseOverridden:
      base!==calculatedBase,
    base,
    bonus,
    fine,
    total:base+bonus-fine
  };
}

function penaltyPayoutLabel(
  payoutKind,
  shiftDate=draft?.date
){
  if(
    !payoutKind ||
    !shiftDate
  ){
    return "По умолчанию";
  }

  const month=
    shiftDate.slice(0,7);

  const payoutDate=
    payoutKind==="first_half"
      ? `${month}-25`
      : `${shiftMonth(month,1)}-10`;

  return dateLabel(payoutDate);
}

function penaltyPayoutControlsHTML(
  item,
  index
){
  const payoutKind=
    item.payoutKind ||
    "";

  const options=[
    ["","По умолчанию"],
    [
      "first_half",
      penaltyPayoutLabel(
        "first_half"
      )
    ],
    [
      "second_half",
      penaltyPayoutLabel(
        "second_half"
      )
    ]
  ];

  return `
    <div class="adjustment-payout">
      <div class="adjustment-payout-title">Удержать из выплаты</div>
      <div class="segbox">
        <div class="seg adjustment-payout-seg">
          ${options.map(([value,label])=>`
            <button
              type="button"
              data-penalty-payout-index="${index}"
              data-penalty-payout-kind="${value}"
              class="${payoutKind===value ? "on" : ""}"
            >
              ${esc(label)}
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  `;
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
      ${(rows || []).map((item,index)=>fieldRevealHTML({
        key:`${kind}-${item.id}`,
        open:
          !adjustmentEntering.has(item.id) &&
          !adjustmentLeaving.has(item.id),
        className:"adjustment-reveal",
        body:`
        <div class="adjustment-row" data-adjustment-kind="${kind}" data-adjustment-index="${index}">
          <label class="row">
            <div class="t">${label}</div>
            <input type="text" inputmode="decimal" data-adjustment-amount value="${esc(String(item.amount ?? "").replace(".",","))}" placeholder="0" autocomplete="off">
          </label>
          <label class="row">
            <div class="t">Комментарий</div>
            <input type="text" data-adjustment-comment value="${esc(item.comment || "")}" autocomplete="off">
          </label>
          ${kind==="penalties"
            ? penaltyPayoutControlsHTML(
                item,
                index
              )
            : ""}
          <button type="button" class="adjustment-remove" data-adjustment-remove="${kind}:${index}">
            Удалить
          </button>
        </div>
      `
      })).join("")}

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
        <div class="row adjustment-readonly-row">
          <div class="l">
            <div class="t">${esc(item.comment)}</div>
            ${negative && item.payoutKind ? `
              <div class="s">
                Удержать ${esc(
                  penaltyPayoutLabel(
                    item.payoutKind
                  )
                )}
              </div>
            ` : ""}
          </div>
          <div class="v ${negative ? "neg" : "pos"}">
            ${negative ? "− " : "+ "}${money(item.amount)}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

/*
  С какой даты действует то, по чему смена посчитана. У старых снимков
  даты может не быть — тогда и говорить нечего.
*/
function rateEffectiveLabel(pricing){
  const from=pricing?.effectiveFrom;

  return typeof from==="string" && from
    ? `с ${shortDateLabel(from)}`
    : "—";
}

function calcHTML(){
  const result=previewCalc(draft);

  if(!result.available){
    return `
      <div class="calc-error">
        ${esc(result.error)}${draft.dbPointId ? ". Задайте тариф в карточке ПВЗ." : ""}
      </div>
    `;
  }

  /*
    Откуда ставка — часть расчёта, а не украшение: при одинаковой сумме
    «своя ставка» и «тариф ПВЗ» означают разные договорённости, и
    увидеть это нужно в самой смене, а не восстанавливать по карточкам.
  */
  const fromEmployeeRate=
    result.pricing?.rateSource==="employee";

  return `
    <div class="ln">
      <span>${result.fixed ? "Оклад смены" : "Ставка по объёму"}</span>
      <b>${money(result.rate)}</b>
    </div>
    <div class="ln calc-rate-source">
      <span>${
        fromEmployeeRate
          ? "Индивидуальная ставка сотрудника"
          : "Тариф ПВЗ"
      }</span>
      <b>${esc(
        rateEffectiveLabel(result.pricing)
      )}</b>
    </div>
    ${draft.partial?`<div class="ln"><span>${nf(result.perHour)} ₽/час × ${hoursWord(result.hours)}</span><b>${money(result.calculatedBase)}</b></div>`:""}
    ${result.baseOverridden?`<div class="ln"><span>Оплата за смену</span><b>${money(result.base)}</b></div>`:""}
    ${result.bonus?`<div class="ln"><span>Премии</span><b class="pos">+ ${money(result.bonus)}</b></div>`:""}
    ${result.fine?`<div class="ln"><span>Штрафы</span><b class="neg">− ${money(result.fine)}</b></div>`:""}
    <div class="tot"><span>За смену</span><span>${money(result.total)}</span></div>`;
}

/*
  Дни, на которые у выбранного сотрудника уже заведена смена того же
  типа. Пока сотрудник не выбран, помечать нечего.
*/
function takenShiftDates(){
  if(!draft?.employeeId){
    return null;
  }

  return new Set(
    shifts
      .filter(item=>
        item.employeeId===draft.employeeId &&
        item.type===draft.type &&
        item.id!==draft.id
      )
      .map(item=>item.date)
  );
}

function shiftDatesLabel(){
  const dates=draftDates(draft);

  if(!multiDateMode() || dates.length<2){
    return dateLabel(draft.date);
  }

  return `${datesWord(dates.length)}: ${shortDateList(dates)}`;
}

/* Подряд идущие дни сворачиваются в промежуток: «4–8, 12 сентября». */
function shortDateList(dates){
  const runs=[];

  for(const date of dates){
    const last=runs.at(-1);

    if(last && nextYMD(last.at(-1))===date){
      last.push(date);
      continue;
    }

    runs.push([date]);
  }

  const day=value=>Number(value.slice(8,10));

  return runs
    .map(run=>
      run.length>1
        ? `${day(run[0])}–${day(run.at(-1))}`
        : String(day(run[0]))
    )
    .join(", ");
}

/*
  Выбранные даты показаны списком под календарём: в сетке видно только
  текущий месяц, а выбор может уйти и в соседний. Здесь же они и
  снимаются.
*/
function selectedDatesHTML(){
  if(!multiDateMode()){
    return "";
  }

  const dates=draftDates(draft);

  return `
    <div class="date-chosen">
      <div class="date-chosen-head">
        ${dates.length>1
          ? `Выбрано ${datesWord(dates.length)} — будет создано столько же смен`
          : draft.datesTouched
            ? "Отметьте ещё дни, чтобы создать несколько смен сразу"
            : "Можно отметить сразу несколько дней."}
      </div>

      <div class="date-chosen-list">
        ${dates.map(date=>`
          <button
            type="button"
            class="date-chip"
            data-shift-date-remove="${date}"
            aria-label="Убрать ${esc(dateLabel(date))}"
            ${dates.length<2 ? "disabled" : ""}
          >
            <span>${esc(shortDateLabel(date))}</span>
            <span class="date-chip-remove" aria-hidden="true">×</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

/*
  По какому тарифу посчитана смена.

  Стоимость смены фиксируется снимком тарифа в момент сохранения и потом
  сама не меняется. Пока этот снимок нигде не показывался, отличие цены
  от текущего тарифа выглядело ошибкой расчёта: человек видел 3 000 ₽ на
  дате, где тариф уже 3 500 ₽, и не мог узнать, что смена просто заведена
  раньше этого тарифа.
*/
function appliedTariffRowHTML(value){
  const pricing=value?.pricing;

  if(!pricing?.rate){
    return "";
  }

  /*
    У снимков до появления индивидуальных ставок поля нет, и других
    ставок тогда не существовало — значит тариф ПВЗ.
  */
  const source=
    pricing.rateSource==="employee"
      ? "своя ставка"
      : "тариф ПВЗ";

  const from=pricing.effectiveFrom
    ? `${source} с ${shortDateLabel(pricing.effectiveFrom)}`
    : source;

  return `
    <div class="row shift-detail-readonly-row">
      <div class="l">
        <div class="s">Ставка</div>
        <div class="t">${money(pricing.rate)} · ${esc(from)}</div>
      </div>
    </div>
  `;
}

/*
  Тариф, действующий на дату смены сейчас. Если он разошёлся со снимком,
  смена заведена до его появления — это не ошибка, но и молчать об этом
  нельзя.
*/
function currentTariffFor(value){
  if(!value?.dbPointId || !value?.date){
    return null;
  }

  try{
    /*
      Сравнивать нужно с тем, по чему смена посчиталась бы сейчас, —
      включая индивидуальную ставку. Иначе появление своей ставки у
      сотрудника осталось бы незамеченным, а пересчёт менял бы сумму
      молча.
    */
    return shiftRateForDate({
      tariffs:teamData.tariffs,
      employeeRates:teamData.employeeRates,
      employeeId:value.employeeId,
      pointId:value.dbPointId,
      shiftDate:value.date
    }).tariff;
  }catch{
    return null;
  }
}

/*
  Расхождение считается по ставке, а не только по идентификатору тарифа:
  администратор может изменить ставку существующего тарифа на месте —
  идентификатор тогда прежний, а деньги другие.
*/
function tariffDivergesFromSnapshot(value){
  const pricing=value?.pricing;
  const current=currentTariffFor(value);

  if(!pricing?.rate || !current){
    return null;
  }

  let rate;

  try{
    /* Та же функция, что считает ставку при сохранении смены. */
    rate=Number(
      rateForTariff(current,value.shk)
    );
  }catch{
    return null;
  }

  return rate!==Number(pricing.rate)
    ? current
    : null;
}

/*
  Пересчёт предлагается только там, где он что-то значит: у смены с
  оплатой, назначенной вручную, тариф сумму не определяет.
*/
function canRepriceShift(value){
  return Boolean(
    isAdmin &&
    !value?.baseOverrideReason &&
    tariffDivergesFromSnapshot(value)
  );
}

function tariffDivergenceHTML(value){
  const current=tariffDivergesFromSnapshot(value);

  if(!current){
    return "";
  }

  const rate=current.pricing_type==="fixed"
    ? money(current.fixed_rate)
    : "другой тариф";

  return `
    <div class="note shift-tariff-note">
      Смена посчитана по прежнему тарифу. На
      ${esc(dateLabel(value.date))} сейчас действует ${esc(rate)}
      с ${esc(shortDateLabel(current.effective_from))}.
      ${value?.baseOverrideReason
        ? "Сумма задана вручную — тариф её не меняет."
        : ""}
    </div>
  `;
}

function drawSheet(isEdit){
  const result=previewCalc(draft);
  const fixed=result.fixed;
  const manualPayment=
    draft.baseOverrideMode===
      "manual";

  if(
    !isAdmin ||
    shiftSheetMode==="view"
  ){
    const employee=
      teamData.employees.find(
        item=>item.id===draft.employeeId
      );

    setHTML(
      document.getElementById("sheetBody"),
      `
      <div class="ml">Смена</div>
      <div class="card">
        <div class="row shift-detail-readonly-row"><div class="l"><div class="s">Дата</div><div class="t">${esc(dateLabel(draft.date))}</div></div></div>
        <div class="row shift-detail-readonly-row"><div class="l"><div class="s">ПВЗ</div><div class="t">${esc(draft.point)}</div></div></div>
        ${isAdmin ? `<div class="row shift-detail-readonly-row"><div class="l"><div class="s">Сотрудник</div><div class="t">${esc(employee?.full_name || draft.employeeName || "Не указан")}</div></div></div>` : ""}
        <div class="row shift-detail-readonly-row"><div class="l"><div class="s">Тип</div><div class="t">${draft.type==="extra" ? "Дополнительная" : "Основная"}</div></div></div>
        <div class="row shift-detail-readonly-row"><div class="l"><div class="s">Часы</div><div class="t">${hoursWord(result.hours)}</div></div></div>
        ${fixed ? "" : `<div class="row shift-detail-readonly-row"><div class="l"><div class="s">Объём</div><div class="t">${nf(Number(draft.shk)||0)} ШК</div></div></div>`}
        <div class="row shift-detail-readonly-row"><div class="l"><div class="s">Смена</div><div class="t">${money(result.base)}</div></div></div>
        ${draft.baseOverrideReason ? `<div class="row shift-detail-readonly-row"><div class="l"><div class="s">Причина корректировки</div><div class="t">${esc(draft.baseOverrideReason)}</div></div></div>` : ""}
        ${appliedTariffRowHTML(draft)}
      </div>
      ${tariffDivergenceHTML(draft)}
      ${adjustmentReadOnlyHTML("Премии",draft.bonuses)}
      ${adjustmentReadOnlyHTML("Штрафы",draft.penalties,true)}
      ${draft.note ? `
        <div class="ml">Комментарий</div>
        <div class="card"><div class="row"><div class="l"><div class="t">${esc(draft.note)}</div></div></div></div>
      ` : ""}
      <div class="ml">Итого</div>
      <div class="calc">${calcHTML()}</div>
      <div class="sheet-spacer" aria-hidden="true"></div>
    `
    );
    return;
  }

  const selectedEmployee=
    shiftEmployeeOptions()
      .find(
        employee=>
          employee.id===
          draft.employeeId
      );

  setHTML(
    document.getElementById("sheetBody"),
    `
    <div class="ml">Смена</div>
    <div class="card">
      <button
        type="button"
        class="row point-row"
        id="f-date-open"
        aria-expanded="${shiftInlineField==="date" ? "true" : "false"}"
      >
        <div class="t">Дата</div>
        <div class="point-value">${esc(shiftDatesLabel())}</div>
      </button>

      ${fieldRevealHTML({
        key:"shiftDateReveal",
        open:shiftInlineField==="date",
        body:inlineCalendarHTML({
          cursor:
            shiftDateCursor ||
            draft.date.slice(0,7),
          selected:multiDateMode()
            ? draftDates(draft)
            : draft.date,
          taken:takenShiftDates(),
          footer:selectedDatesHTML(),
          jumpOpen:shiftDateJumpOpen,
          jumpYear:
            shiftDateJumpYear ||
            Number(draft.date.slice(0,4)),
          prefix:"shift-date"
        })
      })}

      <button
        type="button"
        class="row point-row"
        id="f-point-open"
        aria-expanded="${shiftInlineField==="point" ? "true" : "false"}"
      >
        <div class="t">Пункт</div>
        <div class="point-value">${esc(draft.point || "Выберите пункт")}</div>
      </button>

      ${fieldRevealHTML({
        key:"shiftPointReveal",
        open:shiftInlineField==="point",
        body:inlineChoiceHTML({
          options:shiftPointOptions()
            .map(point=>({
              value:point.id,
              label:
                point.name+
                (
                  point.active===false
                    ? " · в архиве"
                    : ""
                ),
              searchText:[
                point.name,
                point.code,
                point.id
              ].join(" ")
            })),
          value:draft.dbPointId,
          attribute:"data-shift-point",
          searchId:"shiftPointSearch",
          searchQuery:
            shiftInlineField==="point"
              ? shiftInlineQuery
              : "",
          searchLabel:"Поиск пункта"
        })
      })}

      <button
        type="button"
        class="row point-row shift-employee-row"
        id="f-employee-open"
        aria-expanded="${shiftInlineField==="employee" ? "true" : "false"}"
      >
        <div class="t">Сотрудник</div>
        <div class="point-value">
          ${esc(
            selectedEmployee?.full_name ||
            (
              draft.dbPointId
                ? "Выберите сотрудника"
                : "Сначала выберите пункт"
            )
          )}
        </div>
      </button>

      ${fieldRevealHTML({
        key:"shiftEmployeeReveal",
        open:shiftInlineField==="employee",
        body:inlineChoiceHTML({
          options:shiftEmployeeOptions()
            .map(employee=>({
              value:employee.id,
              label:
                employee.full_name+
                (
                  employee.status==="inactive"
                    ? " · в архиве"
                    : ""
                ),
              searchText:[
                employee.full_name,
                employee.phone,
                employee.transfer_phone,
                employee.transfer_bank,
                employee.transfer_recipient,
                employeeAccountEmail(
                  employee
                )
              ].filter(Boolean).join(" ")
            })),
          value:draft.employeeId,
          attribute:"data-shift-employee",
          searchId:"shiftEmployeeSearch",
          searchQuery:
            shiftInlineField==="employee"
              ? shiftInlineQuery
              : "",
          searchLabel:"Поиск сотрудника"
        })
      })}

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
    <div class="card reveal-box">
      <div class="segbox"><div class="seg">
        <button type="button" data-part="0" class="${!draft.partial?"on":""}">Полная смена</button>
        <button type="button" data-part="1" class="${draft.partial?"on":""}">Неполная смена</button>
      </div></div>

      ${fieldRevealHTML({
        key:"shiftHoursReveal",
        open:draft.partial,
        body:`
          <label class="row">
            <div class="t">Часов</div>
            <input type="text" inputmode="decimal" id="f-hours" min="0.5" max="${FULL_HOURS-0.5}" step="0.5" value="${esc(draft.hours==="" ? "" : String(draft.hours).replace(".",","))}" placeholder="0" aria-label="Часов" autocomplete="off">
          </label>
        `
      })}
    </div>

    <div class="ml">Оплата</div>
    <div class="card reveal-box payment-mode-box">
      <div class="segbox">
        <div class="seg">
          <button
            type="button"
            data-pay-mode="tariff"
            class="${manualPayment ? "" : "on"}"
          >
            По тарифу
          </button>
          <button
            type="button"
            data-pay-mode="manual"
            class="${manualPayment ? "on" : ""}"
          >
            Корректировка оклада
          </button>
        </div>
      </div>

      ${fieldRevealHTML({
        key:"shiftPaymentReveal",
        open:manualPayment,
        body:`
          <label class="row">
            <div class="t">За смену</div>
            <input type="text" inputmode="decimal" id="f-base-override" value="${esc(draft.baseOverride==="" ? "" : String(draft.baseOverride).replace(".",","))}" placeholder="0" aria-label="Фактическая оплата за смену" autocomplete="off">
          </label>

          <label class="row">
            <div class="t">Комментарий</div>
            <input type="text" id="f-base-reason" value="${esc(draft.baseOverrideReason || "")}" aria-label="Комментарий к корректировке оклада" autocomplete="off">
          </label>
        `
      })}
    </div>

    <div class="ml">Премии</div>
    ${adjustmentEditorHTML("bonuses",draft.bonuses)}

    <div class="ml">Штрафы</div>
    ${adjustmentEditorHTML("penalties",draft.penalties)}

    <div class="ml">Комментарий</div>
    <div class="card">
      <label class="row shift-note-row">
        <input type="text" class="shift-note-input" id="f-note" value="${esc(draft.note || "")}" placeholder="Комментарий" aria-label="Комментарий к смене" autocomplete="off">
      </label>
    </div>

    <div class="ml">Расчёт</div>
    <div class="calc" id="calcBox">${calcHTML()}</div>
    ${isEdit ? tariffDivergenceHTML(draft) : ""}
    ${isEdit && canRepriceShift(draft) ? `
      <button type="button" class="btn" id="f-reprice">Пересчитать по текущему тарифу</button>
    ` : ""}
    ${isEdit?`<button type="button" class="btn warn" id="f-del">Удалить смену</button>`:""}
    <div class="sheet-spacer" aria-hidden="true"></div>`
  );
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

  if(get("f-base-override")){
    const value=
      get("f-base-override")
        .value
        .trim();

    draft.baseOverride=
      value===""
        ? ""
        : value.replace(",",".");
  }

  if(get("f-base-reason")){
    draft.baseOverrideReason=
      get("f-base-reason").value;
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
  if(!shiftPointOptions(value).some(point=>point.id===value.dbPointId)) return {message:"Выберите ПВЗ",fieldId:"f-point-open"};
  if(!shiftEmployeeOptions(value).some(employee=>employee.id===value.employeeId)) return {message:"Выберите сотрудника этого ПВЗ",fieldId:"f-employee-open"};

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
      const resolved=shiftRateForDate({
        tariffs:teamData.tariffs,
        employeeRates:teamData.employeeRates,
        employeeId:value.employeeId,
        pointId:point.id,
        shiftDate:value.date
      });
      const pricing=createPricingSnapshot({
        tariff:resolved.tariff,
        point,
        shiftDate:value.date,
        shk:value.shk,
        source:resolved.source,
        employeeId:value.employeeId || null
      });
      calculateBaseAmount(
        pricing,
        {
          partial:value.partial,
          hours:value.hours
        }
      );
    }

    const baseAmountError=
      validateMoneyField(
        value.baseOverride,
        "Оплата за смену",
        {
          allowEmpty:
            value.baseOverrideMode!==
              "manual",
          max:MAX_MONEY
        }
      );

    if(baseAmountError){
      return {
        message:baseAmountError,
        fieldId:"f-base-override"
      };
    }

    const result=previewCalc(value);

    /*
      Причина относится к самой корректировке: комментарий смены остаётся
      свободным полем и больше не обязан её объяснять.
    */
    if(
      value.baseOverride!=="" &&
      result.baseOverridden &&
      !String(
        value.baseOverrideReason || ""
      ).trim()
    ){
      return {
        message:"Укажите причину корректировки оклада",
        fieldId:"f-base-reason"
      };
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
        if(
          kind==="penalties" &&
          ![
            "",
            "first_half",
            "second_half"
          ].includes(
            item.payoutKind ||
            ""
          )
        ){
          return {
            message:
              `Выберите выплату для штрафа ${index+1}`,
            fieldId:null
          };
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
    baseOverride:
      value.baseOverride===""
        ? ""
        : Number(value.baseOverride),
    baseOverrideReason:
      String(
        value.baseOverrideReason || ""
      ).trim(),
    note:String(value.note || "").trim(),
    bonuses:value.bonuses.map(item=>({
      ...item,
      amount:Number(item.amount),
      comment:item.comment.trim()
    })),
    penalties:value.penalties.map(item=>({
      ...item,
      amount:Number(item.amount),
      comment:item.comment.trim(),
      payoutKind:
        item.payoutKind ||
        ""
    }))
  };
}

function showValidationError(error){
  toast(error.message,3000);

  /*
    Фокус на незаполненном поле откладывается, чтобы не спорить с
    всплывающим сообщением, и по той же причине не отбирается у того, кто
    за эти миллисекунды успел начать печатать в другом поле.
  */
  setTimeout(()=>{
    const field=document.getElementById(error.fieldId);

    if(!field){
      return;
    }

    const active=document.activeElement;

    if(
      active!==field &&
      typingTarget(active)
    ){
      return;
    }

    field.focus();
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

  setHTML(
    grid,
    MONTHS.map(
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
  ).join("")
  );
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
  },MODAL_HIDE_DELAY);
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
  if(nextCursor===cursor){
    return;
  }

  if(transitionsRunning()){
    /*
      Каждый тап по стрелке — шаг на месяц. Шаги во время перехода
      складываются: три быстрых «вперёд» ведут на три месяца вперёд, а не
      на тот, что был следующим в момент последнего тапа.
    */
    const target=shiftMonth(
      pendingNavigation?.month ?? cursor,
      monthOffset(cursor,nextCursor)
    );

    queueNavigation(
      ()=>changeMonth(
        target,
        Math.sign(monthOffset(cursor,target)) || direction,
        {scrollTop}
      ),
      {month:target}
    );

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

    whenAnimationsSettle(
      animations,
      ()=>{
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
        runPendingNavigation();
      }
    );
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
    runPendingNavigation();
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
let monthPickerYearPendingDirection=0;
let dateJumpYearPendingDirection=0;

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

    whenAnimationsSettle(
      animations,
      ()=>{
        animations.forEach(
          animation=>animation.cancel()
        );

        oldGrid?.remove();
        oldLabel?.remove();

        grid.style.removeProperty(
          "pointer-events"
        );

        finish();
      }
    );
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
    monthPickerYearPendingDirection=
      direction;
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

      const pending=
        monthPickerYearPendingDirection;

      monthPickerYearPendingDirection=0;

      if(pending){
        changeMonthPickerYear(
          pending
        );
      }
    }
  });
}

function changeDateJumpYear(direction){
  if(dateJumpYearTransitionRunning){
    dateJumpYearPendingDirection=
      direction;
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

      const pending=
        dateJumpYearPendingDirection;

      dateJumpYearPendingDirection=0;

      if(pending){
        changeDateJumpYear(
          pending
        );
      }
    }
  });
}

function bindYearSwipe(
  element,
  changeYear
){
  let swipe=null;
  let suppressClickUntil=0;

  /* Год листается меньшим путём: окно узкое, и жест в нём короче. */
  const wheelGesture=
    createWheelGesture({distance:32});

  element.addEventListener(
    "pointerdown",
    e=>{
      if(
        !e.isPrimary ||
        e.pointerType==="mouse" &&
        e.button!==0
      ){
        return;
      }

      swipe={
        id:e.pointerId,
        x:e.clientX,
        y:e.clientY,
        time:performance.now(),
        axis:null,
        moved:false,
        captured:false
      };

      e.stopPropagation();
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

      /*
        Указатель захватывается только когда жест уже стал горизонтальным.

        Захват на pointerdown перенаправлял на окно все последующие
        события указателя вместе с производным click: кнопка под пальцем
        получала pointerdown, а pointerup и click уходили самому окну.
        Внутри окна выбора месяца и панели выбора года в календаре из-за
        этого не работало ничего — ни месяцы, ни стрелки года, ни
        «Текущий месяц», ни «Отмена» с «Готово».
      */
      if(!swipe.captured){
        swipe.captured=true;

        try{
          element.setPointerCapture(
            e.pointerId
          );
        }catch{}
      }

      swipe.moved=true;

      if(e.cancelable){
        e.preventDefault();
      }

      e.stopPropagation();
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

    e.stopPropagation();

    suppressClickUntil=
      performance.now()+360;

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

  element.addEventListener(
    "wheel",
    event=>{
      const {direction,claim}=
        wheelGesture.push({
          deltaX:event.deltaX,
          deltaY:event.deltaY,
          now:performance.now()
        });

      if(!claim){
        return;
      }

      if(event.cancelable){
        event.preventDefault();
      }

      event.stopPropagation();

      if(!direction){
        return;
      }

      suppressClickUntil=
        performance.now()+360;

      changeYear(direction);
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

bindYearSwipe(
  document.getElementById("monthPicker"),
  changeMonthPickerYear
);

bindYearSwipe(
  document.getElementById("dateJump"),
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

      const pending=
        monthPickerYearPendingDirection;

      monthPickerYearPendingDirection=0;

      if(pending){
        changeMonthPickerYear(
          pending
        );
      }
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

  const dismissSurface=target=>
    target instanceof Element &&
    Boolean(
      target.closest(
        ".grab,.shead,.point-picker-handle,.month-picker-handle,.date-picker-handle,.picker-toolbar"
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

  /*
    Возврат на место — короткая поправка: столько же занимает возврат в
    остальных жестах приложения (src/swipe-close-guard.js,
    src/month-picker-swipe.js). Роспуск окна идёт своим, длинным ходом.
  */
  const snapBack=()=>{
    element.style.transition=
      "transform .26s cubic-bezier(.4,0,.2,1)";

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
    },284);
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
        blockedTarget(event.target) ||
        !dismissSurface(event.target)
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
        blockedTarget(event.target) ||
        !dismissSurface(event.target)
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
        !dismissSurface(event.target) ||
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

const monthWheelGesture=
  createWheelGesture();
let pendingMonthWheelDirections=[];

function queueMonthWheelDirection(
  direction
){
  if(
    pendingMonthWheelDirections
      .length>=1
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
      activeModal()
    ){
      /*
        Экран сменился посреди жеста — жест на этом и заканчивается, а не
        ждёт своего продолжения: вернувшись, человек начинает новый.
      */
      monthWheelGesture.cancel();

      return;
    }

    const {direction,claim}=
      monthWheelGesture.push({
        deltaX:event.deltaX,
        deltaY:event.deltaY,
        now:performance.now()
      });

    if(!claim){
      return;
    }

    /*
      Горизонтальный жест удерживается с первых шагов: иначе его успевает
      забрать себе браузер под перелистывание истории, и остаток свайпа до
      страницы уже не доходит.
    */
    if(event.cancelable){
      event.preventDefault();
    }

    event.stopPropagation();

    if(!direction){
      return;
    }

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

/*
  Уход в другой основной раздел возвращает покинутый раздел на его
  базовый экран.

  Разделы держат своё состояние между переключениями, и для настроек
  экрана это правильно: месяц, выбранный в «Итогах» сотрудник, поиск и
  фильтры списков человек задал осознанно и видит на самом экране,
  вернувшись. А вот вложенный экран и раскрытый внутри страницы список —
  не настройка, а место, где человек остановился. «Управление»,
  открывшееся сразу в «Сотрудниках» через полчаса после ухода, и
  раскрытый поверх цифр список сотрудников в «Итогах» — это и есть
  продолжение чужого, уже забытого состояния.

  Правило одно на все разделы: вложенный экран закрывается, раскрытое
  внутри страницы сворачивается, временный поиск внутри раскрытого
  очищается. У «Смен» и «Данных» вложенных экранов нет, и сбрасывать им
  нечего — правило для них просто ничего не делает.

  Внутренняя навигация раздела сюда не заходит: переход между
  «Управлением», «Сотрудниками» и «ПВЗ» идёт через changeManageSection и
  свайп, и состояние там сохраняется, как и прежде.

  Данные при этом потерять нельзя. Пока открыт лист, выбор или календарь,
  нижняя навигация скрыта и не принимает нажатий (body.sheet-open и
  соседние состояния), так что уйти в другой раздел из формы невозможно —
  уходят всегда со страницы раздела, где несохранённого нет.
*/
function resetSectionOnLeave(section){
  if(section==="manage"){
    manageSection="home";
    return;
  }

  if(section==="stats"){
    statsEmployeeOpen=false;
    statsEmployeeQuery="";
    expandedPayoutKind="";
  }
}

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
    dropPendingNavigation();
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

  if(transitionsRunning()){
    queueNavigation(()=>
      changeTab(nextTab)
    );

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
    resetSectionOnLeave(tab);

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

  app.style.transform=
    `translate3d(${startX}px,0,0)`;

  void app.offsetWidth;

  let animation;

  try{
    animation=app.animate(
      [
        {
          transform:
            `translate3d(${startX}px,0,0)`
        },
        {
          transform:"translate3d(0,0,0)"
        }
      ],
      {
        duration:220,
        easing:
          "cubic-bezier(.2,.8,.2,1)",
        fill:"both"
      }
    );

    app.style.transform="translate3d(0,0,0)";
  }catch{
    app.style.removeProperty(
      "transform"
    );

    tabTransitionRunning=false;

    finish();
    runPendingNavigation();
    return;
  }

  whenAnimationsSettle(
    [animation],
    ()=>{
      animation.cancel();

      app.style.removeProperty(
        "transform"
      );

      tabTransitionRunning=false;

      finish();
      runPendingNavigation();
    }
  );
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

document.getElementById("veil").onclick=()=>{
  void requestCloseShiftSheet();
};
document.getElementById("sheetCancel").onclick=()=>{
  void requestCloseShiftSheet();
};
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

      const pending=
        dateJumpYearPendingDirection;

      dateJumpYearPendingDirection=0;

      if(pending){
        changeDateJumpYear(
          pending
        );
      }
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

/* Сетка дней уже окна: тот же жест проходится меньшим путём. */
const dateWheelGesture=
  createWheelGesture({distance:42});

dateGrid.addEventListener(
  "wheel",
  event=>{
    const {direction,claim}=
      dateWheelGesture.push({
        deltaX:event.deltaX,
        deltaY:event.deltaY,
        now:performance.now()
      });

    if(!claim){
      return;
    }

    if(event.cancelable){
      event.preventDefault();
    }

    event.stopPropagation();

    if(!direction){
      return;
    }

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
    cancelManageEditor;

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

    if(button.dataset.tariffEdit){
      const tariff=teamData.tariffs.find(
        item=>
          item.id===
          button.dataset.tariffEdit
      );

      if(!tariff){
        toast("Тариф не найден");
        return;
      }

      openTariffEditor(
        "edit-version",
        tariff
      );
      drawManageEditor();
      return;
    }

    if(
      button.dataset.tariffEditCancel!==
      undefined
    ){
      closeTariffEditor();
      drawManageEditor();
      return;
    }

    if(
      button.dataset.tariffEditSave!==
      undefined
    ){
      void saveOpenTariff();
      return;
    }

    if(button.dataset.tariffDelete){
      void removeHistoricalTariff(
        button.dataset.tariffDelete
      );
      return;
    }

    if(button.id==="managePointDelete"){
      void deleteManagedPoint();
      return;
    }

    if(button.id==="manageTariffDateOpen"){
      openDatePicker("tariff");
      return;
    }

    if(button.id==="manageTariffSave"){
      void saveOpenTariff();
      return;
    }

    if(button.id==="manageTariffCancel"){
      closeTariffEditor();
      drawManageEditor();
      return;
    }

    if(button.dataset.tariffIntent){
      openTariffEditor(
        button.dataset.tariffIntent
      );
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
      /*
        Граница добавляется пустой и в конец: последняя строка больше не
        особенная, а подставлять за менеджера числа, которых он не
        называл, — ровно то, от чего уходим.
      */
      manageEditorDraft.tiers.push({
        up_to:"",
        rate:""
      });

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
        pointIds:null
      };

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

      employeeFilterDraft.pointIds=
        toggleFilterSelection(
          employeeFilterDraft.pointIds,
          pointId,
          teamData.points.map(
            point=>point.id
          )
        );

      drawEmployeeFilterSheet();
    }
  }
);

document.getElementById("shiftFilterVeil").onclick=closeShiftFilterSheet;
document.getElementById("shiftFilterCancel").onclick=closeShiftFilterSheet;
document.getElementById("shiftFilterDone").onclick=applyShiftFilter;

shiftFilterSheetElement.addEventListener("input",event=>{
  if(!shiftFilterDraft) return;
  if(event.target.id==="shiftFilterFrom") shiftFilterDraft.fromDay=event.target.value;
  if(event.target.id==="shiftFilterTo") shiftFilterDraft.toDay=event.target.value;
});

shiftFilterSheetElement.addEventListener("click",event=>{
  const button=event.target.closest("button");
  if(!button || !shiftFilterDraft) return;

  if(button.id==="shiftFilterReset"){
    shiftFilterDraft={pointIds:null,employeeIds:null,fromDay:1,toDay:31,period:"all"};
    drawShiftFilterSheet();
    return;
  }

  if(button.dataset.shiftPeriod){
    applyShiftFilterPeriod(button.dataset.shiftPeriod);
    drawShiftFilterSheet();
    return;
  }

  const updateSelection=(key,id)=>{
    const allIds=key==="pointIds"
      ? teamData.points.map(
          point=>point.id
        )
      : teamData.employees.map(
          employee=>employee.id
        );

    shiftFilterDraft[key]=
      toggleFilterSelection(
        shiftFilterDraft[key],
        id,
        allIds
      );
    drawShiftFilterSheet();
  };

  if(button.dataset.shiftFilterPoint!==undefined){
    updateSelection("pointIds",button.dataset.shiftFilterPoint);
  }else if(button.dataset.shiftFilterEmployee!==undefined){
    updateSelection("employeeIds",button.dataset.shiftFilterEmployee);
  }
});

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

    /* Индивидуальные ставки: строка ПВЗ, её редактор и история. */
    if(button.dataset.employeeRatePoint){
      const pointId=
        button.dataset.employeeRatePoint;

      if(
        employeeRateEditor?.pointId===
        pointId
      ){
        closeEmployeeRateEditor();
      }else{
        openEmployeeRateEditor(
          pointId,
          currentEmployeeRate(
            employeeDraft.id,
            pointId
          )
        );
      }

      drawEmployeeSheet();
      return;
    }

    if(button.dataset.employeeRateEdit){
      const rate=(teamData.employeeRates || [])
        .find(item=>
          item.id===
          button.dataset.employeeRateEdit
        );

      if(!rate){
        toast("Ставка не найдена");
        return;
      }

      openEmployeeRateEditor(
        rate.point_id,
        rate
      );

      drawEmployeeSheet();
      return;
    }

    if(button.dataset.employeeRateDrop){
      void dropEmployeeRate(
        button.dataset.employeeRateDrop
      );

      return;
    }

    if(button.dataset.employeeRateDelete){
      void removeEmployeeRate(
        button.dataset.employeeRateDelete
      );

      return;
    }

    if(button.id==="employeeRateDateOpen"){
      openDatePicker("employeeRate");
      return;
    }

    if(button.id==="employeeRateCancel"){
      closeEmployeeRateEditor();
      drawEmployeeSheet();
      return;
    }

    if(button.id==="employeeRateSave"){
      void saveEmployeeRate();
      return;
    }

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
        field.parentElement.classList.toggle(
          "is-visible"
        );

      button.setAttribute(
        "aria-pressed",
        String(visible)
      );

      button.setAttribute(
        "aria-label",
        visible
          ? "Скрыть пароль"
          : "Показать пароль"
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
      button.dataset.employeeAccountMode &&
      !employeeDraft.userId
    ){
      const scrollTop=
        employeeSheetElement.scrollTop;

      employeeDraft.accountEnabled=
        button.dataset.employeeAccountMode===
        "create";

      if(!employeeDraft.accountEnabled){
        employeeDraft.email="";
        employeeDraft.password="";
      }

      drawEmployeeSheet();

      requestAnimationFrame(()=>{
        employeeSheetElement.scrollTop=
          scrollTop;
      });

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

      /*
        Снятый ПВЗ уносит с собой и незаписанную ставку, и открытый
        редактор: условие работы там, где работы больше нет, — это
        обещание, которое некому выполнить.
      */
      if(selected){
        if(pendingEmployeeRate(pointId)){
          const rest={
            ...employeeDraft.pendingRates
          };

          delete rest[pointId];

          employeeDraft.pendingRates=rest;
        }

        if(
          employeeRateEditor?.pointId===
          pointId
        ){
          closeEmployeeRateEditor();
        }
      }

      /*
        Строка ПВЗ несёт ставку, поэтому отметка перерисовывает карточку,
        а не подменяет галочку на месте.
      */
      drawEmployeeSheet();
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
    shiftFilterSheetElement,

  dragProperty:
    "--sheet-drag",

  close:
    closeShiftFilterSheet
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
  close:()=>{
    void requestCloseShiftSheet();
  },

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

  if(shiftSheetMode==="view"){
    shiftSheetMode="edit";
    document.getElementById("sheetCancel").textContent="Назад";
    button.textContent="Готово";
    drawSheet(true);
    document.getElementById("sheet").scrollTop=0;
    return;
  }

  readForm();

  const chosen=
    multiDateMode()
      ? draftDates(draft)
      : [draft.date];

  /*
    Каждая дата проверяется отдельно: тариф ПВЗ у них может быть разным,
    и дата без тарифа должна остановить сохранение до того, как часть
    смен уже создана.
  */
  for(const date of chosen){
    const error=validateDraft({
      ...draft,
      date
    });

    if(error){
      showValidationError(
        chosen.length>1
          ? {
              ...error,
              message:`${dateLabel(date)}: ${error.message}`
            }
          : error
      );

      return;
    }
  }

  const dates=
    await datesToCreate(chosen);

  if(!dates.length){
    return;
  }

  button.disabled=true;

  let created=0;

  try{
    for(const date of dates){
      /*
        Каждая смена получает свой идентификатор — и сама, и её премии
        со штрафами: общий идентификатор на две записи сервер принял бы
        за одну и ту же.
      */
      await saveAdminShift(
        normalizedDraft({
          ...draft,
          id:created ? createTeamId() : draft.id,
          date,
          bonuses:draft.bonuses.map(item=>({
            ...item,
            id:createTeamId()
          })),
          penalties:draft.penalties.map(item=>({
            ...item,
            id:createTeamId()
          }))
        })
      );

      created+=1;
    }

    await refreshTeamData({
      renderAfter:false
    });

    cursor=dates[0].slice(0,7);
    closeSheet();
    render();

    toast(
      dates.length>1
        ? `Создано ${shiftsWord(dates.length)}`
        : "Смена сохранена"
    );
  }catch(error){
    console.error(
      "Не удалось сохранить смену:",
      error
    );

    /*
      Часть смен могла уже сохраниться: человеку нужно знать сколько,
      иначе он повторит целиком и заведёт дубли.
    */
    if(created){
      await refreshTeamData({
        renderAfter:false
      });

      render();
    }

    toast(
      created
        ? `Создано ${created} из ${dates.length}. ${
            error instanceof Error
              ? error.message
              : "Остальные не сохранены"
          }`
        : navigator.onLine
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

/*
  Даты, на которых смена этого сотрудника такого же типа уже есть,
  по умолчанию пропускаются: повтор почти всегда промах, а не замысел.
  Но основная и дополнительная смена в один день — обычное дело, поэтому
  осознанный дубль остаётся возможным, когда свободных дат не осталось.
*/
async function datesToCreate(chosen){
  const taken=chosen.filter(date=>
    shifts.some(item=>
      item.employeeId===draft.employeeId &&
      item.type===draft.type &&
      item.date===date &&
      item.id!==draft.id
    )
  );

  if(!taken.length){
    return chosen;
  }

  const free=chosen.filter(date=>
    !taken.includes(date)
  );

  const listed=taken
    .map(date=>shortDateLabel(date))
    .join(", ");

  if(free.length){
    const agreed=await appConfirm(
      "На части дат смена уже есть",
      {
        detail:`У этого сотрудника уже есть такая смена: ${listed}. Создать только на остальных ${datesWord(free.length)}?`,
        okText:"Создать остальные"
      }
    );

    return agreed ? free : [];
  }

  const agreed=await appConfirm(
    chosen.length>1
      ? "На всех выбранных датах смена уже есть"
      : "На эту дату смена уже есть",
    {
      detail:`У этого сотрудника уже есть такая смена: ${listed}. Создать ещё одну?`,
      okText:"Создать всё равно",
      danger:true
    }
  );

  return agreed ? chosen : [];
}

document.getElementById("sheetBody").addEventListener("click",async e=>{
  const t=e.target.closest("button");

  if(!t || !draft) return;

  const isEdit=shifts.some(x=>x.id===draft.id);

  /*
    Набранное забирается в черновик на входе, до разбора нажатия.

    Почти каждая ветка ниже перерисовывает лист, а перерисовка берёт
    значения полей из черновика: поле, которое туда не попало, теряет
    набранное. Раньше readForm стоял в отдельных ветках, и те, где о нём
    забыли — стрелки месяца в календаре, переключение года, выбор дня, —
    стирали причину корректировки и комментарии премий. Держалось это
    только на постороннем: прокрутка листа роняла таймер сохранения
    состояния, а он читает форму заодно.

    Ветки, которые очищают поля черновика намеренно (переход на тариф
    убирает ручную сумму и её причину), идут после и перекрывают
    прочитанное — порядок именно такой.
  */
  readForm();

  /*
    Раскрытие строки — такая же правка черновика, как ввод в поле: перед
    перерисовкой введённое надо забрать, иначе оно потеряется.
  */
  if(
    [
      "f-date-open",
      "f-point-open",
      "f-employee-open"
    ].includes(t.id)
  ){
    readForm();

    const field=
      t.id==="f-date-open"
        ? "date"
        : t.id==="f-point-open"
          ? "point"
          : "employee";

    if(
      field==="employee" &&
      shiftInlineField!=="employee" &&
      !draft.dbPointId
    ){
      toast(
        "Сначала выберите ПВЗ",
        2600
      );

      document
        .getElementById("f-point-open")
        ?.focus();

      return;
    }

    const opening=
      shiftInlineField!==field;

    shiftInlineField=
      opening ? field : null;
    shiftInlineQuery="";
    shiftDateJumpOpen=false;

    if(field==="date" && opening){
      shiftDateCursor=
        draft.date.slice(0,7);
      shiftDateJumpYear=
        Number(draft.date.slice(0,4));
    }

    drawSheet(isEdit);

    if(opening && field!=="date"){
      focusInlineSearch(
        field==="point"
          ? "shiftPointSearch"
          : "shiftEmployeeSearch"
      );
    }

    return;
  }

  if(t.dataset.shiftPoint){
    readForm();

    const wasFixed=
      previewCalc(draft).fixed;

    const point=
      teamData.points.find(
        item=>
          item.id===t.dataset.shiftPoint
      );

    if(!point){
      return;
    }

    const pointChanged=
      draft.dbPointId!==point.id;

    draft.dbPointId=point.id;
    draft.pointId=
      point.code || point.id;
    draft.point=point.name;

    if(pointChanged){
      draft.employeeId="";
      draft.employeeName="";
    }

    const nowFixed=
      previewCalc(draft).fixed;

    if(nowFixed){
      draft.shk=0;
    }else if(wasFixed){
      draft.shk="";
    }

    resetShiftInline();
    drawSheet(isEdit);
    saveUIState();
    return;
  }

  if(t.dataset.shiftEmployee){
    readForm();

    const employee=
      shiftEmployeeOptions()
        .find(
          item=>
            item.id===
            t.dataset.shiftEmployee
        );

    if(!employee){
      return;
    }

    draft.employeeId=employee.id;
    draft.employeeName=
      employee.full_name;

    resetShiftInline();
    drawSheet(isEdit);
    saveUIState();
    return;
  }

  /* Стрелки ведут месяцы в сетке дней и годы в сетке месяцев. */
  if(t.dataset.shiftDateStep){
    const step=Number(t.dataset.shiftDateStep);

    if(shiftDateJumpOpen){
      shiftDateJumpYear=Math.min(
        MAX_YEAR,
        Math.max(
          MIN_YEAR,
          shiftDateJumpYear+step
        )
      );
    }else{
      /* shiftMonth уже держит курсор в границах MIN_YEAR..MAX_YEAR. */
      shiftDateCursor=
        shiftMonth(
          shiftDateCursor ||
            draft.date.slice(0,7),
          step
        );
    }

    drawSheet(isEdit);
    return;
  }

  /* Заголовок переключает режимы в обе стороны. */
  if(t.dataset.shiftDateJump){
    shiftDateJumpOpen=
      t.dataset.shiftDateJump==="open";

    if(shiftDateJumpOpen){
      shiftDateJumpYear=Number(
        (
          shiftDateCursor ||
          draft.date.slice(0,7)
        ).slice(0,4)
      );
    }

    drawSheet(isEdit);
    return;
  }

  if(t.dataset.shiftDateMonth){
    shiftDateCursor=
      t.dataset.shiftDateMonth;
    shiftDateJumpOpen=false;

    drawSheet(isEdit);
    return;
  }

  /*
    «Текущий месяц» только переводит календарь на сегодняшний месяц и
    возвращает к дням: дату человек выбирает сам.
  */
  if(t.dataset.shiftDateCurrent){
    shiftDateCursor=
      localYMD().slice(0,7);
    shiftDateJumpOpen=false;

    drawSheet(isEdit);
    return;
  }

  if(t.dataset.shiftDateToday){
    const today=localYMD();

    shiftDateCursor=today.slice(0,7);
    shiftDateJumpOpen=false;

    readForm();

    /* При наборе дат «Сегодня» — такой же день, как и остальные. */
    if(multiDateMode()){
      const dates=draftDates(draft);

      syncDraftDates(
        !draft.datesTouched
          ? [today]
          : dates.includes(today)
            ? dates
            : [...dates,today]
      );

      draft.datesTouched=true;

      drawSheet(isEdit);
      saveUIState();
      return;
    }

    draft.date=today;
    resetShiftInline();
    drawSheet(isEdit);
    saveUIState();
    return;
  }

  if(
    t.dataset.date &&
    shiftInlineField==="date"
  ){
    readForm();

    /*
      У новой смены день переключается, а календарь остаётся открытым:
      даты набирают пачкой. У сохранённой — прежнее поведение: выбрал
      дату, панель закрылась.
    */
    if(multiDateMode()){
      const picked=t.dataset.date;
      const dates=draftDates(draft);

      const next=draft.datesTouched
        ? dates.includes(picked)
          ? dates.filter(date=>date!==picked)
          : [...dates,picked]
        : [picked];

      draft.datesTouched=true;

      /* Последнюю дату снять нельзя: смена без дня не бывает. */
      if(next.length){
        syncDraftDates(next);
        shiftDateCursor=picked.slice(0,7);
        drawSheet(isEdit);
        saveUIState();
      }

      return;
    }

    draft.date=t.dataset.date;
    resetShiftInline();
    drawSheet(isEdit);
    saveUIState();
    return;
  }

  if(t.dataset.shiftDateRemove){
    readForm();

    const rest=draftDates(draft).filter(date=>
      date!==t.dataset.shiftDateRemove
    );

    if(rest.length){
      draft.datesTouched=true;
      syncDraftDates(rest);
      drawSheet(isEdit);
      saveUIState();
    }

    return;
  }

  if(t.id==="f-reprice"){
    const current=
      tariffDivergesFromSnapshot(draft);

    if(!current){
      return;
    }

    /*
      Пересчёт меняет уже посчитанные деньги, поэтому подтверждается:
      человек видит, с чего и на что.
    */
    if(
      !await appConfirm(
        "Пересчитать смену?",
        {
          detail:`Сейчас ${money(previewCalc(draft).base)}. Будет посчитана по тарифу с ${shortDateLabel(current.effective_from)}.`,
          okText:"Пересчитать"
        }
      )
    ){
      return;
    }

    try{
      await repriceAdminShift(draft.id);
      await refreshTeamData({renderAfter:false});
      closeSheet();
      render();
      toast("Смена пересчитана");
    }catch(error){
      toast(
        error instanceof Error
          ? error.message
          : "Не удалось пересчитать смену",
        4400
      );
    }

    return;
  }

  if(t.dataset.adjustmentAdd){
    readForm();

    const added={
      id:createTeamId(),
      amount:"",
      comment:"",
      ...(t.dataset.adjustmentAdd===
        "penalties"
          ? {
              payoutKind:""
            }
          : {})
    };

    draft[
      t.dataset.adjustmentAdd
    ].push(added);

    adjustmentEntering.add(added.id);
    drawSheet(isEdit);
    saveUIState();

    requestAnimationFrame(()=>{
      if(!adjustmentEntering.delete(added.id)){
        return;
      }

      if(!draft){
        return;
      }

      drawSheet(
        shifts.some(
          item=>item.id===draft.id
        )
      );
    });

    return;
  }

  if(
    t.hasAttribute(
      "data-penalty-payout-kind"
    )
  ){
    readForm();

    const index=Number(
      t.dataset
        .penaltyPayoutIndex
    );

    if(draft.penalties[index]){
      draft.penalties[index]
        .payoutKind=
          t.dataset
            .penaltyPayoutKind ||
          "";
    }

    drawSheet(isEdit);
    saveUIState();
    return;
  }

  if(t.dataset.adjustmentRemove){
    readForm();

    const [kind,index]=
      t.dataset.adjustmentRemove
        .split(":");

    const removed=
      draft[kind]?.[Number(index)];

    if(!removed){
      return;
    }

    adjustmentLeaving.add(removed.id);
    drawSheet(isEdit);

    window.setTimeout(()=>{
      if(!adjustmentLeaving.delete(removed.id)){
        return;
      }

      if(!draft?.[kind]){
        return;
      }

      /*
        За время перехода соседние строки могли добавиться или уйти,
        поэтому запись ищется по себе, а не по прежнему месту.
      */
      const at=draft[kind].indexOf(removed);

      if(at<0){
        return;
      }

      draft[kind].splice(at,1);

      drawSheet(
        shifts.some(
          item=>item.id===draft.id
        )
      );
      saveUIState();
    },REVEAL_DURATION);

    return;
  }

  if(t.dataset.type){
    readForm();
    draft.type=t.dataset.type;
    drawSheet(isEdit);
    saveUIState();
  }

  else if(t.dataset.payMode){
    readForm();

    draft.baseOverrideMode=
      t.dataset.payMode;

    if(
      draft.baseOverrideMode===
        "tariff"
    ){
      /* Причина объясняла расхождение, которого больше нет. */
      draft.baseOverride="";
      draft.baseOverrideReason="";
    }

    drawSheet(isEdit);
    saveUIState();

    /*
      Поле забирает фокус только там, где есть аппаратная клавиатура. На
      телефоне фокус посреди раскрытия поднимал клавиатуру, лист менял
      высоту на ходу, и панель доезжала рывком.
    */
    if(
      draft.baseOverrideMode===
        "manual"
    ){
      focusInlineSearch(
        "f-base-override"
      );
    }
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
  .getElementById(
    "pointPickerSearch"
  )
  .addEventListener(
    "input",
    event=>{
      pointPickerSearchQuery=
        event.target.value;

      drawChoicePickerOptions();
    }
  );

document
  .getElementById(
    "pointPickerSearch"
  )
  .addEventListener(
    "keydown",
    event=>{
      if(event.key!=="ArrowDown"){
        return;
      }

      const first=
        document.querySelector(
          "#pointList .point-option"
        );

      if(!first){
        return;
      }

      event.preventDefault();
      first.focus();
    }
  );

document
  .getElementById("pointCancel")
  .onclick=()=>{
    closePointPicker();
  };

/*
  Из модального окна остался один выбор — фильтр ПВЗ в «Управлении». Дата,
  пункт и сотрудник смены раскрываются внутри своей карточки и сюда уже не
  приходят.
*/
function applyPointPickerValue(){
  if(pointPickerKind!=="manage-point-filter"){
    return;
  }

  if(
    ![
      "all",
      "advance",
      "regular"
    ].includes(pointPickerValue)
  ){
    return;
  }

  pointAdvanceFilter=pointPickerValue;

  closePointPicker();
  render();
}

document
  .getElementById("pointDone")
  .onclick=applyPointPickerValue;

/*
  Календарь внутри плитки листается теми же жестами, что и в модальном
  окне: трекпадом и горизонтальным касанием. Без этого раскрытие внутри
  карточки отняло бы у даты способ, который уже был.
*/
const inlineDateWheel=
  createWheelGesture({distance:42});

function stepInlineDate(direction){
  if(!draft || shiftInlineField!=="date"){
    return;
  }

  shiftDateCursor=
    shiftMonth(
      shiftDateCursor ||
        draft.date.slice(0,7),
      direction
    );

  /* Жест по календарю перерисовывает весь лист вместе с полями. */
  readForm();

  drawSheet(
    shifts.some(
      item=>item.id===draft.id
    )
  );
}

function inlineCalendarGrid(target){
  return target?.closest?.(
    ".inline-calendar .date-grid"
  );
}

document
  .getElementById("sheetBody")
  .addEventListener(
    "wheel",
    event=>{
      if(!inlineCalendarGrid(event.target)){
        return;
      }

      const {direction,claim}=
        inlineDateWheel.push({
          deltaX:event.deltaX,
          deltaY:event.deltaY,
          now:performance.now()
        });

      if(!claim){
        return;
      }

      if(event.cancelable){
        event.preventDefault();
      }

      event.stopPropagation();

      if(direction){
        stepInlineDate(direction);
      }
    },
    {passive:false}
  );

let inlineDateTouch=null;

document
  .getElementById("sheetBody")
  .addEventListener(
    "touchstart",
    event=>{
      if(
        event.touches.length!==1 ||
        !inlineCalendarGrid(event.target)
      ){
        inlineDateTouch=null;
        return;
      }

      inlineDateTouch={
        x:event.touches[0].clientX,
        y:event.touches[0].clientY,
        settled:false
      };
    },
    {passive:true}
  );

document
  .getElementById("sheetBody")
  .addEventListener(
    "touchmove",
    event=>{
      if(
        !inlineDateTouch ||
        inlineDateTouch.settled ||
        event.touches.length!==1
      ){
        return;
      }

      const dx=
        event.touches[0].clientX-
        inlineDateTouch.x;

      const dy=
        event.touches[0].clientY-
        inlineDateTouch.y;

      /*
        Вертикаль принадлежит прокрутке формы: месяц листается, только
        когда горизонталь уверенно её перевешивает.
      */
      if(
        Math.abs(dx)<44 ||
        Math.abs(dx)<=Math.abs(dy)*1.2
      ){
        return;
      }

      inlineDateTouch.settled=true;
      stepInlineDate(dx>0 ? -1 : 1);
    },
    {passive:true}
  );

document
  .getElementById("sheetBody")
  .addEventListener(
    "touchend",
    ()=>{
      inlineDateTouch=null;
    },
    {passive:true}
  );

document.getElementById("sheetBody").addEventListener("input",e=>{
  if(!draft){
    return;
  }

  if(
    e.target.id==="shiftPointSearch" ||
    e.target.id==="shiftEmployeeSearch"
  ){
    shiftInlineQuery=e.target.value;

    /* Поиск перерисовывает весь лист, а не только список. */
    readForm();

    drawSheet(
      shifts.some(
        item=>item.id===draft?.id
      )
    );
    return;
  }

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
    e.target.id==="f-base-override" ||
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

  /*
    В черновик попадает любой ввод, а не только тот, что меняет расчёт.

    Перечисление полей поимённо уже подводило: причина корректировки
    оклада и комментарии премий со штрафами в список не попали, и
    набранное в них жило только в разметке — до первой же перерисовки.
    Пересчитывать расчёт по-прежнему нужно лишь для сумм и часов.
  */
  readForm();

  if(
    [
      "f-shk",
      "f-hours",
      "f-base-override"
    ].includes(e.target.id) ||
    e.target.matches(
      "[data-adjustment-amount]"
    )
  ){
    const box=
      document.getElementById(
        "calcBox"
      );

    if(box){
      setHTML(
        box,
        calcHTML()
      );
    }
  }

  saveUIState();
});

const sheetBody=
  document.getElementById("sheetBody");

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

    const mask=
      target.parentElement.querySelector(
        ".employee-secret-mask"
      );

    if(mask){
      mask.textContent=
        "•".repeat(
          target.value.length
        );
    }
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
    if(payoutEditor && event.target instanceof HTMLInputElement){
      if(event.target.id==="payoutAmount") payoutEditor.amount=event.target.value;
      if(event.target.id==="payoutComment") payoutEditor.comment=event.target.value;
    }

    if(
      !(
        event.target instanceof
        HTMLInputElement
      ) ||
      ![
        "employeeSearch",
        "pointSearch",
        "shiftSearch",
        "statsEmployeeSearch"
      ].includes(event.target.id)
    ){
      return;
    }

    if(event.target.id==="statsEmployeeSearch"){
      statsEmployeeQuery=event.target.value;
      render();
      return;
    }

    if(event.target.id==="employeeSearch"){
      employeeSearchQuery=event.target.value;
      updateEmployeeList();
    }else if(event.target.id==="pointSearch"){
      pointSearchQuery=event.target.value;
      updatePointManageList();
    }else{
      shiftSearchQuery=event.target.value;
      updateShiftList();
    }
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

  /* Представления «Смен»: режим, выбор ПВЗ, день, добавление. */
  if(button.dataset.shiftView){
    if(SHIFT_VIEW_MODES.includes(button.dataset.shiftView)){
      shiftViewMode=button.dataset.shiftView;
      render();
    }

    return;
  }

  if(button.hasAttribute("data-calendar-point")){
    shiftViewPointId=button.dataset.calendarPoint;
    shiftViewDay="";
    render();
    return;
  }

  if(button.dataset.calendarDay){
    shiftViewDay=
      shiftViewDay===button.dataset.calendarDay
        ? ""
        : button.dataset.calendarDay;

    render();

    /* На узком экране панель дня лежит под календарём. */
    if(
      shiftViewDay &&
      window.innerWidth<900
    ){
      requestAnimationFrame(()=>
        document
          .querySelector(".sv-panel")
          ?.scrollIntoView({
            behavior:"smooth",
            block:"nearest"
          })
      );
    }

    return;
  }

  if(button.dataset.calendarAdd){
    openShiftForCalendarDay(
      button.dataset.calendarAdd
    );

    return;
  }

  if(button.dataset.controlCell){
    const [pointId,date]=
      button.dataset.controlCell.split("|");

    shiftViewMode="calendar";
    shiftViewPointId=pointId;
    shiftViewDay=date;
    render();
    return;
  }

  if(button.id==="statsEmployeeOpen"){
    statsEmployeeOpen=!statsEmployeeOpen;
    statsEmployeeQuery="";
    render();

    if(statsEmployeeOpen){
      focusInlineSearch(
        "statsEmployeeSearch"
      );
    }

    return;
  }

  if(button.dataset.statsEmployee){
    statsEmployeeId=
      button.dataset.statsEmployee;
    statsEmployeeOpen=false;
    statsEmployeeQuery="";
    saveUIState();
    render();
    return;
  }

  if(button.dataset.payoutToggle){
    expandedPayoutKind=expandedPayoutKind===button.dataset.payoutToggle ? "" : button.dataset.payoutToggle;
    payoutEditor=null;
    render();
    return;
  }

  if(button.dataset.payoutAdd){
    const context=currentStatsPayoutContext(button.dataset.payoutAdd);
    if(context){
      const progress=paymentProgress(context.due,payoutRecords(context.employee.id,button.dataset.payoutAdd));
      payoutEditor={
        kind:button.dataset.payoutAdd,
        amount:String(progress.remaining || ""),
        paidOn:localYMD(),
        comment:""
      };
      render();
    }
    return;
  }

  if(button.hasAttribute("data-payout-date-open")){
    openDatePicker("payout");
    return;
  }

  if(button.hasAttribute("data-payout-cancel")){
    payoutEditor=null;
    render();
    return;
  }

  if(button.hasAttribute("data-payout-save")){
    await persistPayout();
    return;
  }

  if(button.dataset.payoutDelete){
    const confirmed=await appConfirm(
      "Удалить запись выплаты?",
      {
        detail:"Начисления не изменятся — удалится только отметка о выплате.",
        okText:"Удалить",
        danger:true
      }
    );
    if(confirmed){
      try{
        await deleteAdminPayout(button.dataset.payoutDelete);
        await refreshTeamData({renderAfter:false});
        render();
        toast("Запись выплаты удалена");
      }catch(error){
        toast(error instanceof Error ? error.message : "Не удалось удалить выплату",4200);
      }
    }
    return;
  }

  if(button.id==="shiftFilterOpen"){
    openShiftFilterSheet();
    return;
  }

  if(button.id==="employeeArchiveToggle"){
    toggleArchiveView(
      employeeStatusFilter!=="inactive",
      ()=>{
        employeeStatusFilter=
          employeeStatusFilter==="inactive"
            ? "active"
            : "inactive";
      }
    );

    return;
  }

  if(button.id==="pointArchiveToggle"){
    toggleArchiveView(
      pointStatusFilter!=="inactive",
      ()=>{
        pointStatusFilter=
          pointStatusFilter==="inactive"
            ? "active"
            : "inactive";
      }
    );

    return;
  }

  if(
    button.id==="pointFilterOpen" &&
    isAdmin &&
    tab==="manage" &&
    manageSection==="points"
  ){
    openManagePointFilterPicker();
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

/*
  Без веб-сокета Realtime — а в сетях, где режут Cloudflare, его нет —
  данные обновляются опросом, и только пока страница на экране. Человек,
  вернувшийся к приложению, иначе до полуминуты смотрел бы на то, что
  было до его ухода. Когда сокет жив, обновлять незачем: он уже принёс
  всё сам.
*/
let visibleRefreshAt=0;

document.addEventListener(
  "visibilitychange",
  ()=>{
    if(document.visibilityState!=="visible"){
      saveUIState();
      return;
    }

    if(
      realtimeStatus==="connected" ||
      Date.now()-visibleRefreshAt<10000
    ){
      return;
    }

    visibleRefreshAt=Date.now();

    /*
      Как и при восстановлении сети: перерисовка дожидается конца
      переходов, а ввод в полях реконсилятор сохраняет.
    */
    void refreshTeamData();
  }
);

/*
  Перезагрузка ради новой версии допустима только на «чистом» экране:
  открытая модалка, незаписанный черновик или идущее сохранение
  означают несохранённую работу пользователя.
*/
installPwa({
  isReadyForUpdate:()=>
    !activeModal() &&
    !draft &&
    !employeeDraft &&
    !manageEditorDraft &&
    !payoutEditor &&
    !employeeSaving &&
    !manageEditorSaving &&
    !payoutSaving &&
    !legacyMigrationRunning
});

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
