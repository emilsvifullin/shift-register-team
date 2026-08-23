import {
  supabaseClient
} from "./supabase.js";

const app=
  document.getElementById(
    "app"
  );

const employeeSheet=
  document.getElementById(
    "employeeSheet"
  );

const employeeSheetBody=
  document.getElementById(
    "employeeSheetBody"
  );

const employeeFilterSheet=
  document.getElementById(
    "employeeFilterSheet"
  );

const employeeFilterBody=
  document.getElementById(
    "employeeFilterSheetBody"
  );

let accountPicker=null;
let accountPickerVeil=null;
let accountPickerList=null;
let accountPickerValue="";
let accountPickerPreviousFocus=null;
let accountPickerHideTimer=null;

let committedPointFilter=null;
let draftPointFilter=null;
let filterSessionOpen=false;
let allowNativePointClick=false;
let pointNames=new Map();
let employeeAssignments=new Map();
let assignmentsReady=false;
let assignmentsLoading=null;
let filterSyncQueued=false;
let employeeListSyncQueued=false;

let manageBackSwipe=null;
let suppressManageBackClickUntil=0;

function setTextIfChanged(
  element,
  value
){
  if(
    element &&
    element.textContent!==value
  ){
    element.textContent=value;
  }
}

function cleanAccountLabel(value){
  return String(value || "")
    .replace(
      /\s*·\s*администратор\s*$/iu,
      ""
    )
    .trim();
}

function currentAccountSelect(){
  return document.getElementById(
    "employeeAccount"
  );
}

function accountOptions(){
  const select=
    currentAccountSelect();

  if(!select){
    return [];
  }

  return Array.from(select.options)
    .map(option=>({
      value:option.value,
      label:
        cleanAccountLabel(
          option.textContent
        ) || "Не привязан",
      admin:
        /администратор/iu.test(
          option.textContent || ""
        )
    }))
    .filter(
      option=>
        !option.value ||
        !option.admin
    );
}

function accountLabel(select){
  const selected=
    select?.selectedOptions?.[0];

  return selected
    ? cleanAccountLabel(
        selected.textContent
      ) || "Не привязан"
    : "Не привязан";
}

function updateAccountButton(){
  const select=
    currentAccountSelect();

  const value=
    document.querySelector(
      "#employeeAccountOpen .point-value"
    );

  if(select && value){
    setTextIfChanged(
      value,
      accountLabel(select)
    );
  }
}

function enhanceAccountField(){
  const select=
    currentAccountSelect();

  if(
    !select ||
    document.getElementById(
      "employeeAccountOpen"
    )
  ){
    return;
  }

  const label=
    select.closest(
      "label.row"
    );

  const card=
    label?.parentElement;

  if(!label || !card){
    return;
  }

  const button=
    document.createElement(
      "button"
    );

  button.type="button";
  button.className="row point-row";
  button.id="employeeAccountOpen";
  button.innerHTML=`
    <div class="t">
      Вход
    </div>

    <div class="point-value">
      ${accountLabel(select)}
    </div>
  `;

  select.hidden=true;
  select.tabIndex=-1;
  select.setAttribute(
    "aria-hidden",
    "true"
  );

  card.insertBefore(
    button,
    label
  );

  card.appendChild(select);
  label.remove();
}

