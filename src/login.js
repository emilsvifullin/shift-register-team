const form=
  document.getElementById(
    "authForm"
  );

const email=
  document.getElementById(
    "email"
  );

const password=
  document.getElementById(
    "current-password"
  );

const submit=
  document.getElementById(
    "authSubmit"
  );

const error=
  document.getElementById(
    "authError"
  );

const visualViewport=
  window.visualViewport;

const KEYBOARD_OPEN_DELTA=120;
const KEYBOARD_CLOSE_START_DELTA=8;
const KEYBOARD_CLOSED_DELTA=60;
const KEYBOARD_SETTLE_MS=90;
const FIELD_SWITCH_GUARD_MS=360;

let submitting=false;
let userInteracted=false;
let focusEnabled=false;

let autofillTimer=0;
let keyboardSettleTimer=0;
let keyboardCloseTimer=0;
let fieldSwitchTimer=0;

let submitPointerId=null;
let submitPointerCancelled=false;
let submitPointerResetTimer=0;

let keyboardState="idle";
let keyboardOpenHeight=null;
let fieldSwitchGuardUntil=0;

let fullViewportHeight=
  visualViewport
    ? visualViewport.height
    : window.innerHeight;

let supabaseClientPromise=null;

function setError(message=""){
  error.textContent=
    message;

  error.hidden=
    !message;
}

function setSubmitting(value){
  submitting=value;

  submit.disabled=
    value;

  submit.textContent=
    value
      ? "Входим…"
      : "Войти";

  form.setAttribute(
    "aria-busy",
    String(value)
  );
}

function isAuthInput(element){
  return (
    element===email ||
    element===password
  );
}

function setInputsReadonly(value){
  email.readOnly=value;
  password.readOnly=value;
}

function setFocusEnabled(value){
  focusEnabled=value;

  document.body.classList.toggle(
    "auth-focus-enabled",
    value
  );
}

function getViewportMetrics(){
  return {
    height:
      visualViewport
        ? visualViewport.height
        : window.innerHeight
  };
}

function clearKeyboardTimers(){
  window.clearTimeout(
    keyboardSettleTimer
  );

  window.clearTimeout(
    keyboardCloseTimer
  );

  window.clearTimeout(
    fieldSwitchTimer
  );
}

function blurInputs(){
  if(
    isAuthInput(
      document.activeElement
    )
  ){
    document.activeElement.blur();
  }

  email.blur();
  password.blur();

  document.body.classList.remove(
    "auth-input-focused"
  );
}

function setIdleFields(){
  userInteracted=false;

  setFocusEnabled(false);
  setInputsReadonly(true);

  blurInputs();
}

function finishKeyboardSession(){
  clearKeyboardTimers();

  keyboardState="idle";
  keyboardOpenHeight=null;
  fieldSwitchGuardUntil=0;

  setIdleFields();
}

function beginKeyboardDismiss(){
  window.clearTimeout(
    keyboardSettleTimer
  );

  userInteracted=false;
  setFocusEnabled(false);
  setInputsReadonly(true);

  if(keyboardState!=="idle"){
    keyboardState="closing";
  }

  blurInputs();
}

function beginOpeningSession(){
  if(keyboardState!=="idle"){
    return;
  }

  keyboardState="opening";
  keyboardOpenHeight=null;

  window.clearTimeout(
    keyboardCloseTimer
  );
}

function focusAuthInput(input){
  if(!isAuthInput(input)){
    return;
  }

  const previous=
    document.activeElement;

  const switchingFields=
    keyboardState==="open" &&
    isAuthInput(previous) &&
    previous!==input;

  userInteracted=true;
  setInputsReadonly(false);
  setFocusEnabled(true);

  if(keyboardState==="idle"){
    beginOpeningSession();
  }

  if(switchingFields){
    fieldSwitchGuardUntil=
      performance.now()+
      FIELD_SWITCH_GUARD_MS;
  }

  try{
    input.focus({
      preventScroll:true
    });
  }catch{
    input.focus();
  }

  if(switchingFields){
    window.clearTimeout(
      fieldSwitchTimer
    );

    fieldSwitchTimer=
      window.setTimeout(
        ()=>{
          if(
            keyboardState!=="open" ||
            !isAuthInput(
              document.activeElement
            )
          ){
            return;
          }

          const {
            height
          }=
            getViewportMetrics();

          keyboardOpenHeight=
            height;
        },
        FIELD_SWITCH_GUARD_MS+40
      );
  }
}

