const MANAGE_RETRY_INTERVAL=60;
const MANAGE_RETRY_TIMEOUT=2200;
const POINT_DELETE_BUTTON_ID="managePointDelete";
const EMPLOYEE_EDIT_DELETE_BUTTON_ID="employeeEditDelete";

function closestElement(
  target,
  selector
){
  return target?.closest?.(selector) || null;
}

function pointDeleteError(
  error
){
  const message=
    error instanceof Error
      ? error.message
      : String(error || "");

  if(
    message.includes("point_has_history") ||
    message.includes("shifts_point_id_fkey")
  ){
    return (
      "У ПВЗ есть история смен. "+
      "Переведите его в архив."
    );
  }

  if(
    message.includes("point_not_found")
  ){
    return "ПВЗ больше не существует";
  }

  if(
    message.includes("forbidden")
  ){
    return "Недостаточно прав для удаления ПВЗ";
  }

  return message || "Не удалось удалить ПВЗ";
}

export function installManagementNavigation({
  windowRef=window,
  documentRef=document
}={}){
  const panel=
    documentRef.getElementById("app");

  const previous=
    documentRef.getElementById("prevM");

  const next=
    documentRef.getElementById("nextM");

  const manageEditorSheet=
    documentRef.getElementById(
      "manageEditorSheet"
    );

  const manageEditorBody=
    documentRef.getElementById(
      "manageEditorBody"
    );

  const employeeSheet=
    documentRef.getElementById(
      "employeeSheet"
    );

  const employeeSheetBody=
    documentRef.getElementById(
      "employeeSheetBody"
    );

  const employeeSheetSave=
    documentRef.getElementById(
      "employeeSheetSave"
    );

  const employeeSheetCancel=
    documentRef.getElementById(
      "employeeSheetCancel"
    );

  if(!panel || !previous){
    return ()=>{};
  }

  documentRef.body.dataset.managementNavigation=
    "ready";

  let reconcileFrame=0;
  let editorFrame=0;
  let employeeFrame=0;
  let retryTimer=0;
  let retryToken=0;
  let syntheticSectionClick=false;
  let selectedPointId="";
  let pointDeletePending=false;
  let toastTimer=0;

  const activeManage=()=>
    documentRef.body.dataset.activeTab===
      "manage";

  const pointerInput=()=>
    documentRef.body.dataset.inputModality===
      "pointer";

  const sourceBack=()=>
    panel.querySelector(
      ":scope > #manageBack"
    );

  const detailOpen=()=>
    activeManage() &&
    Boolean(sourceBack());

  const sectionDestinationOpen=section=>{
    if(!detailOpen()){
      return false;
    }

    if(section==="employees"){
      return Boolean(
        panel.querySelector(
          "#employeeList"
        )
      );
    }

    if(section==="points"){
      return Boolean(
        panel.querySelector(
          "#pointManageList"
        )
      );
    }

    return false;
  };

  const pointEditorOpen=()=>
    Boolean(
      manageEditorSheet &&
      manageEditorSheet.classList.contains(
        "on"
      ) &&
      manageEditorSheet.getAttribute(
        "aria-hidden"
      )!=="true"
    );

  const pointEditing=()=>
    Boolean(
      manageEditorBody?.querySelector(
        "#managePointName"
      )
    );

  const employeeEditorOpen=()=>
    Boolean(
      employeeSheet &&
      employeeSheet.classList.contains("on") &&
      employeeSheet.getAttribute(
        "aria-hidden"
      )!=="true"
    );

  const employeeEditing=()=>
    Boolean(
      employeeEditorOpen() &&
      employeeSheetSave?.textContent
        ?.trim()==="Готово" &&
      employeeSheetCancel?.textContent
        ?.trim()==="Назад" &&
      employeeSheetBody?.querySelector(
        "#employeeName"
      )
    );

  const showToast=(
    message,
    duration=2600
  )=>{
    const toast=
      documentRef.getElementById(
        "toast"
      );

    if(!toast){
      return;
    }

    windowRef.clearTimeout(
      toastTimer
    );

    toast.textContent=message;
    toast.classList.add("on");

    toastTimer=
      windowRef.setTimeout(()=>{
        toast.classList.remove("on");
      },duration);
  };

  const appConfirm=({
    title,
    detail,
    okText="Удалить"
  })=>{
    const modal=
      documentRef.getElementById(
        "appConfirm"
      );

    const titleElement=
      documentRef.getElementById(
        "appConfirmTitle"
      );

    const detailElement=
      documentRef.getElementById(
        "appConfirmDetail"
      );

    const ok=
      documentRef.getElementById(
        "appConfirmOk"
      );

    const cancel=
      documentRef.getElementById(
        "appConfirmCancel"
      );

    if(
      !modal ||
      !titleElement ||
      !detailElement ||
      !ok ||
      !cancel
    ){
      return Promise.resolve(
        windowRef.confirm(
          detail
            ? `${title}\n\n${detail}`
            : title
        )
      );
    }

    titleElement.textContent=title;
    detailElement.textContent=detail;
    detailElement.hidden=!detail;
    ok.textContent=okText;
    ok.classList.add("danger");

    modal.classList.add("on");
    modal.setAttribute(
      "aria-hidden",
      "false"
    );

    documentRef.body.classList.add(
      "confirm-open"
    );

    windowRef.setTimeout(
      ()=>cancel.focus(),
      20
    );

    return new Promise(resolve=>{
      let settled=false;
      let observer=null;

      const cleanup=()=>{
        ok.removeEventListener(
          "click",
          onOk,
          true
        );

        cancel.removeEventListener(
          "click",
          onCancel,
          true
        );

        modal.removeEventListener(
          "click",
          onBackdrop,
          true
        );

        observer?.disconnect();
      };

      const finish=value=>{
        if(settled){
          return;
        }

        settled=true;
        cleanup();
        resolve(value);
      };

      const onOk=()=>finish(true);
      const onCancel=()=>finish(false);

      const onBackdrop=event=>{
        if(event.target===modal){
          finish(false);
        }
      };

      ok.addEventListener(
        "click",
        onOk,
        {
          once:true,
          capture:true
        }
      );

      cancel.addEventListener(
        "click",
        onCancel,
        {
          once:true,
          capture:true
        }
      );

      modal.addEventListener(
        "click",
        onBackdrop,
        true
      );

      observer=
        new windowRef.MutationObserver(()=>{
          if(
            modal.getAttribute(
              "aria-hidden"
            )==="true" ||
            !modal.classList.contains(
              "on"
            )
          ){
            finish(false);
          }
        });

      observer.observe(
        modal,
        {
          attributes:true,
          attributeFilter:[
            "class",
            "aria-hidden"
          ]
        }
      );
    });
  };

  const clearPointerFocus=()=>{
    if(
      pointerInput() &&
      documentRef.activeElement===previous
    ){
      previous.blur();
    }
  };

  const syncHeaderBack=()=>{
    reconcileFrame=0;

    if(detailOpen()){
      previous.classList.remove(
        "is-hidden"
      );

      previous.disabled=false;
      previous.dataset.manageBackProxy=
        "true";

      previous.setAttribute(
        "aria-label",
        "Назад в управление"
      );

      if(next){
        next.classList.add(
          "is-hidden"
        );
        next.disabled=true;
      }

      clearPointerFocus();
      return;
    }

    if(
      previous.dataset.manageBackProxy!==
        "true"
    ){
      return;
    }

    delete previous.dataset.manageBackProxy;
    previous.setAttribute(
      "aria-label",
      "Назад"
    );

    if(activeManage()){
      previous.classList.add(
        "is-hidden"
      );
      previous.disabled=true;
    }
  };

  const syncPointDeleteButton=()=>{
    editorFrame=0;

    const existing=
      documentRef.getElementById(
        POINT_DELETE_BUTTON_ID
      );

    const shouldShow=
      activeManage() &&
      selectedPointId &&
      pointEditorOpen() &&
      pointEditing();

    if(!shouldShow){
      existing?.remove();
      return;
    }

    if(existing){
      existing.disabled=
        pointDeletePending;
      return;
    }

    const button=
      documentRef.createElement(
        "button"
      );

    button.type="button";
    button.className=
      "btn warn manage-point-delete";
    button.id=
      POINT_DELETE_BUTTON_ID;
    button.textContent=
      "Удалить ПВЗ";
    button.disabled=
      pointDeletePending;

    const spacer=
      manageEditorBody?.querySelector(
        ":scope > .sheet-spacer:last-child"
      );

    if(spacer){
      spacer.before(button);
    }else{
      manageEditorBody?.append(button);
    }
  };

  const syncEmployeeDeleteButton=()=>{
    employeeFrame=0;

    const original=
      documentRef.getElementById(
        "employeeDelete"
      );

    if(original){
      original.hidden=true;
      original.setAttribute(
        "aria-hidden",
        "true"
      );
      original.tabIndex=-1;
    }

    const existing=
      documentRef.getElementById(
        EMPLOYEE_EDIT_DELETE_BUTTON_ID
      );

    const shouldShow=
      activeManage() &&
      employeeEditing();

    if(!shouldShow){
      existing?.remove();
      return;
    }

    if(existing){
      existing.disabled=
        Boolean(
          employeeSheetSave?.disabled
        );
      return;
    }

    const button=
      documentRef.createElement(
        "button"
      );

    button.type="button";
    button.className=
      "btn warn manage-employee-delete";
    button.id=
      EMPLOYEE_EDIT_DELETE_BUTTON_ID;
    button.textContent=
      "Удалить сотрудника";
    button.disabled=
      Boolean(
        employeeSheetSave?.disabled
      );

    employeeSheetBody?.append(button);
  };

  const queueHeaderSync=()=>{
    if(reconcileFrame){
      return;
    }

    reconcileFrame=
      windowRef.requestAnimationFrame(
        syncHeaderBack
      );
  };

  const queueEditorSync=()=>{
    if(editorFrame){
      return;
    }

    editorFrame=
      windowRef.requestAnimationFrame(
        syncPointDeleteButton
      );
  };

  const queueEmployeeSync=()=>{
    if(employeeFrame){
      return;
    }

    employeeFrame=
      windowRef.requestAnimationFrame(
        syncEmployeeDeleteButton
      );
  };

  const clearRetry=()=>{
    retryToken++;

    if(retryTimer){
      windowRef.clearTimeout(
        retryTimer
      );
      retryTimer=0;
    }
  };

  const sectionButton=section=>
    Array.from(
      panel.querySelectorAll(
        "[data-manage-section]"
      )
    ).find(button=>
      button.dataset.manageSection===
        section
    ) || null;

  const scheduleSectionRetry=(
    section,
    startedAt,
    token
  )=>{
    retryTimer=
      windowRef.setTimeout(
        ()=>retrySectionNavigation(
          section,
          startedAt,
          token
        ),
        MANAGE_RETRY_INTERVAL
      );
  };

  const retrySectionNavigation=(
    section,
    startedAt,
    token
  )=>{
    if(
      token!==retryToken ||
      !activeManage() ||
      sectionDestinationOpen(section)
    ){
      retryTimer=0;
      return;
    }

    if(
      windowRef.performance.now()-
        startedAt>
        MANAGE_RETRY_TIMEOUT
    ){
      retryTimer=0;
      return;
    }

    const button=
      sectionButton(section);

    if(button){
      syntheticSectionClick=true;

      try{
        button.click();
      }finally{
        syntheticSectionClick=false;
      }
    }

    scheduleSectionRetry(
      section,
      startedAt,
      token
    );
  };

  const ensureSectionNavigation=section=>{
    clearRetry();

    const token=
      retryToken;

    const startedAt=
      windowRef.performance.now();

    scheduleSectionRetry(
      section,
      startedAt,
      token
    );
  };

  const retryBackNavigation=(
    startedAt,
    token
  )=>{
    if(
      token!==retryToken ||
      !activeManage() ||
      !detailOpen()
    ){
      retryTimer=0;
      return;
    }

    if(
      windowRef.performance.now()-
        startedAt>
        MANAGE_RETRY_TIMEOUT
    ){
      retryTimer=0;
      return;
    }

    sourceBack()?.click();

    retryTimer=
      windowRef.setTimeout(
        ()=>retryBackNavigation(
          startedAt,
          token
        ),
        MANAGE_RETRY_INTERVAL
      );
  };

  const ensureBackNavigation=()=>{
    clearRetry();

    const token=
      retryToken;

    const startedAt=
      windowRef.performance.now();

    sourceBack()?.click();

    retryTimer=
      windowRef.setTimeout(
        ()=>retryBackNavigation(
          startedAt,
          token
        ),
        MANAGE_RETRY_INTERVAL
      );
  };

  const removePointFromVisibleList=
    pointId=>{
      Array.from(
        panel.querySelectorAll(
          "[data-point-id]"
        )
      )
        .find(button=>
          button.dataset.pointId===
            pointId
        )
        ?.remove();
    };

  const deleteSelectedPoint=async()=>{
    if(
      !selectedPointId ||
      pointDeletePending ||
      !pointEditorOpen() ||
      !pointEditing()
    ){
      return;
    }

    const confirmed=
      await appConfirm({
        title:"Удалить ПВЗ?",
        detail:
          "ПВЗ будет удалён вместе с назначениями сотрудников и историей тарифов. Если по нему есть смены, вместо удаления используйте архив."
      });

    if(!confirmed){
      return;
    }

    const pointId=
      selectedPointId;

    pointDeletePending=true;
    syncPointDeleteButton();

    try{
      const {
        deleteAdminPoint
      }=await import(
        "./api/points.js"
      );

      await deleteAdminPoint(
        pointId
      );

      removePointFromVisibleList(
        pointId
      );

      selectedPointId="";

      documentRef
        .getElementById(
          "manageEditorCancel"
        )
        ?.click();

      showToast(
        "ПВЗ удалён"
      );
    }catch(error){
      showToast(
        pointDeleteError(error),
        4400
      );
    }finally{
      pointDeletePending=false;
      queueEditorSync();
    }
  };

  const deleteEmployeeFromEdit=()=>{
    if(
      !employeeEditing() ||
      !employeeSheetCancel ||
      !employeeSheetSave
    ){
      return;
    }

    employeeSheetCancel.click();

    const original=
      documentRef.getElementById(
        "employeeDelete"
      );

    if(
      !original ||
      employeeSheetSave.textContent
        .trim()!=="Изменить"
    ){
      queueEmployeeSync();
      return;
    }

    original.click();

    const confirm=
      documentRef.getElementById(
        "appConfirm"
      );

    if(
      employeeEditorOpen() &&
      confirm?.classList.contains("on") &&
      employeeSheetSave.textContent
        .trim()==="Изменить"
    ){
      employeeSheetSave.click();
    }

    queueEmployeeSync();
  };

  const onClickCapture=event=>{
    const employeeDelete=
      closestElement(
        event.target,
        `#${EMPLOYEE_EDIT_DELETE_BUTTON_ID}`
      );

    if(employeeDelete){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      deleteEmployeeFromEdit();
      return;
    }

    const pointDelete=
      closestElement(
        event.target,
        `#${POINT_DELETE_BUTTON_ID}`
      );

    if(pointDelete){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void deleteSelectedPoint();
      return;
    }

    const pointRow=
      closestElement(
        event.target,
        "[data-point-id]"
      );

    if(
      pointRow &&
      panel.contains(pointRow) &&
      activeManage()
    ){
      selectedPointId=
        pointRow.dataset.pointId || "";
      queueEditorSync();
    }

    const pointAdd=
      closestElement(
        event.target,
        "#pointAdd"
      );

    if(
      pointAdd &&
      panel.contains(pointAdd)
    ){
      selectedPointId="";
      queueEditorSync();
    }

    const previousClick=
      closestElement(
        event.target,
        "#prevM"
      );

    if(
      previousClick===previous &&
      detailOpen()
    ){
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      ensureBackNavigation();
      queueHeaderSync();
      return;
    }

    const manageButton=
      closestElement(
        event.target,
        "[data-manage-section]"
      );

    if(
      !manageButton ||
      !panel.contains(manageButton) ||
      !activeManage() ||
      syntheticSectionClick
    ){
      return;
    }

    const section=
      manageButton.dataset.manageSection;

    if(section){
      ensureSectionNavigation(
        section
      );
    }
  };

  const onFocusIn=event=>{
    if(
      event.target!==previous ||
      previous.dataset.manageBackProxy!==
        "true" ||
      !pointerInput()
    ){
      return;
    }

    windowRef.requestAnimationFrame(
      clearPointerFocus
    );
  };

  documentRef.addEventListener(
    "click",
    onClickCapture,
    true
  );

  documentRef.addEventListener(
    "focusin",
    onFocusIn,
    true
  );

  const panelObserver=
    new windowRef.MutationObserver(()=>{
      queueHeaderSync();
      queueEditorSync();
      queueEmployeeSync();
    });

  panelObserver.observe(
    panel,
    {
      childList:true,
      subtree:true
    }
  );

  const bodyObserver=
    new windowRef.MutationObserver(()=>{
      queueHeaderSync();
      queueEditorSync();
      queueEmployeeSync();
    });

  bodyObserver.observe(
    documentRef.body,
    {
      attributes:true,
      attributeFilter:[
        "data-active-tab",
        "data-input-modality"
      ]
    }
  );

  let editorObserver=null;

  if(manageEditorSheet){
    editorObserver=
      new windowRef.MutationObserver(
        queueEditorSync
      );

    editorObserver.observe(
      manageEditorSheet,
      {
        childList:true,
        subtree:true,
        attributes:true,
        attributeFilter:[
          "class",
          "aria-hidden",
          "disabled"
        ]
      }
    );
  }

  let employeeObserver=null;

  if(employeeSheet){
    employeeObserver=
      new windowRef.MutationObserver(
        queueEmployeeSync
      );

    employeeObserver.observe(
      employeeSheet,
      {
        childList:true,
        subtree:true,
        attributes:true,
        characterData:true,
        attributeFilter:[
          "class",
          "aria-hidden",
          "disabled"
        ]
      }
    );
  }

  queueHeaderSync();
  queueEditorSync();
  queueEmployeeSync();

  return ()=>{
    clearRetry();

    windowRef.clearTimeout(
      toastTimer
    );

    if(
      documentRef.body.dataset.managementNavigation===
        "ready"
    ){
      delete documentRef.body.dataset.managementNavigation;
    }

    panelObserver.disconnect();
    bodyObserver.disconnect();
    editorObserver?.disconnect();
    employeeObserver?.disconnect();

    documentRef.removeEventListener(
      "click",
      onClickCapture,
      true
    );

    documentRef.removeEventListener(
      "focusin",
      onFocusIn,
      true
    );

    documentRef
      .getElementById(
        POINT_DELETE_BUTTON_ID
      )
      ?.remove();

    documentRef
      .getElementById(
        EMPLOYEE_EDIT_DELETE_BUTTON_ID
      )
      ?.remove();

    if(reconcileFrame){
      windowRef.cancelAnimationFrame(
        reconcileFrame
      );
    }

    if(editorFrame){
      windowRef.cancelAnimationFrame(
        editorFrame
      );
    }

    if(employeeFrame){
      windowRef.cancelAnimationFrame(
        employeeFrame
      );
    }
  };
}

function autoInstall(){
  installManagementNavigation();
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