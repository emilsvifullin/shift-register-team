import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPayrollReport,
  reportFileName
} from "../src/payroll-report.js";

import {
  payrollReportDocument
} from "../src/payroll-pdf.js";

/*
  Отчёт ничего не считает сам: он получает те же строки, которыми живёт
  период, и раскладывает их по колонкам. Тесты проверяют именно это —
  что суммы доходят без изменений, что итог сходится и что документ
  показывает те же цифры.
*/

function row(extra={}){
  return {
    employeeId:"e-1",
    employeeName:"Марина Абрамова",
    shifts:2,
    base:6000,
    bonus:500,
    fine:200,
    corrections:0,
    due:6300,
    paid:6300,
    ...extra
  };
}

function report(rows,employeeId=null){
  return buildPayrollReport({
    periodLabel:"1–15",
    monthLabel:"сентябрь 2026",
    statusLabel:"закрыто",
    generatedAt:"21 сентября 2026, 12:00",
    rows,
    employeeId
  });
}

test("строки доходят до отчёта без пересчёта",()=>{
  const built=report([row()]);

  assert.equal(built.lines.length,1);
  assert.equal(built.lines[0].base,6000);
  assert.equal(built.lines[0].bonus,500);
  assert.equal(built.lines[0].fine,200);
  assert.equal(built.lines[0].accrued,6300);
  assert.equal(built.lines[0].paid,6300);
  assert.equal(built.lines[0].unpaid,0);
  assert.equal(built.lines[0].overpaid,0);
});

test("остаток различает недоплату и переплату",()=>{
  const under=report([row({paid:4000})]);

  assert.equal(under.lines[0].unpaid,2300);
  assert.equal(under.lines[0].overpaid,0);

  const over=report([row({paid:7000})]);

  assert.equal(over.lines[0].unpaid,0);
  assert.equal(over.lines[0].overpaid,700);
});

test("итог складывается из строк",()=>{
  const built=report([
    row({employeeId:"e-1"}),
    row({employeeId:"e-2",employeeName:"Роман Белов",paid:3000})
  ]);

  assert.equal(built.totals.employees,2);
  assert.equal(built.totals.shifts,4);
  assert.equal(built.totals.accrued,12600);
  assert.equal(built.totals.paid,9300);
  assert.equal(built.totals.unpaid,3300);
});

test("отчёт по одному сотруднику оставляет только его",()=>{
  const built=report(
    [
      row({employeeId:"e-1"}),
      row({employeeId:"e-2",employeeName:"Роман Белов"})
    ],
    "e-2"
  );

  assert.equal(built.lines.length,1);
  assert.equal(built.lines[0].employeeName,"Роман Белов");
  assert.equal(built.totals.employees,1);
});

test("имя файла говорит, что внутри",()=>{
  assert.equal(
    reportFileName({
      monthLabel:"сентябрь 2026",
      periodLabel:"1–15",
      employeeName:"",
      detailed:false
    }),
    "Shift Register — зарплата — сентябрь 2026 1–15"
  );

  assert.match(
    reportFileName({
      monthLabel:"сентябрь 2026",
      periodLabel:"1–15",
      employeeName:"Марина Абрамова",
      detailed:true
    }),
    /подробно.*Марина Абрамова/
  );
});

test("документ показывает те же суммы, что и отчёт",()=>{
  const built=report([row({paid:4000})]);
  const html=payrollReportDocument(built,{detailed:false});

  assert.match(html,/Shift Register/);
  assert.match(html,/сентябрь 2026/);
  assert.match(html,/6 300 ₽/);
  assert.match(html,/2 300 ₽/);

  /* «К выплате» рядом с «Начислено» быть не должно: это одна цифра. */
  assert.ok(!/К выплате/.test(html));
});

test("колонка корректировок появляется только при них",()=>{
  const without=payrollReportDocument(
    report([row()]),
    {detailed:false}
  );

  assert.ok(!/Корректировки/.test(without));

  const with_=payrollReportDocument(
    report([row({corrections:500})]),
    {detailed:false}
  );

  assert.match(with_,/Корректировки/);
});

test("подробный документ объясняет сумму по сменам",()=>{
  const built=report([
    row({
      detail:{
        shifts:[
          {
            dateLabel:"3 сентября",
            point:"Корабельная 1",
            typeLabel:"Основная",
            rate:3300,
            rateSource:"employee",
            base:3300,
            manual:false
          }
        ],
        bonuses:[{label:"3 сентября · за объём",amount:500}],
        fines:[],
        payouts:[{label:"25 сентября",amount:6300}]
      }
    })
  ]);

  const html=payrollReportDocument(built,{detailed:true});

  assert.match(html,/Корабельная 1/);
  assert.match(html,/своя ставка/);
  assert.match(html,/Премии/);
  assert.match(html,/Выплаты/);

  /* Пустого блока штрафов быть не должно. */
  assert.ok(!/<h4>Штрафы<\/h4>/.test(html));
});
