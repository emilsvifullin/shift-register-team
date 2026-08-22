import {
  supabaseClient
} from "./supabase.js";

function authElements(){
  return {
    gate:
      document.getElementById(
        "authGate"
      ),

    form:
      document.getElementById(
        "authForm"
      ),

    email:
      document.getElementById(
        "authEmail"
      ),

    password:
      document.getElementById(
        "authPassword"
      ),

    submit:
      document.getElementById(
        "authSubmit"
      ),

    error:
      document.getElementById(
        "authError"
      )
  };
}

function setAuthError(message=""){
  const {error}=
    authElements();

  if(!error){
    return;
  }

  error.textContent=
    message;

  error.hidden=
    !message;
}

function showAuthGate(){
  const {gate}=
    authElements();

  document.body.classList.add(
    "auth-required"
  );

  document.body.classList.remove(
    "app-booting"
  );

  gate?.setAttribute(
    "aria-hidden",
    "false"
  );
}

function prepareApp(){
  const {gate}=
    authElements();

  document.body.classList.add(
    "app-booting"
  );

  document.body.classList.remove(
    "auth-required"
  );

  gate?.setAttribute(
    "aria-hidden",
    "true"
  );
}

async function getProfile(userId){
  const {
    data,
    error
  }=
    await supabaseClient
      .from("profiles")
      .select("id, role")
      .eq("id",userId)
      .single();

  if(error || !data){
    throw new Error(
      "Профиль пользователя недоступен"
    );
  }

  if(
    !["admin","employee"]
      .includes(data.role)
  ){
    throw new Error(
      "Неизвестная роль пользователя"
    );
  }

  return data;
}

async function openSession(
  session,
  onAuthenticated
){
  if(!session?.user){
    showAuthGate();
    return;
  }

  try{
    const profile=
      await getProfile(
        session.user.id
      );

    prepareApp();

    await onAuthenticated({
      user:session.user,
      profile
    });
  }catch(error){
    console.error(
      "Не удалось открыть профиль:",
      error
    );

    try{
      await supabaseClient
        .auth
        .signOut();
    }catch{}

    setAuthError(
      "Не удалось открыть профиль пользователя."
    );

    showAuthGate();
  }
}

export async function startAuth({
  onAuthenticated
}){
  const {
    form,
    email,
    password,
    submit
  }=
    authElements();

  if(
    !form ||
    !email ||
    !password ||
    !submit
  ){
    throw new Error(
      "Форма авторизации не найдена"
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
        setAuthError(
          "Введите email и пароль."
        );

        return;
      }

      setAuthError();

      submit.disabled=true;

      const {
        data,
        error
      }=
        await supabaseClient
          .auth
          .signInWithPassword({
            email:emailValue,
            password:passwordValue
          });

      submit.disabled=false;

      if(
        error ||
        !data.session
      ){
        password.value="";

        setAuthError(
          "Неверный email или пароль."
        );

        return;
      }

      password.value="";

      await openSession(
        data.session,
        onAuthenticated
      );
    }
  );

  const {
    data,
    error
  }=
    await supabaseClient
      .auth
      .getSession();

  if(error){
    console.error(
      "Не удалось проверить сессию:",
      error
    );

    setAuthError(
      "Не удалось проверить авторизацию."
    );

    showAuthGate();
    return;
  }

  if(data.session){
    await openSession(
      data.session,
      onAuthenticated
    );

    return;
  }

  showAuthGate();
}

export async function signOut(){
  const {error}=
    await supabaseClient
      .auth
      .signOut();

  if(error){
    throw error;
  }

  window.location.reload();
}
