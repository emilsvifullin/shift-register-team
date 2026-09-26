import assert from "node:assert/strict";
import test from "node:test";

import {
  periodDifferences,
  periodFingerprint,
  periodKindForDate,
  periodTotals
} from "../src/payroll-period.js";

/*
  Разница периода отвечает на один вопрос: сколько человеку ещё должны
  или сколько ему отдали сверх. Тесты держат именно этот ответ — и то,
  от чего он считается.
*/

function entry(extra={}){
  return {
    employeeId:"e-1",
    employeeName:"Марина Абрамова",
    shifts:2,
    base:6000,
    bonus:0,
    fine:0,
    due:6000,
    paid:6000,
    ...extra
  };
}

test(
  "половина месяца определяется днём",
  ()=>{
    assert.equal(periodKindForDate("2026-09-01"),"first_half");
    assert.equal(periodKindForDate("2026-09-15"),"first_half");
    assert.equal(periodKindForDate("2026-09-16"),"second_half");
    assert.equal(periodKindForDate("2026-09-30"),"second_half");
  }
);

test(
  "сошедшийся период не показывает разницы",
  ()=>{
    const result=periodDifferences({
      entries:[entry()],
      snapshot:[],
      closed:true
    });

    assert.deepEqual(result.rows,[]);
    assert.equal(result.underpaid,0);
    assert.equal(result.overpaid,0);
  }
);

/*
  Открытый период, по которому ещё не платили, ничего не должен: это не
  недоплата, а «ещё не выплачено».
*/
test(
  "открытый период без выплат не называется недоплатой",
  ()=>{
    const result=periodDifferences({
      entries:[entry({paid:0})],
      snapshot:[],
      closed:false
    });

    assert.equal(result.underpaid,0);
    assert.deepEqual(result.rows,[]);
  }
);

test(
  "закрытый период без выплат — это недоплата целиком",
  ()=>{
    const result=periodDifferences({
      entries:[entry({paid:0})],
      snapshot:[entry({paid:0})],
      closed:true
    });

    assert.equal(result.underpaid,6000);
  }
);

/*
  Главный случай: расчёт закрытого периода изменили — через
  подтверждение и с записью в историю. Деньги изменились вместе с ним,
  и разница обязана это показать. Снимок помнит прежние 6 000, но
  правильная сумма теперь 7 500.
*/
test(
  "изменение расчёта после закрытия становится недоплатой",
  ()=>{
    const result=periodDifferences({
      entries:[entry({due:7500,paid:6500})],
      snapshot:[entry({due:6500,paid:6500})],
      closed:true
    });

    assert.equal(result.underpaid,1000);
    assert.equal(result.overpaid,0);
    assert.equal(result.rows[0].due,7500);
    assert.equal(result.rows[0].paid,6500);
  }
);

test(
  "уменьшение расчёта после закрытия становится переплатой",
  ()=>{
    const result=periodDifferences({
      entries:[entry({due:5000,paid:6500})],
      snapshot:[entry({due:6500,paid:6500})],
      closed:true
    });

    assert.equal(result.overpaid,1500);
    assert.equal(result.underpaid,0);
  }
);

/*
  Сотрудник был в снимке, а из текущего счёта выпал: смены перенесли в
  другой период или удалили. Выплата ему при этом осталась, и молчать о
  ней нельзя — иначе деньги пропадут с экрана.
*/
test(
  "выплата сотруднику, выпавшему из расчёта, остаётся видна",
  ()=>{
    const result=periodDifferences({
      entries:[],
      snapshot:[
        {
          employeeId:"e-2",
          employeeName:"Пётр Волков",
          due:0,
          paid:4000
        }
      ],
      closed:true
    });

    assert.equal(result.overpaid,4000);
    assert.equal(result.rows[0].employeeName,"Пётр Волков");
  }
);

test(
  "снимок открытого периода в расчёт разницы не входит",
  ()=>{
    const result=periodDifferences({
      entries:[entry({due:6000,paid:6000})],
      snapshot:[
        {
          employeeId:"e-2",
          employeeName:"Пётр Волков",
          due:0,
          paid:4000
        }
      ],
      closed:false
    });

    assert.deepEqual(result.rows,[]);
  }
);

/*
  Отпечаток отвечает на вопрос «изменилось ли то, от чего зависят
  деньги», и не должен меняться от порядка строк.
*/
test(
  "отпечаток не зависит от порядка сотрудников",
  ()=>{
    const first=entry({employeeId:"a"});
    const second=entry({employeeId:"b",due:3000});

    assert.equal(
      periodFingerprint([first,second]),
      periodFingerprint([second,first])
    );

    assert.notEqual(
      periodFingerprint([first,second]),
      periodFingerprint([first,entry({employeeId:"b",due:3100})])
    );
  }
);

test(
  "итог периода складывает то же, что видит человек",
  ()=>{
    const totals=periodTotals([
      entry({due:6000,paid:6000}),
      entry({employeeId:"e-2",due:3000,paid:1000,shifts:1,base:3000})
    ]);

    assert.equal(totals.employees,2);
    assert.equal(totals.shifts,3);
    assert.equal(totals.due,9000);
    assert.equal(totals.paid,7000);
  }
);
