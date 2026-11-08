import {execFileSync,spawn} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {homedir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const root=new URL("../",import.meta.url);
const rootPath=fileURLToPath(root);
const passwordPath=join(
  homedir(),
  ".shift-register",
  "local-admin.txt"
);

function run(command,args,options={}){
  return execFileSync(command,args,{
    cwd:rootPath,
    encoding:"utf8",
    stdio:"inherit",
    ...options
  });
}

function statusEnv(){
  const output=execFileSync(
    "supabase",
    ["status","-o","env"],
    {cwd:new URL(root),encoding:"utf8"}
  );
  const values={};
  for(const line of output.split(/\r?\n/)){
    const match=line.match(/^([A-Z0-9_]+)=(.*)$/);
    if(match){
      values[match[1]]=match[2].replace(/^['"]|['"]$/g,"");
    }
  }
  return values;
}

function requireValue(values,name){
  if(!values[name]) throw new Error(`Supabase status did not return ${name}`);
  return values[name];
}

async function request(url,options){
  const response=await fetch(url,options);
  const body=await response.text();
  let data=null;
  try{data=body ? JSON.parse(body) : null;}catch{}
  if(!response.ok){
    throw new Error(data?.msg || data?.message || body || response.statusText);
  }
  return data;
}

try{
  try{
    execFileSync("docker",["info"],{stdio:"ignore"});
  }catch{
    throw new Error(
      "Docker Desktop is not running. Launch Docker Desktop, wait until it says Running, then rerun npm run local:review."
    );
  }

  run("supabase",["start","--ignore-health-check"]);
  run("supabase",["db","reset","--local","--yes"]);

  const values=statusEnv();
  const apiUrl=requireValue(values,"API_URL");
  const anonKey=requireValue(values,"ANON_KEY");
  const serviceKey=requireValue(values,"SERVICE_ROLE_KEY");
  const email="local-admin@shift-register.test";
  const password=randomBytes(24).toString("base64url");

  const user=await request(`${apiUrl}/auth/v1/admin/users`,{
    method:"POST",
    headers:{
      apikey:serviceKey,
      Authorization:`Bearer ${serviceKey}`,
      "content-type":"application/json"
    },
    body:JSON.stringify({email,password,email_confirm:true,user_metadata:{full_name:"Локальный администратор"}})
  });

  await request(`${apiUrl}/rest/v1/profiles?id=eq.${user.id}`,{
    method:"PATCH",
    headers:{
      apikey:serviceKey,
      Authorization:`Bearer ${serviceKey}`,
      "content-type":"application/json",
      Prefer:"return=minimal"
    },
    body:JSON.stringify({role:"admin"})
  });

  await mkdir(join(homedir(),".shift-register"),{recursive:true,mode:0o700});
  await writeFile(
    passwordPath,
    `email=${email}\npassword=${password}\nurl=${apiUrl}\n`,
    {mode:0o600}
  );

  const server=spawn(
    process.execPath,
    [fileURLToPath(new URL("./serve.mjs",import.meta.url)),"4173"],
    {
      cwd:rootPath,
      env:{
        ...process.env,
        LOCAL_SUPABASE_URL:apiUrl,
        LOCAL_SUPABASE_ANON_KEY:anonKey
      },
      stdio:"inherit"
    }
  );

  const stop=()=>{
    server.kill("SIGTERM");
    try{run("supabase",["stop"]);}catch{}
  };
  process.once("SIGINT",stop);
  process.once("SIGTERM",stop);
  await new Promise(resolve=>server.once("exit",resolve));
}catch(error){
  console.error(error instanceof Error ? error.message : error);
  process.exitCode=1;
}
