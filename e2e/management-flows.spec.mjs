import {
  test,
  expect
} from "@playwright/test";

import {
  ADMIN_SEED,
  openApp
} from "./support/supabase-stub.mjs";

function employeeWithShiftSeed(){
  const seed=structuredClone(ADMIN_SEED);

  seed.shifts=[
    {
      id:"shift-1",
      employee_id:"employee-1",
      shift_date:"2026-09-01",
      point_id:"point-1",
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
        fullHours:12
      },
      note:"",
      employee:{
        id:"employee-1",
        user_id:"user-1",
        full_name:"Марина Абрамова",
        status:"active"
      },
      point:{
        id:"point-1",
        code:"p1",
        name:"Коммунальная 10",
        active:true,
        advance_enabled:true
      },
      bonuses:[],
      penalties:[]
    }
  ];

  return seed;
}

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
  "deleting a point is an edit-mode action that refreshes the list",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    await page
      .locator('[data-point-id="point-2"]')
      .click();

    await expect(
      page.locator("#manageEditorSheet")
    ).toHaveClass(/\bon\b/);

    /*
      В режиме просмотра разрушительной кнопки нет — так было и до 7.0.
    */
    await expect(
      page.locator("#managePointDelete")
    ).toHaveCount(0);

    await page.locator("#manageEditorSave").click();

    await expect(
      page.locator("#managePointName")
    ).toBeVisible();

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

test(
  "employee deletion appears only after Edit and cancelling keeps editing",
  async({page})=>{
    await openApp(page);

    await page.locator("#tab-manage").click();
    await page
      .locator('#app [data-manage-section="employees"]')
      .click();

    await page
      .locator('[data-employee-id="employee-2"]')
      .click();

    await expect(
      page.locator("#employeeSheet")
    ).toHaveClass(/\bon\b/);

    await expect(
      page.locator("#employeeDelete")
    ).toHaveCount(0);

    await page.locator("#employeeSheetSave").click();

    await expect(
      page.locator("#employeeName")
    ).toBeVisible();

    await page.locator("#employeeDelete").click();

    await expect(
      page.locator("#appConfirm")
    ).toHaveClass(/\bon\b/);

    await page.locator("#appConfirmCancel").click();

    await expect(
      page.locator("#employeeName")
    ).toBeVisible();

    await expect(
      page.locator("#employeeDelete")
    ).toBeVisible();
  }
);

/*
  Строка ступени без ключа доставалась соседней, и ставка удалённой
  строки уходила в сохранённый тариф.
*/
test(
  "removing a tariff tier saves the remaining tiers unchanged",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    await page.locator("#pointAdd").click();

    await expect(
      page.locator("#manageEditorSheet")
    ).toHaveClass(/\bon\b/);

    await page.locator("#managePointName").fill("Тестовый ПВЗ");

    await page
      .locator('#manageEditorBody [data-pricing-type="shk_tiers"]')
      .click();

    await page.locator("#tierAdd").click();

    const rows=page.locator("#manageEditorBody [data-tier-index]");

    await expect(rows).toHaveCount(3);

    await rows.nth(1).locator("[data-tier-limit]").fill("500");
    await rows.nth(1).locator("[data-tier-rate]").fill("5000");

    await page.locator('[data-tier-remove="1"]').click();

    await expect(rows).toHaveCount(2);

    expect(
      await rows.last().locator("[data-tier-rate]").inputValue()
    ).toBe("6500");

    await page.locator("#manageEditorSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("ПВЗ сохранён");

    const saved=await page.evaluate(()=>
      globalThis.__stubCalls.find(call=>
        call.name==="admin_save_point"
      ).args.p_shk_tiers
    );

    expect(saved).toEqual([
      {up_to:350,rate:3000},
      {up_to:null,rate:6500}
    ]);
  }
);

/*
  Карточка сотрудника удаляется Edge-функцией admin-employee-auth: приложение
  шлёт в неё обычный fetch (src/supabase.js, src/api/employees.js). Стаб
  отвечает теми же кодами, что и настоящая функция.
*/
async function openEmployees(page){
  await page.locator("#tab-manage").click();

  await page
    .locator('#app [data-manage-section="employees"]')
    .click();

  await expect(
    page.locator("#employeeList")
  ).toBeVisible();
}

test(
  "an employee without shifts is deleted from the editor",
  async({page})=>{
    await openApp(page);
    await openEmployees(page);

    await page
      .locator('[data-employee-id="employee-2"]')
      .click();

    await page.locator("#employeeSheetSave").click();
    await page.locator("#employeeDelete").click();
    await page.locator("#appConfirmOk").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Сотрудник удалён");

    await expect(
      page.locator('[data-employee-id="employee-2"]')
    ).toHaveCount(0);

    expect(
      await page.evaluate(()=>
        globalThis.__stubCalls
          .filter(call=>
            call.name==="admin-employee-auth" &&
            call.args.action==="delete"
          )
          .length
      )
    ).toBe(1);
  }
);

test(
  "an employee with shifts is kept and the reason is explained",
  async({page})=>{
    await openApp(page,{
      seed:employeeWithShiftSeed()
    });

    await openEmployees(page);

    await page
      .locator('[data-employee-id="employee-1"]')
      .click();

    await page.locator("#employeeSheetSave").click();
    await page.locator("#employeeDelete").click();
    await page.locator("#appConfirmOk").click();

    await expect(
      page.locator("#toast")
    ).toContainText("история смен");

    await expect(
      page.locator("#employeeName")
    ).toBeVisible();

    await page.locator("#employeeSheetCancel").click();
    await page.locator("#employeeSheetCancel").click();

    await expect(
      page.locator('[data-employee-id="employee-1"]')
    ).toHaveCount(1);
  }
);

