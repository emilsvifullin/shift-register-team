import {
  test,
  expect
} from "@playwright/test";

import {
  ADMIN_SEED,
  openApp
} from "./support/supabase-stub.mjs";

/*
  Связанные поля раскрываются внутри своей плитки, а не отдельным окном
  снизу и не соседней карточкой. Проверяется именно это: плитка растёт,
  страница не затемняется, выбранное попадает в основную строку, а
  повторное нажатие снова раскрывает список.

  Высоту раскрытого меряем у самого контейнера: он и есть то, что растёт.
*/

function seed({employees=2,shifts=true}={}){
  const source=structuredClone(ADMIN_SEED);
  const base=source.employees[0];

  const names=[
    "Абрамова Марина",
    "Белов Роман",
    "Волков Игорь",
    "Гусева Анна",
    "Дроздов Пётр",
    "Ефимова Ольга",
    "Жуков Тимур",
    "Зайцева Вера",
    "Ильин Артём",
    "Кузнецова Лидия"
  ].slice(0,employees);

  source.employees=names.map((full_name,index)=>({
    ...base,
    id:`emp-${index}`,
    user_id:`user-${index}`,
    full_name,
    status:"active"
  }));

  source.employee_points=
    source.employees.flatMap(employee=>
      source.points.map(point=>({
        employee_id:employee.id,
        point_id:point.id
      }))
    );

  source.shifts=shifts
    ? [3,11,15].map((day,index)=>({
        id:`shift-${index}`,
        employee_id:source.employees[0].id,
        shift_date:`2026-09-${String(day).padStart(2,"0")}`,
        point_id:source.points[1].id,
        shift_type:"main",
        shk:null,
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
          id:source.employees[0].id,
          user_id:source.employees[0].user_id,
          full_name:source.employees[0].full_name,
          status:"active"
        },
        point:{
          id:source.points[1].id,
          code:source.points[1].code,
          name:source.points[1].name,
          active:source.points[1].active,
          advance_enabled:source.points[1].advance_enabled
        },
        bonuses:[],
        penalties:[]
      }))
    : [];

  return source;
}

function reveal(page,key){
  return page.evaluate(name=>{
    const element=
      document.querySelector(
        `[data-key="${name}"]`
      );

    return {
      height:Math.round(
        element.getBoundingClientRect().height
      ),
      open:element.classList.contains("on"),
      inert:element
        .querySelector(".field-reveal-body")
        .hasAttribute("inert")
    };
  },key);
}

/* Затемнение и окно снизу — признак того, что выбор снова уехал в модалку. */
function overlays(page){
  return page.evaluate(()=>({
    pickerOpen:
      document
        .getElementById("pointPicker")
        .classList.contains("on") ||
      document
        .getElementById("datePicker")
        .classList.contains("on"),
    bodyPickerClasses:
      [...document.body.classList]
        .filter(name=>
          name.includes("picker-open")
        )
  }));
}

test.use({
  viewport:{width:402,height:874},
  colorScheme:"dark"
});

test(
  "the stats employee list opens inside its own tile",
  async({page})=>{
    await openApp(page,{seed:seed({employees:10})});

    await page.locator("#tab-stats").click();

    const row=page.locator("#statsEmployeeOpen");

    await expect(row).toHaveAttribute("aria-expanded","false");
    expect(await reveal(page,"statsEmployeeReveal"))
      .toEqual({height:0,open:false,inert:true});

    await row.click();

    await expect(row).toHaveAttribute("aria-expanded","true");

    /* Плитка растёт переходом, поэтому высота проверяется с ожиданием. */
    await expect
      .poll(()=>reveal(page,"statsEmployeeReveal")
        .then(state=>state.height))
      .toBeGreaterThan(100);

    const open=await reveal(page,"statsEmployeeReveal");

    expect(open.open).toBe(true);
    expect(open.inert).toBe(false);

    /* Никакого отдельного окна и никакого затемнения страницы. */
    expect(await overlays(page)).toEqual({
      pickerOpen:false,
      bodyPickerClasses:[]
    });

    /* Список и поиск лежат внутри той же карточки, что и строка. */
    expect(
      await page.evaluate(()=>{
        const card=document
          .getElementById("statsEmployeeOpen")
          .closest(".card");

        return (
          card.contains(
            document.getElementById("statsEmployeeSearch")
          ) &&
          card.contains(
            document.querySelector("[data-stats-employee]")
          )
        );
      })
    ).toBe(true);

    await page
      .locator("[data-stats-employee]")
      .nth(3)
      .click();

    await expect(row).toHaveAttribute("aria-expanded","false");
    await expect(row).toContainText("Гусева Анна");

    /* Повторное нажатие снова раскрывает список. */
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded","true");

    await expect(
      page.locator("[data-stats-employee].on")
    ).toContainText("Гусева Анна");
  }
);

