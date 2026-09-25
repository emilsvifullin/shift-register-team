import {
  invokeSupabaseFunction,
  supabaseClient
} from "../supabase.js";

import {
  resultData
} from "./result.js";

export async function saveAdminEmployee({
  id=null,
  fullName,
  status,
  hiredAt=null,
  userId=null,
  employmentType="staff",
  phone,
  transferPhone=null,
  transferBank=null,
  transferRecipient=null,
  pointIds=[]
}){
  const result=
    await supabaseClient
      .rpc(
        "admin_save_employee_profile",
        {
          p_employee_id:id,
          p_full_name:fullName,
          p_status:status,
          p_hired_at:hiredAt,
          p_user_id:userId,
          p_employment_type:
            employmentType,
          p_phone:phone,
          p_transfer_phone:
            transferPhone,
          p_transfer_bank:
            transferBank,
          p_transfer_recipient:
            transferRecipient,
          p_point_ids:pointIds
        }
      );

  return resultData(
    result,
    "Не удалось сохранить сотрудника"
  );
}

export async function rollbackAdminEmployeeCreation(
  id
){
  const result=
    await supabaseClient
      .rpc(
        "admin_rollback_employee_creation",
        {
          p_employee_id:id
        }
      );

  return resultData(
    result,
    "Не удалось отменить создание сотрудника"
  );
}

export async function deleteAdminEmployee(
  id
){
  return invokeSupabaseFunction(
    "admin-employee-auth",
    {
      action:"delete",
      employeeId:id
    }
  );
}

/*
  Индивидуальная ставка сотрудника на ПВЗ.

  Три функции повторяют тарифные один в один — и это намеренно: ставка
  устроена как тариф, и любое расхождение в проверках или в порядке
  доводов означало бы, что где-то из двух путей правила другие.
*/
export async function addAdminEmployeeRate({
  employeeId,
  pointId,
  effectiveFrom,
  pricingType,
  fixedRate=null,
  shkTiers=null
}){
  const result=
    await supabaseClient
      .rpc(
        "admin_add_employee_rate",
        {
          p_employee_id:employeeId,
          p_point_id:pointId,
          p_effective_from:
            effectiveFrom,
          p_pricing_type:
            pricingType,
          p_fixed_rate:
            fixedRate===null ||
            fixedRate===""
              ? null
              : Number(fixedRate),
          p_shk_tiers:shkTiers
        }
      );

  return resultData(
    result,
    "Не удалось добавить ставку"
  );
}

export async function updateAdminEmployeeRate({
  id,
  effectiveFrom,
  pricingType,
  fixedRate=null,
  shkTiers=null
}){
  const result=
    await supabaseClient
      .rpc(
        "admin_update_employee_rate",
        {
          p_rate_id:id,
          p_effective_from:
            effectiveFrom,
          p_pricing_type:
            pricingType,
          p_fixed_rate:
            fixedRate===null ||
            fixedRate===""
              ? null
              : Number(fixedRate),
          p_shk_tiers:shkTiers
        }
      );

  return resultData(
    result,
    "Не удалось сохранить ставку"
  );
}

export async function deleteAdminEmployeeRate(
  id
){
  const result=
    await supabaseClient.rpc(
      "admin_delete_employee_rate",
      {
        p_rate_id:id
      }
    );

  return resultData(
    result,
    "Не удалось удалить ставку"
  );
}
