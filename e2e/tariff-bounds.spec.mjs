import {
  test,
  expect
} from "@playwright/test";

import {
  ADMIN_SEED,
  openApp
} from "./support/supabase-stub.mjs";

/*
  Границы тарифа по ШК конечны.

  Последняя строка обязана была быть открытой, и её ставка молча
  действовала на любой объём выше: менеджер задавал «до 650 — 5500 ₽», а
  смена с 900 ШК считалась по 5500 ₽. Теперь выше последней границы
  ставки нет, смена не сохраняется, и приложение говорит, какая граница
  последняя.

  Новый тариф при этом начинается с одной пустой строки: подставленный
  набор 350/450/550/650 был решением, которого никто не принимал.
*/

function boundedSeed(){
  const seed=structuredClone(ADMIN_SEED);

  seed.point_tariffs=[
    {
      id:"tariff-bounded",
      point_id:"point-1",
      effective_from:"2026-01-01",
      pricing_type:"shk_tiers",
      fixed_rate:null,
      shk_tiers:[
        {up_to:350,rate:3000},
        {up_to:650,rate:5500}
      ],
      created_at:"2026-01-01T00:00:00Z"
    }
  ];

  seed.shifts=[];

  return seed;
}

async function openPoints(page){
  await page.locator("#tab-manage").click();

  await page
    .locator('#app [data-manage-section="points"]')
    .click();

  await expect(
    page.locator("#pointManageList")
  ).toBeVisible();
}

test.use({
  viewport:{width:402,height:874},
  colorScheme:"dark"
});

test(
  "a new point starts with one empty tariff row",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    await page.locator("#pointAdd").click();

    await expect(
      page.locator("#manageEditorSheet")
    ).toHaveClass(/\bon\b/);

    await page
      .locator('#manageEditorBody [data-pricing-type="shk_tiers"]')
      .click();

    const rows=page.locator(
      "#manageEditorBody [data-tier-index]"
    );

    await expect(rows).toHaveCount(1);

    /* Ни границ, ни ставок — только подсказка, что сюда вводят число. */
    expect(
      await page.evaluate(()=>{
        const row=document.querySelector(
          "#manageEditorBody [data-tier-index]"
        );

        const limit=row.querySelector("[data-tier-limit]");
        const rate=row.querySelector("[data-tier-rate]");

        return {
          limit:limit.value,
          rate:rate.value,
          limitPlaceholder:limit.placeholder,
          ratePlaceholder:rate.placeholder,
          openTail:row.textContent.includes("Без границы")
        };
      })
    ).toEqual({
      limit:"",
      rate:"",
      limitPlaceholder:"0",
      ratePlaceholder:"0",
      openTail:false
    });
  }
);

test(
  "the last tariff row needs its own upper bound before saving",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    await page.locator("#pointAdd").click();
    await page.locator("#managePointName").fill("Граничный ПВЗ");

    await page
      .locator('#manageEditorBody [data-pricing-type="shk_tiers"]')
      .click();

    const rows=page.locator(
      "#manageEditorBody [data-tier-index]"
    );

    await rows.nth(0).locator("[data-tier-rate]").fill("3000");
    await page.locator("#manageEditorSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("верхнюю границу");

    await rows.nth(0).locator("[data-tier-limit]").fill("650");
    await page.locator("#manageEditorSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("ПВЗ сохранён");

    expect(
      await page.evaluate(()=>
        globalThis.__stubCalls
          .find(call=>call.name==="admin_save_point")
          .args.p_shk_tiers
      )
    ).toEqual([{up_to:650,rate:3000}]);
  }
);

test(
  "a volume above the last boundary is not paid by the last rate",
  async({page})=>{
    await openApp(page,{seed:boundedSeed()});

    await page.locator("#shiftAdd").click();

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    /* Ждём конец раскрытия: внутри едущей панели клик переигрывается. */
    const settle=async key=>{
      await expect
        .poll(()=>page
          .locator(`[data-key="${key}"]`)
          .evaluate(node=>node.getAnimations().length))
        .toBe(0);
    };

    await page.locator("#f-point-open").click();
    await settle("shiftPointReveal");
    await page.locator('[data-shift-point="point-1"]').click();

    await page.locator("#f-employee-open").click();
    await settle("shiftEmployeeReveal");
    await page.locator("[data-shift-employee]").first().click();

    /* Внутри границ ставка считается как раньше. */
    await page.locator("#f-shk").fill("600");

    await expect(
      page.locator("#calcBox")
    ).toContainText("5 500");

    /* Выше последней границы — не последняя ставка, а отказ с числом. */
    await page.locator("#f-shk").fill("900");

    const calc=page.locator("#calcBox .calc-error");

    await expect(calc).toContainText("900");
    await expect(calc).toContainText("650");

    await expect(
      page.locator("#calcBox")
    ).not.toContainText("5 500");

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("выше последней границы");

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    /* Ничего не ушло в сохранение. */
    expect(
      await page.evaluate(()=>
        (globalThis.__stubDb?.saved_shifts || []).length
      )
    ).toBe(0);
  }
);