function createAccountPicker(){
  if(accountPicker){
    return;
  }

  accountPickerVeil=
    document.createElement(
      "div"
    );

  accountPickerVeil.className=
    "point-veil";
  accountPickerVeil.id=
    "employeeAccountVeil";
  accountPickerVeil.setAttribute(
    "aria-hidden",
    "true"
  );

  accountPicker=
    document.createElement(
      "div"
    );

  accountPicker.className=
    "point-picker";
  accountPicker.id=
    "employeeAccountPicker";
  accountPicker.setAttribute(
    "role",
    "dialog"
  );
  accountPicker.setAttribute(
    "aria-modal",
    "true"
  );
  accountPicker.setAttribute(
    "aria-labelledby",
    "employeeAccountPickerTitle"
  );
  accountPicker.setAttribute(
    "aria-hidden",
    "true"
  );

  accountPicker.innerHTML=`
    <div class="point-picker-handle">
      <div class="point-picker-grab"></div>
    </div>

    <div class="picker-toolbar">
      <button
        type="button"
        class="picker-toolbar-btn cancel"
        id="employeeAccountCancel"
      >
        Отмена
      </button>

      <div
        class="picker-toolbar-title"
        id="employeeAccountPickerTitle"
      >
        Выберите аккаунт
      </div>

      <button
        type="button"
        class="picker-toolbar-btn done"
        id="employeeAccountDone"
      >
        Готово
      </button>
    </div>

    <div
      class="point-list"
      id="employeeAccountList"
    ></div>
  `;

  document.body.append(
    accountPickerVeil,
    accountPicker
  );

  accountPickerList=
    document.getElementById(
      "employeeAccountList"
    );

  accountPickerVeil.addEventListener(
    "click",
    closeAccountPicker
  );

  document
    .getElementById(
      "employeeAccountCancel"
    )
    .addEventListener(
      "click",
      closeAccountPicker
    );

  document
    .getElementById(
      "employeeAccountDone"
    )
    .addEventListener(
      "click",
      applyAccountPicker
    );

  accountPickerList.addEventListener(
    "click",
    event=>{
      const option=
        event.target.closest(
          "[data-employee-account]"
        );

      if(!option){
        return;
      }

      accountPickerValue=
        option.dataset
          .employeeAccount ||
        "";

      drawAccountPicker();
    }
  );
}

function drawAccountPicker(){
  if(!accountPickerList){
    return;
  }

  accountPickerList.innerHTML=
    accountOptions()
      .map(option=>{
        const selected=
          option.value===
          accountPickerValue;

        return `
          <button
            type="button"
            class="point-option ${selected ? "on" : ""}"
            data-employee-account="${option.value}"
          >
            <span class="point-check">
              ${selected ? "✓" : ""}
            </span>

            <span class="point-name">
              ${option.label}
            </span>
          </button>
        `;
      })
      .join("");
}

function openAccountPicker(){
  const select=
    currentAccountSelect();

  if(!select){
    return;
  }

  createAccountPicker();

  clearTimeout(
    accountPickerHideTimer
  );

  const options=
    accountOptions();

  accountPickerValue=
    options.some(
      option=>
        option.value===
        select.value
    )
      ? select.value
      : "";

  drawAccountPicker();

  accountPickerPreviousFocus=
    document.activeElement;

  employeeSheet?.setAttribute(
    "inert",
    ""
  );

  accountPicker.style.display=
    "block";
  accountPicker.style.removeProperty(
    "transition"
  );
  accountPicker.style.removeProperty(
    "--point-drag"
  );
  accountPicker.classList.remove(
    "on"
  );
  accountPicker.setAttribute(
    "aria-hidden",
    "false"
  );
  accountPickerVeil.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.classList.add(
    "point-picker-open"
  );

  accountPickerVeil.classList.add(
    "on"
  );

  void accountPicker.offsetHeight;

  accountPicker.classList.add(
    "on"
  );

  requestAnimationFrame(()=>{
    const selected=
      accountPickerList.querySelector(
        ".point-option.on"
      ) ||
      accountPickerList.querySelector(
        ".point-option"
      );

    selected?.scrollIntoView({
      block:"center"
    });

    selected?.focus();
  });
}

