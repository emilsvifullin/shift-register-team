const SUPABASE_URL=
  "https://shift-register-supabase-proxy.vercel.app";

const SUPABASE_PROJECT_URL=
  "https://rxosovinouuonwrrzigs.supabase.co";

const SUPABASE_FUNCTIONS_URL=
  `${SUPABASE_PROJECT_URL}/functions/v1`;

const SUPABASE_PUBLISHABLE_KEY=
  "sb_publishable_f-tS0xagjlx2giW2k5u0hw_dxzEtV-v";

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
        detectSessionInUrl:true
      }
    }
  );

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

  const accessToken=
    data.session?.access_token;

  if(error || !accessToken){
    throw new Error(
      error?.message ||
      "unauthorized"
    );
  }

  let response;

  try{
    response=await fetch(
      `${SUPABASE_FUNCTIONS_URL}/${encodeURIComponent(name)}`,
      {
        method:"POST",
        headers:{
          Authorization:
            `Bearer ${accessToken}`,
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
