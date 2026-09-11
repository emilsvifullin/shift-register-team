import {
  invokeSupabaseFunction,
  supabaseClient,
  supabaseRealtimeClient
} from "./supabase.js";

import {installPlatformRuntime} from "./platform/runtime.js";

installPlatformRuntime();

export {
  loadAdminTeamData,
  loadEmployeeTeamData,
  loadTeamData
} from "./api/team-read.js";

export {
  rollbackAdminEmployeeCreation,
  saveAdminEmployee
} from "./api/employees.js";

export {
  deleteAdminShift,
  importAdminLegacyShift,
  importAdminLegacyShifts,
  saveAdminShift
} from "./api/shifts.js";

export {
  addAdminTariff,
  deleteAdminTariff,
  saveAdminPoint,
  updateAdminTariff
} from "./api/points.js";

export {
  deleteAdminPayout,
  saveAdminPayout
} from "./api/payouts.js";

export async function saveAdminEmployeeAuth({
  employeeId,
  email,
  password=""
}){
  return invokeSupabaseFunction(
    "admin-employee-auth",
    {
      action:"save",
      employeeId,
      email,
      password:password || undefined
    }
  );
}

export async function deleteAdminEmployee(id){
  return invokeSupabaseFunction(
    "admin-employee-auth",
    {
      action:"delete",
      employeeId:id
    }
  );
}

export async function subscribeTeamChanges({
  role,
  onChange=()=>{},
  onStatus=()=>{}
}){
  const tables=role==="admin"
    ? [
        "employees",
        "employee_points",
        "points",
        "point_tariffs",
        "shifts",
        "shift_bonuses",
        "shift_penalties",
        "employee_payouts"
      ]
    : [
        "employees",
        "shifts",
        "shift_bonuses",
        "shift_penalties",
        "employee_payouts"
      ];

  const sessionResult=await supabaseClient.auth.getSession();
  if(sessionResult.error){
    throw sessionResult.error;
  }

  const accessToken=sessionResult.data.session?.access_token;
  if(accessToken){
    await supabaseRealtimeClient.realtime.setAuth(accessToken);
  }

  let channel=supabaseRealtimeClient.channel(
    `shift-register-${role}-${crypto.randomUUID()}`
  );

  tables.forEach(table=>{
    channel=channel.on(
      "postgres_changes",
      {event:"*",schema:"public",table},
      payload=>onChange({table,payload})
    );
  });

  channel.subscribe(status=>onStatus(status));

  return ()=>{
    void supabaseRealtimeClient.removeChannel(channel);
  };
}
