import {test,expect} from "@playwright/test";
import {ADMIN_SEED,openApp} from "./support/supabase-stub.mjs";
import {settleScreen} from "./support/settle.mjs";

test.use({viewport:{width:390,height:844},hasTouch:true,colorScheme:"dark"});

function emptyPayrollSeed(){
  const seed=structuredClone(ADMIN_SEED);
  seed.shifts=[];
  seed.employee_points=[];
  seed.points.forEach(point=>{point.advance_enabled=false;});
  return seed;
}

async function openTeamStats(page){
  await openApp(page,{seed:emptyPayrollSeed()});
  await page.locator("#tab-stats").click();
  await expect(page.locator("#statsEmployeeOpen")).toContainText("Все сотрудники");
  await expect(page.locator("[data-payout-advance]")).toHaveCount(0);
}

async function startAdvance(page,employee="employee-2"){
  await page.locator("#statsEmployeeOpen").click();
  const choices=page.locator('[data-key="statsEmployeeReveal"]');
  await expect.poll(()=>choices.evaluate(node=>node.getAnimations().length)).toBe(0);
  await choices.locator(`[data-stats-employee="${employee}"]`).click();
  await page.locator('[data-payout-toggle="first_half"]').click();
  const reveal=page.locator('[data-key="payoutReveal-first_half"]');
  await expect.poll(()=>reveal.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.getByRole('button',{name:'Отметить выплату',exact:true}).click();
  await expect(page.locator('[data-payout-mode="regular"]')).toHaveAttribute("aria-pressed","true");
  await page.locator('[data-payout-mode="advance"]').click();
  await expect(page.locator("#payoutAmount")).toBeVisible();
}

test("the existing payout entry records an advance before the first shift",async({page},testInfo)=>{
  await openTeamStats(page);
  await startAdvance(page);
  await expect(page.locator("#statsEmployeeOpen")).toContainText("Роман Белов");
  await expect(page.locator(".payout-advance-note")).toContainText("наличие смен не ограничивают аванс");
  await page.locator("#payoutAmount").fill("10000");
  await page.locator("#payoutComment").fill("До первой смены");
  await page.locator("[data-payout-save]").click();
  await expect(page.locator("#appConfirmDetail")).toContainText("Роман Белов");
  await expect(page.locator("#appConfirmDetail")).toContainText("10 000 ₽");
  await page.locator("#appConfirmOk").click();
  await expect(page.locator("#toast")).toContainText("Аванс сохранён");
  const record=page.locator(".payout-record");
  await expect(record).toContainText("Аванс");
  await expect(record).toContainText("До первой смены");
  expect(await page.evaluate(()=>({
    shifts:globalThis.__stubDb.shifts.length,
    payouts:globalThis.__stubDb.employee_payouts.map(item=>({
      employee:item.employee_id,month:item.period_month,kind:item.payout_kind,
      amount:item.amount,isAdvance:item.is_advance,comment:item.comment
    }))
  }))).toEqual({shifts:0,payouts:[{
    employee:"employee-2",month:"2026-09-01",kind:"first_half",
    amount:10000,isAdvance:true,comment:"До первой смены"
  }]});
  const geometry=await record.evaluate(row=>{
    const bounds=row.getBoundingClientRect();
    const amount=row.querySelector("b").getBoundingClientRect();
    const actions=row.querySelector(".payout-record-actions").getBoundingClientRect();
    return {
      overflow:document.documentElement.scrollWidth>innerWidth,
      contained:amount.left>=bounds.left && actions.right<=bounds.right+1,
      sameRow:Math.abs((amount.top+amount.bottom-actions.top-actions.bottom)/2)<1
    };
  });
  expect(geometry).toEqual({overflow:false,contained:true,sameRow:true});
  await record.scrollIntoViewIfNeeded();
  await settleScreen(page);
  await page.screenshot({path:testInfo.outputPath("advance-team-discovery.png")});
});

test("switching payment modes preserves amount, comment and payout date",async({page})=>{
  await openTeamStats(page);
  await startAdvance(page,"employee-1");
  await page.locator("#payoutAmount").fill("12345,67");
  await page.locator("#payoutComment").fill("Согласованный аванс");
  const paidOn=await page.locator("[data-payout-date-open]").textContent();
  await page.locator('[data-payout-mode="regular"]').click();
  await page.locator('[data-payout-mode="advance"]').click();
  await expect(page.locator("#payoutAmount")).toHaveValue("12345,67");
  await expect(page.locator("#payoutComment")).toHaveValue("Согласованный аванс");
  await expect(page.locator('[data-payout-mode="advance"]')).toHaveAttribute("aria-pressed","true");
  await expect(page.locator("[data-payout-date-open]")).toHaveText(paidOn);
  await expect(page.locator(".payout-editor")).toHaveCount(1);
  expect(await page.evaluate(()=>globalThis.__stubDb.employee_payouts.length)).toBe(0);
});

test("a pending advance disables cancellation and editing and sends one original payment",async({page})=>{
  await openTeamStats(page);
  await startAdvance(page);
  await page.locator("#payoutAmount").fill("10000");
  await page.locator("#payoutComment").fill("Выдано сотруднику");
  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient();
    const rpc=client.rpc.bind(client);
    globalThis.__advanceDiscoveryWrites=[];
    client.rpc=async(name,args)=>{
      if(name==="admin_save_employee_payout_v2"){
        globalThis.__advanceDiscoveryWrites.push(structuredClone(args));
        await new Promise(resolve=>{globalThis.__releaseDiscoveryAdvance=resolve;});
      }
      return rpc(name,args);
    };
  });
  await page.locator("[data-payout-save]").click();
  await page.locator("#appConfirmOk").click();
  await expect.poll(()=>page.evaluate(()=>globalThis.__advanceDiscoveryWrites.length)).toBe(1);
  await expect(page.locator(".payout-editor")).toHaveAttribute("aria-busy","true");
  for(const selector of ["#payoutAmount","#payoutComment","[data-payout-date-open]","[data-payout-cancel]","[data-payout-save]",'[data-payout-mode="regular"]','[data-payout-mode="advance"]']){
    await expect(page.locator(selector)).toBeDisabled();
  }
  // A synthetic event deliberately bypasses the native disabled-button
  // behaviour to verify the action guards as well as the markup.
  await page.locator("[data-payout-cancel]").dispatchEvent("click");
  await page.locator("[data-payout-date-open]").dispatchEvent("click");
  await page.locator("[data-payout-save]").dispatchEvent("click");
  await expect(page.locator("#payoutAmount")).toHaveValue("10000");
  await expect(page.locator("#payoutComment")).toHaveValue("Выдано сотруднику");
  await expect(page.locator("#datePicker")).not.toHaveClass(/\bon\b/);
  expect(await page.evaluate(()=>globalThis.__advanceDiscoveryWrites.length)).toBe(1);
  await page.evaluate(()=>globalThis.__releaseDiscoveryAdvance());
  await expect(page.locator("#toast")).toContainText("Аванс сохранён");
  await expect(page.locator("#payoutAmount")).toHaveCount(0);
  expect(await page.evaluate(()=>({
    calls:globalThis.__advanceDiscoveryWrites.length,
    amount:globalThis.__stubDb.employee_payouts[0].amount,
    comment:globalThis.__stubDb.employee_payouts[0].comment,
    employee:globalThis.__stubDb.employee_payouts[0].employee_id,
    count:globalThis.__stubDb.employee_payouts.length
  }))).toEqual({calls:1,amount:10000,comment:"Выдано сотруднику",employee:"employee-2",count:1});
});
