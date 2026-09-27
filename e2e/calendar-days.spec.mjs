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
  Календарь «Смен» как рабочее место, а не только как картинка месяца.

  Здесь закреплено то, что замечали при настоящей работе: календарь
  открывается на сегодняшнем дне, пустой день говорит об этом один раз,
  клетки месяца одного размера независимо от данных, а дни можно выбрать
  и сделать с их сменами что-то разом — не обходя защиту закрытых и
  выплаченных периодов.
*/

const YEAR=FROZEN_TODAY.getFullYear();

const MONTH=String(
  FROZEN_TODAY.getMonth()+1
).padStart(2,"0");

const day=number=>
  `${YEAR}-${MONTH}-${
    String(number).padStart(2,"0")
  }`;

const PEOPLE=[
  ["employee-1","Марина Абрамова"],
  ["employee-2","Роман Белов"]
];

/*
  Два ПВЗ. На первом смены по дням из списка, в чётные дни — у обоих
  сотрудников; на втором — по одной смене в те же дни. Сегодня 21-е.
*/
function seed({
  days=[1,2,3,5,7,8,10,12,14,15,16,17,19,20]
}={}){
  const source=structuredClone(ADMIN_SEED);

  source.points=[
    {
      id:"point-a",
      code:"pa",
      name:"Коммунальная 10",
      active:true,
      advance_enabled:false
    },
    {
      id:"point-b",
      code:"pb",
      name:"Корабельная 1",
      active:true,
      advance_enabled:false
    }
  ];

  const shift=({id,date,point,person})=>({
    id,
    employee_id:person[0],
    shift_date:date,
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
      id:person[0],
      user_id:null,
      full_name:person[1],
      status:"active"
    },
    point:{...point},
    bonuses:[],
    penalties:[]
  });

  const [first,second]=source.points;

  source.shifts=days.flatMap(number=>[
    shift({
      id:`a-${number}-1`,
      date:day(number),
      point:first,
      person:PEOPLE[0]
    }),
    ...(number%2===0
      ? [shift({
          id:`a-${number}-2`,
          date:day(number),
          point:first,
          person:PEOPLE[1]
        })]
      : []),
    shift({
      id:`b-${number}`,
      date:day(number),
      point:second,
      person:PEOPLE[1]
    })
  ]);

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

/*
  Список раскрывается переходом, и нажатие по строке, которая ещё едет,
  на медленной машине промахивается. Ждём не время, а сам переход — как
  с выбором сотрудника в «Итогах».
*/
async function choosePoint(page,id){
  await page.locator("#calendarPointOpen").click();

  const reveal=page.locator('[data-key="calendarPointReveal"]');

  await expect(reveal).toHaveClass(/\bon\b/);

  await expect
    .poll(()=>reveal.evaluate(node=>node.getAnimations({subtree:true}).length))
    .toBe(0);

  await page
    .locator(`[data-calendar-point="${id}"]`)
    .click();

  await expect(
    page.locator("#calendarPointOpen")
  ).toHaveAttribute("aria-expanded","false");
}

const cell=(page,number)=>
  page.locator(`[data-calendar-day="${day(number)}"]`);

/* Высоты всех клеток месяца, по строкам сетки. */
function gridGeometry(page){
  return page.evaluate(()=>{
    const cells=[
      ...document.querySelectorAll(
        ".sv-grid .sv-day:not(.outside)"
      )
    ].map(element=>
      element.getBoundingClientRect()
    );

    const heights=cells.map(box=>
      Math.round(box.height*10)/10
    );

    return {
      count:cells.length,
      min:Math.min(...heights),
      max:Math.max(...heights),
      firstTop:Math.round(cells[0].top),
      lastBottom:Math.round(cells.at(-1).bottom),
      lastHeight:heights.at(-1)
    };
  });
}

