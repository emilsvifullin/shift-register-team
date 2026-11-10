import {execFileSync} from "node:child_process";
import {readdirSync} from "node:fs";

const projectRef=String(
  process.env.SUPABASE_PROJECT_REF || ""
).trim();
const dbUrl=String(
  process.env.SUPABASE_DB_URL || ""
).trim();
const accessToken=String(
  process.env.SUPABASE_ACCESS_TOKEN || ""
).trim();

function block(detail){
  throw new Error(`Deploy is blocked. ${detail}`);
}

async function checkProject(){
  if(!/^[a-z0-9]{20}$/.test(projectRef) || !accessToken){
    block("Set SUPABASE_PROJECT_REF and a Supabase access token with migration history read access.");
  }

  const local=readdirSync(new URL("../supabase/migrations/",import.meta.url))
    .filter(name=>/^\d{14}_.+\.sql$/.test(name))
    .map(name=>name.slice(0,14));
  if(!local.length || new Set(local).size!==local.length){
    block("Repository migration versions are empty or duplicated.");
  }

  const response=await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/migrations`,
    {
      headers:{authorization:`Bearer ${accessToken}`},
      redirect:"error",
      signal:AbortSignal.timeout(15000)
    }
  ).catch(()=>block("Cannot reach the Supabase Management API."));
  if(!response.ok){
    block(`Supabase migration history returned HTTP ${response.status}.`);
  }

  const rows=await response.json().catch(()=>null);
  if(!Array.isArray(rows) || rows.some(row=>!/^\d{14}$/.test(row?.version ?? ""))){
    block("Supabase returned an invalid migration history.");
  }

  const remote=rows.map(row=>row.version);
  const missing=local.filter(version=>!remote.includes(version));
  const unexpected=remote.filter(version=>!local.includes(version));
  if(missing.length || unexpected.length || new Set(remote).size!==remote.length){
    block(`Migration history differs. Pending: ${missing.join(", ") || "none"}. Remote only: ${unexpected.join(", ") || "none"}.`);
  }
}

function checkDatabase(){
  let state;
  try{
    state=JSON.parse(execFileSync(
      process.env.SUPABASE_CLI || "supabase",
      ["db","push","--dry-run","--skip-vault","--output-format","json","--db-url",dbUrl],
      {encoding:"utf8",stdio:["ignore","pipe","pipe"]}
    ));
  }catch{
    block("Supabase CLI could not read the database state.");
  }
  if(state?.dryRun!==true || state.upToDate!==true ||
    !Array.isArray(state.migrations) || state.migrations.length){
    block("Database is not at the repository migration state.");
  }
}

if(dbUrl) checkDatabase();
else await checkProject();

process.stdout.write("Supabase migration state is up to date.\n");
