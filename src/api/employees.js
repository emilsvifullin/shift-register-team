import {supabaseClient} from "../supabase.js";
import {resultData} from "./shared.js";

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
  const result=await supabaseClient.rpc(
    "admin_save_employee_profile",
    {
      p_employee_id:id,
      p_full_name:fullName,
      p_status:status,
      p_hired_at:hiredAt,
      p_user_id:userId,
      p_employment_type:employmentType,
      p_phone:phone,
      p_transfer_phone:transferPhone,
      p_transfer_bank:transferBank,
      p_transfer_recipient:transferRecipient,
      p_point_ids:pointIds
    }
  );

  return resultData(result,"Не удалось сохранить сотрудника");
}

export async function rollbackAdminEmployeeCreation(id){
  const result=await supabaseClient.rpc(
    "admin_rollback_employee_creation",
    {p_employee_id:id}
  );

  return resultData(
    result,
    "Не удалось отменить создание сотрудника"
  );
}
