/*
  Зарплатный отчёт за расчётный период.

  Отчёт ничего не считает. Он получает те же строки, которыми живёт
  период — снимок закрытия или текущий счёт из payouts(), — и только
  раскладывает их по колонкам. Любая своя формула здесь означала бы
  второй ответ на вопрос «сколько начислено», а он должен быть один.

  Колонки выбраны так, чтобы не повторять одно и то же разными словами.
  «По тарифу», «Корректировки», «Премии» и «Штрафы» складываются в
  «Начислено», а «Начислено» за период — это и есть сумма к выплате:
  отдельной колонки «К выплате» рядом с ней быть не может, она была бы
  той же цифрой под другим именем.

  Сумма за смены разложена на тариф и корректировки не для красоты.
  Раньше колонка «За смены» показывала уже исправленную сумму, а рядом
  стояли «Корректировки» — те же деньги второй раз. Строка выглядела
  слагаемыми, но не сходилась: 26 400 + 2 400 никак не давало 26 400.
  В зарплатном документе это худший вид ошибки — тот, который заставляет
  пересчитывать всё остальное вручную.
*/

export const REPORT_FORMATS=Object.freeze([
  "short",
  "detailed"
]);

export function buildPayrollReport({
  periodLabel,
  monthLabel,
  statusLabel,
  rows,
  generatedAt,
  employeeId=null
}){
  const scoped=employeeId
    ? rows.filter(row=>
        row.employeeId===employeeId
      )
    : rows;

  /*
    На какую сумму период закрывали.

    Считается по тем же строкам, которые попали в документ: и отбор по
    сотруднику, и выпавшие сотрудники учитываются сами собой. Отдельное
    число на весь период сюда передавать нельзя — в отчёте по одному
    человеку оно говорило бы про всю команду, а сравнение шло бы между
    разными наборами сотрудников и расходилось бы на пустом месте.
  */
  const frozen=scoped.reduce(
    (sum,row)=>
      row.snapshotDue===null || row.snapshotDue===undefined
        ? sum
        : sum+Number(row.snapshotDue),
    null
  );

  const lines=scoped.map(row=>{
    const accrued=round(row.due);
    const paid=round(row.paid);
    const gap=round(accrued-paid);

    const corrections=round(row.corrections || 0);
    const base=round(row.base);

    return {
      employeeId:row.employeeId,
      employeeName:row.employeeName,
      shifts:row.shifts,
      base,
      /* Сколько дал тариф сам по себе, без правок руками. */
      tariffBase:round(base-corrections),
      bonus:round(row.bonus),
      fine:round(row.fine),
      corrections,
      accrued,
      paid,
      unpaid:gap>0 ? gap : 0,
      overpaid:gap<0 ? -gap : 0,
      detail:row.detail || null
    };
  });

  const totals=lines.reduce(
      (total,line)=>({
        employees:total.employees+1,
        shifts:total.shifts+line.shifts,
        base:round(total.base+line.base),
        tariffBase:round(total.tariffBase+line.tariffBase),
        bonus:round(total.bonus+line.bonus),
        fine:round(total.fine+line.fine),
        corrections:round(
          total.corrections+line.corrections
        ),
        accrued:round(total.accrued+line.accrued),
        paid:round(total.paid+line.paid),
        unpaid:round(total.unpaid+line.unpaid),
        overpaid:round(total.overpaid+line.overpaid)
      }),
      {
        employees:0,
        shifts:0,
        base:0,
        tariffBase:0,
        bonus:0,
        fine:0,
        corrections:0,
        accrued:0,
        paid:0,
        unpaid:0,
        overpaid:0
      }
  );

  return {
    periodLabel,
    monthLabel,
    statusLabel,
    generatedAt,
    employeeId,
    /*
      Сумма, на которую период закрыли, если расчёт с тех пор изменили.
      Отдельный факт рядом с итогом, а не подмена итога. Совпал —
      говорить не о чем.
    */
    closedAtDue:
      frozen===null || round(frozen)===totals.accrued
        ? null
        : round(frozen),
    lines,
    totals
  };
}

/*
  Имя файла человеку, а не машине: по нему видно, что это за отчёт, за
  какой период и по кому.
*/
export function reportFileName({
  monthLabel,
  periodLabel,
  employeeName,
  detailed
}){
  const parts=[
    "Shift Register",
    detailed ? "зарплата подробно" : "зарплата",
    `${monthLabel} ${periodLabel}`
  ];

  if(employeeName){
    parts.push(employeeName);
  }

  return parts
    .join(" — ")
    .replace(/[\\/:*?"<>|]/g,"")
    .trim();
}

function round(value){
  return Math.round(Number(value) || 0);
}
