/*
  Проверка расчётного периода перед закрытием.

  Задача не в том, чтобы выдать список предупреждений, а в том, чтобы
  человек посмотрел ровно туда, где расчёт может быть неверным. Поэтому
  каждая находка отвечает на три вопроса: что не так, почему это важно
  для денег и куда идти смотреть.

  Правило отбора одно: находка появляется, только если её можно
  проверить и она может изменить сумму. «Смен мало», «премия крупная» и
  прочие поводы для тревоги без действия сюда не попадают — от них
  проверка превращается в шум, который перестают читать.

  Считать здесь ничего нельзя: суммы приходят готовыми из того же
  расчёта, что рисует «Итоги» и снимок периода.
*/

/* Насколько ручная сумма должна разойтись с тарифной, чтобы спросить. */
const MANUAL_GAP_SHARE=0.2;

export function reviewPeriod({
  entries,
  shifts,
  payoutsFor,
  today
}){
  const findings=[];

  for(const entry of entries){
    const own=shifts.filter(shift=>
      shift.employeeId===entry.employeeId
    );

    findings.push(
      ...reviewEmployee({
        entry,
        shifts:own,
        payouts:payoutsFor(entry.employeeId),
        today
      })
    );
  }

  const troubled=new Set(
    findings.map(item=>item.employeeId)
  );

  return {
    findings,
    employees:entries.length,
    ready:entries.length-troubled.size,
    troubled:troubled.size
  };
}

function reviewEmployee({
  entry,
  shifts,
  payouts,
  today
}){
  const found=[];

  const add=(item)=>found.push({
    employeeId:entry.employeeId,
    employeeName:entry.employeeName,
    ...item
  });

  for(const shift of shifts){
    /*
      Смена без ставки посчитана в ноль: это не «маленькая сумма», а
      отсутствие тарифа на её дату.
    */
    if(!(Number(shift.rate)>0)){
      add({
        kind:"shift_without_rate",
        severity:"error",
        title:"Смена без ставки",
        detail:`${shift.dateLabel} · ${shift.point}`,
        target:{type:"shift",id:shift.id,date:shift.date}
      });

      continue;
    }

    /*
      Ручная сумма — решение человека, и спорить с ним незачем. Но если
      она сильно расходится с тарифной, проверить стоит: чаще всего это
      опечатка в поле, а не договорённость.
    */
    if(shift.manual){
      const tariff=Number(shift.tariffBase) || 0;
      const actual=Number(shift.base) || 0;

      const gap=tariff>0
        ? Math.abs(actual-tariff)/tariff
        : 1;

      if(gap>=MANUAL_GAP_SHARE){
        add({
          kind:"manual_amount",
          severity:"warning",
          title:"Ручная сумма заметно отличается от тарифа",
          detail:`${shift.dateLabel} · ${shift.point}`,
          target:{type:"shift",id:shift.id,date:shift.date}
        });
      }
    }

    /*
      Смена посчитана по прежним условиям: тариф или своя ставка на эту
      дату теперь другие. До закрытия это решают пересчётом или
      оставляют как есть — но осознанно.
    */
    if(shift.diverged){
      add({
        kind:"stale_rate",
        severity:"warning",
        title:"Ставка изменилась после сохранения смены",
        detail:`${shift.dateLabel} · ${shift.point}`,
        target:{type:"shift",id:shift.id,date:shift.date}
      });
    }

    /* Смена в будущем попадает в период, которого ещё не было. */
    if(shift.date>today){
      add({
        kind:"future_shift",
        severity:"warning",
        title:"Смена ещё не наступила",
        detail:`${shift.dateLabel} · ${shift.point}`,
        target:{type:"shift",id:shift.id,date:shift.date}
      });
    }
  }

  /*
    Выплачено больше, чем причитается. Само по себе это не ошибка —
    так выглядит переплата, — но закрывать период, не заметив её,
    нельзя.
  */
  if(entry.paid-entry.due>0.005){
    add({
      kind:"overpaid",
      severity:"warning",
      title:"Выплачено больше, чем начислено",
      detail:`Переплата ${format(entry.paid-entry.due)}`,
      target:{type:"employee",id:entry.employeeId}
    });
  }

  /*
    Выплата записана, но период ещё должен: обычная частичная выплата.
    Спрашиваем только тогда, когда деньги уже двигались — иначе это
    просто «ещё не платили».
  */
  if(
    payouts.length>0 &&
    entry.due-entry.paid>0.005
  ){
    add({
      kind:"partially_paid",
      severity:"info",
      title:"Выплачено не полностью",
      detail:`Осталось ${format(entry.due-entry.paid)}`,
      target:{type:"employee",id:entry.employeeId}
    });
  }

  /* Отрицательная сумма к выплате: штрафы съели начисление. */
  if(entry.due<0){
    add({
      kind:"negative_due",
      severity:"error",
      title:"Сумма к выплате отрицательная",
      detail:`Штрафы больше начислений на ${format(-entry.due)}`,
      target:{type:"employee",id:entry.employeeId}
    });
  }

  return found;
}

function format(value){
  return `${Math.round(Number(value) || 0)} ₽`;
}
