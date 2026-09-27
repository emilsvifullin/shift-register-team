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

  Отдельно закреплены вещи, которые легко сломать незаметно: геометрия
  (панель дня по высоте календаря, одинаковые клетки месяца, число дня
  над центром своей клетки) и выбор ПВЗ, который должен находить пункт
  одинаково быстро и среди семи, и среди сотни.
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

/*
  ПВЗ выбирается из раскрывающегося списка, как сотрудник в «Итогах». Список
  раскрывается переходом, и по строке, которая ещё едет, нажатие может
  промахнуться — поэтому ждём конца перехода, а не время.
*/
async function pointListSettled(page){
  const reveal=page.locator('[data-key="calendarPointReveal"]');

  await expect(reveal).toHaveClass(/\bon\b/);

  await expect
    .poll(()=>reveal.evaluate(node=>node.getAnimations({subtree:true}).length))
    .toBe(0);
}

async function choosePoint(page,id){
  await page.locator("#calendarPointOpen").click();
  await pointListSettled(page);

  await page
    .locator(`[data-calendar-point="${id}"]`)
    .click();

  await expect(
    page.locator("#calendarPointOpen")
  ).toHaveAttribute("aria-expanded","false");
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

      await choosePoint(page,"point-0");

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

        const add=document.querySelector(
          ".sv-panel-add"
        );

        const style=getComputedStyle(
          document.querySelector(".sv-panel")
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
            : true,
          /*
            Кнопка стоит у нижнего края панели: между ней и краем
            только собственный отступ панели.
          */
          buttonAtBottom:add
            ? Math.round(
                panel.bottom-
                add.getBoundingClientRect().bottom-
                parseFloat(style.paddingBottom)-
                parseFloat(style.borderBottomWidth)
              )
            : null
        };
      });

      /* Пустой день. */
      await page
        .locator(`[data-calendar-day="${day(22)}"]`)
        .click();

      expect(await geometry()).toEqual({
        top:0,
        bottom:0,
        listInside:true,
        buttonAtBottom:0
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
        listInside:true,
        buttonAtBottom:0
      });

    }
  );

  /*
    Смен в дне больше, чем помещается рядом с календарём: панель остаётся
    ростом с календарь, а прокручивается список внутри неё. Календарь для
    этого нарочно низкий — три ПВЗ и по одной смене в остальных днях.
  */
  test(
    "a long day list scrolls inside the panel",
    async({page})=>{
      const source=seed({points:3});

      source.shifts=source.shifts.filter(
        shift=>shift.shift_date!==day(1)
      );

      for(let index=0;index<14;index++){
        const point=source.points[
          index%source.points.length
        ];

        source.shifts.push({
          ...source.shifts[0],
          id:`crowded-${index}`,
          shift_date:day(1),
          point_id:point.id,
          point:{...point}
        });
      }

      await openApp(page,{seed:source});
      await openCalendar(page);

      await page
        .locator(`[data-calendar-day="${day(1)}"]`)
        .click();

      await expect(
        page.locator(".sv-panel-list .sh")
      ).toHaveCount(14);

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

      /*
        Домотав список до конца, последнюю смену видно целиком: её не
        срезает ни край прокрутки, ни кнопка под ним.
      */
      const tail=await page.evaluate(()=>{
        const list=document.querySelector(
          ".sv-panel-list"
        );

        list.scrollTop=list.scrollHeight;

        const last=[
          ...list.querySelectorAll(".sh")
        ]
          .at(-1)
          .getBoundingClientRect();

        const add=document
          .querySelector(".sv-panel-add")
          .getBoundingClientRect();

        return {
          insideScroller:Math.round(
            list.getBoundingClientRect().bottom-
            last.bottom
          ),
          aboveButton:Math.round(
            add.top-last.bottom
          )
        };
      });

      expect(tail.insideScroller)
        .toBeGreaterThanOrEqual(0);

      expect(tail.aboveButton)
        .toBeGreaterThan(0);
    }
  );

  test(
    "a shift added from a day keeps its date, its point and the other dates",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);

      await choosePoint(page,"point-1");

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

  /*
    Пунктов много — лента кнопок заставила бы их долистывать. Список
    сужается поиском, число пунктов на это не влияет, а выбор сразу
    сворачивает список и оставляет открытый день на месте.
  */
  test(
    "the point picker finds any of a hundred points by search",
    async({page})=>{
      const source=seed({points:3});

      for(let index=0;index<100;index++){
        source.points.push({
          id:`extra-${index}`,
          code:`x${index}`,
          name:`Пункт ${String(index).padStart(3,"0")}`,
          active:true,
          advance_enabled:false
        });
      }

      await openApp(page,{seed:source});
      await openCalendar(page);

      await expect(
        page.locator("#calendarPointOpen")
      ).toContainText("Все ПВЗ");

      await page
        .locator(`[data-calendar-day="${day(3)}"]`)
        .click();

      await page.locator("#calendarPointOpen").click();
      await pointListSettled(page);

      /* Мышью поле поиска получает фокус сразу — можно печатать. */
      await expect(
        page.locator("#calendarPointSearch")
      ).toBeFocused();

      /* «Все ПВЗ» и все 103 пункта, а прокручивается сам список. */
      await expect(
        page.locator(".sv-point-card .inline-options [data-calendar-point]")
      ).toHaveCount(104);

      expect(
        await page.evaluate(()=>{
          const list=document.querySelector(
            ".sv-point-card .inline-options"
          );

          return list.scrollHeight>list.clientHeight+1;
        })
      ).toBe(true);

      await page
        .locator("#calendarPointSearch")
        .fill("пункт 09");

      await expect(
        page.locator(".sv-point-card .inline-options [data-calendar-point]")
      ).toHaveCount(10);

      await page
        .locator('[data-calendar-point="extra-97"]')
        .click();

      await expect(
        page.locator("#calendarPointOpen")
      ).toHaveAttribute("aria-expanded","false");

      await expect(
        page.locator("#calendarPointOpen .t")
      ).toHaveText("Пункт 097");

      /* У пункта без смен так и написано — ноль тоже ответ. */
      await expect(
        page.locator("#calendarPointOpen .point-value")
      ).toHaveText("0 смен");

      /* Открытый день остался тем же. */
      await expect(
        page.locator(".sv-panel-date")
      ).toContainText("3 сентября 2026");

      /* Поиск без совпадений не оставляет пустой коробки. */
      await page.locator("#calendarPointOpen").click();

      await expect(
        page.locator("#calendarPointSearch")
      ).toHaveValue("");

      await page
        .locator("#calendarPointSearch")
        .fill("такого нет");

      await expect(
        page.locator(".sv-point-card .inline-empty")
      ).toHaveText("Ничего не найдено");
    }
  );
});