test.describe("desktop",()=>{
  test.use({
    viewport:{width:1440,height:940}
  });

  test(
    "the calendar opens on today and remembers a day only within its month",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);

      await expect(cell(page,21)).toHaveClass(/\bon\b/);
      await expect(cell(page,21)).toHaveAttribute("aria-pressed","true");

      await expect(
        page.locator(".sv-panel-date")
      ).toHaveText("21 сентября 2026");

      /* Повторное нажатие не закрывает день: панели без дня тут не бывает. */
      await cell(page,21).click();

      await expect(
        page.locator(".sv-panel-date")
      ).toHaveText("21 сентября 2026");

      await cell(page,3).click();

      await expect(
        page.locator(".sv-panel-date")
      ).toHaveText("3 сентября 2026");

      /* В чужом месяце сентябрьская дата не висит в панели. */
      await page.locator("#prevM").click();

      await expect(
        page.locator(".sv-panel-empty")
      ).toContainText("Выберите день");

      await expect(
        page.locator(".sv-day.on")
      ).toHaveCount(0);

      /* Вернулись — открыт тот день, что выбирали. */
      await page.locator("#nextM").click();

      await expect(
        page.locator(".sv-panel-date")
      ).toHaveText("3 сентября 2026");
    }
  );

  test(
    "a day without shifts says so once",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);
      await choosePoint(page,"point-a");

      await cell(page,4).click();

      await expect(
        page.locator(".sv-panel-sub")
      ).toHaveText("Коммунальная 10");

      const text=await page
        .locator(".sv-panel")
        .innerText();

      expect(
        text.match(/смен/g)
      ).toHaveLength(2);

      expect(text).toContain("В этот день смен не записано.");
      expect(text).toContain("Добавить смену на 4 сентября");

      /* О будущем дне — без «не записано»: там ещё и не должно быть. */
      await cell(page,25).click();

      await expect(
        page.locator(".sv-panel-hint")
      ).toHaveText("На этот день смен пока нет.");

      /* День со сменами: сколько и на какую сумму — в той же строке. */
      await cell(page,2).click();

      await expect(
        page.locator(".sv-panel-sub")
      ).toHaveText("Коммунальная 10 · 2 смены · 6 000 ₽");

      await expect(
        page.locator(".sv-panel-hint")
      ).toHaveCount(0);
    }
  );

  test(
    "every day of the month is the same size whatever it holds",
    async({page})=>{
      const source=seed();

      /* Один перегруженный день: имена не должны растягивать неделю. */
      for(let index=0;index<9;index++){
        source.shifts.push({
          ...source.shifts[0],
          id:`crowded-${index}`
        });
      }

      await openApp(page,{seed:source});
      await openCalendar(page);

      const all=await gridGeometry(page);

      expect(all.count).toBe(30);
      expect(all.max-all.min).toBeLessThanOrEqual(0.5);

      /* Последняя строка месяца — 28, 29, 30 без смен — такая же. */
      expect(all.lastHeight).toBe(all.max);

      /* Выбор ПВЗ и выделенные дни размер не меняют. */
      await choosePoint(page,"point-a");
      await cell(page,28).click();

      const one=await gridGeometry(page);

      expect(one.max-one.min).toBeLessThanOrEqual(0.5);
      expect(one.lastBottom-one.firstTop)
        .toBe(all.lastBottom-all.firstTop);

      /*
        Выбранный будущий день — сплошная рамка в полную силу: пунктир и
        приглушённость будущего дня не должны просвечивать сквозь выбор.
      */
      const selected=await cell(page,28).evaluate(element=>{
        const style=getComputedStyle(element);

        return {
          border:style.borderTopStyle,
          opacity:style.opacity
        };
      });

      expect(selected).toEqual({
        border:"solid",
        opacity:"1"
      });
    }
  );

  test(
    "days are picked in the calendar and their shifts removed together",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);
      await choosePoint(page,"point-a");

      await page.locator("[data-calendar-pick-mode]").click();

      await expect(
        page.locator("[data-calendar-pick-mode]")
      ).toHaveText("Готово");

      /* В режиме выбора открытого дня нет — есть отмеченные. */
      await expect(page.locator(".sv-day.on")).toHaveCount(0);

      await expect(
        page.locator(".sv-panel-date")
      ).toHaveText("Выбор дней");

      await cell(page,2).click();
      await cell(page,3).click();
      await cell(page,4).click();

      await expect(page.locator(".sv-day.picked")).toHaveCount(3);

      /* Пустой день выбрать можно, в смены он ничего не добавляет. */
      await expect(
        page.locator(".sv-panel-date")
      ).toHaveText("Выбрано 3 дня");

      /* Только смены выбранного ПВЗ: 2-го две, 3-го одна. */
      await expect(
        page.locator("[data-calendar-pick-shift]")
      ).toHaveCount(3);

      await expect(
        page.locator(".sv-panel-sub")
      ).toHaveText("Коммунальная 10 · 3 смены · 9 000 ₽");

      /* Смену другого человека из дня можно исключить. */
      await page
        .locator('[data-calendar-pick-shift="a-2-2"]')
        .click();

      await expect(
        page.locator('[data-calendar-pick-shift="a-2-2"]')
      ).toHaveAttribute("aria-pressed","false");

      await expect(
        page.locator("[data-calendar-delete-picked]")
      ).toHaveText("Удалить 2 смены");

      await page.locator("[data-calendar-delete-picked]").click();

      await expect(
        page.locator("#appConfirmTitle")
      ).toHaveText("Удалить 2 смены?");

      /* Подпись называет именно выбранные дни, а не их размах. */
      await expect(
        page.locator("#appConfirmDetail")
      ).toContainText("2, 3 сентября · Марина Абрамова · 6 000 ₽");

      await page.locator("#appConfirmOk").click();

      await expect(page.locator("#toast"))
        .toHaveText("Удалено 2 смены",{timeout:15000});

      const left=await page.evaluate(()=>
        window.__stubDb.shifts.map(item=>item.id)
      );

      expect(left).not.toContain("a-2-1");
      expect(left).not.toContain("a-3-1");

      /* Исключённая и чужой ПВЗ остались. */
      expect(left).toContain("a-2-2");
      expect(left).toContain("b-2");
      expect(left).toContain("b-3");

      /* Действие отработало — выбор снят, календарь снова открыт на дне. */
      await expect(
        page.locator("[data-calendar-pick-mode]")
      ).toHaveText("Выбрать дни");

      await expect(page.locator(".sv-day.picked")).toHaveCount(0);
    }
  );

  test(
    "each closed or paid period is asked about on its own",
    async({page})=>{
      await openApp(page,{seed:seed({days:[14,15,16,17]})});

      await page.evaluate(month=>{
        const period=(kind,status)=>({
          id:`period-${kind}`,
          period_month:month,
          payout_kind:kind,
          status,
          checked_fingerprint:null,
          checked_at:null,
          closed_at:new Date().toISOString(),
          paid_at:status==="paid"
            ? new Date().toISOString()
            : null
        });

        window.__stubDb.payroll_periods=[
          period("first_half","paid"),
          period("second_half","closed")
        ];
      },`${YEAR}-${MONTH}-01`);

      await page.evaluate(()=>window.dispatchEvent(new Event("online")));

      await openCalendar(page);
      await choosePoint(page,"point-b");

      await page.locator("[data-calendar-pick-mode]").click();

      /* С Shift отмечаются все дни от предыдущей отметки. */
      await cell(page,14).click();
      await cell(page,17).click({modifiers:["Shift"]});

      await expect(page.locator(".sv-day.picked")).toHaveCount(4);

      /* Про закрытые периоды панель говорит до нажатия. */
      await expect(
        page.locator(".sv-panel-note")
      ).toContainText("Период 1–15 уже выплачен");

      await expect(
        page.locator(".sv-panel-note")
      ).toContainText("Период 16–конец месяца закрыт");

      await page.locator("[data-calendar-delete-picked]").click();
      await page.locator("#appConfirmOk").click();

      await expect(
        page.locator("#appConfirmDetail")
      ).toContainText("1–15");

      await expect(
        page.locator("#appConfirmDetail")
      ).toContainText("уже выплачен");

      await page.locator("#appConfirmOk").click();

      /*
        Согласие на выплаченную первую половину не распространяется на
        закрытую вторую: про неё спрашивают отдельно.
      */
      await expect(
        page.locator("#appConfirmDetail")
      ).toContainText("16–конец месяца");

      await page.locator("#appConfirmCancel").click();

      await expect(page.locator("#toast"))
        .toHaveText(
          "Удалено 2 из 4: остальные в закрытом периоде",
          {timeout:15000}
        );

      const left=await page.evaluate(()=>
        window.__stubDb.shifts
          .filter(item=>item.point_id==="point-b")
          .map(item=>item.id)
          .sort()
      );

      expect(left).toEqual(["b-16","b-17"]);
    }
  );

  test(
    "picked days become the dates of a new shift",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);
      await choosePoint(page,"point-b");

      await page.locator("[data-calendar-pick-mode]").click();
      await cell(page,24).click();
      await cell(page,22).click();
      await cell(page,23).click();

      /* В будущих днях смен нет — и удалять нечего. */
      await expect(
        page.locator(".sv-panel-hint")
      ).toHaveText("В выбранных днях смен нет.");

      await expect(
        page.locator("[data-calendar-delete-picked]")
      ).toHaveCount(0);

      await page.locator("[data-calendar-add-picked]").click();

      await expect(
        page.locator("#sheetTitle")
      ).toContainText("Новая смена");

      await expect(page.locator(".date-chip")).toHaveCount(3);

      await expect(
        page.locator("#f-point-open")
      ).toContainText("Корабельная 1");
    }
  );

  test(
    "leaving the calendar drops the picked days",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);

      await page.locator("[data-calendar-pick-mode]").click();
      await cell(page,2).click();

      await page
        .locator('[data-shift-view="registry"]')
        .click();

      await openCalendar(page);

      await expect(
        page.locator("[data-calendar-pick-mode]")
      ).toHaveText("Выбрать дни");

      await expect(page.locator(".sv-day.picked")).toHaveCount(0);

      await expect(
        page.locator(".sv-panel-date")
      ).toHaveText("21 сентября 2026");
    }
  );

  /*
    Выбранная строка реестра отмечена галочкой и лишь чуть теплее
    соседних. Заливка --gold-soft делала её похожей на нажатую, а
    наведение курсора перекрашивало её в серый, будто выбор сняли.
  */
  test(
    "a chosen registry row is marked calmly and stays marked under the pointer",
    async({page})=>{
      await openApp(page,{seed:seed()});

      await page.locator("#shiftSelectToggle").click();

      const row=page.locator("[data-select]").nth(1);

      await row.click();

      await expect(row).toHaveClass(/\bchosen\b/);

      /*
        Прозрачность фона из вычисленного цвета. Движки записывают
        color-mix по-разному — rgba(), color(srgb …) или oklab(), — но
        прозрачность у всех стоит последней.
      */
      const alpha=async()=>{
        await page.waitForTimeout(400);

        const color=await row.evaluate(element=>
          getComputedStyle(element).backgroundColor
        );

        const slash=color.match(/\/\s*([\d.]+%?)\s*\)$/);

        if(slash){
          return slash[1].endsWith("%")
            ? parseFloat(slash[1])/100
            : Number(slash[1]);
        }

        const parts=color.match(/[\d.]+/g).map(Number);

        return color.startsWith("rgba") ? parts[3] : 1;
      };

      await page.mouse.move(0,0);

      const resting=await alpha();

      expect(resting).toBeGreaterThan(0);
      expect(resting).toBeLessThan(0.07);

      await row.hover();

      const hovered=await alpha();

      expect(hovered).toBeGreaterThanOrEqual(resting);
      expect(hovered).toBeLessThan(0.1);

      await expect(
        row.locator(".sh-check")
      ).toHaveText("✓");
    }
  );
});

