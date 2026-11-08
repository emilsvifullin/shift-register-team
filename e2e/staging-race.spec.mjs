import {test, expect} from "@playwright/test";

const config={
  url:String(process.env.STAGING_SUPABASE_URL || "").replace(/\/$/,""),
  anonKey:String(process.env.STAGING_SUPABASE_ANON_KEY || ""),
  email:String(process.env.STAGING_ADMIN_EMAIL || ""),
  password:String(process.env.STAGING_ADMIN_PASSWORD || "")
};

const enabled=
  process.env.STAGING_CONFIRM=== "1" &&
  Object.values(config).every(Boolean);

test.describe.configure({mode:"serial"});

async function request(path,{token,method="GET",body}={}){
  const response=await fetch(`${config.url}${path}`,{
    method,
    headers:{
      apikey:config.anonKey,
      Authorization:`Bearer ${token || config.anonKey}`,
      ...(body ? {"content-type":"application/json"} : {})
    },
    body:body ? JSON.stringify(body) : undefined
  });
  const text=await response.text();
  let data=null;
  try{data=text ? JSON.parse(text) : null;}catch{}
  if(!response.ok){
    const error=new Error(
      data?.message || data?.error_description || text || response.statusText
    );
    error.code=data?.code;
    error.status=response.status;
    throw error;
  }
  return data;
}

async function rpc(name,body,token){
  return request(`/rest/v1/rpc/${name}`,{
    token,
    method:"POST",
    body
  });
}

async function signIn(){
  return request("/auth/v1/token?grant_type=password",{
    method:"POST",
    body:{email:config.email,password:config.password}
  });
}

test("staging rejects stale update and makes retries idempotent", async()=>{
  test.skip(!enabled,"set STAGING_CONFIRM=1 and staging credentials to run");
  const session=await signIn();
  const token=session.access_token;
  const [links]=await Promise.all([
    request("/rest/v1/employee_points?select=employee_id,point_id&active=eq.true&limit=1",{token})
  ]);
  expect(links).toHaveLength(1);
  const link=links[0];
  const operationId=crypto.randomUUID();
  const base={
    p_shift_id:null,
    p_expected_version:null,
    p_operation_id:operationId,
    p_employee_id:link.employee_id,
    p_shift_date:new Date().toISOString().slice(0,10),
    p_point_id:link.point_id,
    p_shift_type:"main",
    p_shk:100,
    p_partial:false,
    p_hours:null,
    p_note:"staging race",
    p_bonuses:[],
    p_penalties:[],
    p_base_amount_override:null,
    p_base_amount_reason:null,
    p_force:true,
    p_reason:"staging race"
  };
  let created=null;
  try{
    created=await rpc("admin_save_shift_v5",base,token);
    expect(created.status).toBe("saved");
    const id=created.shift_id;
    const version=created.version;
    const changed=await rpc("admin_save_shift_v5",{
      ...base,
      p_shift_id:id,
      p_expected_version:version,
      p_operation_id:crypto.randomUUID(),
      p_note:"staging winner"
    },token);
    expect(changed.version).toBe(version+1);

    await expect(
      rpc("admin_save_shift_v5",{
        ...base,
        p_shift_id:id,
        p_expected_version:version,
        p_operation_id:crypto.randomUUID(),
        p_note:"stale loser"
      },token)
    ).rejects.toMatchObject({message:expect.stringContaining("record_changed")});

    const retryId=crypto.randomUUID();
    const deleted=await rpc("admin_delete_shift_v3",{
      p_shift_id:id,
      p_expected_version:version+1,
      p_operation_id:retryId,
      p_force:true,
      p_reason:"staging delete"
    },token);
    expect(deleted.status).toBe("deleted");
    const retry=await rpc("admin_delete_shift_v3",{
      p_shift_id:id,
      p_expected_version:version+1,
      p_operation_id:retryId,
      p_force:true,
      p_reason:"staging delete"
    },token);
    expect(retry).toEqual(deleted);

    await expect(
      rpc("admin_save_shift_v5",{
        ...base,
        p_shift_id:id,
        p_expected_version:version+1,
        p_operation_id:crypto.randomUUID(),
        p_note:"resurrection attempt"
      },token)
    ).rejects.toMatchObject({message:expect.stringContaining("record_deleted")});
  }finally{
    if(created?.shift_id){
      await rpc("admin_delete_shift_v3",{
        p_shift_id:created.shift_id,
        p_expected_version:created.version+1,
        p_operation_id:crypto.randomUUID(),
        p_force:true,
        p_reason:"staging cleanup"
      },token).catch(()=>{});
    }
  }
});