test.describe("mobile",()=>{
  test.use({
    viewport:{width:402,height:874},
    hasTouch:true
  });

  test(
    "a point is chosen by finger from the same list",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await openCalendar(page);

      await page.locator("#calendarPointOpen").tap();
      await pointListSettled(page);

      /*
        Пальцем фокус в поиск не ставится: клавиатура закрыла бы
        половину списка, из которого чаще выбирают глазами.
      */
      await expect(
        page.locator("#calendarPointSearch")
      ).not.toBeFocused();

      const last=`point-${POINT_NAMES.length-1}`;

      await page
        .locator(`[data-calendar-point="${last}"]`)
        .tap();

      await expect(
        page.locator("#calendarPointOpen .t")
      ).toHaveText(POINT_NAMES.at(-1));
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

/*
  Удаление смены должно закрыть её форму.

  Обёртка подтверждения для закрытого периода обозначала отказ человека
  значением null — тем же, что возвращает admin_delete_shift_v2, которая
  в базе объявлена returns void. Успешное удаление выглядело отказом:
  обработчик выходил до closeSheet(), и форма несуществующей смены
  оставалась на экране вместе с кнопками «Готово» и «Удалить смену».
  Список при этом обновлялся — но чужими руками, подпиской на изменения.
*/
test(
  "deleting a shift closes its sheet",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.locator(".sh").first().click();
    await expect(page.locator("#sheet")).toHaveClass(/\bon\b/);

    await page.locator("#sheetSave").click();
    await page.locator("#f-del").click();
    await page.locator("#appConfirmOk").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Смена удалена");

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);
  }
);
