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
let keyboardLockTimer=0;
let keyboardCloseTimer=0;

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

function removeKeyboardPosition({
  animate=false
}={}){
  window.clearTimeout(
    keyboardLockTimer
  );

  window.clearTimeout(
    keyboardCloseTimer
  );

  keyboardOpen=false;
  keyboardScreenCenter=null;

  document.body.classList.remove(
    "auth-keyboard-locked"
  );

  if(!animate){
    document.body.classList.remove(
      "auth-keyboard-open"
    );

    document.documentElement
      .style
      .removeProperty(
        "--auth-keyboard-center-y"
      );

    return;
  }

  /*
    Сначала возвращаем transition,
    а уже следующим кадром отправляем
    карточку обратно в центр страницы.
  */
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

function dismissInput(){
  userInteracted=false;

  setFocusEnabled(false);
  setInputsReadonly(true);

  blurInputs();
}

function lockIdleState(){
  dismissInput();

  removeKeyboardPosition({
    animate:false
  });
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

  /*
    Клавиатура ещё не была
    зафиксирована.
  */
  if(!keyboardOpen){
    const keyboardVisible=
      fullViewportHeight -
        height >
      120;

    if(
      !keyboardVisible ||
      !focusEnabled ||
      !isAuthInput(
        document.activeElement
      )
    ){
      return;
    }

    keyboardOpen=true;
    keyboardOpenHeight=height;

    /*
      Положение карточки вычисляем
      ОДИН РАЗ на всю клавиатурную
      сессию.
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

    /*
      Единственный вызов setKeyboardTop()
      за всю открытую клавиатуру.
    */
    setKeyboardTop();

    window.clearTimeout(
      keyboardLockTimer
    );

    keyboardLockTimer=
      window.setTimeout(
        ()=>{
          if(!keyboardOpen){
            return;
          }

          document.body.classList.add(
            "auth-keyboard-locked"
          );
        },
        280
      );

    return;
  }

  /*
    Клавиатура уже открыта.

    Здесь НИКОГДА не меняем top
    карточки. Email -> Пароль ->
    Email не может сдвинуть окно.
  */

  const inputStillFocused=
    isAuthInput(
      document.activeElement
    );

  const viewportExpanded=
    keyboardOpenHeight!==null &&
    height>=
      keyboardOpenHeight+100;

  /*
    Обычное переключение полей.

    Пока один из наших inputs
    остаётся активным и viewport
    не раскрылся заметно вверх,
    вообще ничего не делаем.
  */
  if(
    inputStillFocused &&
    !viewportExpanded
  ){
    window.clearTimeout(
      keyboardCloseTimer
    );

    return;
  }

  /*
    Возможное настоящее закрытие
    клавиатуры.

    Ничего не закрываем сами.
    Просто ждём, пока Safari
    окончательно закончит анимацию.
  */
  window.clearTimeout(
    keyboardCloseTimer
  );

  keyboardCloseTimer=
    window.setTimeout(
      ()=>{
        if(!keyboardOpen){
          return;
        }

        const {
          height:currentHeight
        }=
          getViewportMetrics();

        const stillFocused=
          isAuthInput(
            document.activeElement
          );

        const stillExpanded=
          keyboardOpenHeight!==null &&
          currentHeight>=
            keyboardOpenHeight+100;

        /*
          Если поле снова активно,
          а keyboard viewport снова
          уменьшился — это было лишь
          переключение Email/Пароль.
        */
        if(
          stillFocused &&
          !stillExpanded
        ){
          return;
        }

        fullViewportHeight=
          Math.max(
            fullViewportHeight,
            currentHeight
          );

        /*
          Кнопка закрытия клавиатуры
          iOS иногда оставляет input
          формально focused.

          Blur делаем ТОЛЬКО ПОСЛЕ
          того, как viewport уже
          подтвердил закрытие.
        */
        if(stillFocused){
          dismissInput();
        }

        /*
          Теперь клавиатура уже
          закончила движение.

          Только теперь разрешаем
          карточке плавно вернуться
          в центр страницы.
        */
        removeKeyboardPosition({
          animate:true
        });
      },
      460
    );
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
  /*
    visualViewport теперь используется
    только для определения состояния
    клавиатуры.

    Положение уже открытой карточки
    здесь НИКОГДА не меняется.
  */
  scheduleKeyboardSync();
}

document.addEventListener(
  "pointerdown",
  event=>{
    const target=
      event.target;

    if(
      target instanceof Element
    ){
      const field=
        target.closest(
          ".auth-field"
        );

      if(field){
        const input=
          field.querySelector(
            "input"
          );

        unlockForUser();

        /*
          Первый тап оставляем браузеру:
          он нормально открывает
          клавиатуру и Password AutoFill.

          Когда клавиатура уже открыта,
          переключаем Email/Пароль сами
          с preventScroll, чтобы Safari
          не пытался дополнительно
          панорамировать страницу.
        */
        if(
          keyboardOpen &&
          (
            input===email ||
            input===password
          ) &&
          document.activeElement!==input
        ){
          if(event.cancelable){
            event.preventDefault();
          }

          try{
            input.focus({
              preventScroll:true
            });
          }catch{
            input.focus();
          }
        }

        return;
      }
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
      dismissInput();
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
    Password Manager может ещё
    дописывать второе поле.

    Фокус и клавиатуру закрываем,
    но карточку не отправляем вниз
    раньше фактического закрытия
    клавиатуры.
  */
  setFocusEnabled(false);

  blurInputs();
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

    dismissInput();
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
      isAuthInput(
        document.activeElement
      )
    ){
      dismissInput();
    }
      },
      320
    );
  }
);