test(
  "cancelling point edits returns to the point card",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    await page
      .locator('[data-point-id="point-1"]')
      .click();

    await expect(
      page.locator("#manageEditorCancel")
    ).toHaveText("Закрыть");

    await page.locator("#manageEditorSave").click();

    /*
      Отказ вернёт в карточку, а не закроет её, поэтому кнопка называется
      «Назад» — так же, как при редактировании сотрудника.
    */
    await expect(
      page.locator("#manageEditorCancel")
    ).toHaveText("Назад");

    await page.locator("#managePointName").fill("Другое название");
    await page.locator("#manageEditorCancel").click();

    /*
      Карточка остаётся открытой в режиме просмотра, правки отброшены.
    */
    await expect(
      page.locator("#manageEditorSheet")
    ).toHaveClass(/\bon\b/);

    await expect(
      page.locator("#manageEditorCancel")
    ).toHaveText("Закрыть");

    await expect(
      page.locator("#manageEditorBody")
    ).toContainText("Коммунальная 10");

    await expect(
      page.locator("#managePointName")
    ).toHaveCount(0);

    await page.locator("#manageEditorCancel").click();

    await expect(
      page.locator("#manageEditorSheet")
    ).not.toHaveClass(/\bon\b/);

    await expect(
      page.locator('[data-point-id="point-1"]')
    ).toContainText("Коммунальная 10");
  }
);

test(
  "a new point is still closed by cancel",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    await page.locator("#pointAdd").click();

    await expect(
      page.locator("#manageEditorCancel")
    ).toHaveText("Отмена");

    await page.locator("#manageEditorCancel").click();

    await expect(
      page.locator("#manageEditorSheet")
    ).not.toHaveClass(/\bon\b/);
  }
);

/*
  Поля «ШК до» и «Ставка» занимают всю ширину строки. Место под кнопку
  удаления держится, только когда строки можно удалять.
*/
test(
  "tariff tier fields use the full row width",
  async({page})=>{
    await openApp(page);
    await openPoints(page);

    await page
      .locator('[data-point-id="point-1"]')
      .click();

    await page.locator("#manageEditorSave").click();
    await page
      .locator('[data-tariff-intent="edit-current"]')
      .click();

    const rows=page.locator("#manageEditorBody [data-tier-index]");

    await expect(rows).toHaveCount(2);

    const twoRows=await page.evaluate(()=>{
      const row=document.querySelector(
        "#manageEditorBody [data-tier-index]"
      );

      const style=getComputedStyle(row);

      return {
        content:row.getBoundingClientRect().width-
          parseFloat(style.paddingLeft)-
          parseFloat(style.paddingRight),
        fields:row
          .querySelector(".tariff-tier-fields")
          .getBoundingClientRect().width,
        spacers:row.querySelectorAll(
          ".tariff-tier-remove-space"
        ).length
      };
    });

    expect(twoRows.spacers).toBe(0);
    expect(Math.abs(twoRows.fields-twoRows.content))
      .toBeLessThanOrEqual(1);

    await page.locator("#tierAdd").click();

    await expect(rows).toHaveCount(3);

    /* С тремя строками колонка удаления снова нужна и выровнена. */
    const threeRows=await page.evaluate(()=>{
      const list=[...document.querySelectorAll(
        "#manageEditorBody [data-tier-index]"
      )];

      return {
        removes:document.querySelectorAll(
          "#manageEditorBody .tariff-tier-remove"
        ).length,
        fieldWidths:list.map(row=>
          Math.round(
            row
              .querySelector(".tariff-tier-fields")
              .getBoundingClientRect().width
          )
        )
      };
    });

    expect(threeRows.removes).toBe(2);
    expect(new Set(threeRows.fieldWidths).size).toBe(1);
  }
);

/*
  Лист забирает фокус на следующем кадре после открытия. Человек успевает
  коснуться поля раньше этого кадра: тогда фокус обязан остаться у поля,
  иначе перерисовка возьмёт значение поля без фокуса из разметки и набранное
  пропадёт. Кадр здесь задержан намеренно — на телефоне под нагрузкой он
  приходит так же поздно.
*/
test(
  "a sheet opening does not take focus away from a field already in use",
  async({page})=>{
    await openApp(page);

    await page.addInitScript(()=>{});

    await page.evaluate(()=>{
      const raf=window.requestAnimationFrame;

      window.requestAnimationFrame=callback=>
        raf(()=>setTimeout(()=>callback(performance.now()),120));
    });

    await openPoints(page);
    await page.locator("#pointAdd").click();

    await expect(
      page.locator("#manageEditorSheet")
    ).toHaveClass(/\bon\b/);

    await page.locator("#managePointName").fill("Тестовый ПВЗ");

    /*
      Отложенный кадр листа приходит уже после ввода.
    */
    await page.waitForTimeout(400);

    expect(
      await page.locator("#managePointName").inputValue()
    ).toBe("Тестовый ПВЗ");

    await expect(
      page.locator("#managePointName")
    ).toBeFocused();

    await page.locator("#manageEditorSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("ПВЗ сохранён");
  }
);
