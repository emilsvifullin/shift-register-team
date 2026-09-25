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
  Индивидуальная ставка сотрудника на ПВЗ.

  Правило одно: есть своя ставка на дату смены — считаем по ней, нет —
  по тарифу ПВЗ. Проверяется, что это правило работает одинаково на всём
  пути смены: в расчёте формы, в сохранённой записи, при нескольких
  датах сразу, при переводе смены на другого человека и в «Итогах».

  Отдельно — история: новая ставка не переписывает стоимость уже
  сохранённых смен. Это и есть причина, по которой ставка версионируется
  датой, а стоимость смены замораживается снимком.
*/

const YEAR=FROZEN_TODAY.getFullYear();

const MONTH=String(
  FROZEN_TODAY.getMonth()+1
).padStart(2,"0");

const day=number=>
  `${YEAR}-${MONTH}-${
    String(number).padStart(2,"0")
  }`;

/*
  Коммунальная 10 (point-1) платит по ШК, Корабельная 1 (point-2) —
  фиксированные 3 000 ₽. Марина (employee-1) назначена на оба.
*/
function seed({rates=[]}={}){
  const source=structuredClone(ADMIN_SEED);

  source.shifts=[];
  source.employee_point_rates=rates;

  source.employee_points=[
    {
      employee_id:"employee-1",
      point_id:"point-1",
      active:true
    },
    {
      employee_id:"employee-1",
      point_id:"point-2",
      active:true
    },
    {
      employee_id:"employee-2",
      point_id:"point-2",
      active:true
    }
  ];

  return source;
}

function rate({
  id="rate-1",
  employeeId="employee-1",
  pointId="point-2",
  from=`${YEAR}-01-01`,
  amount=3300
}={}){
  return {
    id,
    employee_id:employeeId,
    point_id:pointId,
    effective_from:from,
    pricing_type:"fixed",
    fixed_rate:amount,
    shk_tiers:null,
    created_at:`${from}T00:00:00Z`
  };
}

async function settle(page,key){
  const element=page.locator(
    `[data-key="${key}"]`
  );

  await expect
    .poll(()=>element.evaluate(node=>
      node.getAnimations().length
    ))
    .toBe(0);
}

async function newShift(page,{
  point="Корабельная 1",
  employee="Марина Абрамова"
}={}){
  await page.locator("#shiftAdd").click();

  await page.locator("#f-point-open").click();
  await settle(page,"shiftPointReveal");

  await page
    .locator("[data-shift-point]")
    .filter({hasText:point})
    .first()
    .click();

  await page.locator("#f-employee-open").click();
  await settle(page,"shiftEmployeeReveal");

  await page
    .locator("[data-shift-employee]")
    .filter({hasText:employee})
    .first()
    .click();
}

function savedShifts(page){
  return page.evaluate(()=>
    (window.__stubDb?.saved_shifts || [])
      .map(item=>({
        employee:item.p_employee_id,
        point:item.p_point_id,
        date:item.p_shift_date
      }))
  );
}

function storedShifts(page){
  return page.evaluate(()=>
    (window.__stubDb?.shifts || []).map(item=>({
      date:item.shift_date,
      employee:item.employee_id,
      base:Number(item.base_amount),
      source:item.pricing_snapshot?.rateSource ?? null,
      rate:Number(item.pricing_snapshot?.rate)
    }))
  );
}

test.use({
  viewport:{width:402,height:874}
});

test(
  "an individual rate replaces the point tariff in the shift form",
  async({page})=>{
    await openApp(page,{
      seed:seed({rates:[rate({amount:3300})]})
    });

    await newShift(page);

    /* Ставка ПВЗ 3 000, у Марины здесь — 3 300. */
    await expect(
      page.locator("#calcBox")
    ).toContainText("3 300 ₽");

    await expect(
      page.locator("#calcBox")
    ).toContainText(
      "Индивидуальная ставка сотрудника"
    );

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);

    expect(await storedShifts(page)).toMatchObject([
      {
        base:3300,
        rate:3300,
        source:"employee"
      }
    ]);
  }
);

test(
  "without an individual rate the point tariff still decides",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await newShift(page);

    await expect(
      page.locator("#calcBox")
    ).toContainText("3 000 ₽");

    await expect(
      page.locator("#calcBox")
    ).toContainText("Тариф ПВЗ");

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);

    expect(await storedShifts(page)).toMatchObject([
      {
        base:3000,
        rate:3000,
        source:"point"
      }
    ]);
  }
);

test(
  "the rate follows the employee, not the point",
  async({page})=>{
    await openApp(page,{
      seed:seed({rates:[rate({amount:3500})]})
    });

    /* У Романа своей ставки на этом ПВЗ нет. */
    await newShift(page,{
      employee:"Роман Белов"
    });

    await expect(
      page.locator("#calcBox")
    ).toContainText("3 000 ₽");

    await expect(
      page.locator("#calcBox")
    ).toContainText("Тариф ПВЗ");
  }
);

test(
  "one rate a day applies to every date of a multi-date shift",
  async({page})=>{
    await openApp(page,{
      seed:seed({rates:[rate({amount:3300})]})
    });

    await newShift(page);

    await page.locator("#f-date-open").click();

    for(const number of [4,5,6]){
      await page
        .locator(`#sheet [data-date="${day(number)}"]`)
        .click();
    }

    await expect(
      page.locator(".date-chip")
    ).toHaveCount(3);

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);

    const stored=await storedShifts(page);

    expect(stored).toHaveLength(3);

    for(const item of stored){
      expect(item).toMatchObject({
        base:3300,
        source:"employee"
      });
    }
  }
);

