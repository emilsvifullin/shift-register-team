import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecalcPlan,
  invalidRows,
  recalcTotals,
  resolvedAmount
} from "../src/payroll-recalc.js";

/*
  План перерасчёта — это то, что человек видит до применения. Проверяется
  его отбор и арифметика: план не должен показывать строки, где ничего не
  меняется, и должен считать разницу по выбранным состояниям, а не по
  предложенным.
*/

function shift(extra={}){
  return {
    id:"s-1",
    date:"2026-09-03",
    dateLabel:"3 сентября",
    employeeId:"e-1",
    employeeName:"Марина Абрамова",
    point:"Корабельная 1",
    base:3000,
    manual:false,
    ...extra
  };
}

test("в план попадают только смены, у которых сумма меняется",()=>{
  const rows=buildRecalcPlan({
    shifts:[
      shift({id:"changes",base:3000}),
      shift({id:"same",base:3300})
    ],
    priceOf:()=>3300
  });

  assert.deepEqual(
    rows.map(row=>row.id),
    ["changes"]
  );

  assert.equal(rows[0].current,3000);
  assert.equal(rows[0].next,3300);
  assert.equal(rows[0].diff,300);
});

test("смену без условий на дату план обходит",()=>{
  const rows=buildRecalcPlan({
    shifts:[shift()],
    priceOf:()=>{
      throw new Error("tariff_not_found_for_date");
    }
  });

  assert.equal(rows.length,0);
});

test("ручная сумма по умолчанию остаётся как есть",()=>{
  const rows=buildRecalcPlan({
    shifts:[
      shift({id:"auto"}),
      shift({id:"manual",manual:true})
    ],
    priceOf:()=>3300
  });

  const byId=Object.fromEntries(
    rows.map(row=>[row.id,row])
  );

  assert.equal(byId.auto.mode,"apply");
  assert.equal(byId.manual.mode,"skip");
  assert.equal(byId.manual.wasManual,true);
});

test("итог считает по выбранным состояниям",()=>{
  const rows=buildRecalcPlan({
    shifts:[
      shift({id:"a"}),
      shift({id:"b"}),
      shift({id:"c"})
    ],
    priceOf:()=>3300
  });

  assert.equal(recalcTotals(rows).diff,900);

  rows[1].mode="skip";
  assert.equal(recalcTotals(rows).diff,600);

  rows[2].mode="manual";
  rows[2].manualAmount="4000";

  const totals=recalcTotals(rows);

  assert.equal(totals.apply,1);
  assert.equal(totals.skip,1);
  assert.equal(totals.manual,1);
  assert.equal(totals.diff,300+1000);
});

test("незаполненная своя сумма не применяется",()=>{
  const rows=buildRecalcPlan({
    shifts:[shift()],
    priceOf:()=>3300
  });

  rows[0].mode="manual";
  rows[0].manualAmount="";

  assert.equal(resolvedAmount(rows[0]),null);
  assert.equal(invalidRows(rows).length,1);

  rows[0].manualAmount="4 000";
  assert.equal(resolvedAmount(rows[0]),null);

  rows[0].manualAmount="4000";
  assert.equal(resolvedAmount(rows[0]),4000);
  assert.equal(invalidRows(rows).length,0);
});

test("оставленная смена не двигает итог",()=>{
  const rows=buildRecalcPlan({
    shifts:[shift()],
    priceOf:()=>3300
  });

  rows[0].mode="skip";

  assert.equal(resolvedAmount(rows[0]),null);
  assert.equal(recalcTotals(rows).diff,0);
});
