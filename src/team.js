import {
  supabaseClient
} from "./supabase.js";

function resultData(
  result,
  message
){
  if(result.error){
    throw new Error(
      result.error.message ||
      message
    );
  }

  return result.data;
}

export async function loadAdminTeamData(){
  const [
    employeesResult,
    pointsResult,
    employeePointsResult,
    accountsResult
  ]=
    await Promise.all([
      supabaseClient
        .from("employees")
        .select(
          "id, user_id, full_name, status, hired_at"
        )
        .order(
          "status",
          {
            ascending:true
          }
        )
        .order(
          "full_name",
          {
            ascending:true
          }
        ),

      supabaseClient
        .from("points")
        .select(
          "id, code, name, active, pricing_type, fixed_rate, advance_enabled, sort_order"
        )
        .order(
          "sort_order",
          {
            ascending:true
          }
        )
        .order(
          "name",
          {
            ascending:true
          }
        ),

      supabaseClient
        .from("employee_points")
        .select(
          "employee_id, point_id, active"
        )
        .eq(
          "active",
          true
        ),

      supabaseClient
        .rpc(
          "admin_account_options"
        )
    ]);

  return {
    employees:
      resultData(
        employeesResult,
        "Не удалось загрузить сотрудников"
      ) || [],

    points:
      resultData(
        pointsResult,
        "Не удалось загрузить пункты"
      ) || [],

    employeePoints:
      resultData(
        employeePointsResult,
        "Не удалось загрузить назначения"
      ) || [],

    accounts:
      resultData(
        accountsResult,
        "Не удалось загрузить аккаунты"
      ) || []
  };
}

export async function saveAdminEmployee({
  id=null,
  fullName,
  status,
  hiredAt=null,
  userId=null,
  pointIds=[]
}){
  const result=
    await supabaseClient
      .rpc(
        "admin_save_employee",
        {
          p_employee_id:id,
          p_full_name:fullName,
          p_status:status,
          p_hired_at:hiredAt,
          p_user_id:userId,
          p_point_ids:pointIds
        }
      );

  return resultData(
    result,
    "Не удалось сохранить сотрудника"
  );
}
