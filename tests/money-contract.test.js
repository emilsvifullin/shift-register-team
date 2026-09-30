import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMoney,
  roundMoney
} from "../src/format.js";

import {
  buildPayrollReport
} from "../src/payroll-report.js";

import {
  payrollReportDocument
} from "../src/payroll-pdf.js";

import {
  resolvedAmount
} from "../src/payroll-recalc.js";

import {
  paymentProgress
} from "../src/workflow.js";

import {
  mapServerShift
} from "../src/team-domain.js";

import {
  buildPeriodEntries,
  periodFingerprint
} from "../src/payroll-period.js";

/*
  Денежный контракт проекта — копейки, во всех слоях одинаково.

  База хранит numeric(12,2), ввод принимает два знака, сервер отказывает
  третьему. Тесты держат, что ни один слой между ними не округляет до
  рубля сам: раньше это делали отчёт, PDF, проверка периода и
  перерасчёт, каждый по-своему.
*/

test("округление денег — до копейки и без двоичных хвостов",()=>{
  assert.equal(roundMoney(1.005),1.01);
  assert.equal(roundMoney(0.1+0.2),0.3);
  assert.equal(roundMoney(1500.5),1500.5);
  assert.equal(roundMoney(-0.001),0);
  assert.ok(Object.is(roundMoney(-0.001),0));
  assert.equal(roundMoney("abc"),0);
});

test("отчёт и документ сохраняют копейки",()=>{
  const report=buildPayrollReport({
    periodLabel:"1–15",
    monthLabel:"сентябрь 2026",
    statusLabel:"закрыто",
    generatedAt:"21 сентября 2026, 12:00",
    rows:[{
      employeeId:"e-1",
      employeeName:"Марина Абрамова",
      shifts:1,
      base:3000,
      bonus:250.5,
      fine:0,
      corrections:0,
      due:3250.5,
      paid:1500.25
    }]
  });

  assert.equal(report.lines[0].accrued,3250.5);
  assert.equal(report.lines[0].paid,1500.25);
  assert.equal(report.lines[0].unpaid,1750.25);
  assert.equal(report.totals.accrued,3250.5);

  const html=payrollReportDocument(report,{detailed:false});

  assert.match(html,/3 250,50 ₽/);
  assert.match(html,/1 750,25 ₽/);
});

test("ручная сумма перерасчёта — в копейках, третий знак не применяется",()=>{
  assert.equal(
    resolvedAmount({mode:"manual",manualAmount:"3100,50"}),
    3100.5
  );

  assert.equal(
    resolvedAmount({mode:"manual",manualAmount:"3100,505"}),
    null
  );
});

test("выплаченное полностью не оставляет остатка из двоичной арифметики",()=>{
  const progress=paymentProgress(0.3,[
    {amount:0.1},
    {amount:0.2}
  ]);

  assert.equal(progress.remaining,0);
  assert.equal(progress.overpaid,0);
  assert.equal(progress.complete,true);
});

test("сумма на экране с копейками и без",()=>{
  assert.equal(formatMoney(1500),"1 500 ₽");
  assert.equal(formatMoney(1500.5),"1 500,50 ₽");
});

/*
  Кто в периоде. Отбор повторяет сервер (private.payroll_period_entries),
  и сверку обеих держат db-tests/; здесь — сам смысл отбора.
*/
function shift({id,date,base=3000,advance=false,employeeId="e-1"}){
  return mapServerShift({
    id,
    employee_id:employeeId,
    shift_date:date,
    point_id:"p-1",
    shift_type:"main",
    shk:null,
    partial:false,
    hours:null,
    full_hours:12,
    base_amount:base,
    pricing_snapshot:{
      version:2,
      fixed:true,
      pricingType:"fixed",
      rate:base,
      fullHours:12,
      advanceEnabled:advance
    },
    employee:{id:employeeId,full_name:"",status:"active"},
    point:{id:"p-1",code:"p1",name:"Коммунальная 10",active:true,advance_enabled:advance},
    bonuses:[],
    penalties:[]
  });
}

test("перенос аванса держит сотрудника во второй половине, подменного — нет",()=>{
  const employees=[
    {id:"e-1",full_name:"Марина"},
    {id:"e-sub",full_name:"Подменный",is_system_substitute:true}
  ];

  const shifts=[
    ...[1,2,3,4,5,6,7,8].map(day=>shift({
      id:`s-${day}`,
      date:`2026-09-0${day}`,
      advance:true
    })),
    shift({id:"s-sub",date:"2026-09-20",employeeId:"e-sub"})
  ];

  const second=buildPeriodEntries({
    ym:"2026-09",
    kind:"second_half",
    employees,
    shifts,
    payoutRows:[]
  });

  assert.deepEqual(
    second.map(entry=>[entry.employeeId,entry.shifts,entry.due]),
    [["e-1",0,4000]]
  );

  assert.equal(
    periodFingerprint(second),
    "e-1:0:4000:0:0:4000:0"
  );
});
