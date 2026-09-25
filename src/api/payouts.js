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

/*
  Расчётные периоды.

  Снимок закрытия считает клиент той же функцией, что рисует «Итоги», и
  отправляет готовым: правила расчёта живут в одном месте — см.
  комментарий миграции 20260926120000.
*/
export async function checkPayrollPeriod({
  periodMonth,
  payoutKind,
  fingerprint
}){
  const result=
    await supabaseClient.rpc(
      "admin_check_payroll_period",
      {
        p_period_month:periodMonth,
        p_payout_kind:payoutKind,
        p_fingerprint:fingerprint
      }
    );

  return resultData(
    result,
    "Не удалось отметить период проверенным"
  );
}

export async function uncheckPayrollPeriod({
  periodMonth,
  payoutKind
}){
  const result=
    await supabaseClient.rpc(
      "admin_uncheck_payroll_period",
      {
        p_period_month:periodMonth,
        p_payout_kind:payoutKind
      }
    );

  return resultData(
    result,
    "Не удалось вернуть период в работу"
  );
}

export async function closePayrollPeriod({
  periodMonth,
  payoutKind,
  entries
}){
  const result=
    await supabaseClient.rpc(
      "admin_close_payroll_period",
      {
        p_period_month:periodMonth,
        p_payout_kind:payoutKind,
        p_entries:entries
      }
    );

  return resultData(
    result,
    "Не удалось закрыть период"
  );
}

export async function markPayrollPeriodPaid({
  periodMonth,
  payoutKind
}){
  const result=
    await supabaseClient.rpc(
      "admin_mark_payroll_period_paid",
      {
        p_period_month:periodMonth,
        p_payout_kind:payoutKind
      }
    );

  return resultData(
    result,
    "Не удалось отметить период выплаченным"
  );
}

export async function reopenPayrollPeriod({
  periodMonth,
  payoutKind
}){
  const result=
    await supabaseClient.rpc(
      "admin_reopen_payroll_period",
      {
        p_period_month:periodMonth,
        p_payout_kind:payoutKind
      }
    );

  return resultData(
    result,
    "Не удалось вернуть период в работу"
  );
}
