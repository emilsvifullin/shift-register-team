import {
  positionAppPicker,
  resetAppPickerPosition
} from "./picker-position.js";

let employeeUiInstance=null;

function esc(value){
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function cleanAccountLabel(value){
  return String(value || "")
    .replace(
      /\s*·\s*администратор\s*$/iu,
      ""
    )
    .trim();
}

export function initEmployeeUi({
  app,
  employeeSheet
}){
  if(employeeUiInstance){
    return employeeUiInstance;
  }

  const employeeSheetBody=
    document.getElementById(
      "employeeSheetBody"
    );

  let accountPicker=null;
  let accountPickerVeil=null;
  let accountPickerList=null;
  let accountPickerValue="";
  let accountPickerPreviousFocus=null;
  let accountPickerHideTimer=null;
  let manageBackSwipe=null;
  let suppressManageBackClickUntil=0;

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
      value.textContent=
        accountLabel(select);
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
    button.className=
      "row point-row";
    button.id=
      "employeeAccountOpen";
    button.innerHTML=`
      <div class="t">Вход</div>
      <div class="point-value">
        ${esc(accountLabel(select))}
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
              data-employee-account="${esc(option.value)}"
            >
              <span class="point-check">
                ${selected ? "✓" : ""}
              </span>
              <span class="point-name">
                ${esc(option.label)}
              </span>
            </button>
          `;
        })
        .join("");
  }

  function closeAccountPicker(){
    if(
      !accountPicker?.classList
        .contains("on")
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
        ?.classList
        .contains("on")
    ){
      document.body.classList.remove(
        "point-picker-open"
      );
    }

    clearTimeout(
      accountPickerHideTimer
    );

    accountPickerHideTimer=
      setTimeout(()=>{
        if(
          accountPicker &&
          !accountPicker.classList
            .contains("on")
        ){
          accountPicker.style.display=
            "none";

          resetAppPickerPosition(
            accountPicker
          );
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
        <button type="button" class="picker-toolbar-btn cancel" id="employeeAccountCancel">
          Отмена
        </button>
        <div class="picker-toolbar-title" id="employeeAccountPickerTitle">
          Выберите аккаунт
        </div>
        <button type="button" class="picker-toolbar-btn done" id="employeeAccountDone">
          Готово
        </button>
      </div>
      <div class="point-list" id="employeeAccountList"></div>
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

    positionAppPicker(
      accountPicker,
      accountPickerPreviousFocus
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

  function accountPickerKeydown(event){
    if(
      !accountPicker?.classList
        .contains("on")
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
      return;
    }

    const first=focusable[0];
    const last=focusable.at(-1);

    if(
      event.shiftKey &&
      document.activeElement===first
    ){
      event.preventDefault();
      last.focus();
    }else if(
      !event.shiftKey &&
      document.activeElement===last
    ){
      event.preventDefault();
      first.focus();
    }
  }

  function manageSubsectionView(){
    return Boolean(
      document.getElementById(
        "manageBack"
      )
    );
  }

  function resetManageSwipe(){
    manageBackSwipe=null;
  }

  function startManageSwipe(event){
    if(
      !manageSubsectionView() ||
      event.touches.length!==1 ||
      event.target.closest(
        "input,textarea,select,[contenteditable='true']"
      ) ||
      document.body.classList.contains(
        "sheet-open"
      ) ||
      document.body.classList.contains(
        "point-picker-open"
      )
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
        .find(item=>
          item.identifier===
          manageBackSwipe.id
        );

    if(!touch){
      return;
    }

    manageBackSwipe.lastX=touch.clientX;
    manageBackSwipe.lastY=touch.clientY;

    const dx=
      touch.clientX-
      manageBackSwipe.x;
    const dy=
      touch.clientY-
      manageBackSwipe.y;
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
      ).find(item=>
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
    const duration=Math.max(
      1,
      performance.now()-swipe.time
    );

    resetManageSwipe();

    if(
      dx<=0 ||
      swipe.axis==="y" ||
      absX<=absY*1.08 ||
      !(
        absX>=38 ||
        (
          absX>=22 &&
          absX/duration>=0.30
        )
      )
    ){
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

  app?.addEventListener(
    "pointerdown",
    event=>{
      if(
        event.pointerType==="touch" ||
        !event.isPrimary ||
        !manageSubsectionView() ||
        event.target.closest(
          "input,textarea,select,[contenteditable='true']"
        ) ||
        document.body.classList.contains(
          "sheet-open"
        ) ||
        document.body.classList.contains(
          "point-picker-open"
        )
      ){
        resetManageSwipe();
        return;
      }

      manageBackSwipe={
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

  app?.addEventListener(
    "pointermove",
    event=>{
      if(
        !manageBackSwipe?.pointer ||
        event.pointerId!==
          manageBackSwipe.id
      ){
        return;
      }

      manageBackSwipe.lastX=
        event.clientX;
      manageBackSwipe.lastY=
        event.clientY;

      const dx=
        event.clientX-
        manageBackSwipe.x;
      const dy=
        event.clientY-
        manageBackSwipe.y;
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

      if(manageBackSwipe.axis==="x"){
        event.preventDefault();
      }
    }
  );

  app?.addEventListener(
    "pointerup",
    event=>{
      if(
        !manageBackSwipe?.pointer ||
        event.pointerId!==
          manageBackSwipe.id
      ){
        return;
      }

      finishManageSwipe({
        changedTouches:[{
          identifier:event.pointerId,
          clientX:event.clientX,
          clientY:event.clientY
        }]
      });
    }
  );

  app?.addEventListener(
    "pointercancel",
    event=>{
      if(
        manageBackSwipe?.pointer &&
        event.pointerId===
          manageBackSwipe.id
      ){
        resetManageSwipe();
      }
    }
  );

  let wheelX=0;
  let wheelY=0;
  let wheelTimer=0;
  let wheelGestureLocked=false;

  app?.addEventListener(
    "wheel",
    event=>{
      if(
        !manageSubsectionView() ||
        Math.abs(event.deltaX)<=
          Math.abs(event.deltaY)
      ){
        return;
      }

      wheelX+=event.deltaX;
      wheelY+=event.deltaY;

      window.clearTimeout(
        wheelTimer
      );

      wheelTimer=window.setTimeout(()=>{
        wheelX=0;
        wheelY=0;
        wheelGestureLocked=false;
      },140);

      if(wheelGestureLocked){
        if(event.cancelable){
          event.preventDefault();
        }

        return;
      }

      if(
        wheelX>-48 ||
        Math.abs(wheelX)<=
          Math.abs(wheelY)*1.12
      ){
        return;
      }

      if(event.cancelable){
        event.preventDefault();
      }

      wheelX=0;
      wheelY=0;
      wheelGestureLocked=true;

      document
        .getElementById(
          "manageBack"
        )
        ?.click();
    },
    {passive:false}
  );

  employeeUiInstance={
    enhanceAccountField,
    closeAccountPicker,
    isAccountPickerOpen:()=>
      accountPicker?.classList
        .contains("on")===true
  };

  return employeeUiInstance;
}
