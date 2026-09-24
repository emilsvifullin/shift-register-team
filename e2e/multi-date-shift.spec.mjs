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
  Новую смену заводят сразу на несколько дней: сотрудник, ПВЗ и остальные
  параметры выбираются один раз, а смены создаются на каждую отмеченную
  дату.

  Правка сохранённой смены этого не касается: там правится ровно та
  смена, которую открыли.
*/

const MONTH=FROZEN_TODAY.getMonth()+1;
const YEAR=FROZEN_TODAY.getFullYear();

const ymd=day=>
  `${YEAR}-${String(MONTH).padStart(2,"0")}-${String(day).padStart(2,"0")}`;

function seed({shifts=[]}={}){
  const source=structuredClone(ADMIN_SEED);

  source.shifts=shifts.map((shift,index)=>({
    id:`existing-${index}`,
    employee_id:"employee-2",
    shift_date:shift.date,
    point_id:"point-1",
    shift_type:shift.type || "main",
    shk:120,
    partial:false,
    hours:null,
    full_hours:12,
    base_amount:3000,
    pricing_snapshot:{
      version:2,
      fixed:false,
      pricingType:"shk_tiers",
      rate:3000,
      fullHours:12
    },
    note:"",
    base_amount_override_reason:null,
    employee:{
      id:"employee-2",
      user_id:"user-2",
      full_name:source.employees[1].full_name,
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
  }));

  return source;
}

async function settle(page,key){
  await expect
    .poll(()=>page
      .locator(`[data-key="${key}"]`)
      .evaluate(node=>node.getAnimations().length))
    .toBe(0);
}

async function chooseInline(page,row,attribute,value){
  await page.locator(row).click();
  await settle(
    page,
    row==="#f-point-open"
      ? "shiftPointReveal"
      : "shiftEmployeeReveal"
  );
  await page.locator(`[${attribute}="${value}"]`).click();
}

/* Строка даты переключает панель, поэтому открываем только закрытую. */
async function openDates(page){
  const row=page.locator("#f-date-open");

  if(await row.getAttribute("aria-expanded")==="false"){
    await row.click();
  }

  await settle(page,"shiftDateReveal");
}

async function closeDates(page){
  const row=page.locator("#f-date-open");

  if(await row.getAttribute("aria-expanded")==="true"){
    await row.click();
  }
}

async function pickDays(page,days){
  await openDates(page);

  for(const day of days){
    await page
      .locator(`.inline-calendar [data-date="${ymd(day)}"]`)
      .click();
  }
}

const savedShifts=page=>page.evaluate(()=>
  globalThis.__stubDb.saved_shifts.map(args=>({
    id:args.p_shift_id,
    date:args.p_shift_date,
    employee:args.p_employee_id,
    point:args.p_point_id,
    shk:args.p_shk,
    bonuses:(args.p_bonuses || []).map(item=>item.id)
  }))
);

test.use({
  viewport:{width:402,height:874},
  colorScheme:"dark"
});

test(
  "one form creates a shift on every chosen day",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    const row=page.locator("#f-date-open");

    /* Первый выбранный день заменяет подставленную дату. */
    await pickDays(page,[4]);
    await expect(row).toContainText(`4 сентября ${YEAR}`);

    /* Дальше дни набираются, и видно, сколько их. */
    await pickDays(page,[5,6]);
    await expect(row).toContainText("3 даты: 4–6");

    await expect(
      page.locator(".date-chip")
    ).toHaveCount(3);

    /* Лишний день снимается и из календаря, и из списка. */
    await page
      .locator(`.inline-calendar [data-date="${ymd(6)}"]`)
      .click();

    /* Соседние дни сворачиваются в промежуток. */
    await expect(row).toContainText("2 даты: 4–5");

    await closeDates(page);
    await chooseInline(page,"#f-point-open","data-shift-point","point-1");
    await chooseInline(page,"#f-employee-open","data-shift-employee","employee-2");
    await page.locator("#f-shk").fill("300");

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Создано 2 смены");

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);

    const saved=await savedShifts(page);

    expect(saved.map(item=>item.date)).toEqual([
      ymd(4),
      ymd(5)
    ]);

    /* Параметры общие, а записи — разные. */
    expect(new Set(saved.map(item=>item.id)).size).toBe(2);
    expect(saved.every(item=>item.employee==="employee-2")).toBe(true);
    expect(saved.every(item=>item.point==="point-1")).toBe(true);
    expect(saved.every(item=>item.shk===300)).toBe(true);

    await expect(
      page.locator(".shift-scroll .sh")
    ).toHaveCount(2);
  }
);

