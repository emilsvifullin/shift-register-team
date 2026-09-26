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
  Раздел «Итоги» показывает не расчёт, а состояние денег: сколько начислено,
  сколько уже отдано и сколько ещё остаётся отдать. Эти тесты держат именно
  это соответствие, а заодно — форму отметки выплаты, которая на телефоне
  обязана оставаться в границах экрана и не увеличивать страницу при фокусе.
*/

const SHIFT_DAYS=[3,4,11,12,15,16];

function payoutSeed(payouts=[]){
  const seed=structuredClone(ADMIN_SEED);
  const employee=seed.employees[0];
  const point=seed.points[1];

  seed.shifts=SHIFT_DAYS.map((day,index)=>({
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

  seed.employee_payouts=payouts.map((item,index)=>({
    id:`payout-${index+1}`,
    employee_id:employee.id,
    period_month:"2026-09-01",
    payout_kind:"first_half",
    amount:item.amount,
    paid_on:item.paidOn || "2026-09-20",
    comment:item.comment || null,
    created_at:"2026-09-20T00:00:00Z",
    updated_at:"2026-09-20T00:00:00Z"
  }));

  return seed;
}

/*
  Плитка выплаты раскрывается переходом, поэтому всё, что лежит внутри
  неё, доступно не сразу: кнопка ещё едет вместе с панелью, и клик по
  движущейся цели на медленной машине промахивается. Ждём не время, а сам
  переход — он и есть условие.
*/
async function expandPayout(page,kind="first_half"){
  await page
    .locator(`[data-payout-toggle="${kind}"]`)
    .click();

  const reveal=page.locator(
    `[data-key="payoutReveal-${kind}"]`
  );

  await expect(reveal).toHaveClass(/\bon\b/);

  await expect
    .poll(()=>reveal.evaluate(element=>
      element.getAnimations().length
    ))
    .toBe(0);
}

async function openStats(page,payouts=[]){
  await openApp(page,{seed:payoutSeed(payouts)});

  await page.locator("#tab-stats").click();

  /* Сотрудник выбирается внутри плитки «Сотрудник», без окна снизу. */
  await page.locator("#statsEmployeeOpen").click();
  await page.locator("[data-stats-employee]").first().click();

  await expect(
    page.locator('[data-payout-toggle="first_half"]')
  ).toBeVisible();
}

test.use({
  viewport:{width:402,height:874},
  hasTouch:true,
  colorScheme:"dark"
});

/*
  Сумма выплаты делила ширину с подписью состояния через .row .v
  (max-width:58%), хотя в плитке она лежит в собственной колонке: «15 000 ₽»
  показывалось как «15 0…».
*/
test(
  "a payout tile shows its whole amount next to the state",
  async({page})=>{
    await openStats(page);

    const value=page
      .locator('[data-payout-toggle="first_half"] .v');

    await expect(value).toHaveText("15 000 ₽");

    const fits=await value.evaluate(element=>
      element.scrollWidth<=
      Math.ceil(
        element.getBoundingClientRect().width
      )
    );

    expect(fits).toBe(true);
  }
);

/*
  Состав суммы уже стоит на плитке и остаётся виден в раскрытом состоянии,
  поэтому внутри раскрытого блока он не повторяется.
*/
test(
  "an expanded payout does not repeat what the tile already says",
  async({page})=>{
    await openStats(page);

    const tile=page
      .locator('[data-payout-toggle="first_half"]');

    await expect(tile.locator(".s"))
      .toHaveText(/Остальные ПВЗ/);

    await tile.click();

    await expect(
      page.locator(".payout-breakdown .s")
    ).toHaveCount(0);

    await expect(
      page.locator(".payout-block.open .payout-source-list .payout-source-row")
    ).toHaveCount(5);
  }
);

/*
  «Не выплачено 0 ₽ из 15 000 ₽» описывало противоположное фактическому
  состоянию: невыплаченными оставались все 15 000 ₽.
*/
test(
  "an untouched payout reports the whole amount as still owed",
  async({page})=>{
    await openStats(page);

    await page
      .locator('[data-payout-toggle="first_half"]')
      .click();

    const progress=page.locator(".payout-block.open .payout-progress");

    await expect(progress).toContainText("Не выплачено");
    await expect(progress.locator("strong"))
      .toHaveText("15 000 ₽");
  }
);

test(
  "a partial payout reports what is left to pay",
  async({page})=>{
    await openStats(page,[{amount:5000}]);

    const tile=page
      .locator('[data-payout-toggle="first_half"]');

    await expect(tile.locator(".payout-status"))
      .toHaveText("Частично выплачено");

    await tile.click();

    const progress=page.locator(".payout-block.open .payout-progress");

    await expect(progress)
      .toContainText("Осталось выплатить");

    await expect(progress.locator("strong"))
      .toHaveText("10 000 ₽ из 15 000 ₽");
  }
);

test(
  "a settled payout reports the amount actually paid",
  async({page})=>{
    await openStats(page,[
      {amount:9000,paidOn:"2026-09-20"},
      {amount:6000,paidOn:"2026-09-25"}
    ]);

    const tile=page
      .locator('[data-payout-toggle="first_half"]');

    await expect(tile.locator(".payout-status"))
      .toHaveText("Выплачено");

    await tile.click();

    await expect(
      page.locator(".payout-block.open .payout-progress strong")
    ).toHaveText("15 000 ₽");

    await expect(
      page.locator(".payout-block.open .payout-record")
    ).toHaveCount(2);
  }
);

/*
  Вторая половина месяца здесь пуста: платить нечего, и состояние не может
  называться «не выплачено».
*/
test(
  "a payout with nothing to pay is not called unpaid",
  async({page})=>{
    await openStats(page);

    await expect(
      page.locator('[data-payout-toggle="second_half"] .payout-status')
    ).toHaveText("Не выплачено");

    await page.locator("#prevM").click();

    /*
      Переход месяца держит на экране слепок прежнего экрана,
      поэтому состояние читается у живого раздела.
    */
    await expect(
      page.locator('#app [data-payout-toggle="first_half"] .payout-status')
    ).toHaveText("Без выплаты");
  }
);

/*
  Форма отметки выплаты живёт на телефоне: поля не выходят за карточку,
  держат размер пальца и не меньше 16px — иначе iOS увеличивает страницу
  при фокусе и не возвращает масштаб назад.
*/
test(
  "the payout form stays inside the screen and cannot trigger the iOS zoom",
  async({page})=>{
    await openStats(page);

    await expandPayout(page);

    await page.locator(".payout-block.open [data-payout-add]").click();

    const form=await page.evaluate(()=>{
      const editor=
        document.querySelector(".payout-block.open .payout-editor");

      const card=editor.getBoundingClientRect();

      const measure=selector=>[
        ...editor.querySelectorAll(selector)
      ].map(control=>{
        const rect=
          control.getBoundingClientRect();

        return {
          fontSize:Number.parseFloat(
            getComputedStyle(control).fontSize
          ),
          height:Math.round(rect.height),
          overflow:Math.round(
            rect.right-card.right
          )
        };
      });

      return {
        pageWidth:document.documentElement.scrollWidth,
        innerWidth:window.innerWidth,
        fields:measure(".payout-field-input"),
        actions:measure(".btn")
      };
    });

    expect(form.pageWidth).toBe(form.innerWidth);
    expect(form.fields.length).toBe(3);
    expect(form.actions.length).toBe(2);

    for(const field of form.fields){
      /* Меньше 16px — и iOS увеличивает страницу при фокусе. */
      expect(field.fontSize).toBeGreaterThanOrEqual(16);
      expect(field.height).toBeGreaterThanOrEqual(44);
      expect(field.overflow).toBeLessThanOrEqual(0);
    }

    for(const action of form.actions){
      expect(action.height).toBeGreaterThanOrEqual(44);
      expect(action.overflow).toBeLessThanOrEqual(0);
    }
  }
);

/*
  Дата выбирается тем же календарём, что и остальные даты приложения:
  нативное поле type=date на iOS не укладывается в отведённую ширину и
  показывает дату в чужом для приложения формате.
*/
test(
  "the payout date uses the application date picker",
  async({page})=>{
    await openStats(page);

    await expandPayout(page);

    await page.locator(".payout-block.open [data-payout-add]").click();

    await expect(
      page.locator('.payout-block.open .payout-editor input[type="date"]')
    ).toHaveCount(0);

    const dateField=page
      .locator("[data-payout-date-open]");

    /*
      Новая отметка по умолчанию датирована сегодняшним днём. «Сегодня»
      страницы заморожено в openApp, и ожидание берётся оттуда же.
    */
    const today=new Intl.DateTimeFormat("ru-RU",{
      day:"numeric",
      month:"long",
      year:"numeric"
    })
      .format(FROZEN_TODAY)
      .replace(/\s*г\.$/u,"");

    await expect(dateField).toHaveText(today);

    await dateField.click();

    await expect(page.locator("#datePicker"))
      .toHaveClass(/\bon\b/);

    await page
      .locator(".date-grid .date-day:not(.outside)")
      .nth(9)
      .click();

    await page.locator("#dateDone").click();

    await expect(dateField)
      .toHaveText("10 сентября 2026");
  }
);

/*
  Удаление записи выплаты должно закончиться само.

  Обёртка подтверждения для закрытого периода обозначала отказ человека
  значением null — тем же, что возвращают функции без результата. Обе
  функции удаления объявлены в базе returns void, и успешное удаление
  выглядело для приложения отказом: вызывающий код выходил раньше
  времени и не делал ни обновления данных, ни сообщения. Экран всё же
  менялся, но только потому, что подписка приносила изменения сама.
*/
test(
  "deleting a payout record finishes with its own refresh and message",
  async({page})=>{
    await openStats(page,[{amount:5000}]);
    await expandPayout(page);

    await page
      .locator("[data-payout-delete]")
      .first()
      .click();

    await page.locator("#appConfirmOk").click();

    await expect(
      page.locator("#toast")
    ).toContainText("Запись выплаты удалена");

    await expect(
      page.locator("[data-payout-delete]")
    ).toHaveCount(0);
  }
);
