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

async function openPoints(page){
  await page.locator("#tab-manage").click();

  await page
    .locator('#app [data-manage-section="points"]')
    .click();

  await expect(
    page.locator("#pointManageList")
  ).toBeVisible();
}

test(
  "the point list carries its summaries without a second request",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    const first=page.locator(
      '[data-point-id="point-1"]'
    );

    await expect(first).toContainText(
      "2 сотрудника"
    );

    await expect(first).toContainText("По ШК");
    await expect(first).toContainText("Аванс");

    await expect(
      page.locator('[data-point-id="point-2"]')
    ).toContainText("Фиксированный");

    /*
      Подписи собираются из уже загруженных данных: отдельных чтений
      сотрудников, назначений, ПВЗ и тарифов быть не должно.
    */
    const reads=await page.evaluate(()=>
      globalThis.__stubCalls.filter(call=>
        call.name!=="admin_account_options_v2"
      ).length
    );

    expect(reads).toBe(0);
  }
);

test(
  "editing the current tariff updates it instead of adding a version",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    await page
      .locator('[data-point-id="point-2"]')
      .click();

    await expect(
      page.locator("#manageEditorSheet")
    ).toHaveClass(/\bon\b/);

    await page
      .locator("#manageEditorSave")
      .click();

    await page
      .locator('[data-tariff-intent="edit-current"]')
      .click();

    await page
      .locator("#manageFixedRate")
      .fill("4100");

    await page
      .locator("#manageEditorSave")
      .click();

    await expect(
      page.locator("#toast")
    ).toContainText("текущий тариф");

    const tariffs=await page.evaluate(()=>
      globalThis.__stubDb.point_tariffs.filter(
        tariff=>tariff.point_id==="point-2"
      )
    );

    expect(tariffs).toHaveLength(1);
    expect(tariffs[0].fixed_rate).toBe(4100);

    expect(
      await page.evaluate(()=>
        globalThis.__stubCalls
          .map(call=>call.name)
      )
    ).toContain("admin_update_point_tariff");
  }
);

test(
  "a new tariff version keeps the previous one in history",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    await page
      .locator('[data-point-id="point-2"]')
      .click();

    await page
      .locator("#manageEditorSave")
      .click();

    await page
      .locator('[data-tariff-intent="create"]')
      .click();

    await page
      .locator("#manageFixedRate")
      .fill("5200");

    await page
      .locator("#manageEditorSave")
      .click();

    await expect(
      page.locator("#toast")
    ).toContainText("новый тариф");

    const tariffs=await page.evaluate(()=>
      globalThis.__stubDb.point_tariffs.filter(
        tariff=>tariff.point_id==="point-2"
      )
    );

    expect(tariffs).toHaveLength(2);
  }
);

test(
  "typing in the point search keeps focus and caret",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    const search=page.locator("#pointSearch");

    await search.click();
    await search.pressSequentially("Кораб");

    await expect(
      page.locator(".point-manage-row")
    ).toHaveCount(1);

    const state=await page.evaluate(()=>{
      const input=document.getElementById(
        "pointSearch"
      );

      return {
        focused:document.activeElement===input,
        value:input.value,
        caret:input.selectionStart
      };
    });

    expect(state.focused).toBe(true);
    expect(state.value).toBe("Кораб");
    expect(state.caret).toBe(5);
  }
);

test(
  "a background refresh does not steal the row under the finger",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    const row=page.locator(
      '[data-point-id="point-1"]'
    );

    const before=await page.evaluate(()=>{
      const node=document.querySelector(
        '[data-point-id="point-1"]'
      );

      node.identityStamp="held";

      return node.identityStamp;
    });

    expect(before).toBe("held");

    /*
      Realtime и автосинхронизация перерисовывают экран в произвольный
      момент — включая момент касания.
    */
    await page.evaluate(()=>
      globalThis.dispatchEvent(
        new Event("online")
      )
    );

    await page.waitForTimeout(250);

    expect(
      await page.evaluate(()=>
        document.querySelector(
          '[data-point-id="point-1"]'
        ).identityStamp
      )
    ).toBe("held");

    await row.click();

    await expect(
      page.locator("#manageEditorSheet")
    ).toHaveClass(/\bon\b/);
  }
);

test(
  "deleting a point closes the editor and refreshes the list",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    await page
      .locator('[data-point-id="point-2"]')
      .click();

    await page
      .locator("#managePointDelete")
      .click();

    await page
      .locator("#appConfirmOk")
      .click();

    await expect(
      page.locator("#toast")
    ).toContainText("ПВЗ удалён");

    await expect(
      page.locator("#manageEditorSheet")
    ).not.toHaveClass(/\bon\b/);

    await expect(
      page.locator('[data-point-id="point-2"]')
    ).toHaveCount(0);
  }
);
