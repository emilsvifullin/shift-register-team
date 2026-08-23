const SUPABASE_URL=
  "https://shift-register-supabase-proxy.vercel.app";

const SUPABASE_REALTIME_URL=
  "https://rxosovinouuonwrrzigs.supabase.co";

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
    SUPABASE_REALTIME_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth:{
        persistSession:false,
        autoRefreshToken:false,
        detectSessionInUrl:false
      }
    }
  );

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