/*
  Поиск фильтрует по ходу ввода, а поле при этом остаётся под курсором.

  Перерисовка переиспользует узлы, но «личность» поля считалась вместе со
  служебными data-атрибутами, которые проставляет сам рантайм: живой узел
  всегда отличался от своей разметки, и фокус снимался после первой же
  буквы.
*/
test(
  "typing in an inline search filters without losing the field",
  async({page})=>{
    await openApp(page,{seed:seed({employees:10})});

    await page.locator("#tab-stats").click();
    await page.locator("#statsEmployeeOpen").click();

    const search=page.locator("#statsEmployeeSearch");

    await search.click();
    await search.pressSequentially("куз",{delay:80});

    expect(
      await page.evaluate(()=>({
        active:document.activeElement?.id,
        caret:document
          .getElementById("statsEmployeeSearch")
          .selectionStart
      }))
    ).toEqual({
      active:"statsEmployeeSearch",
      caret:3
    });

    await expect(
      page.locator("[data-stats-employee]")
    ).toHaveCount(1);

    await expect(
      page.locator("[data-stats-employee]")
    ).toContainText("Кузнецова Лидия");
  }
);

test(
  "date, point and employee open inside the shift card",
  async({page})=>{
    await openApp(page,{seed:seed({employees:10})});

    await page.locator("#shiftAdd").click();

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    const card=page.locator("#f-date-open").locator("xpath=..");

    const dateRow=page.locator("#f-date-open");
    const pointRow=page.locator("#f-point-open");
    const employeeRow=page.locator("#f-employee-open");

    /* Календарь раскрывается прямо под строкой даты, в той же карточке. */
    await dateRow.click();
    await expect(dateRow).toHaveAttribute("aria-expanded","true");

    await expect
      .poll(()=>reveal(page,"shiftDateReveal")
        .then(state=>state.height))
      .toBeGreaterThan(300);

    expect(
      (await overlays(page)).pickerOpen
    ).toBe(false);

    await expect(
      card.locator(".inline-calendar")
    ).toHaveCount(1);

    await page
      .locator(".inline-calendar .date-day:not(.outside)")
      .nth(9)
      .click();

    await expect(dateRow).toHaveAttribute("aria-expanded","false");
    await expect(dateRow).toContainText("10 сентября 2026");

    /* Пункт: список с поиском внутри той же карточки. */
    await pointRow.click();
    await expect(pointRow).toHaveAttribute("aria-expanded","true");

    await page
      .locator("[data-shift-point]")
      .first()
      .click();

    await expect(pointRow).toHaveAttribute("aria-expanded","false");
    await expect(pointRow).not.toContainText("Выберите пункт");

    /* Сотрудник: то же поведение, без отдельного окна. */
    await employeeRow.click();
    await expect(employeeRow).toHaveAttribute("aria-expanded","true");

    expect(
      (await overlays(page)).bodyPickerClasses
    ).toEqual([]);

    await page
      .locator("[data-shift-employee]")
      .first()
      .click();

    await expect(employeeRow).toHaveAttribute("aria-expanded","false");
    await expect(employeeRow).toContainText("Абрамова Марина");

    /* Раскрытой остаётся одна строка: карточка не превращается в ленту. */
    await dateRow.click();
    await pointRow.click();

    expect(
      (await reveal(page,"shiftDateReveal")).open
    ).toBe(false);

    expect(
      (await reveal(page,"shiftPointReveal")).open
    ).toBe(true);
  }
);

