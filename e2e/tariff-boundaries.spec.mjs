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
  Тариф смены определяется её собственной датой: последний тариф ПВЗ,
  начавший действовать не позже этой даты. Здесь это проверяется на
  границе — за день до перехода, в сам день и после, — и на пачке дат,
  создаваемой одной формой.
*/

const Y=FROZEN_TODAY.getFullYear();
const M=FROZEN_TODAY.getMonth()+1;

const ymd=day=>
  `${Y}-${String(M).padStart(2,"0")}-${String(day).padStart(2,"0")}`;

/* ПВЗ с историей тарифов: 3000 с 1-го, 3500 с 10-го, 4000 с 20-го. */
function seed({shifts=[]}={}){
  const source=structuredClone(ADMIN_SEED);

  source.point_tariffs=[
    {
      id:"t-1000",
      point_id:"point-2",
      effective_from:`${Y}-${String(M).padStart(2,"0")}-01`,
      pricing_type:"fixed",
      fixed_rate:3000,
      shk_tiers:null,
      created_at:`${Y}-01-01T00:00:00Z`
    },
    {
      id:"t-3500",
      point_id:"point-2",
      effective_from:ymd(10),
      pricing_type:"fixed",
      fixed_rate:3500,
      shk_tiers:null,
      created_at:`${Y}-01-01T00:00:00Z`
    },
    {
      id:"t-4000",
      point_id:"point-2",
      effective_from:ymd(20),
      pricing_type:"fixed",
      fixed_rate:4000,
      shk_tiers:null,
      created_at:`${Y}-01-01T00:00:00Z`
    },
    {
      id:"t-shk",
      point_id:"point-1",
      effective_from:`${Y}-${String(M).padStart(2,"0")}-01`,
      pricing_type:"shk_tiers",
      fixed_rate:null,
      shk_tiers:[
        {up_to:350,rate:3000},
        {up_to:650,rate:5500}
      ],
      created_at:`${Y}-01-01T00:00:00Z`
    }
  ];

  source.shifts=shifts;

  return source;
}

async function settle(page,key){
  await expect
    .poll(()=>page
      .locator(`[data-key="${key}"]`)
      .evaluate(node=>node.getAnimations().length))
    .toBe(0);
}

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

  await closeDates(page);
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

/*
  Приложение узнаёт о новом тарифе не мгновенно: данные обновляются тем
  же путём, что и при восстановлении сети. Ждём не время, а появление
  пояснения в самой карточке смены — единственный признак, который видит
  и человек.
*/
async function waitForTariffNote(page){
  await expect
    .poll(async()=>{
      if(
        await page.locator("#sheet.on").count()===0
      ){
        await page.locator(".shift-scroll .sh").first().click();
      }

      const found=await page
        .locator(".shift-tariff-note")
        .count();

      if(!found){
        await page.locator("#sheetCancel").click();
        await page.evaluate(()=>{
          window.dispatchEvent(new Event("online"));
        });
      }

      return found;
    },{timeout:15000})
    .toBe(1);
}

/* Что в действительности лежит в базе после сохранения. */
const storedShifts=page=>page.evaluate(()=>
  globalThis.__stubDb.shifts
    .map(shift=>({
      date:shift.shift_date,
      base:Number(shift.base_amount),
      rate:Number(shift.pricing_snapshot.rate),
      from:shift.pricing_snapshot.effectiveFrom,
      tariff:shift.pricing_snapshot.tariffId
    }))
    .sort((first,second)=>
      first.date.localeCompare(second.date)
    )
);

test.use({
  viewport:{width:402,height:874},
  colorScheme:"dark"
});

/*
  Тот самый случай: одна форма, даты по обе стороны от перехода.
  Раньше вторая смена уносила ставку первой.
*/
test(
  "shifts created in one batch each take the tariff of their own date",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();

    await pickDays(page,[9,10,11,19,20,21]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Создано 6 смен");

    expect(await storedShifts(page)).toEqual([
      {date:ymd(9),base:3000,rate:3000,from:`${Y}-${String(M).padStart(2,"0")}-01`,tariff:"t-1000"},
      {date:ymd(10),base:3500,rate:3500,from:ymd(10),tariff:"t-3500"},
      {date:ymd(11),base:3500,rate:3500,from:ymd(10),tariff:"t-3500"},
      {date:ymd(19),base:3500,rate:3500,from:ymd(10),tariff:"t-3500"},
      {date:ymd(20),base:4000,rate:4000,from:ymd(20),tariff:"t-4000"},
      {date:ymd(21),base:4000,rate:4000,from:ymd(20),tariff:"t-4000"}
    ]);
  }
);

