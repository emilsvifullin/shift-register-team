import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import {calc,inMonth as domainInMonth} from "../src/domain.js";
import {mapServerShift,rateForTariff,shiftRateForDate} from "../src/team-domain.js";
import {periodKindForDate} from "../src/payroll-period.js";
import {reviewPeriod} from "../src/payroll-review.js";

const app=fs.readFileSync(new URL("../src/app.js",import.meta.url),"utf8");
const slice=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
const functions=slice("function currentTariffFor(value){","/*\n  Пересчёт предлагается")+slice("function payrollReviewShifts(kind){","function payrollPeriodReview(kind,entries){");

function run({tariffs=[{id:"tariff",point_id:"p1",effective_from:"2026-01-01",pricing_type:"shk_tiers",shk_tiers:[{up_to:650,rate:3000}]}],employeeRates=[]}={}){
  const saved=mapServerShift({
    id:"shift",employee_id:"employee",point_id:"p1",shift_date:"2026-09-03",
    shift_type:"main",shk:900,partial:false,full_hours:12,base_amount:3000,
    pricing_snapshot:{version:2,rate:3000,fixed:false,pricingType:"shk_tiers",fullHours:12,advanceEnabled:true},
    point:{name:"ПВЗ",code:"p1",advance_enabled:true},bonuses:[],penalties:[]
  });
  const before=JSON.stringify(saved);
  const c={
    Error,Number,Boolean,calc,rateForTariff,shiftRateForDate,
    cursor:"2026-09",shifts:[saved],
    inMonth:(ym,shifts)=>domainInMonth(shifts,ym),periodKindForDate,
    shortDateLabel:value=>value,teamData:{tariffs,employeeRates}
  };
  vm.createContext(c);
  vm.runInContext(functions,c);
  const shifts=c.payrollReviewShifts("first_half");
  const result=reviewPeriod({
    entries:[{employeeId:"employee",employeeName:"Сотрудник",due:3000,paid:0}],
    shifts,payoutsFor:()=>[],today:"2026-09-21"
  });
  assert.equal(JSON.stringify(saved),before,"review must preserve the saved pricing and amounts");
  return {shifts,result};
}

test("actual 900-item saved shift with a current 650 limit produces an actionable finding",()=>{
  const {shifts,result}=run();
  assert.equal(result.ready,0);
  assert.equal(result.findings[0].kind,"current_tariff_unavailable");
  assert.match(result.findings[0].title,/Не удаётся рассчитать по текущему тарифу/);
  assert.match(shifts[0].currentTariffError,/900 ШК.*650/);
  assert.equal(shifts[0].base,3000);
  assert.equal(shifts[0].rate,3000);
  assert.equal(shifts[0].diverged,false);
});

test("no applicable current tariff is distinct from a matching saved tariff",()=>{
  const {result,shifts}=run({tariffs:[]});
  assert.equal(result.findings[0].kind,"current_tariff_unavailable");
  assert.match(shifts[0].currentTariffError,/тариф/);
});

test("a valid unchanged tariff does not produce a phantom finding",()=>{
  const {result}=run({tariffs:[{point_id:"p1",effective_from:"2026-01-01",pricing_type:"fixed",fixed_rate:3000}]});
  assert.equal(result.ready,1);
  assert.equal(result.findings.length,0);
});

test("a valid changed tariff retains the ordinary stale-rate finding",()=>{
  const {result}=run({tariffs:[{point_id:"p1",effective_from:"2026-01-01",pricing_type:"fixed",fixed_rate:4000}]});
  assert.equal(result.findings.length,1);
  assert.equal(result.findings[0].kind,"stale_rate");
});

test("a valid personal rate takes precedence over unusable point tiers",()=>{
  const {result}=run({employeeRates:[{id:"own-rate",employee_id:"employee",point_id:"p1",effective_from:"2026-01-01",pricing_type:"fixed",fixed_rate:3000}]});
  assert.equal(result.findings.length,0);
});
