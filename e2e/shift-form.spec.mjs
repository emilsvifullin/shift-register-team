import {
  test,
  expect
} from "@playwright/test";

import {
  openApp
} from "./support/supabase-stub.mjs";

test.use({
  viewport:{width:390,height:844},
  hasTouch:true
});

/*
  Форма смены перерисовывается из черновика, а узлы полей
  переиспользуются. Ввод, оставшийся в узле от прошлой формы или от
  удалённой строки, не должен попасть в сохранённую смену.
*/

async function choose(page,opener,value){
  await page.locator(opener).click();

  await expect(
    page.locator("#pointPicker")
  ).toHaveClass(/\bon\b/);

  await page
    .locator(`#pointList [data-picker-value="${value}"]`)
    .click();

  if(
    await page.locator("#pointPicker.on #pointDone").isVisible()
  ){
    await page.locator("#pointDone").click();
  }

  await expect(
    page.locator("#pointPicker")
  ).not.toHaveClass(/\bon\b/);
}

async function openNewShift(page){
  await page.locator("#shiftAdd").click();

  await expect(
    page.locator("#sheet")
  ).toHaveClass(/\bon\b/);

  await expect(
    page.locator("#f-point-open")
  ).toBeVisible();
}

test(
  "a new shift starts empty after saving the previous one",
  async({page})=>{
    await openApp(page);

    await openNewShift(page);
    await choose(page,"#f-point-open","point-1");
    await choose(page,"#f-employee-open","employee-2");
    await page.locator("#f-shk").fill("150");
    await page.locator("#f-note").fill("опоздание 20 минут");
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);

    await openNewShift(page);

    expect(
      await page.evaluate(()=>({
        shk:document.getElementById("f-shk")?.value ?? "",
        note:document.getElementById("f-note")?.value ?? ""
      }))
    ).toEqual({shk:"",note:""});

    await choose(page,"#f-point-open","point-1");
    await choose(page,"#f-employee-open","employee-2");
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);

    const saved=await page.evaluate(()=>
      globalThis.__stubDb.saved_shifts.map(args=>({
        shk:args.p_shk,
        note:args.p_note
      }))
    );

    expect(saved).toEqual([
      {shk:150,note:"опоздание 20 минут"},
      {shk:null,note:null}
    ]);
  }
);

test(
  "removing a bonus row does not hand its values to the next row",
  async({page})=>{
    await openApp(page);
    await openNewShift(page);

    const add=page.locator('[data-adjustment-add="bonuses"]');
    const rows=page.locator('.adjustment-row[data-adjustment-kind="bonuses"]');

    await add.click();
    await add.click();
    await expect(rows).toHaveCount(2);

    await rows.nth(0).locator("[data-adjustment-amount]").fill("500");
    await rows.nth(0).locator("[data-adjustment-comment]").fill("за выход в выходной");

    await page.locator('[data-adjustment-remove="bonuses:0"]').click();

    await expect(rows).toHaveCount(1);

    expect(
      await rows.first().evaluate(row=>({
        amount:row.querySelector("[data-adjustment-amount]").value,
        comment:row.querySelector("[data-adjustment-comment]").value
      }))
    ).toEqual({amount:"",comment:""});
  }
);