/*
  Ровно тот случай из отчёта: у ПВЗ нет тарифа раньше 21-го, тариф 3000
  начинается в этот самый день (он же «сегодня»), а 3500 — с 24-го.
  Обе смены заводятся одной формой.
*/
test(
  "the reported case: tariffs from the 21st and the 24th",
  async({page})=>{
    const source=structuredClone(ADMIN_SEED);

    source.point_tariffs=[
      {
        id:"t-21",
        point_id:"point-2",
        effective_from:ymd(21),
        pricing_type:"fixed",
        fixed_rate:3000,
        shk_tiers:null,
        created_at:`${Y}-01-01T00:00:00Z`
      },
      {
        id:"t-24",
        point_id:"point-2",
        effective_from:ymd(24),
        pricing_type:"fixed",
        fixed_rate:3500,
        shk_tiers:null,
        created_at:`${Y}-01-01T00:00:00Z`
      }
    ];

    source.shifts=[];

    await openApp(page,{seed:source});

    await page.locator("#shiftAdd").click();

    await pickDays(page,[21,24]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Создано 2 смены");

    expect(await storedShifts(page)).toEqual([
      {date:ymd(21),base:3000,rate:3000,from:ymd(21),tariff:"t-21"},
      {date:ymd(24),base:3500,rate:3500,from:ymd(24),tariff:"t-24"}
    ]);
  }
);

/* За день до перехода, в сам день перехода и после него. */
for(const [day,rate,tariff,from] of [
  [9,3000,"t-1000",`${Y}-${String(M).padStart(2,"0")}-01`],
  [10,3500,"t-3500",ymd(10)],
  [11,3500,"t-3500",ymd(10)],
  [20,4000,"t-4000",ymd(20)]
]){
  test(
    `a single shift on day ${day} takes the tariff of its own date`,
    async({page})=>{
      await openApp(page,{seed:seed()});

      await page.locator("#shiftAdd").click();
      await pickDays(page,[day]);

      await chooseInline(page,"#f-point-open","data-shift-point","point-2");
      await chooseInline(
        page,
        "#f-employee-open",
        "data-shift-employee",
        "employee-2"
      );

      await page.locator("#sheetSave").click();

      await expect(
        page.locator("#toast")
      ).toContainText("Смена сохранена");

      expect(await storedShifts(page)).toEqual([
        {date:ymd(day),base:rate,rate,from,tariff}
      ]);
    }
  );
}

/*
  Перенос смены на другую сторону границы — это уже другая дата, значит и
  тариф другой: снимок пересчитывается.
*/
test(
  "moving a saved shift across the boundary reprices it",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[9]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator("#sheetSave").click();
    await expect(page.locator("#sheet")).not.toHaveClass(/\bon\b/);

    expect((await storedShifts(page))[0].base).toBe(3000);

    await page.locator(".shift-scroll .sh").first().click();
    await page.locator("#sheetSave").click();

    await page.locator("#f-date-open").click();
    await settle(page,"shiftDateReveal");

    await page
      .locator(`.inline-calendar [data-date="${ymd(11)}"]`)
      .click();

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена сохранена");

    expect(await storedShifts(page)).toEqual([
      {date:ymd(11),base:3500,rate:3500,from:ymd(10),tariff:"t-3500"}
    ]);
  }
);

/*
  Уже сохранённая смена свой тариф не теряет: новый тариф с более ранней
  даты не переписывает то, что было посчитано раньше.
*/
test(
  "an existing shift keeps its price when a new tariff appears",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[9]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator("#sheetSave").click();
    await expect(page.locator("#sheet")).not.toHaveClass(/\bon\b/);

    /* Появляется тариф, действующий и на эту дату. */
    await page.evaluate(day=>{
      globalThis.__stubDb.point_tariffs.push({
        id:"t-late",
        point_id:"point-2",
        effective_from:day,
        pricing_type:"fixed",
        fixed_rate:9000,
        shk_tiers:null,
        created_at:"2026-01-01T00:00:00Z"
      });
    },ymd(5));

    /* Смену открывают и сохраняют, ничего в ней не меняя. */
    await page.locator(".shift-scroll .sh").first().click();
    await page.locator("#sheetSave").click();
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена сохранена");

    /* Цена осталась прежней: пересчитывать её никто не просил. */
    expect(await storedShifts(page)).toEqual([
      {date:ymd(9),base:3000,rate:3000,from:`${Y}-${String(M).padStart(2,"0")}-01`,tariff:"t-1000"}
    ]);
  }
);

