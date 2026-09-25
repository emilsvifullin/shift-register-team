/*
  Расчётный период — половина месяца.

  Здесь только то, что знает о периоде сам по себе: его ключ, состояние,
  отпечаток данных и снимок для закрытия. Деньги считает payouts() из
  domain.js, и этот модуль их не пересчитывает — он берёт готовый
  результат и раскладывает по периодам. Иначе получилось бы две
  финансовые модели, а расходятся они всегда.

  Период first_half — дни 1–15 и выплата 25-го; second_half — остальные
  дни и окончательный расчёт 10-го следующего месяца. Это не просто окно
  дат: у ПВЗ с авансом часть заработанного в первой половине переносится
  в окончательный расчёт, и «сколько причитается за период» отвечает
  именно payouts(), а не сумма смен по датам.
*/

export const PERIOD_KINDS=Object.freeze([
  "first_half",
  "second_half"
]);

export const PERIOD_STATUSES=Object.freeze([
  "open",
  "checked",
  "closed",
  "paid"
]);

const STATUS_LABELS={
  open:"В работе",
  checked:"Проверено",
  closed:"Закрыто",
  paid:"Выплачено"
};

export function periodStatusLabel(status){
  return STATUS_LABELS[status] || STATUS_LABELS.open;
}

export function periodMonthKey(ym){
  return `${ym}-01`;
}

/* Период, к которому относится день месяца. */
export function periodKindForDate(ymd){
  return Number(ymd.slice(8,10))<=15
    ? "first_half"
    : "second_half";
}

export function findPeriod(periods,ym,kind){
  const month=periodMonthKey(ym);

  return (periods || []).find(
    item=>
      item.period_month===month &&
      item.payout_kind===kind
  ) || null;
}

export function periodStatus(periods,ym,kind){
  return findPeriod(periods,ym,kind)?.status || "open";
}

export function periodClosed(periods,ym,kind){
  return ["closed","paid"].includes(
    periodStatus(periods,ym,kind)
  );
}

/*
  Отпечаток данных периода.

  Нужен ровно для одного ответа: изменилось ли с момента проверки то, от
  чего зависят деньги. Поэтому в него входят суммы и то, из чего они
  сложились, а не служебные поля вроде времени правки — иначе отпечаток
  менялся бы от любого сохранения, ничего не меняющего в расчёте.

  Строка читаемая и короткая: её достаточно сравнить целиком.
*/
export function periodFingerprint(entries){
  const parts=[...entries]
    .sort((first,second)=>
      String(first.employeeId).localeCompare(
        String(second.employeeId)
      )
    )
    .map(entry=>
      [
        entry.employeeId,
        entry.shifts,
        round2(entry.base),
        round2(entry.bonus),
        round2(entry.fine),
        round2(entry.due),
        round2(entry.paid)
      ].join(":")
    );

  return parts.join("|");
}

function round2(value){
  return Math.round((Number(value) || 0)*100)/100;
}

/*
  Строка снимка на одного сотрудника.

  due — то, что причитается за этот период по payouts(); paid — то, что
  на этот момент записано выплатами. detail хранит разбивку целиком,
  чтобы закрытый период можно было показать, ничего не пересчитывая.
*/
export function periodEntry({
  employeeId,
  employeeName,
  kind,
  payout,
  shifts,
  paid
}){
  const first=kind==="first_half";

  const base=first
    ? payout.specialAdvance+payout.regularFirstBase
    : payout.specialCarry+
      payout.specialSecondHalfBase+
      payout.regularSecondBase;

  const bonus=first
    ? payout.bonus25
    : payout.bonus10;

  const fine=first
    ? payout.fine25
    : payout.fine10;

  const due=first
    ? payout.payment25
    : payout.payment10;

  return {
    employeeId,
    employeeName,
    shifts:shifts.length,
    base:round2(base),
    bonus:round2(bonus),
    fine:round2(fine),
    due:round2(due),
    paid:round2(paid),
    detail:{
      kind,
      shifts:shifts.map(shift=>({
        id:shift.id,
        date:shift.date,
        point:shift.point,
        pointId:shift.dbPointId || shift.pointId || "",
        type:shift.type,
        partial:Boolean(shift.partial),
        rate:Number(shift.pricing?.rate) || 0,
        rateSource:
          shift.pricing?.rateSource==="employee"
            ? "employee"
            : "point",
        base:Number(shift.baseAmount ?? shift.base) || 0,
        manual:Boolean(shift.baseOverrideReason)
      })),
      breakdown:{
        specialAdvance:round2(payout.specialAdvance),
        specialCarry:round2(payout.specialCarry),
        regularFirstBase:round2(payout.regularFirstBase),
        regularSecondBase:round2(payout.regularSecondBase),
        specialSecondHalfBase:round2(
          payout.specialSecondHalfBase
        ),
        bonus:round2(bonus),
        fine:round2(fine)
      }
    }
  };
}

/* Итог по всем сотрудникам — то же, что показывает шапка периода. */
export function periodTotals(entries){
  return entries.reduce(
    (total,entry)=>({
      employees:total.employees+1,
      shifts:total.shifts+entry.shifts,
      base:round2(total.base+entry.base),
      bonus:round2(total.bonus+entry.bonus),
      fine:round2(total.fine+entry.fine),
      due:round2(total.due+entry.due),
      paid:round2(total.paid+entry.paid)
    }),
    {
      employees:0,
      shifts:0,
      base:0,
      bonus:0,
      fine:0,
      due:0,
      paid:0
    }
  );
}

/*
  Разница между тем, что зафиксировано снимком, и тем, что записано
  выплатами.

  Историю выплат никто не переписывает: выплатили 30 000 — так и
  осталось. Если после закрытия расчёт изменился и правильная сумма стала
  35 000, разница показывается как недоплата 5 000, а не подменяет факт.
  В обратную сторону — как переплата.

  Для закрытого периода за основу берётся снимок: он и есть утверждённый
  расчёт. Для открытого — текущий счёт, потому что утверждать ещё нечего.
*/
export function periodDifferences({
  entries,
  snapshot,
  closed
}){
  const source=closed && snapshot?.length
    ? snapshot
    : entries;

  const rows=source
    .map(row=>{
      const due=round2(row.due);
      const paid=round2(row.paid);
      const gap=round2(due-paid);

      return {
        employeeId:row.employeeId || row.employee_id,
        employeeName:row.employeeName || "",
        due,
        paid,
        underpaid:gap>0 ? gap : 0,
        overpaid:gap<0 ? -gap : 0
      };
    })
    .filter(row=>row.underpaid || row.overpaid);

  return {
    rows,
    underpaid:round2(
      rows.reduce(
        (sum,row)=>sum+row.underpaid,
        0
      )
    ),
    overpaid:round2(
      rows.reduce(
        (sum,row)=>sum+row.overpaid,
        0
      )
    )
  };
}