test(
  "partial hours and the salary adjustment live in their own tiles",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    expect(await reveal(page,"shiftHoursReveal"))
      .toMatchObject({open:false,inert:true});

    await page.locator('[data-part="1"]').click();

    expect(await reveal(page,"shiftHoursReveal"))
      .toMatchObject({open:true,inert:false});

    expect(
      await page.evaluate(()=>
        document
          .querySelector('[data-part="1"]')
          .closest(".card")
          .contains(
            document.getElementById("f-hours")
          )
      )
    ).toBe(true);

    /*
      Корректировка оклада раскрывается в своей плитке и объясняется
      собственной причиной: общий комментарий смены остаётся отдельным
      полем и больше ничего не обязан объяснять.
    */
    await page.locator('[data-pay-mode="manual"]').click();

    expect(await reveal(page,"shiftPaymentReveal"))
      .toMatchObject({open:true,inert:false});

    expect(
      await page.evaluate(()=>{
        const card=document
          .querySelector('[data-pay-mode="manual"]')
          .closest(".card");

        return {
          amount:card.contains(
            document.getElementById("f-base-override")
          ),
          reason:card.contains(
            document.getElementById("f-base-reason")
          ),
          note:card.contains(
            document.getElementById("f-note")
          )
        };
      })
    ).toEqual({
      amount:true,
      reason:true,
      note:false
    });

    await page.locator('[data-pay-mode="tariff"]').click();

    expect(
      (await reveal(page,"shiftPaymentReveal")).open
    ).toBe(false);
  }
);

test(
  "the salary adjustment asks for its own reason, not the shift comment",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();

    await page.locator("#f-point-open").click();
    await page.locator("[data-shift-point]").first().click();

    await page.locator("#f-employee-open").click();
    await page.locator("[data-shift-employee]").first().click();

    await page.locator('[data-pay-mode="manual"]').click();
    await page.locator("#f-base-override").fill("2500");

    /* Общий комментарий заполнен, но причину корректировки не заменяет. */
    await page.locator("#f-note").fill("Комментарий к смене");
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Укажите причину корректировки оклада");

    await page.locator("#f-base-reason").fill("Договорились о доплате");
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);

    expect(
      await page.evaluate(()=>
        window.__stubDb?.saved_shifts?.at(-1)
      )
    ).toMatchObject({
      p_note:"Комментарий к смене",
      p_base_amount_reason:"Договорились о доплате"
    });
  }
);

test(
  "the account switch and its fields are one component",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#tab-manage").click();

    await page
      .locator('#app [data-manage-section="employees"]')
      .click();

    await page.locator("#employeeAdd").click();

    await expect(
      page.locator("#employeeSheet")
    ).toHaveClass(/\bon\b/);

    expect(await reveal(page,"employeeAccountReveal"))
      .toMatchObject({open:false,inert:true});

    await page
      .locator('[data-employee-account-mode="create"]')
      .click();

    expect(await reveal(page,"employeeAccountReveal"))
      .toMatchObject({open:true,inert:false});

    expect(
      await page.evaluate(()=>{
        const card=document
          .querySelector('[data-employee-account-mode="create"]')
          .closest(".card");

        return (
          card.contains(
            document.getElementById("employeeEmail")
          ) &&
          card.contains(
            document.getElementById("employeePassword")
          )
        );
      })
    ).toBe(true);

    await page
      .locator('[data-employee-account-mode="none"]')
      .click();

    expect(
      (await reveal(page,"employeeAccountReveal")).open
    ).toBe(false);
  }
);

test(
  "the tariff switch shows only the fields of the chosen kind",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#tab-manage").click();

    await page
      .locator('#app [data-manage-section="points"]')
      .click();

    await page.locator("#pointAdd").click();

    await expect(
      page.locator("#manageEditorSheet")
    ).toHaveClass(/\bon\b/);

    expect(await reveal(page,"tariffFixedReveal"))
      .toMatchObject({open:true,inert:false});

    expect(await reveal(page,"tariffTiersReveal"))
      .toMatchObject({open:false,inert:true});

    /* Переключатель, дата и параметры — одна плитка. */
    expect(
      await page.evaluate(()=>{
        const card=document
          .querySelector('#manageEditorBody [data-pricing-type="fixed"]')
          .closest(".card");

        return (
          card.contains(
            document.getElementById("manageTariffDateOpen")
          ) &&
          card.contains(
            document.getElementById("manageFixedRate")
          )
        );
      })
    ).toBe(true);

    await page
      .locator('#manageEditorBody [data-pricing-type="shk_tiers"]')
      .click();

    expect(await reveal(page,"tariffFixedReveal"))
      .toMatchObject({open:false,inert:true});

    expect(await reveal(page,"tariffTiersReveal"))
      .toMatchObject({open:true,inert:false});

    expect(
      await page.evaluate(()=>
        document
          .querySelector('#manageEditorBody [data-pricing-type="shk_tiers"]')
          .closest(".card")
          .contains(
            document.getElementById("tierAdd")
          )
      )
    ).toBe(true);
  }
);
