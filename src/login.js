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

function updateFocusState(){
  document.body.classList.toggle(
    "auth-input-focused",
    isAuthInput(
      document.activeElement
    )
  );
}

function clearFieldFocus(){
  if(isAuthInput(
    document.activeElement
  )){
    document.activeElement.blur();
  }

  email.blur();
  password.blur();

  updateFocusState();
}

form.addEventListener(
  "pointerdown",
  event=>{
    if(
      event.target===email ||
      event.target===password
    ){
      userInteracted=true;
    }
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

document.addEventListener(
  "pointerdown",
  event=>{
    if(
      submitting ||
      !isAuthInput(
        document.activeElement
      )
    ){
      return;
    }

    const target=
      event.target;

    if(
      target instanceof Element &&
      target.closest(
        ".auth-field"
      )
    ){
      return;
    }

    clearFieldFocus();
  },
  {
    capture:true
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

  autofillTimer=
    window.setTimeout(
      ()=>{
        if(
          submitting ||
          !email.value.trim() ||
          !password.value
        ){
          return;
        }

        clearFieldFocus();

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
          120
        );
      },
      280
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

    scheduleAutofillSubmit();
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

    window.setTimeout(
      ()=>{
        clearFieldFocus();
      },
      0
    );
  }
);

clearFieldFocus();