function closeAccountPicker(){
  if(
    !accountPicker?.classList.contains(
      "on"
    )
  ){
    return;
  }

  accountPicker.classList.remove(
    "on"
  );
  accountPicker.setAttribute(
    "aria-hidden",
    "true"
  );
  accountPickerVeil.classList.remove(
    "on"
  );
  accountPickerVeil.setAttribute(
    "aria-hidden",
    "true"
  );

  employeeSheet?.removeAttribute(
    "inert"
  );

  if(
    !document
      .getElementById(
        "pointPicker"
      )
      ?.classList.contains(
        "on"
      )
  ){
    document.body.classList.remove(
      "point-picker-open"
    );
  }

  accountPickerHideTimer=
    setTimeout(()=>{
      if(
        accountPicker &&
        !accountPicker.classList.contains(
          "on"
        )
      ){
        accountPicker.style.display=
          "none";
      }
    },360);

  const previousFocus=
    accountPickerPreviousFocus;

  accountPickerPreviousFocus=null;

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

function applyAccountPicker(){
  const select=
    currentAccountSelect();

  if(!select){
    closeAccountPicker();
    return;
  }

  select.value=
    accountPickerValue;

  select.dispatchEvent(
    new Event(
      "change",
      {
        bubbles:true
      }
    )
  );

  updateAccountButton();
  closeAccountPicker();
}

function accountPickerKeydown(event){
  if(
    !accountPicker?.classList.contains(
      "on"
    )
  ){
    return;
  }

  if(event.key==="Escape"){
    event.preventDefault();
    event.stopImmediatePropagation();
    closeAccountPicker();
    return;
  }

  if(event.key!=="Tab"){
    return;
  }

  const focusable=
    Array.from(
      accountPicker.querySelectorAll(
        "button:not(:disabled)"
      )
    ).filter(
      element=>
        !element.hidden &&
        element.getClientRects()
          .length>0
    );

  if(!focusable.length){
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const first=focusable[0];
  const last=focusable.at(-1);

  if(
    event.shiftKey &&
    document.activeElement===first
  ){
    event.preventDefault();
    event.stopImmediatePropagation();
    last.focus();
  }else if(
    !event.shiftKey &&
    document.activeElement===last
  ){
    event.preventDefault();
    event.stopImmediatePropagation();
    first.focus();
  }
}

function pointRows(){
  return Array.from(
    employeeFilterBody
      ?.querySelectorAll(
        "[data-employee-filter-point]"
      ) || []
  );
}

function pointIds(){
  return pointRows()
    .map(
      button=>
        button.dataset
          .employeeFilterPoint ||
        ""
    )
    .filter(Boolean);
}

function rememberPointNames(){
  pointNames=new Map();

  pointRows().forEach(button=>{
    const id=
      button.dataset
        .employeeFilterPoint ||
      "";

    const name=
      button.querySelector(
        ".employee-point-name"
      )?.textContent
        ?.trim();

    if(id && name){
      pointNames.set(id,name);
    }
  });
}

function clonePointFilter(value){
  return value===null
    ? null
    : new Set(value);
}

function activePointFilter(){
  return filterSessionOpen
    ? draftPointFilter
    : committedPointFilter;
}

function syncPointChecks(){
  const rows=pointRows();

  if(!rows.length){
    return;
  }

  rememberPointNames();

  const ids=pointIds();
  const selection=
    activePointFilter();

  const allSelected=
    selection===null ||
    (
      selection.size===ids.length &&
      ids.every(
        id=>selection.has(id)
      )
    );

  rows.forEach(button=>{
    const id=
      button.dataset
        .employeeFilterPoint ||
      "";

    const selected=
      !id
        ? allSelected
        : allSelected ||
          selection?.has(id)===true;

    button.classList.toggle(
      "on",
      selected
    );

    button.setAttribute(
      "aria-pressed",
      String(selected)
    );

    const check=
      button.querySelector(
        ".employee-point-check"
      );

    if(check){
      setTextIfChanged(
        check,
        selected ? "✓" : ""
      );
    }
  });
}

function queuePointCheckSync(){
  if(filterSyncQueued){
    return;
  }

  filterSyncQueued=true;

  queueMicrotask(()=>{
    filterSyncQueued=false;
    syncPointChecks();
  });
}

function togglePoint(pointId){
  const ids=pointIds();

  const next=
    draftPointFilter===null
      ? new Set(ids)
      : new Set(
          draftPointFilter
        );

  if(next.has(pointId)){
    next.delete(pointId);
  }else{
    next.add(pointId);
  }

  draftPointFilter=
    next.size===ids.length &&
    ids.every(
      id=>next.has(id)
    )
      ? null
      : next;

  syncPointChecks();
}

function refreshAssignments(){
  if(assignmentsLoading){
    return assignmentsLoading;
  }

  assignmentsLoading=
    (async()=>{
      const result=
        await supabaseClient
          .from(
            "employee_points"
          )
          .select(
            "employee_id, point_id, active"
          )
          .eq(
            "active",
            true
          );

      if(result.error){
        throw result.error;
      }

      const next=new Map();

      (result.data || [])
        .forEach(item=>{
          if(!next.has(item.employee_id)){
            next.set(
              item.employee_id,
              new Set()
            );
          }

          next
            .get(item.employee_id)
            .add(item.point_id);
        });

      employeeAssignments=next;
      assignmentsReady=true;
    })()
      .catch(error=>{
        assignmentsReady=false;
        console.error(
          "Не удалось загрузить назначения сотрудников:",
          error
        );
      })
      .finally(()=>{
        assignmentsLoading=null;
      });

  return assignmentsLoading;
}

function filterBaseLabel(){
  const value=
    document.querySelector(
      "#employeeFilterOpen .point-value"
    );

  const text=
    value?.textContent
      ?.trim() ||
    "Активные";

  if(text.startsWith("Архив")){
    return "Архив";
  }

  if(text.startsWith("Все")){
    return "Все";
  }

  return "Активные";
}

function updateFilterLabel(){
  const value=
    document.querySelector(
      "#employeeFilterOpen .point-value"
    );

  if(!value){
    return;
  }

  const base=
    filterBaseLabel();

  if(committedPointFilter===null){
    setTextIfChanged(
      value,
      base
    );
    return;
  }

  const ids=
    Array.from(
      committedPointFilter
    );

  if(!ids.length){
    setTextIfChanged(
      value,
      base+" · 0 ПВЗ"
    );
    return;
  }

  if(ids.length===1){
    setTextIfChanged(
      value,
      base+
      " · "+
      (
        pointNames.get(ids[0]) ||
        "1 ПВЗ"
      )
    );
    return;
  }

  setTextIfChanged(
    value,
    base+
    " · "+
    ids.length+
    " ПВЗ"
  );
}

function applyPointFilter(){
  const list=
    document.getElementById(
      "employeeList"
    );

  if(!list){
    return;
  }

  updateFilterLabel();

  const rows=
    Array.from(
      list.querySelectorAll(
        "[data-employee-id]"
      )
    );

  const existingEmpty=
    list.querySelector(
      ".employee-extra-filter-empty"
    );

  if(
    committedPointFilter===null ||
    !assignmentsReady
  ){
    rows.forEach(row=>{
      row.style.removeProperty(
        "display"
      );
    });

    existingEmpty?.remove();

    return;
  }

  let visible=0;

  rows.forEach(row=>{
    const assigned=
      employeeAssignments.get(
        row.dataset.employeeId
      ) || new Set();

    const matches=
      Array.from(
        committedPointFilter
      ).some(
        pointId=>
          assigned.has(pointId)
      );

    row.style.display=
      matches ? "" : "none";

    if(matches){
      visible++;
    }
  });

  if(
    rows.length &&
    visible===0 &&
    !existingEmpty
  ){
    const card=
      list.querySelector(
        ".card"
      );

    if(card){
      const empty=
        document.createElement(
          "div"
        );

      empty.className=
        "employee-empty employee-extra-filter-empty";
      empty.textContent=
        "Ничего не найдено.";

      card.appendChild(empty);
    }
  }else if(
    existingEmpty &&
    (
      !rows.length ||
      visible>0
    )
  ){
    existingEmpty.remove();
  }
}

function queueEmployeeListSync(){
  if(employeeListSyncQueued){
    return;
  }

  employeeListSyncQueued=true;

  requestAnimationFrame(()=>{
    employeeListSyncQueued=false;
    applyPointFilter();
  });
}

function clearNativePointFilter(){
  const allPoints=
    employeeFilterBody
      ?.querySelector(
        '[data-employee-filter-point=""]'
      );

  if(!allPoints){
    return;
  }

  allowNativePointClick=true;

  try{
    allPoints.click();
  }finally{
    allowNativePointClick=false;
  }

  queuePointCheckSync();
}

function beginFilterSession(){
  filterSessionOpen=true;
  draftPointFilter=
    clonePointFilter(
      committedPointFilter
    );

  void refreshAssignments();

  requestAnimationFrame(()=>{
    clearNativePointFilter();
    syncPointChecks();
  });
}

function commitFilterSession(){
  if(!filterSessionOpen){
    return;
  }

  committedPointFilter=
    clonePointFilter(
      draftPointFilter
    );

  filterSessionOpen=false;
  draftPointFilter=null;

  void refreshAssignments()
    .then(
      queueEmployeeListSync
    );

  setTimeout(
    queueEmployeeListSync,
    0
  );
}

function cancelFilterSession(){
  filterSessionOpen=false;
  draftPointFilter=null;
}

function handlePointFilterClick(event){
  const button=
    event.target.closest(
      "[data-employee-filter-point]"
    );

  if(
    !button ||
    !filterSessionOpen ||
    allowNativePointClick
  ){
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const pointId=
    button.dataset
      .employeeFilterPoint ||
    "";

  if(!pointId){
    draftPointFilter=null;
    syncPointChecks();
    return;
  }

  togglePoint(pointId);
}

function employeesManageView(){
  return Boolean(
    document.getElementById(
      "employeeAdd"
    ) &&
    document.getElementById(
      "employeeList"
    ) &&
    document.getElementById(
      "manageBack"
    )
  );
}

function swipeBlocked(target){
  return (
    !(target instanceof Element) ||
    Boolean(
      target.closest(
        "input,textarea,select,[contenteditable='true']"
      )
    ) ||
    document.body.classList.contains(
      "sheet-open"
    ) ||
    document.body.classList.contains(
      "point-picker-open"
    ) ||
    document.body.classList.contains(
      "month-picker-open"
    ) ||
    Boolean(
      accountPicker?.classList.contains(
        "on"
      )
    )
  );
}

function resetManageSwipe(){
  manageBackSwipe=null;
}

function startManageSwipe(event){
  if(
    !employeesManageView() ||
    event.touches.length!==1 ||
    swipeBlocked(event.target)
  ){
    resetManageSwipe();
    return;
  }

  const touch=event.touches[0];

  manageBackSwipe={
    id:touch.identifier,
    x:touch.clientX,
    y:touch.clientY,
    lastX:touch.clientX,
    lastY:touch.clientY,
    time:performance.now(),
    axis:null
  };
}

function moveManageSwipe(event){
  if(!manageBackSwipe){
    return;
  }

  const touch=
    Array.from(event.touches)
      .find(
        item=>
          item.identifier===
          manageBackSwipe.id
      );

  if(!touch){
    return;
  }

  manageBackSwipe.lastX=touch.clientX;
  manageBackSwipe.lastY=touch.clientY;

  const dx=
    touch.clientX-manageBackSwipe.x;
  const dy=
    touch.clientY-manageBackSwipe.y;
  const absX=Math.abs(dx);
  const absY=Math.abs(dy);

  if(manageBackSwipe.axis===null){
    if(absX<8 && absY<8){
      return;
    }

    if(
      dx>0 &&
      absX>=10 &&
      absX>absY*1.10
    ){
      manageBackSwipe.axis="x";
    }else if(
      absY>=14 &&
      absY>absX*1.25
    ){
      manageBackSwipe.axis="y";
    }else{
      return;
    }
  }

  if(
    manageBackSwipe.axis==="x" &&
    event.cancelable
  ){
    event.preventDefault();
  }
}

function finishManageSwipe(event){
  if(!manageBackSwipe){
    return;
  }

  const swipe=manageBackSwipe;

  const touch=
    Array.from(
      event.changedTouches || []
    ).find(
      item=>
        item.identifier===
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

  const dx=endX-swipe.x;
  const dy=endY-swipe.y;
  const absX=Math.abs(dx);
  const absY=Math.abs(dy);
  const duration=
    Math.max(
      1,
      performance.now()-swipe.time
    );
  const velocity=absX/duration;

  resetManageSwipe();

  const accepted=
    dx>0 &&
    swipe.axis!=="y" &&
    absX>absY*1.08 &&
    (
      absX>=38 ||
      (
        absX>=22 &&
        velocity>=0.30
      )
    );

  if(!accepted){
    return;
  }

  suppressManageBackClickUntil=
    performance.now()+650;

  document
    .getElementById(
      "manageBack"
    )
    ?.click();
}

employeeSheetBody?.addEventListener(
  "click",
  event=>{
    if(
      event.target.closest(
        "#employeeAccountOpen"
      )
    ){
      openAccountPicker();
    }
  }
);

document.addEventListener(
  "keydown",
  accountPickerKeydown,
  true
);

employeeFilterSheet?.addEventListener(
  "click",
  handlePointFilterClick,
  true
);

document.addEventListener(
  "click",
  event=>{
    const target=event.target;

    if(!(target instanceof Element)){
      return;
    }

    if(
      target.closest(
        "#employeeFilterOpen"
      )
    ){
      beginFilterSession();
      return;
    }

    if(
      target.closest(
        "#employeeFilterReset"
      ) &&
      filterSessionOpen
    ){
      draftPointFilter=null;
      requestAnimationFrame(
        syncPointChecks
      );
      return;
    }

    if(
      target.closest(
        "#employeeFilterDone"
      )
    ){
      commitFilterSession();
      return;
    }

    if(
      target.closest(
        "#employeeFilterCancel"
      ) ||
      target.id===
        "employeeFilterVeil"
    ){
      cancelFilterSession();
    }
  },
  true
);

document.addEventListener(
  "click",
  event=>{
    if(
      event.detail!==0 &&
      performance.now()<=
        suppressManageBackClickUntil
    ){
      suppressManageBackClickUntil=0;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true
);

app?.addEventListener(
  "touchstart",
  startManageSwipe,
  {
    passive:true
  }
);

app?.addEventListener(
  "touchmove",
  moveManageSwipe,
  {
    passive:false
  }
);

app?.addEventListener(
  "touchend",
  finishManageSwipe,
  {
    passive:true
  }
);

app?.addEventListener(
  "touchcancel",
  resetManageSwipe,
  {
    passive:true
  }
);

new MutationObserver(
  enhanceAccountField
).observe(
  employeeSheetBody,
  {
    childList:true,
    subtree:true
  }
);

new MutationObserver(
  queuePointCheckSync
).observe(
  employeeFilterBody,
  {
    childList:true,
    subtree:true
  }
);

new MutationObserver(
  queueEmployeeListSync
).observe(
  app,
  {
    childList:true,
    subtree:true
  }
);

new MutationObserver(()=>{
  if(
    employeeSheet.getAttribute(
      "aria-hidden"
    )==="true" &&
    committedPointFilter!==null
  ){
    void refreshAssignments()
      .then(
        queueEmployeeListSync
      );
  }
}).observe(
  employeeSheet,
  {
    attributes:true,
    attributeFilter:[
      "aria-hidden"
    ]
  }
);

enhanceAccountField();
queueEmployeeListSync();
