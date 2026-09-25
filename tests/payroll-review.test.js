import assert from "node:assert/strict";
import test from "node:test";

import {
  reviewPeriod
} from "../src/payroll-review.js";

/*
  Проверка периода отвечает за отбор: находка появляется только тогда,
  когда её можно посмотреть и она может изменить сумму. Поэтому тесты
  проверяют не количество предупреждений, а что именно попадает в список
  и что в него не попадает.
*/

const TODAY="2026-09-21";

function entry(extra={}){
  return {
    employeeId:"e-1",
    employeeName:"Марина Абрамова",
    shifts:2,
    base:6000,
    bonus:0,
    fine:0,
    due:6000,
    paid:0,
    ...extra
  };
}

function shift(extra={}){
  return {
    id:"s-1",
    employeeId:"e-1",
    date:"2026-09-03",
    dateLabel:"3 сентября",
    point:"Корабельная 1",
    rate:3000,
    base:3000,
    tariffBase:3000,
    manual:false,
    diverged:false,
    ...extra
  };
}

function run({entries=[entry()],shifts=[shift()],payouts=[]}={}){
  return reviewPeriod({
    entries,
    shifts,
    payoutsFor:()=>payouts,
    today:TODAY
  });
}

test("чистый период не выдумывает поводов",()=>{
  const result=run();

  assert.equal(result.findings.length,0);
  assert.equal(result.employees,1);
  assert.equal(result.ready,1);
  assert.equal(result.troubled,0);
});

test("смена без ставки — это ошибка, а не малая сумма",()=>{
  const result=run({
    shifts:[shift({rate:0})]
  });

  assert.equal(result.findings.length,1);
  assert.equal(result.findings[0].kind,"shift_without_rate");
  assert.equal(result.findings[0].severity,"error");
  assert.equal(result.findings[0].target.type,"shift");
  assert.equal(result.findings[0].target.id,"s-1");
});

test("ручная сумма рядом с тарифом вопросов не вызывает",()=>{
  const close=run({
    shifts:[shift({manual:true,base:3200,tariffBase:3000})]
  });

  assert.equal(close.findings.length,0);

  const far=run({
    shifts:[shift({manual:true,base:9000,tariffBase:3000})]
  });

  assert.equal(far.findings.length,1);
  assert.equal(far.findings[0].kind,"manual_amount");
});

test("расхождение со ставкой и будущая смена видны отдельно",()=>{
  const result=run({
    shifts:[
      shift({id:"s-diverged",diverged:true}),
      shift({id:"s-future",date:"2026-09-30",dateLabel:"30 сентября"})
    ]
  });

  const kinds=result.findings.map(item=>item.kind).sort();

  assert.deepEqual(kinds,["future_shift","stale_rate"]);
});

test("переплата и частичная выплата различаются",()=>{
  const over=run({
    entries:[entry({paid:7000})],
    payouts:[{amount:7000}]
  });

  assert.equal(
    over.findings.some(item=>item.kind==="overpaid"),
    true
  );

  const partial=run({
    entries:[entry({paid:2000})],
    payouts:[{amount:2000}]
  });

  assert.deepEqual(
    partial.findings.map(item=>item.kind),
    ["partially_paid"]
  );
});

test("без единой выплаты недоплата ещё не находка",()=>{
  const result=run({
    entries:[entry({paid:0})],
    payouts:[]
  });

  assert.equal(result.findings.length,0);
});

test("отрицательная сумма к выплате — ошибка",()=>{
  const result=run({
    entries:[entry({due:-500,fine:6500})]
  });

  assert.equal(
    result.findings.some(item=>item.kind==="negative_due"),
    true
  );
});

test("сводка считает людей, а не находки",()=>{
  const result=run({
    entries:[
      entry({employeeId:"e-1"}),
      entry({employeeId:"e-2",employeeName:"Роман Белов"}),
      entry({employeeId:"e-3",employeeName:"Ким Ли"})
    ],
    shifts:[
      shift({id:"a",employeeId:"e-2",rate:0}),
      shift({id:"b",employeeId:"e-2",diverged:true})
    ]
  });

  assert.equal(result.employees,3);
  assert.equal(result.troubled,1);
  assert.equal(result.ready,2);
  assert.equal(result.findings.length,2);
});