test(
  "each created shift gets its own bonus rows",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();

    await pickDays(page,[8,9]);
    await closeDates(page);

    await chooseInline(page,"#f-point-open","data-shift-point","point-1");
    await chooseInline(page,"#f-employee-open","data-shift-employee","employee-2");
    await page.locator("#f-shk").fill("300");

    await page.locator('[data-adjustment-add="bonuses"]').click();
    await page.locator("[data-adjustment-amount]").fill("500");
    await page.locator("[data-adjustment-comment]").fill("Переработка");

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Создано 2 смены");

    const saved=await savedShifts(page);

    /*
      Один идентификатор премии на две смены сервер принял бы за одну и
      ту же запись: у каждой смены свои.
    */
    expect(saved[0].bonuses).toHaveLength(1);
    expect(saved[1].bonuses).toHaveLength(1);
    expect(saved[0].bonuses[0]).not.toBe(saved[1].bonuses[0]);
  }
);

test(
  "days that already have the same shift are skipped, not duplicated",
  async({page})=>{
    await openApp(page,{
      seed:seed({shifts:[{date:ymd(12)}]})
    });

    await page.locator("#shiftAdd").click();

    await pickDays(page,[11,12,13]);
    await closeDates(page);

    await chooseInline(page,"#f-point-open","data-shift-point","point-1");
    await chooseInline(page,"#f-employee-open","data-shift-employee","employee-2");
    await page.locator("#f-shk").fill("300");

    /* Занятый день помечен ещё в календаре. */
    await openDates(page);

    await expect(
      page.locator(`.inline-calendar [data-date="${ymd(12)}"]`)
    ).toHaveClass(/\btaken\b/);

    await closeDates(page);

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#appConfirmDetail")
    ).toContainText("12 сентября");

    await page.locator("#appConfirmOk").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Создано 2 смены");

    expect(
      (await savedShifts(page)).map(item=>item.date)
    ).toEqual([ymd(11),ymd(13)]);
  }
);

test(
  "a duplicate on a single date needs a deliberate confirmation",
  async({page})=>{
    await openApp(page,{
      seed:seed({shifts:[{date:ymd(12)}]})
    });

    await page.locator("#shiftAdd").click();

    await pickDays(page,[12]);
    await closeDates(page);

    await chooseInline(page,"#f-point-open","data-shift-point","point-1");
    await chooseInline(page,"#f-employee-open","data-shift-employee","employee-2");
    await page.locator("#f-shk").fill("300");

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#appConfirmTitle")
    ).toContainText("На эту дату смена уже есть");

    /* Отказ ничего не создаёт и оставляет форму открытой. */
    await page.locator("#appConfirmCancel").click();

    expect(await savedShifts(page)).toEqual([]);

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    await page.locator("#sheetSave").click();
    await page.locator("#appConfirmOk").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена сохранена");

    expect(
      (await savedShifts(page)).map(item=>item.date)
    ).toEqual([ymd(12)]);
  }
);

test(
  "editing a saved shift stays on its own single date",
  async({page})=>{
    await openApp(page,{
      seed:seed({shifts:[{date:ymd(12)}]})
    });

    await page.locator(".shift-scroll .sh").first().click();

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    /* Открытая смена — режим просмотра, правка начинается с «Изменить». */
    await page.locator("#sheetSave").click();

    const row=page.locator("#f-date-open");

    await row.click();
    await settle(page,"shiftDateReveal");

    /* Ни списка выбранных дат, ни набора: у сохранённой смены одна дата. */
    await expect(
      page.locator(".date-chosen")
    ).toHaveCount(0);

    await page
      .locator(`.inline-calendar [data-date="${ymd(15)}"]`)
      .click();

    await expect(row).toHaveAttribute("aria-expanded","false");
    await expect(row).toContainText(`15 сентября ${YEAR}`);

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена сохранена");

    const saved=await savedShifts(page);

    /* Одна запись, тот же идентификатор — смена перенесена, а не создана. */
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("existing-0");
    expect(saved[0].date).toBe(ymd(15));
  }
);
