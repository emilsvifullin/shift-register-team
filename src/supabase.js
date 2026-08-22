const SUPABASE_URL=
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
