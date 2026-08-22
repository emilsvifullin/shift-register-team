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

const emailField=
  email.closest(
    ".auth-field"
  );

const authCard=
  document.querySelector(
    ".auth-card"
  );

let fieldsUnlocked=false;
let submitting=false;
let autofillTimer=0;
let supabaseClientPromise=null;
let cardPositionLocked=false;

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

function lockFields(){
  fieldsUnlocked=false;

  email.readOnly=true;
  password.readOnly=true;

  email.tabIndex=-1;
  password.tabIndex=-1;

  clearFieldFocus();
}

function unlockFields(){
  if(fieldsUnlocked){
    return;
  }

  fieldsUnlocked=true;

  email.readOnly=false;
  password.readOnly=false;

  email.removeAttribute(
    "tabindex"
  );

  password.removeAttribute(
    "tabindex"
  );
}

function lockCardPosition(){
  if(
    cardPositionLocked ||
    !authCard
  ){
    return;
  }

  const rect=
    authCard.getBoundingClientRect();

  document.documentElement
    .style
    .setProperty(
      "--auth-card-top",
      `${Math.round(rect.top)}px`
    );

  document.body.classList.add(
    "auth-card-position-locked"
  );

  cardPositionLocked=true;
}

function resetCardPosition(){
  cardPositionLocked=false;

  document.body.classList.remove(
    "auth-card-position-locked"
  );

  document.documentElement
    .style
    .removeProperty(
      "--auth-card-top"
    );

  window.setTimeout(
    ()=>{
      requestAnimationFrame(
        ()=>{
          requestAnimationFrame(
            lockCardPosition
          );
        }
      );
    },
    280
  );
}

emailField.addEventListener(
  "pointerdown",
  unlockFields,
  {
    capture:true
  }
);

emailField.addEventListener(
  "touchstart",
  unlockFields,
  {
    capture:true,
    passive:true
  }
);

emailField.addEventListener(
  "mousedown",
  unlockFields,
  {
    capture:true
  }
);

document.addEventListener(
  "keydown",
  event=>{
    if(
      !fieldsUnlocked &&
      event.key==="Tab"
    ){
      unlockFields();
    }
  },
  {
    capture:true
  }
);

form.addEventListener(
  "focusin",
  event=>{
    if(fieldsUnlocked){
      return;
    }

    if(
      event.target!==email &&
      event.target!==password
    ){
      return;
    }

    window.setTimeout(
      clearFieldFocus,
      0
    );
  }
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
          80
        );
      },
      120
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
    if(submitting){
      return;
    }

    lockFields();

    if(!cardPositionLocked){
      requestAnimationFrame(
        ()=>{
          requestAnimationFrame(
            lockCardPosition
          );
        }
      );
    }
  }
);

window.addEventListener(
  "orientationchange",
  resetCardPosition
);

lockFields();

requestAnimationFrame(
  ()=>{
    requestAnimationFrame(
      lockCardPosition
    );
  }
);