test.describe("mobile",()=>{
  test.use({
    viewport:{width:390,height:844},
    hasTouch:true
  });

  test(
    "the month grid stays even on a phone",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);

      const grid=await gridGeometry(page);

      expect(grid.count).toBe(30);
      expect(grid.max-grid.min).toBeLessThanOrEqual(0.5);

      /*
        Число дня стоит в каждой клетке на одном месте — есть под ним
        счётчик смен, точка пропуска или ничего.
      */
      const offsets=await page.evaluate(()=>
        [
          ...document.querySelectorAll(
            ".sv-grid .sv-day:not(.outside)"
          )
        ].map(element=>{
          const box=element.getBoundingClientRect();
          const number=element
            .querySelector(".sv-day-num")
            .getBoundingClientRect();

          return [
            Math.round(number.top-box.top),
            Math.round(
              (number.left+number.width/2)-
              (box.left+box.width/2)
            )
          ];
        })
      );

      expect(
        new Set(offsets.map(([top])=>top)).size
      ).toBe(1);

      expect(
        offsets.every(([,center])=>Math.abs(center)<=1)
      ).toBe(true);

      /* Счётчик не вылезает за клетку. */
      const overflow=await page.evaluate(()=>
        [
          ...document.querySelectorAll(".sv-day-count")
        ].some(element=>{
          const box=element.getBoundingClientRect();
          const parent=element
            .closest(".sv-day")
            .getBoundingClientRect();

          return (
            box.left<parent.left ||
            box.right>parent.right ||
            box.bottom>parent.bottom
          );
        })
      );

      expect(overflow).toBe(false);
    }
  );

  test(
    "days are picked by finger",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);

      await page.locator("[data-calendar-pick-mode]").tap();
      await cell(page,2).tap();
      await cell(page,3).tap();

      await expect(page.locator(".sv-day.picked")).toHaveCount(2);

      /* Подсказка про Shift пальцу не показывается. */
      await cell(page,3).tap();
      await cell(page,2).tap();

      await expect(
        page.locator(".sv-pick-range-hint")
      ).toBeHidden();

      await cell(page,2).tap();

      /* 2-го на всех ПВЗ три смены: две на первом и одна на втором. */
      await expect(
        page.locator("[data-calendar-delete-picked]")
      ).toHaveText("Удалить 3 смены");
    }
  );
});
