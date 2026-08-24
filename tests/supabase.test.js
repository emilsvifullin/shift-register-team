import assert from "node:assert/strict";
import test from "node:test";

test(
  "Edge Function requests bypass the REST proxy and keep the admin token",
  async()=>{
    const originalSupabase=
      globalThis.supabase;
    const originalFetch=
      globalThis.fetch;

    let clientNumber=0;
    let request=null;

    globalThis.supabase={
      createClient(){
        clientNumber+=1;

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
        "https://rxosovinouuonwrrzigs.supabase.co/functions/v1/admin-employee-auth"
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
