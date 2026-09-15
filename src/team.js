import {
  invokeSupabaseFunction
} from "./supabase.js";

export {
  loadAdminTeamData,
  loadEmployeeTeamData,
  loadTeamData
} from "./api/read.js";

export {
  deleteAdminEmployee,
  rollbackAdminEmployeeCreation,
  saveAdminEmployee
} from "./api/employees.js";

export {
  subscribeTeamChanges
} from "./api/realtime.js";

export {
  deleteAdminShift,
  importAdminLegacyShift,
  importAdminLegacyShifts,
  saveAdminShift
} from "./api/shifts.js";

export {
  addAdminTariff,
  deleteAdminPoint,
  deleteAdminTariff,
  saveAdminPoint,
  updateAdminTariff
} from "./api/points.js";

export {
  deleteAdminPayout,
  saveAdminPayout
} from "./api/payouts.js";

/*
  Compatibility facade for src/app.js.
  Realtime transport lives in api/realtime.js and uses postgres_changes.
  Team reads live in api/read.js and include point_tariffs.
*/
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
      password:
        password || undefined
    }
  );
}
