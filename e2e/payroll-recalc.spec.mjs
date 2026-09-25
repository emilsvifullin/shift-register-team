import {
  test,
  expect
} from "@playwright/test";

import {
  ADMIN_SEED,
  FROZEN_TODAY,
  openApp
} from "./support/supabase-stub.mjs";

/*
  Изменение условий задним числом не трогает сохранённые смены само.
  Проверяется то, ради чего план и нужен: человек видит весь список,
  старую и новую сумму, общую разницу и может оставить отдельную смену
  как есть или назначить ей свою сумму — и только потом применить.
*/

const YEAR=FROZEN_TODAY.getFullYear();

const MONTH=String(
  FROZEN_TODAY.getMonth()+1
).padStart(2,"0");

const day=number=>
  `${YEAR}-${MONTH}-${
    String(number).padStart(2,"0")
  }`;

function seed(){
  const source=structuredClone(ADMIN_SEED);

  const point=source.points.find(
    item=>item.id==="point-2"
  );

  source.employee_points=[
    {
      employee_id:"employee-1",
      point_id:"point-2",
      active:true
    }
  ];

  source.shifts=[3,8,12].map((number,index)=>({
    id:`shift-${index}`,
    employee_id:"employee-1",
    shift_date:day(number),
    point_id:point.id,
    shift_type:"main",
    shk:200,
    partial:false,
    hours:null,
    full_hours:12,
    base_amount:3000,
    pricing_snapshot:{
      version:2,
      fixed:true,
      pricingType:"fixed",
      rate:3000,
      fullHours:12,
      advanceEnabled:false
    },
    note:"",
    employee:{
      id:"employee-1",
      user_id:"user-1",
      full_name:"Марина Абрамова",
      status:"active"
    },
    point:{...point},
    bonuses:[],
    penalties:[]
  }));

  return source;
}

async function changeCurrentTariff(page,rate){
  await page.locator("#tab-manage").click();

  await page
    .locator('#app [data-manage-section="points"]')
    .click();

  await page
    .locator('[data-point-id="point-2"]')
    .click();

  await page.locator("#manageEditorSave").click();

  await page
    .locator('[data-tariff-intent="edit-current"]')
    .click();

  await page.locator("#manageFixedRate").fill(rate);
  await page.locator("#manageTariffSave").click();
}

test.use({
  viewport:{width:402,height:874}
});

test(
  "a retroactive tariff shows every affected shift before applying",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await changeCurrentTariff(page,"3300");

    await expect(
      page.locator("#recalcSheet")
    ).toHaveClass(/\bon\b/);

    /* Все три смены попали в план, разница видна одной цифрой. */
    await expect(
      page.locator(".recalc-row")
    ).toHaveCount(3);

    await expect(
      page.locator(".recalc-summary")
    ).toContainText("+900");

    /* Пока не применили — суммы смен не изменились. */
    expect(
      await page.evaluate(()=>
        window.__stubDb.shifts.map(item=>
          Number(item.base_amount)
        )
      )
    ).toEqual([3000,3000,3000]);

    await page.locator("#recalcApply").click();

    await expect(
      page.locator("#recalcSheet")
    ).not.toHaveClass(/\bon\b/);

    await expect
      .poll(()=>page.evaluate(()=>
        window.__stubDb.shifts.map(item=>
          Number(item.base_amount)
        )
      ))
      .toEqual([3300,3300,3300]);
  }
);

test(
  "one shift can be left alone and another given its own amount",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await changeCurrentTariff(page,"3300");

    const rows=page.locator(".recalc-row");

    /* Первую оставляем как есть. */
    await rows
      .nth(0)
      .locator('[data-recalc-mode="skip"]')
      .click();

    /* Второй назначаем свою сумму. */
    await rows
      .nth(1)
      .locator('[data-recalc-mode="manual"]')
      .click();

    await rows
      .nth(1)
      .locator("[data-recalc-amount]")
      .fill("5000");

    /* Итог считается по выбранному, а не по предложенному. */
    await expect(
      page.locator(".recalc-summary")
    ).toContainText("+2 300");

    await page.locator("#recalcApply").click();

    /* Сверяем по сменам, а не по порядку в хранилище. */
    await expect
      .poll(()=>page.evaluate(()=>
        Object.fromEntries(
          window.__stubDb.shifts.map(item=>[
            item.id,
            Number(item.base_amount)
          ])
        )
      ))
      .toEqual({
        "shift-0":3000,
        "shift-1":5000,
        "shift-2":3300
      });
  }
);

test(
  "a rate that only starts in the future asks nothing",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#tab-manage").click();

    await page
      .locator('#app [data-manage-section="points"]')
      .click();

    await page
      .locator('[data-point-id="point-2"]')
      .click();

    await page.locator("#manageEditorSave").click();

    await page
      .locator('[data-tariff-intent="create"]')
      .click();

    await page.locator("#manageFixedRate").fill("4000");

    await page.locator("#manageTariffDateOpen").click();

    await page
      .locator(`#dateGrid [data-date="${day(28)}"]`)
      .click();

    await page.locator("#dateDone").click();
    await page.locator("#manageTariffSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Новый тариф добавлен");

    await expect(
      page.locator("#recalcSheet")
    ).not.toHaveClass(/\bon\b/);
  }
);
