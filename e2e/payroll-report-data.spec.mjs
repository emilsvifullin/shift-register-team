import {expect,test} from "@playwright/test";
import {ADMIN_SEED,openApp} from "./support/supabase-stub.mjs";

function reportSeed(){
  const seed=structuredClone(ADMIN_SEED);
  const point={...seed.points[1],advance_enabled:true,fixed_rate:10000};
  seed.points[1]=point;
  seed.shifts=[1,2,3].map((day,index)=>({
    id:`report-${index}`,employee_id:"employee-1",shift_date:`2026-09-0${day}`,
    point_id:point.id,shift_type:"main",shk:null,partial:false,hours:null,full_hours:12,
    base_amount:index===2 ? 12000 : 10000,
    base_amount_override_reason:index===2 ? "Согласовано" : null,
    pricing_snapshot:{version:2,fixed:true,pricingType:"fixed",rate:10000,fullHours:12,advanceEnabled:true},
    note:"",employee:{...seed.employees[0]},point:{...point},
    bonuses:index===0 ? [{id:"bonus-report",amount:700,comment:"Обучение"}] : [],
    penalties:index===0 ? [{id:"fine-default",amount:400,comment:"Недостача"}]
      : index===1 ? [{id:"fine-target",amount:25000,comment:"Удержать из аванса",payout_kind:"first_half"}] : []
  }));
  return seed;
}
async function reportFor(page,context,index){
  await page.locator("#tab-stats").click();
  const period=page.locator(".payroll-period").nth(index);
  await period.locator("[data-payout-toggle]").click();
  const [report]=await Promise.all([
    context.waitForEvent("page"),
    period.locator("[data-report-detailed]").first().click()
  ]);
  await report.waitForLoadState("domcontentloaded");
  return report;
}
function amount(value){return Number(value.replace(/[^\d,−-]/g,"").replace(",",".").replace("−","-"));}
async function detailAmounts(report){
  const person=report.locator(".person").first();
  const shifts=await person.locator("table").first().locator("tbody tr td:last-child").allTextContents();
  const list=async title=>{
    const table=person.locator(`h4:text-is("${title}") + table`);
    return await table.count() ? (await table.locator("td:last-child").allTextContents()).map(amount) : [];
  };
  return {
    base:shifts.reduce((sum,value)=>sum+amount(value),0),
    bonus:(await list("Премии")).reduce((sum,value)=>sum+value,0),
    fine:(await list("Штрафы")).reduce((sum,value)=>sum+value,0)
  };
}

test("detailed report explains capped base, carried bonus and split targeted fines using the actual payout",async({page,context})=>{
  await openApp(page,{seed:reportSeed()});
  const first=await reportFor(page,context,0);
  expect(await detailAmounts(first)).toEqual({base:20000,bonus:0,fine:20000});
  await expect(first.locator(".person")).toContainText("Удержать из аванса");
  await expect(first.locator(".person")).not.toContainText("Обучение");
  await first.close();

  // The first period stays expanded; open the second one independently.
  const secondPeriod=page.locator(".payroll-period").nth(1);
  await secondPeriod.locator("[data-payout-toggle]").click();
  const [second]=await Promise.all([
    context.waitForEvent("page"),
    secondPeriod.locator("[data-report-detailed]").first().click()
  ]);
  await second.waitForLoadState("domcontentloaded");
  expect(await detailAmounts(second)).toEqual({base:12000,bonus:700,fine:5400});
  await expect(second.locator(".person")).toContainText("Обучение");
  await expect(second.locator(".person")).toContainText("Недостача");
  await expect(second.locator(".person")).toContainText("перенос из выплаты 1–15");
  await expect(second.locator(".person")).toContainText("7 300 ₽");
  const summaryTable=second.locator("body > table");
  await expect(summaryTable.locator("th").nth(3)).toHaveText("Корректировки");
  await expect(summaryTable.locator("tbody tr td").nth(3)).toContainText("2 000 ₽");
  await second.close();
});

test("a closed snapshot-only employee remains in the real report with current zero",async({page,context})=>{
  const seed=reportSeed();
  seed.shifts=[];
  seed.payroll_periods=[{id:"closed-report",period_month:"2026-09-01",payout_kind:"first_half",status:"closed"}];
  seed.payroll_period_entries=[{id:"old-entry",period_id:"closed-report",employee_id:"employee-1",shifts:2,base:6000,bonus:0,fine:0,due:6000,paid:0,detail:{}}];
  await openApp(page,{seed});
  const report=await reportFor(page,context,0);
  await expect(report.locator("body")).toContainText("Период закрыт на 6 000 ₽");
  await expect(report.locator(".person")).toContainText("Марина Абрамова");
  await expect(report.locator(".person")).toContainText("Начислено 0 ₽");
  await expect(report.locator(".person table")).toHaveCount(0);
  await report.close();
});
