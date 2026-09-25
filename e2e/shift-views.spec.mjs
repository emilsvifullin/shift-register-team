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
  «Смены» показывают один и тот же месяц тремя способами. Проверяется то,
  ради чего эти способы и существуют: календарь отвечает на вопрос «что в
  этом дне», контроль — «где вообще пропуски», а реестр от их появления
  не изменился.

  Отдельно закреплены две вещи, которые легко сломать незаметно:
  геометрия (панель дня по высоте календаря, число дня над центром своей
  клетки) и лента ПВЗ, до дальних пунктов которой нужно доставать и
  мышью, и пальцем.
*/

const YEAR=FROZEN_TODAY.getFullYear();

const MONTH=String(
  FROZEN_TODAY.getMonth()+1
).padStart(2,"0");

const day=number=>
  `${YEAR}-${MONTH}-${
    String(number).padStart(2,"0")
  }`;

const POINT_NAMES=[
  "Коммунальная 10",
  "Корабельная 1",
  "Ленинградская 45",
  "Металлургов 7",
  "Набережная 12",
  "Октябрьская 3",
  "Пушкина 101"
];

/*
  Сегодня — 21-е. Смены сеются только по 1..20, поэтому дни 22 и дальше
  заведомо «впереди», а пропуски приходятся на прошедшие дни.
*/
function seed({
  points=POINT_NAMES.length,
  days=[1,2,3,5,7,8,10,12,14,17,19,20]
}={}){
  const source=structuredClone(ADMIN_SEED);

  source.points=POINT_NAMES
    .slice(0,points)
    .map((name,index)=>({
      id:`point-${index}`,
      code:`p${index}`,
      name,
      active:true,
      advance_enabled:true
    }));

  const shifts=[];

  source.points.forEach((point,index)=>{
    for(const number of days.slice(0,days.length-index)){
      shifts.push({
        id:`shift-${point.id}-${number}`,
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
          fullHours:12
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
      });
    }
  });

  source.shifts=shifts;

  return source;
}

async function openCalendar(page){
  await page
    .locator('[data-shift-view="calendar"]')
    .click();

  await expect(
    page.locator(".sv-calendar")
  ).toBeVisible();
}

function stripState(page){
  return page.evaluate(()=>{
    const frame=document.querySelector(
      "[data-points-strip]"
    );

    const strip=document.querySelector(
      "[data-points-chips]"
    );

    return {
      overflow:Math.round(
        strip.scrollWidth-strip.clientWidth
      ),
      left:Math.round(strip.scrollLeft),
      start:frame.classList.contains("has-start"),
      end:frame.classList.contains("has-end"),
      back:frame.querySelector(
        '[data-points-scroll="-1"]'
      ).disabled,
      ahead:frame.querySelector(
        '[data-points-scroll="1"]'
      ).disabled
    };
  });
}

