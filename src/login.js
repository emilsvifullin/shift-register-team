import {
  supabaseClient
} from "./supabase.js";

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

function setError(message=""){
  error.textContent=
    message;

  error.hidden=
    !message;
}

function setSubmitting(value){
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

form.addEventListener(
  "submit",
  async event=>{
    event.preventDefault();

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
    setSubmitting(true);

    let data;
    let authError;

    try{
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
