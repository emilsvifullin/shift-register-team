import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import test from "node:test";
import vm from "node:vm";

// Execute the entire Edge handler and its pinned SDK. Only the network boundary
// is controlled: the two requests must both read an unlinked employee before
// either may create an Auth user. This reproduces the actual concurrent failure.
const edgeSource=stripTypeScriptTypes(readFileSync(
  process.env.SHIFT_EMPLOYEE_AUTH_SOURCE || new URL(
    "../supabase/functions/admin-employee-auth/index.ts",import.meta.url
  ),"utf8"
).replace(/^import\s[\s\S]*?;\s*/gm,""));
const sdkSource=readFileSync(new URL("../vendor/supabase-js-2.112.3.js",import.meta.url),"utf8");
const ADMIN="00000000-0000-4000-8000-000000000001";
const EMPLOYEE="20000000-0000-4000-8000-000000000001";
const EXISTING="30000000-0000-4000-8000-000000000001";
const reply=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"content-type":"application/json"}
});

function fixture({parallel=false,existing=false,linkError=false,cleanupError=false,conflict=false,profileError=false}={}){
  const employee={id:EMPLOYEE,user_id:existing?EXISTING:null,full_name:"Employee",status:"active",deletion_pending:false};
  const users=new Map();
  if(existing) users.set(EXISTING,{id:EXISTING,email:"old@example.test",user_metadata:{},app_metadata:{}});
  const deleted=[];
  const linkRequests=[];
  let nextId=0,readCount=0,releaseReads;
  const readsReady=new Promise(resolve=>{releaseReads=resolve;});
  let zeroRowResponses=0;

  async function fetchImpl(input,init={}){
    const url=new URL(String(input));
    const method=init.method || "GET";
    const body=init.body?JSON.parse(init.body):null;
    if(url.pathname==="/auth/v1/user"){
      return reply({id:ADMIN,email:"admin@example.test",user_metadata:{},app_metadata:{}});
    }
    if(url.pathname==="/auth/v1/admin/users" && method==="POST"){
      const id=`40000000-0000-4000-8000-${String(++nextId).padStart(12,"0")}`;
      const user={id,...body};users.set(id,user);return reply(user);
    }
    if(url.pathname.startsWith("/auth/v1/admin/users/")){
      const id=url.pathname.split("/").at(-1);
      if(method==="DELETE"){
        deleted.push(id);
        if(cleanupError) return reply({msg:"cleanup unavailable"},500);
        users.delete(id);
        if(employee.user_id===id) employee.user_id=null;
        return reply({});
      }
      const user=users.get(id);
      if(method==="PUT") Object.assign(user,body);
      return reply(user);
    }
    if(url.pathname==="/rest/v1/profiles"){
      if(method==="POST"){
        return profileError?reply({code:"XX000",message:"profile failed"},500):reply(null);
      }
      const id=url.searchParams.get("id");
      return reply([{role:id===`eq.${ADMIN}`?"admin":"employee"}]);
    }
    if(url.pathname==="/rest/v1/employees"){
      if(method==="GET"){
        const snapshot={...employee};
        if(parallel){readCount++;if(readCount===2) releaseReads();await readsReady;}
        return reply([snapshot]);
      }
      assert.equal(method,"PATCH");
      linkRequests.push({query:url.search,body});
      if(linkError) return reply({code:"XX000",message:"write failed"},500);
      const matched=!conflict && (
        url.searchParams.get("user_id")!=="is.null" || employee.user_id===null
      );
      if(!matched){
        zeroRowResponses++;
        // The pinned SDK requests an array and maybeSingle() must turn the
        // empty mutation result into data:null/error:null, not a successful link.
        return reply([]);
      }
      employee.user_id=body.user_id;
      return reply([{id:employee.id}]);
    }
    throw Error(`Unexpected ${method} ${url}`);
  }

  const sdkContext={fetch:fetchImpl,Headers,Response,Request,AbortController,URL,URLSearchParams,WebSocket,
    TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,console};
  vm.runInNewContext(sdkSource,sdkContext);
  let handler;
  vm.runInNewContext(edgeSource,{
    Request,Response,Headers,console,
    Deno:{
      env:{get:key=>({SUPABASE_URL:"https://test.supabase.co",SUPABASE_ANON_KEY:"anon",SUPABASE_SERVICE_ROLE_KEY:"service"}[key])},
      serve:fn=>{handler=fn;}
    },
    createClient:(url,key,options)=>sdkContext.supabase.createClient(url,key,{
      ...options,global:{...options.global,fetch:fetchImpl}
    })
  });

  async function save(email="new@example.test"){
    const response=await handler(new Request("https://test/functions/v1/admin-employee-auth",{
      method:"POST",headers:{Authorization:"Bearer test", "Content-Type":"application/json"},
      body:JSON.stringify({employeeId:EMPLOYEE,email,password:"ExamplePassword123"})
    }));
    return {status:response.status,body:await response.json()};
  }
  return {save,users,employee,deleted,linkRequests,get zeroRowResponses(){return zeroRowResponses;}};
}