test.describe("desktop",()=>{
  test.use({
    viewport:{width:1440,height:940}
  });

  test(
    "the three views answer three questions about one month",
    async({page})=>{
      await openApp(page,{seed:seed()});

      await expect(
        page.locator("[data-shift-view]")
      ).toHaveText([
        "Реестр",
        "Календарь",
        "Контроль"
      ]);

      /* Раздел открывается реестром. */
      await expect(
        page.locator("#shiftListArea")
      ).toBeVisible();

      await openCalendar(page);

      await expect(
        page.locator("#shiftListArea")
      ).toHaveCount(0);

      await page
        .locator('[data-shift-view="control"]')
        .click();

      await expect(
        page.locator(".sv-control")
      ).toBeVisible();

      await page
        .locator('[data-shift-view="registry"]')
        .click();

      await expect(
        page.locator("#shiftListArea")
      ).toBeVisible();
    }
  );

  test(
    "the registry keeps its own layout and settings",
    async({page})=>{
      await openApp(page,{seed:seed()});

      await page
        .locator("#shiftSearch")
        .fill("Корабельная");

      const found=await page
        .locator(".sh")
        .count();

      expect(found).toBeGreaterThan(0);

      await openCalendar(page);

      /*
        Реестр подгоняет список под остаток высоты, календарь — нет.
        Класс раскладки должен сниматься и возвращаться вместе с режимом.
      */
      await expect(
        page.locator("#app")
      ).not.toHaveClass(/shifts-layout/);

      await page
        .locator('[data-shift-view="registry"]')
        .click();

      await expect(
        page.locator("#app")
      ).toHaveClass(/shifts-layout/);

      await expect(
        page.locator("#shiftSearch")
      ).toHaveValue("Корабельная");

      await expect(
        page.locator(".sh")
      ).toHaveCount(found);
    }
  );

  test(
    "the calendar separates days with shifts, gaps and days ahead",
    async({page})=>{
      await openApp(page,{seed:seed({points:1})});
      await openCalendar(page);

      await page
        .locator('[data-calendar-point="point-0"]')
        .click();

      /*
        Сентябрь: 30 дней, сегодня 21-е. Смен 12 дней, значит прошедших
        без смен ровно 9, а впереди — остальные 9.
      */
      await expect(
        page.locator(".sv-day.has")
      ).toHaveCount(12);

      await expect(
        page.locator(".sv-day.missed")
      ).toHaveCount(9);

      await expect(
        page.locator(".sv-day.ahead")
      ).toHaveCount(9);

      await expect(
        page.locator(".sv-summary")
      ).toContainText("прошло без смен");

      /* День без смен так и говорит, а не притворяется пустым. */
      await page
        .locator(`[data-calendar-day="${day(4)}"]`)
        .click();

      await expect(
        page.locator(".sv-panel")
      ).toContainText("В этот день смен не записано");

      await page
        .locator(`[data-calendar-day="${day(3)}"]`)
        .click();

      await expect(
        page.locator(".sv-panel-date")
      ).toContainText("3 сентября 2026");

      await expect(
        page.locator(".sv-panel-list .sh")
      ).toHaveCount(1);
    }
  );

  test(
    "the day panel matches the calendar height either way",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);

      const geometry=()=>page.evaluate(()=>{
        const calendar=document
          .querySelector(".sv-calendar")
          .getBoundingClientRect();

        const panel=document
          .querySelector(".sv-panel")
          .getBoundingClientRect();

        const list=document.querySelector(
          ".sv-panel-list"
        );

        return {
          top:Math.round(calendar.top-panel.top),
          bottom:Math.round(
            calendar.bottom-panel.bottom
          ),
          /* Список не выталкивает панель за её собственный низ. */
          listInside:list
            ? list.getBoundingClientRect().bottom<=
              panel.bottom+1
            : true
        };
      });

      /* Пустой день. */
      await page
        .locator(`[data-calendar-day="${day(22)}"]`)
        .click();

      expect(await geometry()).toEqual({
        top:0,
        bottom:0,
        listInside:true
      });

      /* День со сменами всех семи ПВЗ. */
      await page
        .locator(`[data-calendar-day="${day(1)}"]`)
        .click();

      await expect(
        page.locator(".sv-panel-list .sh")
      ).toHaveCount(7);

      expect(await geometry()).toEqual({
        top:0,
        bottom:0,
        listInside:true
      });

      /*
        И когда смен заведомо больше, чем помещается: панель остаётся той
        же высоты, а прокручивается список внутри неё.
      */
      await page.setViewportSize({
        width:1440,
        height:620
      });

      const tight=await page.evaluate(()=>{
        const calendar=document
          .querySelector(".sv-calendar")
          .getBoundingClientRect();

        const panel=document
          .querySelector(".sv-panel")
          .getBoundingClientRect();

        const list=document.querySelector(
          ".sv-panel-list"
        );

        return {
          top:Math.round(calendar.top-panel.top),
          bottom:Math.round(
            calendar.bottom-panel.bottom
          ),
          scrolls:
            list.scrollHeight>list.clientHeight+1
        };
      });

      expect(tight.top).toBe(0);
      expect(tight.bottom).toBe(0);
      expect(tight.scrolls).toBe(true);
    }
  );

  test(
    "a shift added from a day keeps its date, its point and the other dates",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);

      await page
        .locator('[data-calendar-point="point-1"]')
        .click();

      await page
        .locator(`[data-calendar-day="${day(9)}"]`)
        .click();

      await page
        .locator("[data-calendar-add]")
        .click();

      await expect(
        page.locator("#sheetTitle")
      ).toContainText("Новая смена");

      await expect(
        page.locator("#f-date-open")
      ).toContainText("9 сентября 2026");

      /* Контекст календаря переносится: ПВЗ выбирать заново не нужно. */
      await expect(
        page.locator("#f-point-open")
      ).toContainText("Корабельная 1");

      /*
        Дату выбрал человек, поэтому следующий день добавляется к ней, а
        не заменяет её: мультивыбор из календаря должен остаться.
      */
      await page.locator("#f-date-open").click();

      await page
        .locator(`#sheet [data-date="${day(11)}"]`)
        .click();

      await expect(
        page.locator(".date-chip")
      ).toHaveCount(2);

      await expect(
        page.locator(".date-chosen-head")
      ).toContainText("Выбрано 2 даты");
    }
  );

  test(
    "every day number sits over the middle of its own column",
    async({page})=>{
      await openApp(page,{seed:seed()});

      await page
        .locator('[data-shift-view="control"]')
        .click();

      const drift=()=>page.evaluate(()=>{
        const heads=[
          ...document.querySelectorAll(
            ".sv-control thead th"
          )
        ].slice(1);

        const cells=[
          ...document.querySelectorAll(
            ".sv-control tbody tr:first-child .sv-cell button"
          )
        ];

        let worst=0;

        heads.forEach((head,index)=>{
          const cell=cells[index];

          if(!cell){
            return;
          }

          const a=head.getBoundingClientRect();
          const b=cell.getBoundingClientRect();

          worst=Math.max(
            worst,
            Math.abs(
              (a.left+a.width/2)-
              (b.left+b.width/2)
            )
          );
        });

        return {
          columns:heads.length,
          cells:cells.length,
          worst:Math.round(worst*100)/100
        };
      });

      const wide=await drift();

      expect(wide.columns).toBe(30);
      expect(wide.cells).toBe(30);
      expect(wide.worst).toBeLessThanOrEqual(0.5);

      /* Другая ширина окна сетку не перекашивает. */
      await page.setViewportSize({
        width:1100,
        height:940
      });

      expect((await drift()).worst)
        .toBeLessThanOrEqual(0.5);

      /* И месяц другой длины тоже. */
      await page.locator("#prevM").click();

      await expect
        .poll(()=>drift().then(state=>state.columns))
        .toBe(31);

      expect((await drift()).worst)
        .toBeLessThanOrEqual(0.5);
    }
  );

  test(
    "a control cell opens that day in the calendar",
    async({page})=>{
      await openApp(page,{seed:seed()});

      await page
        .locator('[data-shift-view="control"]')
        .click();

      await page
        .locator(
          `[data-control-cell="point-2|${day(12)}"]`
        )
        .click();

      await expect(
        page.locator('[data-shift-view="calendar"]')
      ).toHaveClass(/\bon\b/);

      await expect(
        page.locator('[data-calendar-point="point-2"]')
      ).toHaveClass(/\bon\b/);

      await expect(
        page.locator(".sv-panel-date")
      ).toContainText("12 сентября 2026");
    }
  );

  test(
    "the point strip reaches every point with a mouse",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);

      const start=await stripState(page);

      expect(start.overflow).toBeGreaterThan(0);
      expect(start.back).toBe(true);
      expect(start.ahead).toBe(false);
      expect(start.end).toBe(true);

      /* Колесо мыши шлёт только deltaY — лента всё равно едет. */
      await page
        .locator("[data-points-chips]")
        .hover();

      await page.mouse.wheel(0,240);

      await expect
        .poll(()=>
          stripState(page).then(state=>state.left)
        )
        .toBeGreaterThan(0);

      /*
        Горизонтальный жест над лентой принадлежит ей: листание месяцев
        слушает его на всём документе.
      */
      const month=await page
        .locator("#period")
        .innerText();

      for(let step=0;step<6;step++){
        await page.mouse.wheel(-90,0);
      }

      await page.waitForTimeout(600);

      expect(
        await page.locator("#period").innerText()
      ).toBe(month);

      /* Стрелка доводит до конца и там гаснет. */
      for(let step=0;step<10;step++){
        const ahead=page.locator(
          '[data-points-scroll="1"]'
        );

        if(await ahead.isDisabled()){
          break;
        }

        await ahead.click();
        await page.waitForTimeout(380);
      }

      const end=await stripState(page);

      expect(end.ahead).toBe(true);
      expect(end.end).toBe(false);
      expect(end.start).toBe(true);

      /* Дальний ПВЗ выбирается и остаётся на виду. */
      const last=`point-${POINT_NAMES.length-1}`;

      await page
        .locator(`[data-calendar-point="${last}"]`)
        .click();

      /* Лента подтягивает выбранный пункт плавно, поэтому с ожиданием. */
      await expect
        .poll(()=>
          page.evaluate(()=>{
            const strip=document.querySelector(
              "[data-points-chips]"
            );

            const chip=strip.querySelector(
              ".sv-chip.on"
            );

            const a=chip.getBoundingClientRect();
            const b=strip.getBoundingClientRect();

            return (
              a.left>=b.left-2 &&
              a.right<=b.right+2
            );
          })
        )
        .toBe(true);
    }
  );
});

