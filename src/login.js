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

let submitting=false;
let autofillTimer=0;
let userInteracted=false;
let focusAllowed=false;
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

const visualViewport=
  window.visualViewport;

let fullViewportHeight=
  visualViewport
    ? visualViewport.height
    : window.innerHeight;

function syncAuthViewport(){
  const viewport=
    window.visualViewport;

  const viewportTop=
    viewport
      ? viewport.offsetTop
      : 0;

  const viewportHeight=
    viewport
      ? viewport.height
      : window.innerHeight;

  if(
    !isAuthInput(
      document.activeElement
    ) &&
    viewportHeight>
      fullViewportHeight
  ){
    fullViewportHeight=
      viewportHeight;
  }

  const keyboardVisible=
    isAuthInput(
      document.activeElement
    ) &&
    viewportHeight<
      fullViewportHeight - 120;

  const visibleCenter=
    viewportTop +
    viewportHeight / 2;

  document.documentElement
    .style
    .setProperty(
      "--auth-visible-center-y",
      `${visibleCenter}px`
    );

  document.body.classList.toggle(
    "auth-keyboard-visible",
    keyboardVisible
  );
}

function updateFocusState(){
  document.body.classList.toggle(
    "auth-input-focused",
    focusAllowed &&
    isAuthInput(
      document.activeElement
    )
  );

  syncAuthViewport();
}

function clearFieldFocus(){
  focusAllowed=false;

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

  document.body.classList.remove(
    "auth-keyboard-visible"
  );
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
      userInteracted=true;
      focusAllowed=true;

      return;
    }

    if(
      isAuthInput(
        document.activeElement
      )
    ){
      clearFieldFocus();
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
    focusAllowed=true;
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

    if(
      !focusAllowed ||
      !userInteracted
    ){
      event.target.blur();

      document.body.classList.remove(
        "auth-input-focused"
      );

      requestAnimationFrame(
        ()=>{
          if(
            !focusAllowed &&
            isAuthInput(
              document.activeElement
            )
          ){
            document.activeElement.blur();
          }
        }
      );

      return;
    }

    updateFocusState();
  }
);

form.addEventListener(
  "focusout",
  ()=>{
    window.setTimeout(
      updateFocusState,
      0
    );
  }
);

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

  const check=()=>{
    if(submitting){
      return;
    }

    const ready=
      Boolean(
        email.value.trim() &&
        password.value
      );

    if(ready){
      clearFieldFocus();

      autofillTimer=
        window.setTimeout(
          ()=>{
            if(submitting){
              return;
            }

            if(
              typeof form.requestSubmit===
              "function"
            ){
              form.requestSubmit();
              return;
            }

            submit.click();
          },
          80
        );

      return;
    }

    attempts+=1;

    if(attempts>=6){
      return;
    }

    autofillTimer=
      window.setTimeout(
        check,
        40
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
      "auth-autofill-detected"
    ){
      return;
    }

    if(
      !userInteracted ||
      submitting
    ){
      return;
    }

    /*
      Password AutoFill уже начался.
      Сразу убираем системный фокус,
      выделение текста и клавиатуру.
    */
    requestAnimationFrame(
      ()=>{
        if(
          !userInteracted ||
          submitting
        ){
          return;
        }

        clearFieldFocus();
        scheduleAutofillSubmit();
      }
    );
  }
);

form.addEventListener(
  "input",
  event=>{
    if(
      event.inputType===
        "insertReplacementText" ||
      event.inputType===null
    ){
      scheduleAutofillSubmit();
    }
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
      email.value
        .trim();

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

    clearFieldFocus();

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

window.addEventListener(
  "pageshow",
  ()=>{
    userInteracted=false;
    focusAllowed=false;

    clearFieldFocus();

    requestAnimationFrame(
      ()=>{
        if(!userInteracted){
          clearFieldFocus();
        }
      }
    );
  }
);

userInteracted=false;
focusAllowed=false;

clearFieldFocus();

if(visualViewport){
  visualViewport.addEventListener(
    "resize",
    syncAuthViewport,
    {
      passive:true
    }
  );

  visualViewport.addEventListener(
    "scroll",
    syncAuthViewport,
    {
      passive:true
    }
  );
}

window.addEventListener(
  "resize",
  syncAuthViewport,
  {
    passive:true
  }
);

syncAuthViewport();
