import {execFileSync} from "node:child_process";

const projectRef=String(
  process.env.SUPABASE_PROJECT_REF || ""
).trim();
const dbUrl=String(
  process.env.SUPABASE_DB_URL || ""
).trim();

if(!projectRef && !dbUrl){
  throw new Error(
    "SUPABASE_PROJECT_REF or SUPABASE_DB_URL is required for the migration gate"
  );
}

const args=[
  "db",
  "push",
  "--dry-run",
  "--skip-vault"
];

if(dbUrl){
  args.push("--db-url",dbUrl);
}else{
  args.push("--linked","--project-ref",projectRef);
}

let output="";
try{
  output=execFileSync(
    process.env.SUPABASE_CLI || "supabase",
    args,
    {
      encoding:"utf8",
      stdio:["ignore","pipe","pipe"]
    }
  );
}catch(error){
  const detail=[
    error.stdout,
    error.stderr
  ]
    .filter(Boolean)
    .join("\n");
  throw new Error(
    `Supabase migration gate failed${detail ? `:\n${detail}` : ""}`
  );
}

if(!/remote database is up to date/i.test(output)){
  throw new Error(
    "Remote database is not at the repository migration state. Deploy is blocked.\n"+
    output
  );
}

process.stdout.write("Supabase migration state is up to date.\n");
