import {
  supabaseClient
} from "../supabase.js";

import {
  resultData
} from "./result.js";

export async function saveAdminPayout({
  id=null,
  employeeId,
  periodMonth,
  payoutKind,
  amount,
  paidOn,
  comment=null
}){
  const result=
    await supabaseClient.rpc(
      "admin_save_employee_payout",
      {
        p_payout_id:id,
        p_employee_id:employeeId,
        p_period_month:periodMonth,
        p_payout_kind:payoutKind,
        p_amount:Number(amount),
        p_paid_on:paidOn,
        p_comment:comment || null
      }
    );

  return resultData(
    result,
    "Не удалось сохранить выплату"
  );
}

export async function deleteAdminPayout(
  id
){
  const result=
    await supabaseClient.rpc(
      "admin_delete_employee_payout",
      {
        p_payout_id:id
      }
    );

  return resultData(
    result,
    "Не удалось удалить выплату"
  );
}
