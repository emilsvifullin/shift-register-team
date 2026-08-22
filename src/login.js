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

const authCard=
  document.querySelector(
    ".auth-card"
  );

const visualViewport=
  window.visualViewport;

const KEYBOARD_OPEN_DELTA=120;
const KEYBOARD_CLOSED_DELTA=80;
const KEYBOARD_OPEN_STABLE_MS=140;
const KEYBOARD_CLOSE_STABLE_MS=240;
const CARD_LOCK_DELAY_MS=300;

let submitting=false;
let userInteracted=false;
let focusEnabled=false;

let autofillTimer=0;
let keyboardOpenTimer=0;
let keyboardCloseTimer=0;
let keyboardLockTimer=0;

let keyboardSession=false;

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
        : window.innerHeight,

    offsetTop:
      visualViewport
        ? visualViewport.offsetTop
        : 0
  };
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

function clearKeyboardTimers(){
  window.clearTimeout(
    keyboardOpenTimer
  );

  window.clearTimeout(
    keyboardCloseTimer
  );

  window.clearTimeout(
    keyboardLockTimer
  );
}

function resetCardImmediately(){
  clearKeyboardTimers();

  keyboardSession=false;

  document.body.classList.remove(
    "auth-keyboard-open",
    "auth-keyboard-locked"
  );

  document.documentElement
    .style
    .removeProperty(
      "--auth-keyboard-center-y"
    );
}

function returnCardToCenter(){
  clearKeyboardTimers();

  if(!keyboardSession){
    resetCardImmediately();
    return;
  }

  keyboardSession=false;

  /*
    Пока клавиатура закрывалась,
    карточка оставалась полностью
    замороженной.

    Теперь возвращаем transition
    и одним движением отправляем
    карточку в центр страницы.
  */
  document.body.classList.remove(
    "auth-keyboard-locked"
  );

  void authCard?.offsetHeight;

  requestAnimationFrame(
    ()=>{
      document.body.classList.remove(
        "auth-keyboard-open"
      );

      document.documentElement
        .style
        .removeProperty(
          "--auth-keyboard-center-y"
        );
    }
  );
}

function requestKeyboardDismiss(){
  window.clearTimeout(
    keyboardOpenTimer
  );

  userInteracted=false;

  setFocusEnabled(false);

  /*
    Никакого изменения позиции карточки.
    Только снимаем focus.

    Карточка вернётся в центр лишь после
    того, как visualViewport подтвердит,
    что клавиатура полностью закрылась.
  */
  blurInputs();

  setInputsReadonly(true);
}

function focusAuthInput(input){
  if(!isAuthInput(input)){
    return;
  }

  userInteracted=true;

  setInputsReadonly(false);
  setFocusEnabled(true);

  try{
    input.focus({
      preventScroll:true
    });
  }catch{
    input.focus();
  }
}

function freezeCardAboveKeyboard(){
  if(
    keyboardSession ||
    !focusEnabled ||
    !isAuthInput(
      document.activeElement
    )
  ){
    return;
  }

  const {
    height,
    offsetTop
  }=
    getViewportMetrics();

  if(
    fullViewportHeight -
      height <=
    KEYBOARD_OPEN_DELTA
  ){
    return;
  }

  const cardHeight=
    authCard
      ? authCard
          .getBoundingClientRect()
          .height
      : 0;

  const margin=12;

  const visibleTop=
    offsetTop;

  const visibleBottom=
    offsetTop +
    height;

  const idealCenter=
    visibleTop +
    height / 2;

  const minimumCenter=
    visibleTop +
    cardHeight / 2 +
    margin;

  const maximumCenter=
    visibleBottom -
    cardHeight / 2 -
    margin;

  const center=
    minimumCenter<=maximumCenter
      ? Math.min(
          Math.max(
            idealCenter,
            minimumCenter
          ),
          maximumCenter
        )
      : idealCenter;

  document.documentElement
    .style
    .setProperty(
      "--auth-keyboard-center-y",
      `${Math.round(center)}px`
    );

  keyboardSession=true;

  document.body.classList.add(
    "auth-keyboard-open"
  );

  window.clearTimeout(
    keyboardLockTimer
  );

  keyboardLockTimer=
    window.setTimeout(
      ()=>{
        if(!keyboardSession){
          return;
        }

        document.body.classList.add(
          "auth-keyboard-locked"
        );
      },
      CARD_LOCK_DELAY_MS
    );
}

function confirmKeyboardClosed(){
  if(!keyboardSession){
    return;
  }

  const {
    height
  }=
    getViewportMetrics();

  const keyboardClosed=
    fullViewportHeight -
      height <=
    KEYBOARD_CLOSED_DELTA;

  if(!keyboardClosed){
    return;
  }

  fullViewportHeight=
    Math.max(
      fullViewportHeight,
      height
    );

  /*
    При закрытии клавиатуры кнопкой iOS
    input иногда формально остаётся focused.
    Убираем этот остаточный focus только
    после подтверждённого закрытия.
  */
  setIdleFields();

  returnCardToCenter();
}

function scheduleKeyboardState(){
  const {
    height
  }=
    getViewportMetrics();

  if(!keyboardSession){
    const keyboardVisible=
      fullViewportHeight -
        height >
      KEYBOARD_OPEN_DELTA;

    if(
      !keyboardVisible ||
      !focusEnabled ||
      !isAuthInput(
        document.activeElement
      )
    ){
      window.clearTimeout(
        keyboardOpenTimer
      );

      return;
    }

    /*
      Ждём окончания resize-анимации iOS,
      затем вычисляем позицию только один раз.
    */
    window.clearTimeout(
      keyboardOpenTimer
    );

    keyboardOpenTimer=
      window.setTimeout(
        freezeCardAboveKeyboard,
        KEYBOARD_OPEN_STABLE_MS
      );

    return;
  }

  /*
    Во время открытой клавиатуры top карточки
    больше никогда не пересчитывается.

    resize/scroll нужны только для определения
    окончательного закрытия клавиатуры.
  */
  const keyboardClosed=
    fullViewportHeight -
      height <=
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
      KEYBOARD_CLOSE_STABLE_MS
    );
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
          /*
            Всегда берём focus под свой контроль.
            Safari не получает возможности
            самостоятельно панорамировать страницу.

            Первый focus и Email <-> Пароль
            проходят через одну и ту же
            непрерывную клавиатурную сессию.
          */
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
      requestKeyboardDismiss();
    }
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

    scheduleKeyboardState();
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
          /*
            Email -> Пароль:
            клавиатурная сессия продолжается.
          */
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
  /*
    AutoFill уже выбран пользователем.
    Сразу убираем focus и клавиатуру,
    но карточку не двигаем до фактического
    завершения закрытия клавиатуры.
  */
  requestKeyboardDismiss();
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

    requestKeyboardDismiss();
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

  setIdleFields();
  resetCardImmediately();

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

/*
  readonly уже есть непосредственно
  в login.html, поэтому до загрузки JS
  Safari физически не может сам открыть
  клавиатуру.
*/
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

if(visualViewport){
  visualViewport.addEventListener(
    "resize",
    scheduleKeyboardState,
    {
      passive:true
    }
  );

  visualViewport.addEventListener(
    "scroll",
    scheduleKeyboardState,
    {
      passive:true
    }
  );
}else{
  window.addEventListener(
    "resize",
    scheduleKeyboardState,
    {
      passive:true
    }
  );
}

window.addEventListener(
  "orientationchange",
  ()=>{
    setIdleFields();
    resetCardImmediately();

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
