const ERROR_MESSAGES=Object.freeze({
  forbidden:"Недостаточно прав для этой операции",
  employee_not_found:"Сотрудник не найден",
  employee_inactive:"Для новой смены нужен активный сотрудник",
  point_not_found:"Пункт выдачи не найден",
  point_inactive:"Для новой смены нужен активный ПВЗ",
  point_not_assigned:"Этот ПВЗ не назначен сотруднику",
  tariff_not_found_for_date:"Для выбранного ПВЗ и даты тариф не найден",
  account_already_linked:"Этот аккаунт уже привязан к другому сотруднику",
  employee_account_required:"Выберите аккаунт с ролью сотрудника",
  employee_has_history:"Сотрудника со сменами можно только перенести в архив",
  shift_not_found:"Смена не найдена",
  invalid_partial_hours:"Неполная смена должна быть от 0,5 до 11,5 часа с шагом 0,5",
  invalid_bonus:"Проверьте сумму и комментарий премии",
  invalid_penalty:"Проверьте сумму и комментарий штрафа",
  invalid_shift_base_amount:"Проверьте сумму оплаты за смену",
  shift_base_amount_comment_required:"Укажите причину изменения оплаты в комментарии к смене",
  employee_creation_rollback_forbidden:"Нельзя отменить создание сотрудника: карточка уже используется",
  employee_deletion_pending:"Удаление сотрудника уже выполняется"
});

function readableError(result,fallback){
  const raw=String(result.error?.message || "");
  const known=Object.entries(ERROR_MESSAGES)
    .find(([code])=>raw.includes(code));
  return known?.[1] || raw || fallback;
}

export function resultData(result,message){
  if(result.error){
    const error=new Error(readableError(result,message));
    error.code=result.error.code;
    error.details=result.error.details;
    throw error;
  }
  return result.data;
}

export function adjustmentPayload(rows,{includePayoutKind=false}={}){
  return (rows || []).map(item=>({
    id:item.id,
    amount:Number(item.amount),
    comment:String(item.comment || "").trim(),
    ...(includePayoutKind
      ? {payoutKind:item.payoutKind || null}
      : {})
  }));
}
