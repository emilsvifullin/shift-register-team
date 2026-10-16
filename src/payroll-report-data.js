/*
  Подробности отчёта относятся к выплате, а не к календарному окну.
  Деньги и лимиты определяет только payouts(). Здесь его готовые суммы
  распределяются между исходными сменами и комментариями для документа.
*/
import {calc,inMonth,payouts} from "./domain.js?shell=7";
import {periodEntry,periodKindForDate} from "./payroll-period.js";
import {roundMoney} from "./format.js";

function entry(kind,payout){
  return periodEntry({kind,payout,shifts:[],paid:0});
}

/* Исторический участник остаётся в отчёте с текущим нулевым начислением. */
export function reportEntries({entries,snapshot=[],closed=false}){
  const result=[...entries];
  const present=new Set(entries.map(row=>row.employeeId));
  if(closed){
    for(const row of snapshot){
      if(present.has(row.employeeId)) continue;
      present.add(row.employeeId);
      result.push({
        employeeId:row.employeeId,
        employeeName:row.employeeName || "Сотрудник",
        shifts:0,base:0,bonus:0,fine:0,due:0,
        paid:Number(row.paid) || 0
      });
    }
  }
  return result;
}

/*
  Корректировка также относится к выплате. При заполненном лимите изменение
  смены 1–15 может целиком изменить окончательный расчёт, а не выплату25.
*/
export function reportCorrections({ym,kind,shifts}){
  const own=inMonth(shifts,ym);
  const tariff=own.map(shift=>shift.baseOverrideReason
    ? {...shift,baseAmount:calc(shift).calculatedBase}
    : shift
  );
  return roundMoney(
    entry(kind,payouts(ym,own)).base-
    entry(kind,payouts(ym,tariff)).base
  );
}

function commentedAmounts(shift,key,total,fallback){
  let remaining=roundMoney(total);
  const rows=[];
  for(const item of shift[key] || []){
    const amount=roundMoney(Math.min(Number(item.amount) || 0,remaining));
    if(amount<=0) continue;
    rows.push({amount,comment:item.comment || fallback,...(key==="penalties" ? {
      payoutKind:item.payoutKind || item.payout_kind || ""
    } : {})});
    remaining=roundMoney(remaining-amount);
  }
  if(remaining>0) rows.push({amount:remaining,comment:fallback});
  return rows;
}

export function periodReportDetail({
  ym,kind,shifts,
  shortDateLabel=value=>value,
  hoursWord=value=>`${value} ч`
}){
  const own=inMonth(shifts,ym).sort((a,b)=>
    a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  );
  const payout=payouts(ym,own);
  const rows=[];
  const bonuses=[];
  const fines=[];
  const prefix=[];
  let previousBase=0;
  let firstFineBudget=roundMoney(payout.targetedFine25Applied);

  for(const shift of own){
    const result=calc(shift);
    prefix.push(shift);
    const currentBase=entry(kind,payouts(ym,prefix)).base;
    const base=roundMoney(currentBase-previousBase);
    previousBase=currentBase;
    const calendarKind=periodKindForDate(shift.date);

    if(base!==0 || calendarKind===kind){
      let typeLabel=shift.type==="extra"
        ? "Доп"
        : shift.partial ? hoursWord(result.hours) : "Основная";
      if(calendarKind!==kind) typeLabel+=" · перенос из 1–15";
      else if(base!==result.base) typeLabel+=" · часть в этой выплате";
      rows.push({
        dateLabel:shortDateLabel(shift.date),
        point:shift.point,typeLabel,
        rate:Number(shift.pricing?.rate) || 0,
        rateSource:shift.pricing?.rateSource==="employee" ? "employee" : "point",
        base,manual:Boolean(shift.baseOverrideReason)
      });
    }

    // Один источник определяет принадлежность премии тем же payouts().
    const ownPayout=payouts(ym,[shift]);
    const bonusBudget=entry(kind,ownPayout).bonus;
    for(const item of commentedAmounts(shift,"bonuses",bonusBudget,"премия")){
      bonuses.push({
        label:`${shortDateLabel(shift.date)} · ${item.comment}`,
        amount:item.amount
      });
    }

    /*
      Для targeted first_half payouts уже вычислил доступную часть25 и
      остаток10. Расходуем именно этот бюджет, не повторяя формулу лимита,
      gross/defaultFine или проверки периода по дню смены.
    */
    const fineRows=commentedAmounts(shift,"penalties",Math.max(
      result.fine,
      (shift.penalties || []).reduce((sum,item)=>sum+Math.max(Number(item.amount) || 0,0),0)
    ),"штраф");
    for(const item of fineRows){
      const itemPayout=payouts(ym,[{
        ...shift,fine:item.amount,
        penalties:[{amount:item.amount,payoutKind:item.payoutKind || ""}]
      }]);
      let amount;
      let carried=false;
      if(itemPayout.targetedFine25){
        const first=roundMoney(Math.min(item.amount,firstFineBudget));
        firstFineBudget=roundMoney(firstFineBudget-first);
        amount=kind==="first_half" ? first : roundMoney(item.amount-first);
        carried=kind==="second_half" && amount>0;
      }else{
        amount=kind==="first_half"
          ? itemPayout.defaultFine25
          : itemPayout.defaultFine10+itemPayout.targetedFine10;
      }
      if(amount>0) fines.push({
        label:`${shortDateLabel(shift.date)} · ${item.comment}${carried ? " · перенос из выплаты 1–15" : ""}`,
        amount:roundMoney(amount)
      });
    }
  }

  return {shifts:rows,bonuses,fines};
}
