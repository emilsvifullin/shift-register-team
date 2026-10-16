import {
  DataValidationError,
  isValidDateString,
  payouts
} from "./domain.js?shell=7";
import {roundMoney} from "./format.js";
import {paymentProgress} from "./workflow.js?shell=7";

const BUSINESS_DATE_FORMAT=new Intl.DateTimeFormat("en-CA",{
  timeZone:"Europe/Moscow",
  year:"numeric",
  month:"2-digit",
  day:"2-digit"
});

/* Совпадает с датой расчёта сервера независимо от часового пояса браузера. */
export function businessDate(date=new Date()){
  const parts=Object.fromEntries(
    BUSINESS_DATE_FORMAT.formatToParts(date)
      .map(part=>[part.type,part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/*
  Денежные правила остаются в payouts(): лимит первой выплаты, перенос
  заработанного, премии и адресные удержания не пересчитываются здесь.
  Отличается только набор смен: прогноз содержит все внесённые смены,
  начисленное — смены до явно переданного расчётного дня включительно.
*/
export function payoutAccruals({ym,shifts=[],asOf}){
  if(!isValidDateString(asOf)){
    throw new DataValidationError("некорректная дата расчёта выплаты");
  }
  return {
    earned:payouts(ym,shifts.filter(shift=>shift.date<=asOf),{today:asOf}),
    forecast:payouts(ym,shifts,{today:asOf})
  };
}

/*
  Баланс одной выплаты одного сотрудника. records и shifts можно передать
  уже отобранными по сотруднику; employeeId дополнительно ограничивает
  обе коллекции, когда передаётся общий набор команды. accruals позволяет
  повторно использовать пару расчётов этого же сотрудника на экране.

  При редактировании прежняя запись исключается из доступного остатка.
  Старую обычную выплату разрешено уменьшить даже после уменьшения
  начислений: её прежняя сумма остаётся верхней границей редактирования.
*/
export function payoutBalance({
  ym,
  kind,
  employeeId,
  shifts=[],
  records=[],
  asOf,
  editingId=null,
  accruals=null
}){
  if(!["first_half","second_half"].includes(kind)){
    throw new DataValidationError("некорректный расчётный период выплаты");
  }
  if(!isValidDateString(asOf)){
    throw new DataValidationError("некорректная дата расчёта выплаты");
  }
  const ownShifts=employeeId===undefined
    ? shifts
    : shifts.filter(shift=>shift.employeeId===employeeId);
  const calculated=accruals || payoutAccruals({ym,shifts:ownShifts,asOf});
  const key=kind==="first_half" ? "payment25" : "payment10";
  const due=roundMoney(calculated.earned[key]);
  const forecastDue=roundMoney(calculated.forecast[key]);
  const scoped=records.filter(record=>
    (employeeId===undefined || record.employee_id===employeeId) &&
    record.period_month===`${ym}-01` &&
    record.payout_kind===kind
  );
  const previous=editingId
    ? scoped.find(record=>record.id===editingId) || null
    : null;
  const progress=paymentProgress(due,scoped);
  const others=previous ? scoped.filter(record=>record!==previous) : scoped;
  const editingProgress=paymentProgress(due,others);
  const advancePaid=paymentProgress(0,scoped.filter(record=>record.is_advance)).paid;
  const allowedRegular=roundMoney(previous && !previous.is_advance
    ? Math.max(editingProgress.remaining,Number(previous.amount) || 0)
    : editingProgress.remaining);

  return {
    accruals:calculated,
    due,
    forecastDue,
    paid:progress.paid,
    advancePaid,
    regularPaid:roundMoney(progress.paid-advancePaid),
    remaining:progress.remaining,
    // Отрицательное начисление само по себе не означает выдачу денег.
    overpaid:roundMoney(Math.max(0,progress.paid-Math.max(due,0))),
    otherPaid:editingProgress.paid,
    editingRemaining:editingProgress.remaining,
    allowedRegular,
    regularAvailable:allowedRegular>0,
    defaultIsAdvance:previous
      ? Boolean(previous.is_advance)
      : editingProgress.remaining<=0,
    previous
  };
}
