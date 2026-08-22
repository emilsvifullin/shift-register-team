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

let fieldsUnlocked=false;
let submitting=false;
let autofillTimer=0;
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

function clearFieldFocus(){
  email.blur();
  password.blur();

  const active=
    document.activeElement;

  if(
    active===email ||
    active===password
  ){
    active.blur();
  }
}

function keepInitialState(){
  if(fieldsUnlocked){
    return;
  }

  clearFieldFocus();
}

function unlockFields(){
  if(fieldsUnlocked){
    return;
  }

  fieldsUnlocked=true;

  email.readOnly=false;
  password.readOnly=false;
}

email.addEventListener(
  "pointerdown",
  unlockFields,
  {
    capture:true
  }
);

email.addEventListener(
  "touchstart",
  unlockFields,
  {
    capture:true,
    passive:true
  }
);

email.addEventListener(
  "mousedown",
  unlockFields,
  {
    capture:true
  }
);

email.addEventListener(
  "keydown",
  unlockFields
);

function scheduleAutofillFinish(){
  if(
    !fieldsUnlocked ||
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
          !email.value.trim() ||
          !password.value ||
          submitting
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
          60
        );
      },
      100
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

    scheduleAutofillFinish();
  }
);

form.addEventListener(
  "input",
  event=>{
    if(
      event.inputType!==undefined &&
      event.inputType!==null &&
      event.inputType!==
        "insertReplacementText"
    ){
      return;
    }

    scheduleAutofillFinish();
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
      const existing=
        document.querySelector(
          "script[data-supabase-auth]"
        );

      if(existing){
        existing.addEventListener(
          "load",
          resolve,
          {
            once:true
          }
        );

        existing.addEventListener(
          "error",
          reject,
          {
            once:true
          }
        );

        return;
      }

      const script=
        document.createElement(
          "script"
        );

      script.src=
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3";

      script.async=true;

      script.dataset.supabaseAuth=
        "true";

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
    }catch(error){
      console.error(
        "Не удалось выполнить вход:",
        error
      );

      setSubmitting(false);

      setError(
        "Не удалось выполнить вход."
      );

      return;
    }

    if(
      authError ||
      !data.session
    ){
      setSubmitting(false);

      password.value="";

      setError(
        "Неверный email или пароль."
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
    keepInitialState();

    requestAnimationFrame(
      keepInitialState
    );

    window.setTimeout(
      keepInitialState,
      80
    );

    window.setTimeout(
      keepInitialState,
      200
    );
  }
);

keepInitialState();
