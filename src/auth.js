import {
  supabaseClient
} from "./supabase.js";

function prepareApp(){
  const gate=
    document.getElementById(
      "authGate"
    );

  document.body.classList.add(
    "app-booting"
  );

  document.body.classList.add(
    "auth-authenticated"
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

async function goToLogin(){
  try{
    await supabaseClient
      .auth
      .signOut();
  }catch{}

  window.location.replace(
    "./login.html"
  );
}

export async function startAuth({
  onAuthenticated
}){
  const {
    data,
    error
  }=
    await supabaseClient
      .auth
      .getSession();

  if(
    error ||
    !data.session?.user
  ){
    await goToLogin();
    return;
  }

  try{
    const profile=
      await getProfile(
        data.session.user.id
      );

    prepareApp();

    await onAuthenticated({
      user:data.session.user,
      profile,
      freshLogin:false
    });
  }catch(error){
    console.error(
      "Не удалось открыть профиль:",
      error
    );

    await goToLogin();
  }
}

export async function signOut(){
  const {error}=
    await supabaseClient
      .auth
      .signOut();

  if(error){
    throw error;
  }

  window.location.replace(
    "./login.html"
  );
}
