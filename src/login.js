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

let submitting=false;
let userInteracted=false;
let focusEnabled=false;

let autofillTimer=0;
let keyboardTimer=0;

let keyboardOpen=false;
let keyboardScreenCenter=null;

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

function removeKeyboardPosition(){
  keyboardOpen=false;
  keyboardScreenCenter=null;

  document.body.classList.remove(
    "auth-keyboard-open"
  );

  document.documentElement
    .style
    .removeProperty(
      "--auth-keyboard-center-y"
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

function lockIdleState(){
  userInteracted=false;

  setFocusEnabled(false);
  setInputsReadonly(true);

  blurInputs();
  removeKeyboardPosition();
}

function unlockForUser(){
  userInteracted=true;

  setInputsReadonly(false);
  setFocusEnabled(true);
}

function setKeyboardTop(){
  if(
    !keyboardOpen ||
    keyboardScreenCenter===null
  ){
    return;
  }

  const {
    offsetTop
  }=
    getViewportMetrics();

  /*
    keyboardScreenCenter хранится
    в экранных координатах.

    offsetTop компенсирует попытки
    Safari автоматически панорамировать
    visual viewport.
  */
  const layoutTop=
    offsetTop +
    keyboardScreenCenter;

  document.documentElement
    .style
    .setProperty(
      "--auth-keyboard-center-y",
      `${Math.round(layoutTop)}px`
    );
}

function syncKeyboardState(){
  const {
    height
  }=
    getViewportMetrics();

  const keyboardVisible=
    fullViewportHeight -
      height >
    120;

  if(!keyboardVisible){
    /*
      Клавиатура закрыта.

      Обновляем нормальную высоту
      экрана и возвращаем карточку
      строго в центр страницы.
    */
    fullViewportHeight=
      height;

    const wasOpen=
      keyboardOpen;

    removeKeyboardPosition();

    /*
      Если клавиатуру скрыли кнопкой
      на самой клавиатуре, Safari
      может оставить input focused.

      Нам это не нужно.
    */
    if(
      wasOpen &&
      isAuthInput(
        document.activeElement
      )
    ){
      lockIdleState();
    }

    return;
  }

  if(
    !focusEnabled &&
    !keyboardOpen
  ){
    return;
  }

  if(!keyboardOpen){
    keyboardOpen=true;

    /*
      Положение вычисляем ТОЛЬКО
      при первом открытии клавиатуры.

      При Email -> Пароль оно уже
      не пересчитывается.
    */
    const cardHeight=
      authCard
        ? authCard
            .getBoundingClientRect()
            .height
        : 0;

    const margin=12;

    const idealCenter=
      height / 2;

    const minimumCenter=
      cardHeight / 2 +
      margin;

    const maximumCenter=
      Math.max(
        minimumCenter,
        height -
          cardHeight / 2 -
          margin
      );

    keyboardScreenCenter=
      Math.min(
        Math.max(
          idealCenter,
          minimumCenter
        ),
        maximumCenter
      );

    document.body.classList.add(
      "auth-keyboard-open"
    );
  }

  setKeyboardTop();
}

function scheduleKeyboardSync(){
  window.clearTimeout(
    keyboardTimer
  );

  keyboardTimer=
    window.setTimeout(
      syncKeyboardState,
      90
    );
}

function handleViewportChange(){
  if(keyboardOpen){
    /*
      При переключении Email/Пароль
      не меняем выбранный центр.

      Корректируем только offsetTop,
      если Safari сам попытался
      сдвинуть visual viewport.
    */
    setKeyboardTop();
  }

  scheduleKeyboardSync();
}

document.addEventListener(
  "pointerdown",
  event=>{
    const target=
      event.target;

    if(
      target instanceof Element &&
      target.closest(
        ".auth-field"
      )
    ){
      unlockForUser();
      return;
    }

    /*
      Нажатие в любое место
      вне Email/Пароля закрывает
      клавиатуру и снимает фокус.

      Нажатие с Email на Пароль
      сюда не попадает.
    */
    if(
      isAuthInput(
        document.activeElement
      )
    ){
      lockIdleState();
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

    unlockForUser();
  },
  {
    capture:true
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

    /*
      Любой самопроизвольный focus
      Safari при запуске запрещён.
    */
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

    scheduleKeyboardSync();
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
            ничего не меняем.
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
    Не ставим readonly прямо сейчас:
    Password Manager ещё может
    дописывать второе поле.

    Но визуального/системного
    фокуса уже нет.
  */
  setFocusEnabled(false);

  blurInputs();
  removeKeyboardPosition();
}

function scheduleAutofillSubmit(){
  if(
    !userInteracted ||
    submitting
  ){
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

      /*
        Значения должны остаться
        одинаковыми несколько циклов,
        чтобы не отправить форму
        посреди работы AutoFill.
      */
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

    /*
      Системный Password AutoFill
      начался.

      Убираем Email highlight,
      caret и клавиатуру сразу.
    */
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
    /*
      Дополнительный fallback
      для менеджеров паролей,
      которые сообщают AutoFill
      через input event.
    */
    if(
      event.inputType!==
      "insertReplacementText"
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

    lockIdleState();
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

  lockIdleState();
}

/*
  Первый idle-state выполняется
  сразу.

  readonly уже находится в HTML,
  поэтому даже до выполнения JS
  клавиатура открыться не должна.
*/
lockIdleState();

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
    handleViewportChange,
    {
      passive:true
    }
  );

  visualViewport.addEventListener(
    "scroll",
    handleViewportChange,
    {
      passive:true
    }
  );
}else{
  window.addEventListener(
    "resize",
    handleViewportChange,
    {
      passive:true
    }
  );
}

window.addEventListener(
  "orientationchange",
  ()=>{
    removeKeyboardPosition();

    window.setTimeout(
      ()=>{
        const {
          height
        }=
          getViewportMetrics();

        fullViewportHeight=
          height;

        if(
          !isAuthInput(
            document.activeElement
          )
        ){
          lockIdleState();
        }
      },
      320
    );
  }
);
