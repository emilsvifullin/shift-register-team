import assert from "node:assert/strict";
import test from "node:test";

test(
  "Supabase REST, Auth and Edge Functions use proxy while Realtime stays direct",
  async()=>{
    const originalSupabase=
      globalThis.supabase;
    const originalFetch=
      globalThis.fetch;

    let clientNumber=0;
    const clientUrls=[];
    let request=null;

    globalThis.supabase={
      createClient(url){
        clientNumber+=1;
        clientUrls.push(url);

        if(clientNumber===1){
          return {
            auth:{
              getSession:async()=>({
                data:{
                  session:{
                    access_token:
                      "admin-access-token"
                  }
                },
                error:null
              }),
              refreshSession:async()=>({
                data:{session:null},
                error:null
              }),
              onAuthStateChange(){}
            }
          };
        }

        return {
          auth:{},
          realtime:{
            setAuth:async()=>{}
          }
        };
      }
    };

    globalThis.fetch=async(
      url,
      options
    )=>{
      request={url,options};

      return {
        ok:true,
        status:200,
        json:async()=>({
          ok:true,
          created:true
        })
      };
    };

    try{
      const moduleUrl=
        new URL(
          "../src/supabase.js",
          import.meta.url
        );

      moduleUrl.searchParams.set(
        "test",
        String(Date.now())
      );

      const {
        invokeSupabaseFunction
      }=await import(
        moduleUrl.href
      );

      const result=
        await invokeSupabaseFunction(
          "admin-employee-auth",
          {
            employeeId:
              "00000000-0000-4000-8000-000000000000",
            email:
              "employee@example.com",
            password:
              "password-value"
          }
        );

      assert.deepEqual(
        result,
        {
          ok:true,
          created:true
        }
      );

      assert.equal(
        request.url,
        "https://shift-register-supabase-proxy.vercel.app/functions/v1/admin-employee-auth"
      );

      assert.deepEqual(
        clientUrls,
        [
          "https://shift-register-supabase-proxy.vercel.app",
          "https://rxosovinouuonwrrzigs.supabase.co"
        ]
      );

      assert.equal(
        request.options.headers.Authorization,
        "Bearer admin-access-token"
      );

      assert.match(
        request.options.headers.apikey,
        /^sb_publishable_/
      );

      assert.deepEqual(
        JSON.parse(
          request.options.body
        ),
        {
          employeeId:
            "00000000-0000-4000-8000-000000000000",
          email:
            "employee@example.com",
          password:
            "password-value"
        }
      );
    }finally{
      globalThis.supabase=
        originalSupabase;
      globalThis.fetch=
        originalFetch;
    }
  }
);

test(
  "Edge Function retries once with a refreshed user JWT after a 401",
  async()=>{
    const originalSupabase=
      globalThis.supabase;
    const originalFetch=
      globalThis.fetch;

    let clientNumber=0;
    let refreshCount=0;
    const authorizations=[];

    globalThis.supabase={
      createClient(){
        clientNumber+=1;

        if(clientNumber===1){
          return {
            auth:{
              getSession:async()=>({
                data:{
                  session:{
                    access_token:"expired-token"
                  }
                },
                error:null
              }),
              refreshSession:async()=>{
                refreshCount+=1;

                return {
                  data:{
                    session:{
                      access_token:"fresh-token"
                    }
                  },
                  error:null
                };
              },
              onAuthStateChange(){}
            }
          };
        }

        return {
          auth:{},
          realtime:{
            setAuth:async()=>{}
          }
        };
      }
    };

    let requestCount=0;

    globalThis.fetch=async(
      _url,
      options
    )=>{
      requestCount+=1;
      authorizations.push(
        options.headers.Authorization
      );

      if(requestCount===1){
        return {
          ok:false,
          status:401,
          json:async()=>({
            error:"unauthorized"
          })
        };
      }

      return {
        ok:true,
        status:200,
        json:async()=>({
          ok:true
        })
      };
    };

    try{
      const moduleUrl=
        new URL(
          "../src/supabase.js",
          import.meta.url
        );

      moduleUrl.searchParams.set(
        "refresh-test",
        String(Date.now())
      );

      const {
        invokeSupabaseFunction
      }=await import(
        moduleUrl.href
      );

      const result=
        await invokeSupabaseFunction(
          "admin-employee-auth",
          {
            action:"save"
          }
        );

      assert.deepEqual(
        result,
        {ok:true}
      );

      assert.equal(
        refreshCount,
        1
      );

      assert.deepEqual(
        authorizations,
        [
          "Bearer expired-token",
          "Bearer fresh-token"
        ]
      );
    }finally{
      globalThis.supabase=
        originalSupabase;
      globalThis.fetch=
        originalFetch;
    }
  }
);
