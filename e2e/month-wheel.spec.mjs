import {
  test,
  expect
} from "@playwright/test";

import {
  ADMIN_SEED,
  openApp
} from "./support/supabase-stub.mjs";

/*
  Двухпальцевый свайп по трекпаду приходит в страницу колесом с deltaX.
  Приложение разбирает его полностью: и переключение месяца в «Сменах» и
  «Итогах», и выбор года в окне месяца и в панели года календаря, и
  переключение месяца по сетке дней — со своими порогами, направлением и
  защитой от повторного срабатывания внутри одного жеста.

  Всё это не работало, потому что reference-swipes гасил горизонтальное
  колесо в фазе перехвата на document и на контейнере выбора года: события
  до разбора не доходили. Гасить нужно было только перетаскивание мышью,
  которого нет в эталоне.

  Жест проверяется на настоящем приложении, а не на счётчиках слушателей:
  важно, что месяц и год действительно меняются.
*/

function shiftsSeed(){
  const seed=structuredClone(ADMIN_SEED);
  const employee=seed.employees[0];
  const point=seed.points[1];

  seed.shifts=[3,11,15].map((day,index)=>({
    id:`shift-${index+1}`,
    employee_id:employee.id,
    shift_date:`2026-09-${String(day).padStart(2,"0")}`,
    point_id:point.id,
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
      id:employee.id,
      user_id:employee.user_id,
      full_name:employee.full_name,
      status:employee.status
    },
    point:{
      id:point.id,
      code:point.code,
      name:point.name,
      active:point.active,
      advance_enabled:point.advance_enabled
    },
    bonuses:[],
    penalties:[]
  }));

  return seed;
}

/*
  Трекпад присылает жест россыпью мелких шагов, а не одним событием:
  приложение копит путь и срабатывает один раз за жест.
*/
async function trackpadSwipe(page,selector,deltaX){
  await page.evaluate(async([target,delta])=>{
    const element=
      document.querySelector(target);

    const rect=
      element.getBoundingClientRect();

    for(let step=0;step<6;step+=1){
      element.dispatchEvent(
        new WheelEvent(
          "wheel",
          {
            bubbles:true,
            cancelable:true,
            deltaX:delta,
            deltaY:1,
            clientX:rect.left+rect.width/2,
            clientY:rect.top+rect.height/2
          }
        )
      );

      await new Promise(resolve=>
        setTimeout(resolve,20)
      );
    }
  },[selector,deltaX]);

  /*
    Жест заканчивается, когда пальцы отрываются от трекпада: приложение
    закрывает накопленный жест по паузе, и следующий свайп начинается с
    чистого счёта.
  */
  await page.waitForTimeout(400);
}

test.use({
  viewport:{width:1280,height:900},
  colorScheme:"dark"
});

test(
  "a trackpad swipe changes the month in both main sections",
  async({page})=>{
    await openApp(page,{seed:shiftsSeed()});

    const period=page.locator("#period");

    await expect(period).toHaveText(/Сентябрь 2026/);

    await trackpadSwipe(page,"#app",60);
    await expect(period).toHaveText(/Октябрь 2026/);

    await trackpadSwipe(page,"#app",-60);
    await expect(period).toHaveText(/Сентябрь 2026/);

    await page.locator("#tab-stats").click();

    await expect(
      page.locator("body")
    ).toHaveAttribute("data-active-tab","stats");

    await trackpadSwipe(page,"#app",60);
    await expect(period).toHaveText(/Октябрь 2026/);
  }
);

test(
  "a trackpad swipe changes the year in the month picker",
  async({page})=>{
    await openApp(page,{seed:shiftsSeed()});

    await page.locator("#period").click();

    await expect(
      page.locator("#monthPicker")
    ).toHaveClass(/\bon\b/);

    const year=page.locator("#monthPickerYear");

    await expect(year).toHaveText("2026");

    await trackpadSwipe(page,"#monthGrid",60);
    await expect(year).toHaveText("2027");

    await trackpadSwipe(page,"#monthGrid",-60);
    await expect(year).toHaveText("2026");
  }
);

/*
  Календарь разбирает тот же жест на сетке дней и в панели года — их
  гасило то же правило.
*/
test(
  "a trackpad swipe works inside the calendar too",
  async({page})=>{
    await openApp(page,{seed:shiftsSeed()});

    await page.locator("#tab-shifts").click();
    await page.locator("#shiftAdd").click();

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    await page.locator("#f-date-open").click();

    await expect(
      page.locator("#datePicker")
    ).toHaveClass(/\bon\b/);

    const month=page.locator("#datePickerMonth");

    await expect(month).toHaveText(/Сентябрь 2026/);

    await trackpadSwipe(page,".date-grid",60);
    await expect(month).toHaveText(/Октябрь 2026/);

    await month.click();

    await expect(
      page.locator("#dateJump")
    ).toHaveClass(/\bon\b/);

    const jumpYear=page.locator("#dateJumpYear");

    await expect(jumpYear).toHaveText("2026");

    await trackpadSwipe(page,"#dateJumpMonths",60);
    await expect(jumpYear).toHaveText("2027");
  }
);

/*
  Мышь остаётся мышью: протащить месяц по экрану по-прежнему нельзя.
*/
test(
  "dragging with the mouse still does not change the month",
  async({page})=>{
    await openApp(page,{seed:shiftsSeed()});

    const period=page.locator("#period");

    await expect(period).toHaveText(/Сентябрь 2026/);

    const area=
      await page.locator("#app").boundingBox();

    const y=area.y+60;

    await page.mouse.move(area.x+area.width/2,y);
    await page.mouse.down();

    for(let step=1;step<=10;step+=1){
      await page.mouse.move(
        area.x+area.width/2-step*25,
        y
      );
    }

    await page.mouse.up();
    await page.waitForTimeout(400);

    await expect(period).toHaveText(/Сентябрь 2026/);
  }
);
