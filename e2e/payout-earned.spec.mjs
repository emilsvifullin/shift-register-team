import {test,expect} from "@playwright/test";
import {ADMIN_SEED,openApp} from "./support/supabase-stub.mjs";
import {settleScreen} from "./support/settle.mjs";

function payrollSeed({earned=3500,future=0,records=[]}={}){
  const seed=structuredClone(ADMIN_SEED);
  seed.points.forEach(point=>{point.advance_enabled=false;});
  seed.shifts=[{day:19,amount:earned},{day:25,amount:future}].filter(item=>item.amount).map(({day,amount},index)=>({
    id:`earned-shift-${index}`,employee_id:"employee-1",point_id:"point-2",shift_date:`2026-09-${day}`,
    shift_type:"main",base_amount:amount,partial:false,full_hours:12,
    pricing_snapshot:{version:2,fixed:true,pricingType:"fixed",rate:amount,fullHours:12},bonuses:[],penalties:[]
  }));
  seed.employee_payouts=records.map((record,index)=>({
    id:`issued-${index}`,employee_id:"employee-1",period_month:"2026-09-01",payout_kind:"second_half",
    amount:record.amount,is_advance:Boolean(record.isAdvance),paid_on:"2026-09-20",comment:null,
    created_at:"2026-09-20T00:00:00Z",updated_at:"2026-09-20T00:00:00Z"
  }));
  return seed;
}
async function openBalance(page,seed){
  await openApp(page,{seed});
  await page.locator("#tab-stats").click();
  await settleScreen(page);
  await page.locator("#statsEmployeeOpen").click();
  const choices=page.locator('[data-key="statsEmployeeReveal"]');
  await expect(choices).toHaveClass(/\bon\b/);
  await expect.poll(()=>choices.evaluate(element=>element.getAnimations().length)).toBe(0);
  await page.locator('[data-stats-employee="employee-1"]').click();
  await expect(page.locator("#statsEmployeeOpen")).toContainText("Марина Абрамова");
  await settleScreen(page);
  await page.locator('[data-payout-toggle="second_half"]').click();
  await expect(page.locator('[data-key="payoutReveal-second_half"]')).toHaveClass(/\bon\b/);
  await settleScreen(page);
}
const block=page=>page.locator(".payout-block.open");
async function start(page){
  await block(page).locator("[data-payout-add]").click();
  await settleScreen(page);
}
async function expectBalance(page,{earned,issued,remaining,overpaid}){
  await expect(block(page).locator("[data-payout-earned]")).toHaveText(earned);
  await expect(block(page).locator("[data-payout-issued]")).toHaveText(issued);
  await expect(block(page).locator("[data-payout-remaining]")).toHaveText(remaining);
  if(overpaid) await expect(block(page).locator("[data-payout-overpaid]")).toHaveText(overpaid);
  else await expect(block(page).locator("[data-payout-overpaid]")).toHaveCount(0);
}

test("only earned shifts permit ordinary payouts; future shifts stay forecast",async({page})=>{
  await openBalance(page,payrollSeed({earned:3500,future:8500}));
  await expectBalance(page,{earned:"3 500 ₽",issued:"0 ₽",remaining:"3 500 ₽"});
  await expect(block(page).locator("[data-payout-forecast]")).toHaveText("12 000 ₽");
  await expect(block(page).locator(".payout-source-row").filter({hasText:"25 сентября"})).toContainText("Запланировано");
  await start(page);
  await expect(page.locator('[data-payout-mode="regular"]')).toHaveAttribute("aria-pressed","true");
  await page.locator("#payoutAmount").fill("4000");
  await expect(page.locator("[data-payout-amount-error]")).toContainText("3 500 ₽");
  await expect(page.locator("[data-payout-save]")).toBeDisabled();
  await expect(page.locator('[data-payout-mode="regular"]')).toHaveAttribute("aria-pressed","true");
  // The stub models the server boundary independently of the form guard.
  const denied=await page.evaluate(async()=>{
    const {error}=await globalThis.supabase.createClient().rpc("admin_save_employee_payout_v2",{
      p_employee_id:"employee-1",p_period_month:"2026-09-01",p_payout_kind:"second_half",
      p_amount:4000,p_paid_on:"2026-09-21",p_is_advance:false,p_payout_id:null
    });
    return {error:error?.message,records:globalThis.__stubDb.employee_payouts.length};
  });
  expect(denied).toEqual({error:"payout_exceeds_due:3500",records:0});
});

