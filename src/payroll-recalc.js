/*
  Перерасчёт смен после изменения условий задним числом.

  Изменённый тариф ПВЗ или индивидуальная ставка сотрудника не трогают
  уже сохранённые смены сами: их стоимость заморожена снимком. Но если
  условия изменились с даты, которая эти смены застаёт, кто-то должен
  решить, пересчитывать ли их — и решать это вслепую нельзя.

  Здесь собирается план: какие смены затронуты, сколько они стоят сейчас,
  сколько будут стоить, и какова разница. Ничего не применяется — план
  только показывают. Считает его тот же расчёт, что и всё остальное:
  сюда приходит готовая новая сумма, а не своя формула.

  Строка плана может быть в одном из трёх состояний:

    apply  — пересчитать по новым условиям;
    skip   — оставить как есть, смена сохраняет свою сумму;
    manual — назначить свою сумму, отличную и от старой, и от новой.

  Ради manual план и нужен целиком до применения: «новая ставка подходит
  всем, кроме одной смены» — обычный случай, и разбирать его после
  массового пересчёта пришлось бы вручную по одной.
*/

export const RECALC_MODES=Object.freeze([
  "apply",
  "skip",
  "manual"
]);

/*
  План перерасчёта.

  shifts — уже отфильтрованные смены, которых касается изменение;
  priceOf(shift) возвращает сумму по действующим сейчас условиям.
  Смена попадает в план, только если сумма действительно меняется:
  строка «было 3000, станет 3000» ничего не сообщает.
*/
export function buildRecalcPlan({
  shifts,
  priceOf
}){
  const rows=[];

  for(const shift of shifts){
    let next=null;

    try{
      next=priceOf(shift);
    }catch{
      /*
        Условий на дату смены нет вовсе — пересчитать её нечем. Это не
        строка плана, а повод показать смену в проверке периода.
      */
      continue;
    }

    const current=round(shift.base);
    const target=round(next);

    if(current===target){
      continue;
    }

    rows.push({
      id:shift.id,
      date:shift.date,
      dateLabel:shift.dateLabel,
      employeeId:shift.employeeId,
      employeeName:shift.employeeName,
      point:shift.point,
      manualAmount:"",
      mode:shift.manual ? "skip" : "apply",
      /*
        Смена с ручной суммой по умолчанию остаётся как есть: её сумму
        назначил человек, и молча заменять её расчётом нельзя.
      */
      wasManual:Boolean(shift.manual),
      current,
      next:target,
      diff:round(target-current)
    });
  }

  return rows.sort((first,second)=>
    first.date.localeCompare(second.date) ||
    String(first.employeeName).localeCompare(
      String(second.employeeName)
    )
  );
}

/* Во что план обойдётся: считается по выбранным состояниям строк. */
export function recalcTotals(rows){
  return rows.reduce(
    (total,row)=>{
      const target=resolvedAmount(row);

      const diff=target===null
        ? 0
        : round(target-row.current);

      return {
        rows:total.rows+1,
        apply:total.apply+(row.mode==="apply" ? 1 : 0),
        skip:total.skip+(row.mode==="skip" ? 1 : 0),
        manual:total.manual+(row.mode==="manual" ? 1 : 0),
        diff:round(total.diff+diff)
      };
    },
    {rows:0,apply:0,skip:0,manual:0,diff:0}
  );
}

/*
  Сумма, которой строка станет. Для skip — прежняя (null означает «не
  трогать»), для manual — назначенная, если она разобралась в число.
*/
export function resolvedAmount(row){
  if(row.mode==="skip"){
    return null;
  }

  if(row.mode==="apply"){
    return row.next;
  }

  const raw=String(row.manualAmount)
    .trim()
    .replace(",",".");

  if(!raw){
    return null;
  }

  const value=Number(raw);

  return Number.isFinite(value) && value>=0
    ? round(value)
    : null;
}

/* Строки, которые нечем применить: ручная сумма не разобралась. */
export function invalidRows(rows){
  return rows.filter(row=>
    row.mode==="manual" &&
    resolvedAmount(row)===null
  );
}

function round(value){
  return Math.round(Number(value) || 0);
}
