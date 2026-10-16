import {test,expect} from "@playwright/test";
import {openApp} from "./support/supabase-stub.mjs";

test.use({viewport:{width:390,height:844}});

async function settle(page,key){
  await expect.poll(()=>page.locator(`[data-key="${key}"]`).evaluate(node=>node.getAnimations().length)).toBe(0);
}
async function prepareBatch(page){
  await openApp(page);
  await page.locator("#shiftAdd").click();
  await page.locator("#f-date-open").click();
  await settle(page,"shiftDateReveal");
  for(const day of [15,16,17]){
    await page.locator(`.inline-calendar [data-date="2026-09-${day}"]`).click();
  }
  await page.locator("#f-date-open").click();
  await page.locator("#f-point-open").click();
  await settle(page,"shiftPointReveal");
  await page.locator('[data-shift-point="point-1"]').click();
  await page.locator("#f-employee-open").click();
  await settle(page,"shiftEmployeeReveal");
  await page.locator('[data-shift-employee="employee-2"]').click();
  await page.locator("#f-shk").fill("300");
}

test("a delayed batch locks editing and dismissal until every original payload is saved",async({page})=>{
  await prepareBatch(page);
  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient();
    const rpc=client.rpc.bind(client);
    let first=true;
    client.rpc=async(name,args)=>{
      if(name==="admin_save_shift_v4" && first){
        first=false;
        globalThis.__batchWaiting=true;
        await new Promise(resolve=>{globalThis.__releaseBatch=resolve;});
      }
      return rpc(name,args);
    };
  });
  await page.locator("#sheetSave").click();
  await expect.poll(()=>page.evaluate(()=>globalThis.__batchWaiting)).toBe(true);
  await expect(page.locator("#sheetCancel")).toBeDisabled();
  expect(await page.locator("#sheetBody").evaluate(node=>node.inert)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#sheet")).toHaveClass(/\bon\b/);
  // Even external DOM mutation while the real RPC is waiting must not
  // leak into the already captured operation.
  await page.locator("#f-shk").evaluate(input=>{
    input.value="999";
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await page.evaluate(()=>globalThis.__releaseBatch());
  await expect(page.locator("#sheet")).not.toHaveClass(/\bon\b/);
  expect(await page.evaluate(()=>globalThis.__stubDb.saved_shifts.map(args=>({date:args.p_shift_date,shk:args.p_shk,employee:args.p_employee_id})))).toEqual([
    {date:"2026-09-15",shk:300,employee:"employee-2"},
    {date:"2026-09-16",shk:300,employee:"employee-2"},
    {date:"2026-09-17",shk:300,employee:"employee-2"}
  ]);
});

test("declining the closed second half keeps only retry dates and never overwrites the saved day",async({page})=>{
  await prepareBatch(page);
  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient();
    const rpc=client.rpc.bind(client);
    let declineOnce=true;
    client.rpc=(name,args)=>{
      if(name==="admin_save_shift_v4" && args.p_shift_date==="2026-09-16" && declineOnce){
        declineOnce=false;
        return Promise.resolve({data:null,error:{message:"payroll_period_closed:2026-09-01:second_half:closed"}});
      }
      return rpc(name,args);
    };
  });
  await page.locator("#sheetSave").click();
  await expect(page.locator("#appConfirmTitle")).toContainText("в закрытом периоде");
  await page.locator("#appConfirmCancel").click();
  await expect(page.locator("#toast")).toContainText("Сохранено 1 из 3");
  await expect(page.locator("#sheet")).toHaveClass(/\bon\b/);
  await expect(page.locator("#f-date-open")).toContainText("2 даты: 16–17");
  await expect(page.locator("#sheetSave")).toBeEnabled();
  const first=await page.evaluate(()=>globalThis.__stubDb.saved_shifts[0].p_shift_id);
  await page.locator("#sheetSave").click();
  await expect(page.locator("#sheet")).not.toHaveClass(/\bon\b/);
  const saved=await page.evaluate(()=>globalThis.__stubDb.saved_shifts.map(args=>({date:args.p_shift_date,id:args.p_shift_id})));
  expect(saved.map(item=>item.date)).toEqual(["2026-09-15","2026-09-16","2026-09-17"]);
  expect(new Set(saved.map(item=>item.id)).size).toBe(3);
  expect(saved[0].id).toBe(first);
  expect(await page.evaluate(()=>globalThis.__stubDb.shifts.length)).toBe(3);
});