test("one real advance above earned amount is recorded once and later earnings cover it",async({page})=>{
  await openBalance(page,payrollSeed({earned:3500,future:8500}));
  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient();
    const original=client.rpc.bind(client);
    globalThis.__earnedPaymentWrites=[];
    client.rpc=(name,args)=>{
      if(name==="admin_save_employee_payout_v2") globalThis.__earnedPaymentWrites.push(structuredClone(args));
      return original(name,args);
    };
  });
  await start(page);
  await page.locator("#payoutAmount").fill("10000");
  await page.locator("#payoutComment").fill("Фактически выдали 10000");
  const date=await page.locator("[data-payout-date-open]").textContent();
  await page.locator('[data-payout-mode="advance"]').click();
  await expect(page.locator("#payoutAmount")).toHaveValue("10000");
  await expect(page.locator("#payoutComment")).toHaveValue("Фактически выдали 10000");
  await expect(page.locator("[data-payout-date-open]")).toHaveText(date);
  await expect(page.locator('[data-payout-preview="issued"]')).toHaveText("10 000 ₽");
  await expect(page.locator('[data-payout-preview="remaining"]')).toHaveText("0 ₽");
  await expect(page.locator('[data-payout-preview="overpaid"]')).toHaveText("6 500 ₽");
  await page.locator("[data-payout-save]").click();
  await expect(page.locator("#appConfirmDetail")).toContainText("6 500 ₽");
  await page.locator("#appConfirmOk").click();
  await expect(page.locator("#toast")).toContainText("Аванс сохранён");
  await expectBalance(page,{earned:"3 500 ₽",issued:"10 000 ₽",remaining:"0 ₽",overpaid:"6 500 ₽"});
  const record=await page.evaluate(()=>globalThis.__stubDb.employee_payouts.map(item=>({amount:item.amount,isAdvance:item.is_advance,kind:item.payout_kind})));
  expect(record).toEqual([{amount:10000,isAdvance:true,kind:"second_half"}]);
  // The planned shift becomes worked as the business date moves forward.
  await page.clock.setFixedTime(new Date("2026-09-26T09:00:00Z"));
  await page.evaluate(()=>window.dispatchEvent(new Event("online")));
  await expectBalance(page,{earned:"12 000 ₽",issued:"10 000 ₽",remaining:"2 000 ₽"});
  await expect(block(page).locator(".payout-record")).toHaveCount(1);
  await start(page);
  await expect(page.locator('[data-payout-mode="regular"]')).toHaveAttribute("aria-pressed","true");
  await page.locator("#payoutAmount").fill("2000");
  await page.locator("[data-payout-save]").click();
  await expect(page.locator("#toast")).toContainText("Выплата сохранена");
  await expectBalance(page,{earned:"12 000 ₽",issued:"12 000 ₽",remaining:"0 ₽"});
  expect(await page.evaluate(()=>globalThis.__stubDb.employee_payouts.map(item=>[item.amount,item.is_advance]))).toEqual([[10000,true],[2000,false]]);
  const writes=await page.evaluate(()=>globalThis.__earnedPaymentWrites);
  expect(writes).toHaveLength(2);
  expect(writes[0]).toMatchObject({p_employee_id:"employee-1",p_period_month:"2026-09-01",p_payout_kind:"second_half",p_amount:10000,p_is_advance:true,p_payout_id:null,p_comment:"Фактически выдали 10000"});
  expect(writes[1]).toMatchObject({p_employee_id:"employee-1",p_period_month:"2026-09-01",p_payout_kind:"second_half",p_amount:2000,p_is_advance:false,p_payout_id:null});
});

for(const state of [
  {name:"no shifts",earned:0,future:0,records:[]},
  {name:"future shifts only",earned:0,future:12000,records:[]},
  {name:"earnings already paid",earned:12000,future:0,records:[{amount:12000}]},
  {name:"earnings covered by advance",earned:3500,future:8500,records:[{amount:10000,isAdvance:true}]}
]){
  test(`${state.name}: new entry defaults to advance and ordinary payout is unavailable`,async({page})=>{
    await openBalance(page,payrollSeed(state));
    await start(page);
    await expect(page.locator('[data-payout-mode="advance"]')).toHaveAttribute("aria-pressed","true");
    await expect(page.locator('[data-payout-mode="regular"]')).toBeDisabled();
    await expect(page.locator(".payout-editor")).toContainText("Нет суммы к выплате");
    await page.locator('[data-payout-mode="regular"]').dispatchEvent("click");
    await expect(page.locator('[data-payout-mode="advance"]')).toHaveAttribute("aria-pressed","true");
  });
}

test("an advance below earned amount stays an advance and reduces the same period balance",async({page})=>{
  await openBalance(page,payrollSeed({earned:12000,records:[{amount:2000}]}));
  await expectBalance(page,{earned:"12 000 ₽",issued:"2 000 ₽",remaining:"10 000 ₽"});
  await start(page);
  await page.locator("#payoutAmount").fill("5000");
  await page.locator('[data-payout-mode="advance"]').click();
  await expect(page.locator('[data-payout-preview="issued"]')).toHaveText("7 000 ₽");
  await expect(page.locator('[data-payout-preview="remaining"]')).toHaveText("5 000 ₽");
  await page.locator("[data-payout-save]").click();
  await expect(page.locator("#toast")).toContainText("Аванс сохранён");
  await expectBalance(page,{earned:"12 000 ₽",issued:"7 000 ₽",remaining:"5 000 ₽"});
  expect(await page.evaluate(()=>globalThis.__stubDb.employee_payouts.at(-1).is_advance)).toBe(true);
});

