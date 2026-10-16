import {test,expect} from "@playwright/test";
import {openApp} from "./support/supabase-stub.mjs";
import {settleScreen} from "./support/settle.mjs";

// Stubbed business requests must include the router's prerequisite health
// check. Browser tests may not depend on connectivity to the working backend.
test("employee deletion stays local when both real Supabase hosts are blocked",async({page})=>{
  const outbound=[];
  await page.route(/^https:\/\/(?:shift-register-supabase-proxy\.vercel\.app|rxosovinouuonwrrzigs\.supabase\.co)\//,route=>{
    outbound.push(route.request().url());
    return route.abort();
  });
  await openApp(page);
  await page.locator("#tab-manage").click();
  await settleScreen(page);
  await page.locator('#app [data-manage-section="employees"]').click();
  await settleScreen(page);
  await page.locator('[data-employee-id="employee-2"]').click();
  await settleScreen(page);
  await page.locator("#employeeSheetSave").click();
  await page.locator("#employeeDelete").click();
  await page.locator("#appConfirmOk").click();
  await expect(page.locator("#toast")).toContainText("Сотрудник удалён");
  await expect(page.locator('[data-employee-id="employee-2"]')).toHaveCount(0);
  expect(await page.evaluate(()=>globalThis.__stubCalls.filter(call=>call.name==="admin-employee-auth" && call.args.action==="delete").length)).toBe(1);
  // Either configured route must remain usable when selected by the router.
  expect(await page.evaluate(()=>Promise.all([
    "https://shift-register-supabase-proxy.vercel.app/auth/v1/health",
    "https://rxosovinouuonwrrzigs.supabase.co/auth/v1/health"
  ].map(async url=>(await fetch(url)).status)))).toEqual([200,200]);
  expect(outbound).toEqual([]);
});
