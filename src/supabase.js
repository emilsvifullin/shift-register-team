import {
  createRouteFetch
} from "./network-routes.js";

/*
  До Supabase два пути: прокси на Vercel и сам проект за Cloudflare.
  Разные сети режут разное, поэтому путь выбирается по факту, а не
  зашит один (src/network-routes.js).

  Адреса клиент строит от прокси: от этого адреса зависит и ключ, под
  которым хранится сеанс. Сменить его — значит разлогинить всех, поэтому
  ключ дополнительно закреплён явно, а подмену хоста делает маршрутизатор.
*/
const SUPABASE_PROXY_URL=
  "https://shift-register-supabase-proxy.vercel.app";

const SUPABASE_PROJECT_URL=
  "https://rxosovinouuonwrrzigs.supabase.co";

const SUPABASE_URL=
  SUPABASE_PROXY_URL;

const SUPABASE_FUNCTIONS_URL=
  `${SUPABASE_PROXY_URL}/functions/v1`;

const SUPABASE_PUBLISHABLE_KEY=
  "sb_publishable_f-tS0xagjlx2giW2k5u0hw_dxzEtV-v";

const SESSION_STORAGE_KEY=
  "sb-shift-register-supabase-proxy-auth-token";

function safeLocalStorage(){
  try{
    return globalThis.localStorage || null;
  }catch{
    return null;
  }
}

export const supabaseRoutes=
  createRouteFetch({
    routes:[
      {id:"proxy",base:SUPABASE_PROXY_URL},
      {id:"direct",base:SUPABASE_PROJECT_URL}
    ],
    fetchImpl:(...args)=>globalThis.fetch(...args),
    storage:safeLocalStorage(),
    probeHeaders:{
      apikey:SUPABASE_PUBLISHABLE_KEY
    }
  });

const createClient=
  globalThis.supabase?.createClient;

if(typeof createClient!=="function"){
  throw new Error(
    "Supabase client не загружен"
  );
}

export const supabaseClient=
  createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true,
        storageKey:SESSION_STORAGE_KEY
      },
      global:{
        fetch:supabaseRoutes.fetch
      }
    }
  );

/*
  Realtime — веб-сокет, а прокси на Vercel сокеты не пропускает, поэтому
  он ходит только напрямую. Это не точка отказа: без сокета приложение
  обновляет данные опросом (src/app.js, automaticRefreshTimer).
*/
export const supabaseRealtimeClient=
  createClient(
    SUPABASE_PROJECT_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth:{
        persistSession:false,
        autoRefreshToken:false,
        detectSessionInUrl:false
      }
    }
  );

export async function invokeSupabaseFunction(
  name,
  body
){
  const {data,error}=
    await supabaseClient.auth
      .getSession();

  let accessToken=
    data.session?.access_token;

  if(error || !accessToken){
    throw new Error(
      error?.message ||
      "unauthorized"
    );
  }

  const send=async token=>{
    try{
      return await supabaseRoutes.fetch(
        `${SUPABASE_FUNCTIONS_URL}/${encodeURIComponent(name)}`,
        {
          method:"POST",
          headers:{
            Authorization:
              `Bearer ${token}`,
            apikey:
              SUPABASE_PUBLISHABLE_KEY,
            "Content-Type":
              "application/json"
          },
          body:JSON.stringify(body)
        }
      );
    }catch{
      throw new Error(
        "employee_auth_request_failed"
      );
    }
  };

  let response=
    await send(accessToken);

  if(response.status===401){
    const {
      data:refreshData,
      error:refreshError
    }=await supabaseClient.auth
      .refreshSession();

    accessToken=
      refreshData.session?.access_token;

    if(
      refreshError ||
      !accessToken
    ){
      throw new Error(
        refreshError?.message ||
        "unauthorized"
      );
    }

    response=
      await send(accessToken);
  }

  let result=null;

  try{
    result=await response.json();
  }catch{}

  if(!response.ok){
    throw new Error(
      result?.error ||
      `employee_auth_http_${response.status}`
    );
  }

  return result;
}

supabaseClient.auth.onAuthStateChange(
  (_event,session)=>{
    const accessToken=
      session?.access_token;

    if(accessToken){
      void supabaseRealtimeClient
        .realtime
        .setAuth(accessToken);
    }
  }
);

/*
  Сеть сменилась — Wi-Fi на мобильную или наоборот, — и рабочий путь мог
  стать другим. Проверяем заранее, чтобы следующая запись не шла вслепую.
*/
globalThis.addEventListener?.(
  "online",
  ()=>{
    void supabaseRoutes
      .ensureRoute({force:true})
      .catch(()=>{});
  }
);