test(
  "a rate that starts later leaves earlier shifts alone",
  async({page})=>{
    await openApp(page,{
      seed:seed({
        rates:[
          rate({
            id:"rate-old",
            from:`${YEAR}-01-01`,
            amount:3300
          }),
          rate({
            id:"rate-new",
            from:day(15),
            amount:3900
          })
        ]
      })
    });

    /* До 15-го — прежняя ставка. */
    await newShift(page);

    await page.locator("#f-date-open").click();

    await page
      .locator(`#sheet [data-date="${day(10)}"]`)
      .click();

    await expect(
      page.locator("#calcBox")
    ).toContainText("3 300 ₽");

    /*
      С 15-го — новая. Добавляем 16-е и снимаем 10-е: у смены остаётся
      одна дата, уже из нового периода.
    */
    await page
      .locator(`#sheet [data-date="${day(16)}"]`)
      .click();

    await page
      .locator(`#sheet [data-date="${day(10)}"]`)
      .click();

    await expect(
      page.locator(".date-chip")
    ).toHaveCount(1);

    await expect(
      page.locator("#calcBox")
    ).toContainText("3 900 ₽");
  }
);

test(
  "a saved shift keeps its price when the rate changes afterwards",
  async({page})=>{
    await openApp(page,{
      seed:seed({rates:[rate({amount:3300})]})
    });

    await newShift(page);
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);

    expect(await storedShifts(page)).toMatchObject([
      {base:3300}
    ]);

    /* Ставка выросла задним числом. */
    await page.evaluate(()=>{
      const rates=window.__stubDb.employee_point_rates;
      rates[0].fixed_rate=4100;
    });

    await page.evaluate(()=>
      window.dispatchEvent(new Event("online"))
    );

    await page.waitForTimeout(600);

    /* Сохранённая смена стоит столько же. */
    expect(await storedShifts(page)).toMatchObject([
      {base:3300}
    ]);

    /* И приложение об этом говорит, а не молчит. */
    await page.locator(".sh").first().click();

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    await expect(
      page.locator("#sheetBody")
    ).toContainText("своя ставка");

    await expect(
      page.locator("#sheetBody")
    ).toContainText("4 100");
  }
);

test(
  "repricing brings the shift to the individual rate",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await newShift(page);
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);

    expect(await storedShifts(page)).toMatchObject([
      {base:3000,source:"point"}
    ]);

    /* Договорились об индивидуальной ставке задним числом. */
    await page.evaluate(from=>{
      window.__stubDb.employee_point_rates.push({
        id:"rate-late",
        employee_id:"employee-1",
        point_id:"point-2",
        effective_from:from,
        pricing_type:"fixed",
        fixed_rate:3300,
        shk_tiers:null,
        created_at:`${from}T00:00:00Z`
      });
    },`${YEAR}-01-01`);

    await page.evaluate(()=>
      window.dispatchEvent(new Event("online"))
    );

    await page.waitForTimeout(600);

    await page.locator(".sh").first().click();
    await page.locator("#sheetSave").click();

    await page.locator("#f-reprice").click();

    /* Пересчёт меняет уже посчитанные деньги и потому подтверждается. */
    await page.locator("#appConfirmOk").click();

    await expect
      .poll(()=>storedShifts(page))
      .toMatchObject([
        {base:3300,source:"employee"}
      ]);
  }
);

test(
  "the employee card sets, changes and removes the rate",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#tab-manage").click();

    await page
      .locator('#app [data-manage-section="employees"]')
      .click();

    await page
      .locator("[data-employee-id]")
      .filter({hasText:"Марина"})
      .first()
      .click();

    await expect(
      page.locator("#employeeSheet")
    ).toHaveClass(/\bon\b/);

    await page.locator("#employeeSheetSave").click();

    /* Пока ставки нет, строка так и говорит. */
    const row=page.locator(
      '[data-employee-rate-point="point-2"]'
    );

    await expect(row).toContainText(
      "По тарифу ПВЗ"
    );

    await row.click();

    await page
      .locator("#employeeRateAmount")
      .fill("3300");

    await page
      .locator("#employeeRateSave")
      .click();

    await expect(
      page.locator("#toast")
    ).toContainText(
      "Индивидуальная ставка задана"
    );

    await expect(row).toContainText("3 300 ₽");

    /* Ставку видно и в режиме просмотра карточки. */
    await page.locator("#employeeSheetCancel").click();

    await expect(
      page.locator("#employeeSheetBody")
    ).toContainText("Индивидуальные ставки");

    await expect(
      page.locator("#employeeSheetBody")
    ).toContainText("3 300 ₽");

    /* И её можно убрать — сотрудник возвращается на тариф ПВЗ. */
    await page.locator("#employeeSheetSave").click();
    await row.click();

    await page
      .locator('[data-employee-rate-delete]')
      .first()
      .click();

    await page
      .locator("#appConfirmOk")
      .click();

    await expect(
      page.locator("#toast")
    ).toContainText("Ставка убрана");

    await expect(row).toContainText(
      "По тарифу ПВЗ"
    );
  }
);

test(
  "an individual rate reaches the month totals",
  async({page})=>{
    await openApp(page,{
      seed:seed({rates:[rate({amount:3300})]})
    });

    await newShift(page);
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);

    await page.locator("#tab-stats").click();
    await page.locator("#statsEmployeeOpen").click();

    await page
      .locator('[data-stats-employee="employee-1"]')
      .click();

    await expect(
      page.locator("#app .hero")
    ).toContainText("3 300");
  }
);