function settleKeyboardOpen(){
  if(keyboardState!=="opening"){
    return;
  }

  const {
    height
  }=
    getViewportMetrics();

  const keyboardVisible=
    fullViewportHeight-
      height>
    KEYBOARD_OPEN_DELTA;

  if(
    !keyboardVisible ||
    !focusEnabled ||
    !isAuthInput(
      document.activeElement
    )
  ){
    return;
  }

  keyboardOpenHeight=
    height;

  keyboardState="open";
}

function confirmKeyboardClosed(){
  if(
    keyboardState!=="closing" &&
    keyboardState!=="open"
  ){
    return;
  }

  const {
    height
  }=
    getViewportMetrics();

  const keyboardClosed=
    fullViewportHeight-
      height<=
    KEYBOARD_CLOSED_DELTA;

  if(!keyboardClosed){
    return;
  }

  fullViewportHeight=
    Math.max(
      fullViewportHeight,
      height
    );

  finishKeyboardSession();
}

function handleViewportGeometry(){
  const {
    height
  }=
    getViewportMetrics();

  if(keyboardState==="idle"){
    if(
      !isAuthInput(
        document.activeElement
      )
    ){
      fullViewportHeight=
        Math.max(
          fullViewportHeight,
          height
        );
    }

    return;
  }

  if(keyboardState==="opening"){
    const keyboardVisible=
      fullViewportHeight-
        height>
      KEYBOARD_OPEN_DELTA;

    if(!keyboardVisible){
      return;
    }

    window.clearTimeout(
      keyboardSettleTimer
    );

    keyboardSettleTimer=
      window.setTimeout(
        settleKeyboardOpen,
        KEYBOARD_SETTLE_MS
      );

    return;
  }

  if(keyboardState==="open"){
    if(
      performance.now()<
      fieldSwitchGuardUntil
    ){
      return;
    }

    const startedClosing=
      keyboardOpenHeight!==null &&
      height>=
        keyboardOpenHeight+
        KEYBOARD_CLOSE_START_DELTA;

    if(!startedClosing){
      return;
    }

    keyboardState="closing";
  }

  if(keyboardState==="closing"){
    const keyboardClosed=
      fullViewportHeight-
        height<=
      KEYBOARD_CLOSED_DELTA;

    if(!keyboardClosed){
      window.clearTimeout(
        keyboardCloseTimer
      );

      return;
    }

    window.clearTimeout(
      keyboardCloseTimer
    );

    keyboardCloseTimer=
      window.setTimeout(
        confirmKeyboardClosed,
        70
      );
  }
}

document.addEventListener(
  "pointerdown",
  event=>{
    const target=
      event.target;

    if(target instanceof Element){
      const field=
        target.closest(
          ".auth-field"
        );

      if(field){
        const input=
          field.querySelector(
            "input"
          );

        if(isAuthInput(input)){
          if(event.cancelable){
            event.preventDefault();
          }

          focusAuthInput(
            input
          );

          return;
        }
      }
    }

    if(
      isAuthInput(
        document.activeElement
      )
    ){
      beginKeyboardDismiss();
    }
  },
  {
    capture:true
  }
);

function isPointerInsideSubmit(
  event
){
  const rect=
    submit.getBoundingClientRect();

  return (
    event.clientX>=rect.left &&
    event.clientX<=rect.right &&
    event.clientY>=rect.top &&
    event.clientY<=rect.bottom
  );
}

function resetSubmitPointer(){
  submitPointerId=null;
  submitPointerCancelled=false;

  submit.classList.remove(
    "press-cancelled"
  );
}

submit.addEventListener(
  "pointerdown",
  event=>{
    if(submit.disabled){
      return;
    }

    window.clearTimeout(
      submitPointerResetTimer
    );

    submitPointerId=
      event.pointerId;

    submitPointerCancelled=false;

    submit.classList.remove(
      "press-cancelled"
    );
  }
);

window.addEventListener(
  "pointermove",
  event=>{
    if(
      event.pointerId!==
        submitPointerId ||
      submitPointerCancelled
    ){
      return;
    }

    if(
      isPointerInsideSubmit(
        event
      )
    ){
      return;
    }

    submitPointerCancelled=true;

    submit.classList.add(
      "press-cancelled"
    );
  },
  {
    passive:true
  }
);