test("a historical ordinary overpayment can be corrected down without disguising it as an advance",async({page})=>{
  await openBalance(page,payrollSeed({earned:0,records:[{amount:10000}]}));
  await block(page).locator("[data-payout-edit]").click();
  await expect(page.locator('[data-payout-mode="regular"]')).toBeEnabled();
  await expect(page.locator('[data-payout-mode="regular"]')).toHaveAttribute("aria-pressed","true");
  await page.locator("#payoutAmount").fill("10001");
  await expect(page.locator("[data-payout-save]")).toBeDisabled();
  await page.locator("#payoutAmount").fill("9000");
  await expect(page.locator('[data-payout-preview="issued"]')).toHaveText("9 000 ₽");
  await expect(page.locator('[data-payout-preview="overpaid"]')).toHaveText("9 000 ₽");
  await page.locator("[data-payout-save]").click();
  await expect(page.locator("#toast")).toContainText("Выплата сохранена");
  expect(await page.evaluate(()=>globalThis.__stubDb.employee_payouts.map(item=>[item.amount,item.is_advance]))).toEqual([[9000,false]]);
});

// The old record must stop contributing its editing allowance as soon as
// cancellation starts, while the old form is still finishing its animation.
test("quickly reopening a new entry cannot inherit the cancelled ordinary record allowance",async({page})=>{
  await openBalance(page,payrollSeed({earned:0,records:[{amount:10000}]}));
  await block(page).locator("[data-payout-edit]").click();
  await settleScreen(page);
  await expect(page.locator('[data-payout-mode="regular"]')).toHaveAttribute("aria-pressed","true");
  const closing=await page.evaluate(()=>{
    document.querySelector('[data-payout-cancel]').click();
    const wasClosing=!document.querySelector('.payout-editor-reveal').classList.contains('on');
    globalThis.__earnedReopenDeadline=new Promise(resolve=>setTimeout(resolve,350));
    document.querySelector('.payout-block.open [data-payout-add]').click();
    return wasClosing;
  });
  expect(closing).toBe(true);
  await expect(page.locator('[data-payout-mode="advance"]')).toHaveAttribute("aria-pressed","true");
  await expect(page.locator('[data-payout-mode="regular"]')).toBeDisabled();
  await expect(page.locator("#payoutAmount")).toHaveValue("");
  await expect(page.locator("#payoutComment")).toHaveValue("");
  await settleScreen(page);
  await page.evaluate(()=>globalThis.__earnedReopenDeadline);
  await expect(page.locator(".payout-editor-reveal.on")).toHaveCount(1);
  await expect(page.locator('[data-payout-mode="advance"]')).toHaveAttribute("aria-pressed","true");
  expect(await page.evaluate(()=>globalThis.__stubDb.employee_payouts.map(item=>[item.amount,item.is_advance]))).toEqual([[10000,false]]);
});

test("negative earned money without issued money never appears as an overpayment",async({page})=>{
  const seed=payrollSeed({earned:3500});
  seed.shifts[0].penalties=[{id:"earned-penalty",amount:5000,comment:"Удержание",payout_kind:"second_half"}];
  await openBalance(page,seed);
  await expectBalance(page,{earned:"-1 500 ₽",issued:"0 ₽",remaining:"0 ₽"});
  await expect(block(page).locator(".payout-status")).toHaveText("Без выплаты");
  await expect(block(page).locator(".payout-financial-summary")).not.toContainText("Выдано сверх начисленного");
  await start(page);
  await expect(page.locator('[data-payout-mode="advance"]')).toHaveAttribute("aria-pressed","true");
  await page.locator("#payoutAmount").fill("1000");
  await expect(page.locator('[data-payout-preview="issued"]')).toHaveText("1 000 ₽");
  await expect(page.locator('[data-payout-preview="overpaid"]')).toHaveText("1 000 ₽");
});

test("the team hero separates earned money from its forecast before choosing an employee",async({page})=>{
  await openApp(page,{seed:payrollSeed({earned:3500,future:8500})});
  await page.locator("#tab-stats").click();
  await settleScreen(page);
  await expect(page.locator("#statsEmployeeOpen")).toContainText("Все сотрудники");
  const hero=page.locator(".hero");
  await expect(hero.locator(".k")).toHaveText("Начислено");
  await expect(hero.locator(".n")).toHaveText("3 500 ₽");
  await expect(hero.locator(".payout-forecast")).toContainText("12 000 ₽");
  await expect(hero.locator(".payout-forecast")).toContainText("в плане: 1 смена");
});