/*
  Запланированный тариф не действует раньше срока: смена до его начала
  считается по текущему.
*/
test(
  "a tariff planned for the future does not touch earlier shifts",
  async({page})=>{
    const source=seed();

    source.point_tariffs.push({
      id:"t-future",
      point_id:"point-2",
      effective_from:`${Y}-${String(M+1).padStart(2,"0")}-01`,
      pricing_type:"fixed",
      fixed_rate:9000,
      shk_tiers:null,
      created_at:`${Y}-01-01T00:00:00Z`
    });

    await openApp(page,{seed:source});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[25]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена сохранена");

    expect(await storedShifts(page)).toEqual([
      {date:ymd(25),base:4000,rate:4000,from:ymd(20),tariff:"t-4000"}
    ]);
  }
);

/*
  Неполная смена делит ставку своей даты, а не чужой.
*/
test(
  "a partial shift is prorated from the tariff of its own date",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[9,20]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator('[data-part="1"]').click();
    await page.locator("#f-hours").fill("6");

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Создано 2 смены");

    /* Половина смены — половина ставки своего дня. */
    expect(await storedShifts(page)).toEqual([
      {date:ymd(9),base:1500,rate:3000,from:`${Y}-${String(M).padStart(2,"0")}-01`,tariff:"t-1000"},
      {date:ymd(20),base:2000,rate:4000,from:ymd(20),tariff:"t-4000"}
    ]);
  }
);

/*
  Дополнительная смена считается по тому же тарифу даты, что и основная.
*/
test(
  "an extra shift uses the same date-based tariff as a main one",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[20]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator('[data-type="extra"]').click();
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена сохранена");

    expect(await storedShifts(page)).toEqual([
      {date:ymd(20),base:4000,rate:4000,from:ymd(20),tariff:"t-4000"}
    ]);
  }
);

/*
  Тариф по ШК берётся тоже по дате смены, а ставка — по объёму.
*/
test(
  "an shk tariff picks the tier by volume and the version by date",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[15]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-1");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator("#f-shk").fill("500");
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена сохранена");

    expect(await storedShifts(page)).toEqual([
      {
        date:ymd(15),
        base:5500,
        rate:5500,
        from:`${Y}-${String(M).padStart(2,"0")}-01`,
        tariff:"t-shk"
      }
    ]);
  }
);

/*
  Смена ПВЗ у сохранённой смены пересчитывает её по тарифу нового ПВЗ на
  ту же дату.
*/
test(
  "changing the point of a saved shift reprices it by the new point",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[15]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator("#sheetSave").click();
    await expect(page.locator("#sheet")).not.toHaveClass(/\bon\b/);

    expect((await storedShifts(page))[0].rate).toBe(3500);

    await page.locator(".shift-scroll .sh").first().click();
    await page.locator("#sheetSave").click();

    await chooseInline(page,"#f-point-open","data-shift-point","point-1");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator("#f-shk").fill("200");
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена сохранена");

    expect(await storedShifts(page)).toEqual([
      {
        date:ymd(15),
        base:3000,
        rate:3000,
        from:`${Y}-${String(M).padStart(2,"0")}-01`,
        tariff:"t-shk"
      }
    ]);
  }
);

/*
  Корректировка оклада заменяет сумму, но не тариф: снимок остаётся тем
  же, и видно, от чего отступили.
*/
test(
  "a salary override replaces the amount but not the tariff snapshot",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[20]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator('[data-pay-mode="manual"]').click();
    await page.locator("#f-base-override").fill("4500");
    await page.locator("#f-base-reason").fill("Доплата за выход");

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена сохранена");

    expect(await storedShifts(page)).toEqual([
      {date:ymd(20),base:4500,rate:4000,from:ymd(20),tariff:"t-4000"}
    ]);
  }
);

/*
  Премии и штрафы прибавляются к оплате своей даты, а не меняют ставку.
*/
test(
  "bonuses and penalties add to the amount of each date",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[9,20]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator('[data-adjustment-add="bonuses"]').click();
    await page.locator("[data-adjustment-amount]").fill("500");
    await page.locator("[data-adjustment-comment]").fill("Переработка");

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Создано 2 смены");

    /* Ставка у каждой своя, премия одинаковая. */
    expect(await storedShifts(page)).toEqual([
      {date:ymd(9),base:3000,rate:3000,from:`${Y}-${String(M).padStart(2,"0")}-01`,tariff:"t-1000"},
      {date:ymd(20),base:4000,rate:4000,from:ymd(20),tariff:"t-4000"}
    ]);

    /* Итог месяца — оплата обеих смен плюс обе премии. */
    await page.locator("#tab-stats").click();
    await page.locator("#statsEmployeeOpen").click();
    await page.locator('[data-stats-employee="employee-2"]').click();

    await expect(
      page.locator("#app")
    ).toContainText("8 000");
  }
);