window.addEventListener(
  "pointerup",
  event=>{
    if(
      event.pointerId!==
      submitPointerId
    ){
      return;
    }

    submitPointerId=null;

    submitPointerResetTimer=
      window.setTimeout(
        resetSubmitPointer,
        0
      );
  },
  {
    passive:true
  }
);

window.addEventListener(
  "pointercancel",
  event=>{
    if(
      event.pointerId!==
      submitPointerId
    ){
      return;
    }

    submitPointerCancelled=true;

    submit.classList.add(
      "press-cancelled"
    );

    submitPointerId=null;

    submitPointerResetTimer=
      window.setTimeout(
        resetSubmitPointer,
        0
      );
  },
  {
    passive:true
  }
);

submit.addEventListener(
  "click",
  event=>{
    if(
      !submitPointerCancelled ||
      event.detail===0
    ){
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    resetSubmitPointer();
  },
  {
    capture:true
  }
);

document.addEventListener(
  "keydown",
  event=>{
    if(event.key!=="Tab"){
      return;
    }

    userInteracted=true;
    setInputsReadonly(false);
    setFocusEnabled(true);
  },
  {
    capture:true
  }
);

email.addEventListener(
  "keydown",
  event=>{
    if(event.key!=="Enter"){
      return;
    }

    event.preventDefault();

    focusAuthInput(
      password
    );
  }
);

password.addEventListener(
  "keydown",
  event=>{
    if(event.key!=="Enter"){
      return;
    }

    event.preventDefault();

    if(
      typeof form.requestSubmit===
      "function"
    ){
      form.requestSubmit();
      return;
    }

    submit.click();
  }
);

form.addEventListener(
  "focusin",
  event=>{
    if(
      !isAuthInput(
        event.target
      )
    ){
      return;
    }

    if(
      !userInteracted ||
      !focusEnabled
    ){
      event.target.blur();

      document.body.classList.remove(
        "auth-input-focused"
      );

      return;
    }

    document.body.classList.add(
      "auth-input-focused"
    );

    handleViewportGeometry();
  }
);

form.addEventListener(
  "focusout",
  ()=>{
    window.setTimeout(
      ()=>{
        if(
          isAuthInput(
            document.activeElement
          )
        ){
          return;
        }

        document.body.classList.remove(
          "auth-input-focused"
        );
      },
      0
    );
  }
);

function releaseAutofillFocus(){
  beginKeyboardDismiss();
}

function scheduleAutofillSubmit(){
  if(submitting){
    return;
  }

  window.clearTimeout(
    autofillTimer
  );

  let attempts=0;
  let stableCount=0;

  let previousEmail="";
  let previousPassword="";

  const check=()=>{
    if(submitting){
      return;
    }

    const emailValue=
      email.value.trim();

    const passwordValue=
      password.value;

    if(
      emailValue &&
      passwordValue
    ){
      if(
        emailValue===
          previousEmail &&
        passwordValue===
          previousPassword
      ){
        stableCount+=1;
      }else{
        stableCount=0;

        previousEmail=
          emailValue;

        previousPassword=
          passwordValue;
      }

      if(stableCount>=2){
        setInputsReadonly(true);

        if(
          typeof form.requestSubmit===
          "function"
        ){
          form.requestSubmit();
          return;
        }

        submit.click();
        return;
      }
    }

    attempts+=1;

    if(attempts>=12){
      return;
    }

    autofillTimer=
      window.setTimeout(
        check,
        50
      );
  };

  requestAnimationFrame(
    check
  );
}

form.addEventListener(
  "animationstart",
  event=>{
    if(
      event.animationName!==
        "auth-autofill-detected" ||
      !userInteracted ||
      submitting
    ){
      return;
    }

    requestAnimationFrame(
      ()=>{
        if(submitting){
          return;
        }

        releaseAutofillFocus();
        scheduleAutofillSubmit();
      }
    );
  }
);

form.addEventListener(
  "input",
  event=>{
    if(
      event.inputType!==
        "insertReplacementText" ||
      !userInteracted
    ){
      return;
    }

    releaseAutofillFocus();
    scheduleAutofillSubmit();
  }
);

function loadSupabaseLibrary(){
  if(
    typeof globalThis
      .supabase
      ?.createClient===
    "function"
  ){
    return Promise.resolve();
  }

  return new Promise(
    (resolve,reject)=>{
      const script=
        document.createElement(
          "script"
        );

      script.src=
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3";

      script.async=true;

      script.addEventListener(
        "load",
        resolve,
        {
          once:true
        }
      );

      script.addEventListener(
        "error",
        ()=>{
          reject(
            new Error(
              "Supabase client не загружен"
            )
          );
        },
        {
          once:true
        }
      );

      document.head.appendChild(
        script
      );
    }
  );
}

async function getSupabaseClient(){
  if(supabaseClientPromise){
    return supabaseClientPromise;
  }

  supabaseClientPromise=
    (async()=>{
      await loadSupabaseLibrary();

      const module=
        await import(
          "./supabase.js"
        );

      return module.supabaseClient;
    })();

  try{
    return await supabaseClientPromise;
  }catch(error){
    supabaseClientPromise=null;
    throw error;
  }
}

form.addEventListener(
  "submit",
  async event=>{
    event.preventDefault();

    window.clearTimeout(
      autofillTimer
    );

    const emailValue=
      email.value.trim();

    const passwordValue=
      password.value;

    if(
      !emailValue ||
      !passwordValue
    ){
      setError(
        "Введите email и пароль."
      );

      return;
    }

    setError();

    beginKeyboardDismiss();
    setSubmitting(true);

    let data;
    let authError;

    try{
      const supabaseClient=
        await getSupabaseClient();

      ({
        data,
        error:authError
      }=
        await supabaseClient
          .auth
          .signInWithPassword({
            email:emailValue,
            password:passwordValue
          }));
    }catch(authRequestError){
      console.error(
        "Не удалось выполнить вход:",
        authRequestError
      );

      setSubmitting(false);

      setError(
        navigator.onLine
          ? "Не удалось связаться с сервером авторизации."
          : "Нет подключения к интернету."
      );

      return;
    }

    if(
      authError ||
      !data.session
    ){
      setSubmitting(false);

      console.error(
        "Ошибка входа Supabase:",
        authError
      );

      if(
        authError?.code===
        "invalid_credentials"
      ){
        password.value="";

        setError(
          "Неверный email или пароль."
        );

        return;
      }

      if(
        authError?.code===
        "email_not_confirmed"
      ){
        setError(
          "Email не подтверждён."
        );

        return;
      }

      if(
        authError?.name===
          "AuthRetryableFetchError" ||
        authError?.status===0
      ){
        setError(
          "Сеть не пропускает сервер авторизации."
        );

        return;
      }

      setError(
        "Не удалось выполнить вход. Попробуйте ещё раз."
      );

      return;
    }

    try{
      sessionStorage.removeItem(
        "shift-register-team-ui-v3"
      );

      sessionStorage.setItem(
        "shift-register-login-entry-v1",
        "1"
      );
    }catch{}

    window.location.replace(
      "./"
    );
  }
);

function enforceInitialIdleState(){
  if(userInteracted){
    return;
  }

  clearKeyboardTimers();

  keyboardState="idle";
  keyboardOpenHeight=null;
  fieldSwitchGuardUntil=0;

  setIdleFields();

  const {
    height
  }=
    getViewportMetrics();

  fullViewportHeight=
    Math.max(
      fullViewportHeight,
      height
    );
}

enforceInitialIdleState();

window.addEventListener(
  "pageshow",
  ()=>{
    if(userInteracted){
      return;
    }

    enforceInitialIdleState();

    requestAnimationFrame(
      enforceInitialIdleState
    );

    window.setTimeout(
      enforceInitialIdleState,
      80
    );

    window.setTimeout(
      enforceInitialIdleState,
      220
    );
  }
);

document.addEventListener(
  "visibilitychange",
  ()=>{
    if(
      document.visibilityState===
        "visible" &&
      !userInteracted
    ){
      enforceInitialIdleState();
    }
  }
);

function onViewportChange(){
  handleViewportGeometry();
}

if(visualViewport){
  visualViewport.addEventListener(
    "resize",
    onViewportChange,
    {
      passive:true
    }
  );

  visualViewport.addEventListener(
    "scroll",
    onViewportChange,
    {
      passive:true
    }
  );
}else{
  window.addEventListener(
    "resize",
    onViewportChange,
    {
      passive:true
    }
  );
}

window.addEventListener(
  "orientationchange",
  ()=>{
    clearKeyboardTimers();

    keyboardState="idle";
    keyboardOpenHeight=null;
    fieldSwitchGuardUntil=0;

    setIdleFields();

    window.setTimeout(
      ()=>{
        const {
          height
        }=
          getViewportMetrics();

        fullViewportHeight=
          height;
      },
      320
    );
  }
);