test("parallel new accounts keep one link, reject the loser and delete only its own Auth user",async()=>{
  const f=fixture({parallel:true});
  const results=await Promise.all([f.save("first@example.test"),f.save("second@example.test")]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
  const winner=results.find(x=>x.status===200);
  const loser=results.find(x=>x.status===409);
  assert.equal(loser.body.error,"employee_auth_link_conflict");
  assert.equal(winner.body.created,true);
  assert.equal(f.employee.user_id,winner.body.userId);
  assert.equal(f.users.size,1);
  assert.equal(f.users.has(winner.body.userId),true);
  assert.equal(f.deleted.length,1);
  assert.notEqual(f.deleted[0],winner.body.userId);
  assert.equal(f.zeroRowResponses,1);
  for(const request of f.linkRequests){
    assert.equal(new URLSearchParams(request.query).get("user_id"),"is.null");
  }
});

test("existing account updates and repeated saves retain the account without creating or deleting users",async()=>{
  const f=fixture({existing:true});
  for(const email of ["changed@example.test","changed@example.test"]){
    const response=await f.save(email);
    assert.equal(response.status,200);
    assert.equal(response.body.created,false);
    assert.equal(response.body.userId,EXISTING);
    assert.equal(f.users.get(EXISTING).email,email);
  }
  assert.equal(f.employee.user_id,EXISTING);
  assert.equal(f.users.size,1);
  assert.deepEqual(f.deleted,[]);
});

test("repeating a successful initial save updates the same linked account",async()=>{
  const f=fixture();
  const first=await f.save();
  const second=await f.save();
  assert.equal(first.status,200);
  assert.equal(first.body.created,true);
  assert.equal(second.status,200);
  assert.equal(second.body.created,false);
  assert.equal(second.body.userId,first.body.userId);
  assert.equal(f.employee.user_id,first.body.userId);
  assert.equal(f.users.size,1);
  assert.deepEqual(f.deleted,[]);
});

for(const fault of ["linkError","profileError"]){
  test(`${fault}: failed initial linking rolls back only the new Auth account`,async()=>{
    const f=fixture({[fault]:true});
    const response=await f.save();
    assert.equal(response.status,500);
    assert.equal(response.body.error,"employee_auth_link_failed");
    assert.equal(f.users.size,0);
    assert.equal(f.employee.user_id,null);
    assert.equal(f.deleted.length,1);
  });
}

test("a failed existing-account link never deletes the previously linked Auth account",async()=>{
  const f=fixture({existing:true,linkError:true});
  const response=await f.save();
  assert.equal(response.status,500);
  assert.equal(response.body.error,"employee_auth_link_failed");
  assert.equal(f.employee.user_id,EXISTING);
  assert.equal(f.users.has(EXISTING),true);
  assert.deepEqual(f.deleted,[]);
});

test("a cleanup failure is reported as failure rather than claiming the competing account was removed",async()=>{
  const f=fixture({conflict:true,cleanupError:true});
  const response=await f.save();
  assert.equal(response.status,500);
  assert.equal(response.body.error,"employee_auth_cleanup_failed");
  assert.equal(f.employee.user_id,null);
  assert.equal(f.users.size,1);
  assert.equal(f.deleted.length,1);
});
