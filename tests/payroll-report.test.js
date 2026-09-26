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

/*
  Строка свода должна сходиться на глаз.

  Колонка «Корректировки» показывала деньги, уже включённые в «За смены»:
  26 400 и рядом 2 400, а в «Начислено» снова 26 400. Читатель
  зарплатного документа складывает то, что стоит в ряд, и первое, что он
  обнаруживал, — что документ не сходится.
*/
test(
  "свод с корректировками раскладывается на слагаемые",
  ()=>{
    const built=report([
      row({
        employeeName:"Галина",
        shifts:8,
        base:26400,
        bonus:0,
        fine:0,
        corrections:2400,
        due:26400,
        paid:0
      })
    ]);

    const line=built.lines[0];

    assert.equal(line.tariffBase,24000);
    assert.equal(line.corrections,2400);

    assert.equal(
      line.tariffBase+
        line.corrections+
        line.bonus-
        line.fine,
      line.accrued
    );

    assert.equal(built.totals.tariffBase,24000);

    const html=payrollReportDocument(built,{detailed:false});

    assert.match(html,/По тарифу/);
    assert.match(html,/Корректировки/);
    assert.doesNotMatch(html,/<th>За смены<\/th>/);

    /* Без корректировок делить сумму надвое незачем. */
    const plain=payrollReportDocument(
      report([row({corrections:0})]),
      {detailed:false}
    );

    assert.match(plain,/За смены/);
    assert.doesNotMatch(plain,/По тарифу/);
    assert.doesNotMatch(plain,/Корректировки/);
  }
);

/* Корректировка в минус остаётся вычитанием и по знаку, и по арифметике. */
test(
  "отрицательная корректировка показывается со знаком минус",
  ()=>{
    const built=report([
      row({
        base:5400,
        bonus:0,
        fine:0,
        corrections:-600,
        due:5400,
        paid:0
      })
    ]);

    assert.equal(built.lines[0].tariffBase,6000);

    const html=payrollReportDocument(built,{detailed:false});

    assert.match(html,/− 600/);
  }
);

/*
  Период закрыли на одну сумму, а потом расчёт изменили — через
  подтверждение и с записью в историю. Документ обязан сказать об этом
  сам: иначе читатель сверяет его с экраном выплат и не сходится.
*/
test(
  "документ сообщает, на какую сумму период был закрыт",
  ()=>{
    const built=buildPayrollReport({
      periodLabel:"1–15",
      monthLabel:"декабрь 2026",
      statusLabel:"закрыто",
      generatedAt:"26 сентября 2026, 10:40",
      closedAtDue:8500,
      rows:[
        row({
          shifts:2,
          base:8000,
          bonus:1500,
          fine:0,
          corrections:0,
          due:9500,
          paid:6500
        })
      ]
    });

    assert.equal(built.closedAtDue,8500);
    assert.equal(built.totals.accrued,9500);
    assert.equal(built.totals.unpaid,3000);

    const html=payrollReportDocument(built,{detailed:false});

    assert.match(html,/Период закрыт на 8\s500\s₽/);
    assert.match(html,/расчёт изменили/);
  }
);

/* Пока расчёт не менялся, лишней строки в документе нет. */
test(
  "без расхождения со снимком документ ничего не добавляет",
  ()=>{
    const html=payrollReportDocument(
      report([row()]),
      {detailed:false}
    );

    assert.doesNotMatch(html,/Период закрыт на/);
  }
);