test.describe("mobile",()=>{
  test.use({
    viewport:{width:402,height:874},
    hasTouch:true
  });

  test(
    "the strip scrolls by finger and keeps its arrows away",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);

      /* Пальцем лента двигается сама, стрелки только мешали бы. */
      expect(
        await page.evaluate(()=>
          getComputedStyle(
            document.querySelector(
              "[data-points-scroll]"
            )
          ).display
        )
      ).toBe("none");

      await page.evaluate(()=>{
        const strip=document.querySelector(
          "[data-points-chips]"
        );

        strip.scrollLeft=strip.scrollWidth;
      });

      await expect
        .poll(()=>
          stripState(page).then(state=>state.start)
        )
        .toBe(true);
    }
  );

  test(
    "the day panel follows the calendar in one column",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);

      await page
        .locator(`[data-calendar-day="${day(3)}"]`)
        .click();

      await expect(
        page.locator(".sv-panel-date")
      ).toContainText("3 сентября 2026");

      expect(
        await page.evaluate(()=>{
          const calendar=document
            .querySelector(".sv-calendar")
            .getBoundingClientRect();

          const panel=document
            .querySelector(".sv-panel")
            .getBoundingClientRect();

          return panel.top>=calendar.bottom-1;
        })
      ).toBe(true);
    }
  );
});
