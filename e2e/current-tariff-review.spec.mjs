import {test,expect} from "@playwright/test";
import {ADMIN_SEED,openApp} from "./support/supabase-stub.mjs";

test.use({viewport:{width:390,height:844}});

function seed(missing){
  const source=structuredClone(ADMIN_SEED);
  const point=source.points[0];
  source.point_tariffs=source.point_tariffs.filter(item=>item.point_id!==point.id);
  if(!missing){
    source.point_tariffs.push({id:"limited-tariff",point_id:point.id,effective_from:"2026-01-01",pricing_type:"shk_tiers",fixed_rate:null,shk_tiers:[{up_to:650,rate:3000}]});
  }
  source.shifts=[{
    id:"saved-shift",employee_id:"employee-1",point_id:point.id,
    shift_date:"2026-09-03",shift_type:"main",shk:900,partial:false,
    hours:null,full_hours:12,base_amount:3000,
    pricing_snapshot:{version:2,fixed:false,pricingType:"shk_tiers",rate:3000,fullHours:12,advanceEnabled:true},
    note:"",employee:{...source.employees[0]},point:{...point},bonuses:[],penalties:[]
  }];
  return source;
}

for(const missing of [false,true]){
  test(missing
    ? "a saved rate does not hide the absence of a current tariff"
    : "900 items against a current last tier of 650 is visible in review without changing the saved money",
  async({page})=>{
    await openApp(page,{seed:seed(missing)});
    await page.locator("#tab-stats").click();
    const period=page.locator(".payroll-period").first();
    await period.locator("[data-payout-toggle]").click();
    const review=period.locator("[data-period-review]");
    await expect(review).toContainText("Вопросы по 1 из 1");
    await review.click();
    const finding=period.locator(".payroll-finding").filter({hasText:"Не удаётся рассчитать по текущему тарифу"});
    await expect(finding).toBeVisible();
    await finding.click();
    await expect(page.locator("#sheet")).toHaveClass(/\bon\b/);
    await expect(page.locator(".shift-tariff-note")).toContainText("Не удаётся рассчитать по текущему тарифу");
    await expect(page.locator(".shift-tariff-note")).toContainText("Сохранённая сумма не изменена");
    if(!missing){
      await expect(page.locator(".shift-tariff-note")).toContainText("900 ШК выше последней границы тарифа (650)");
    }
    await expect(page.locator("#sheetBody")).toContainText("3 000");
    expect(await page.evaluate(()=>({
      saved:globalThis.__stubDb.saved_shifts.length,
      base:globalThis.__stubDb.shifts[0].base_amount,
      rate:globalThis.__stubDb.shifts[0].pricing_snapshot.rate,
      reprices:globalThis.__stubCalls.filter(item=>item.name==="admin_reprice_shift_v2").length
    }))).toEqual({saved:0,base:3000,rate:3000,reprices:0});
  });
}


test("an employee sees saved shift pricing without a false current-tariff warning",async({page})=>{
  const employeeSeed=seed(false);
  employeeSeed.profile={id:"user-1",role:"employee"};
  employeeSeed.account={...employeeSeed.account,id:"user-1"};
  await openApp(page,{seed:employeeSeed});
  await page.locator(".shift-scroll .sh").first().click();
  await expect(page.locator("#sheet")).toHaveClass(/\bon\b/);
  await expect(page.locator("#sheetBody")).toContainText("3 000");
  await expect(page.locator(".shift-tariff-note")).toHaveCount(0);
  expect(await page.evaluate(()=>globalThis.__stubDb.saved_shifts.length)).toBe(0);
});
