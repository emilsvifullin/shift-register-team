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
  Ровная цепочка одинаковых событий — не трекпад, и именно на ней прошлый
  разбор жеста выглядел исправным. Настоящий двухпальцевый свайп macOS
  устроен иначе, и здесь он воспроизводится как есть:

  — шаги дробные, с разгоном и затуханием внутри самого свайпа;
  — вертикальная составляющая шумит и на отдельных кадрах перевешивает
    горизонтальную;
  — после отрыва пальцев система ещё почти секунду досылает затухающий
    хвост инерции;
  — палец, снова легший на трекпад, обрывает хвост: следующий свайп
    начинается прямо посреди инерции предыдущего.
*/
async function trackpadSwipe(page,selector,{
  direction=1,
  axis="x",
  peak=9,
  steps=18,
  noise=1.4,
  momentum=26
}={}){
  await page.evaluate(async([target,shape])=>{
    const element=
      document.querySelector(target);

    const rect=
      element.getBoundingClientRect();

    let seed=7;

    const jitter=()=>{
      seed=(seed*1103515245+12345)%2147483648;

      return (
        (seed/2147483648)*2-1
      )*shape.noise;
    };

    /* Вдоль своей оси — движение, поперёк — шум трекпада. */
    const send=(along,across)=>{
      const deltaX=shape.axis==="x"
        ? along
        : across;

      const deltaY=shape.axis==="x"
        ? across
        : along;

      element.dispatchEvent(
        new WheelEvent(
          "wheel",
          {
            bubbles:true,
            cancelable:true,
            deltaX,
            deltaY,
            clientX:rect.left+rect.width/2,
            clientY:rect.top+rect.height/2
          }
        )
      );
    };

    const frame=()=>new Promise(resolve=>
      requestAnimationFrame(()=>resolve())
    );

    for(let index=0;index<shape.steps;index+=1){
      send(
        shape.direction*shape.peak*Math.sin(
          ((index+1)/(shape.steps+1))*Math.PI
        ),
        jitter()
      );

      await frame();
    }

    /* Хвост инерции: пальцы уже сняты, события ещё идут. */
    let tail=shape.peak*0.55;

    for(let index=0;index<shape.momentum;index+=1){
      send(
        shape.direction*tail,
        jitter()*0.3
      );

      tail*=0.82;

      await frame();
    }
  },[selector,{direction,axis,peak,steps,noise,momentum}]);
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

    await trackpadSwipe(page,"#app",{direction:1});
    await expect(period).toHaveText(/Октябрь 2026/);

    await trackpadSwipe(page,"#app",{direction:-1});
    await expect(period).toHaveText(/Сентябрь 2026/);

    await page.locator("#tab-stats").click();

    await expect(
      page.locator("body")
    ).toHaveAttribute("data-active-tab","stats");

    await trackpadSwipe(page,"#app",{direction:1});
    await expect(period).toHaveText(/Октябрь 2026/);
  }
);

/*
  Свайп подряд, без тапа между ними, — это и есть жалоба: второй свайп
  начинается, пока ещё идёт инерция первого, и проглатывался. Тап давал
  паузу, после которой состояние сбрасывалось, — отсюда и «сначала
  тапнуть, потом свайпнуть». Проверяется без единого клика по экрану.
*/
test(
  "swipes one after another each change the month",
  async({page})=>{
    await openApp(page,{seed:shiftsSeed()});

    const period=page.locator("#period");

    await expect(period).toHaveText(/Сентябрь 2026/);

    /* Второй свайп ложится прямо на хвост инерции первого. */
    await trackpadSwipe(page,"#app",{direction:1,momentum:8});
    await trackpadSwipe(page,"#app",{direction:1,momentum:8});
    await trackpadSwipe(page,"#app",{direction:1});

    await expect(period).toHaveText(/Декабрь 2026/);

    await trackpadSwipe(page,"#app",{direction:-1,momentum:8});
    await trackpadSwipe(page,"#app",{direction:-1});

    await expect(period).toHaveText(/Октябрь 2026/);
  }
);

/*
  Хвост инерции сам по себе месяц не листает: пальцы уже сняты.
*/
test(
  "the momentum tail of one swipe does not move the month twice",
  async({page})=>{
    await openApp(page,{seed:shiftsSeed()});

    const period=page.locator("#period");

    await trackpadSwipe(page,"#app",{
      direction:1,
      momentum:60
    });

    await expect(period).toHaveText(/Октябрь 2026/);
    await page.waitForTimeout(600);
    await expect(period).toHaveText(/Октябрь 2026/);
  }
);

/*
  Вертикальная прокрутка остаётся прокруткой, даже когда в ней есть
  небольшая горизонтальная составляющая.
*/
test(
  "scrolling vertically does not change the month",
  async({page})=>{
    await openApp(page,{seed:shiftsSeed()});

    const period=page.locator("#period");

    await trackpadSwipe(page,"#app",{
      direction:1,
      axis:"y",
      peak:14,
      steps:24,
      noise:2.2
    });

    await expect(period).toHaveText(/Сентябрь 2026/);
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

    await trackpadSwipe(page,"#monthGrid",{direction:1});
    await expect(year).toHaveText("2027");

    await trackpadSwipe(page,"#monthGrid",{direction:-1});
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

    await page.locator("#tab-manage").click();

    await page
      .locator('#app [data-manage-section="points"]')
      .click();

    await page.locator("#pointAdd").click();
    await page.locator("#manageTariffDateOpen").click();

    await expect(
      page.locator("#datePicker")
    ).toHaveClass(/\bon\b/);

    const month=page.locator("#datePickerMonth");
    const start=await month.textContent();

    await trackpadSwipe(page,"#dateGrid",{direction:1});
    await expect(month).not.toHaveText(start);

    await month.click();

    await expect(
      page.locator("#dateJump")
    ).toHaveClass(/\bon\b/);

    const jumpYear=page.locator("#dateJumpYear");
    const startYear=await jumpYear.textContent();

    await trackpadSwipe(page,"#dateJumpMonths",{direction:1});

    await expect(jumpYear).toHaveText(
      String(Number(startYear)+1)
    );
  }
);

/*
  Календарь, раскрытый внутри плитки «Смена», листается тем же жестом:
  переезд из отдельного окна не должен был отнять у даты способ, который
  уже работал.
*/
test(
  "a trackpad swipe works in the calendar opened inside the shift card",
  async({page})=>{
    await openApp(page,{seed:shiftsSeed()});

    await page.locator("#tab-shifts").click();
    await page.locator("#shiftAdd").click();

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    const row=page.locator("#f-date-open");

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded","true");

    const month=page.locator(
      ".inline-calendar .date-calendar-title"
    );

    await expect(month).toHaveText(/Сентябрь 2026/);

    await trackpadSwipe(
      page,
      ".inline-calendar .date-grid",
      {direction:1}
    );

    await expect(month).toHaveText(/Октябрь 2026/);

    await trackpadSwipe(
      page,
      ".inline-calendar .date-grid",
      {direction:-1}
    );

    await expect(month).toHaveText(/Сентябрь 2026/);
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