/*
  Тариф заведён после смены — ровно то, из-за чего цена смены выглядит
  «неправильной». Смена сама не пересчитывается, но приложение объясняет
  почему и даёт пересчитать явно.
*/
test(
  "a shift priced before a newer tariff explains itself and can be repriced",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[15]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator("#sheetSave").click();
    await expect(page.locator("#sheet")).not.toHaveClass(/\bon\b/);

    expect((await storedShifts(page))[0].base).toBe(3500);

    /* Появляется тариф, который действует и на эту дату. */
    await page.evaluate(day=>{
      globalThis.__stubDb.point_tariffs.push({
        id:"t-later",
        point_id:"point-2",
        effective_from:day,
        pricing_type:"fixed",
        fixed_rate:5000,
        shk_tiers:null,
        created_at:"2026-01-01T00:00:00Z"
      });
    },ymd(14));

    /*
      Перезагружать страницу нельзя — стаб держит базу в памяти. Данные
      обновляются так же, как их обновляет само приложение при
      восстановлении сети.
    */
    await page.evaluate(()=>{
      window.dispatchEvent(new Event("online"));
    });

    await waitForTariffNote(page);

    /* Видно, по какому тарифу посчитано, и что сейчас тариф другой. */
    const card=page.locator("#sheetBody");

    await expect(card).toContainText("3 500 ₽ · тариф с");
    await expect(card).toContainText("Сейчас на");
    await expect(card).toContainText("5 000 ₽");

    /* Сама смена не пересчиталась. */
    expect((await storedShifts(page))[0].base).toBe(3500);

    await page.locator("#sheetSave").click();
    await page.locator("#f-reprice").click();
    await page.locator("#appConfirmOk").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена пересчитана");

    expect(await storedShifts(page)).toEqual([
      {date:ymd(15),base:5000,rate:5000,from:ymd(14),tariff:"t-later"}
    ]);
  }
);

/* Смену с ручной суммой пересчёт не предлагается и не трогает. */
test(
  "a shift with a manual amount is not offered for repricing",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[15]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator('[data-pay-mode="manual"]').click();
    await page.locator("#f-base-override").fill("4200");
    await page.locator("#f-base-reason").fill("Договорённость");

    await page.locator("#sheetSave").click();
    await expect(page.locator("#sheet")).not.toHaveClass(/\bon\b/);

    await page.evaluate(day=>{
      globalThis.__stubDb.point_tariffs.push({
        id:"t-later",
        point_id:"point-2",
        effective_from:day,
        pricing_type:"fixed",
        fixed_rate:5000,
        shk_tiers:null,
        created_at:"2026-01-01T00:00:00Z"
      });
    },ymd(14));

    /*
      Перезагружать страницу нельзя — стаб держит базу в памяти. Данные
      обновляются так же, как их обновляет само приложение при
      восстановлении сети.
    */
    await page.evaluate(()=>{
      window.dispatchEvent(new Event("online"));
    });

    await waitForTariffNote(page);

    /* Расхождение объяснено и в карточке, и в правке. */
    await expect(
      page.locator(".shift-tariff-note")
    ).toContainText("задана вручную");

    await page.locator("#sheetSave").click();

    await expect(
      page.locator(".shift-tariff-note")
    ).toContainText("задана вручную");

    await expect(
      page.locator("#f-reprice")
    ).toHaveCount(0);

    expect((await storedShifts(page))[0].base).toBe(4200);
  }
);

/*
  Ставку существующего тарифа можно изменить на месте: идентификатор
  тогда прежний, а деньги другие. Расхождение считается по ставке, иначе
  такой случай остался бы незамеченным.
*/
test(
  "editing the rate of the same tariff is noticed too",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator("#shiftAdd").click();
    await pickDays(page,[15]);

    await chooseInline(page,"#f-point-open","data-shift-point","point-2");
    await chooseInline(
      page,
      "#f-employee-open",
      "data-shift-employee",
      "employee-2"
    );

    await page.locator("#sheetSave").click();
    await expect(page.locator("#sheet")).not.toHaveClass(/\bon\b/);

    /* Тот же тариф, другая ставка. */
    await page.evaluate(()=>{
      const tariff=globalThis.__stubDb.point_tariffs.find(item=>
        item.id==="t-3500"
      );

      tariff.fixed_rate=4800;
    });

    await waitForTariffNote(page);

    await expect(
      page.locator(".shift-tariff-note")
    ).toContainText("4 800 ₽");

    await page.locator("#sheetSave").click();
    await page.locator("#f-reprice").click();
    await page.locator("#appConfirmOk").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена пересчитана");

    expect(await storedShifts(page)).toEqual([
      {date:ymd(15),base:4800,rate:4800,from:ymd(10),tariff:"t-3500"}
    ]);
  }
);
