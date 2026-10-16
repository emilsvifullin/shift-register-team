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
    is_advance:Boolean(item.isAdvance),
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

async function openStats(page,payouts=[],source=null){
  await openApp(page,{seed:source || payoutSeed(payouts)});

  await page.locator("#tab-stats").click();

  /*
    Сотрудник выбирается внутри плитки «Сотрудник», без окна снизу.

    Список раскрывается переходом, и клик по строке, которая ещё едет,
    на медленной машине промахивается: на Firefox в CI выбор не
    срабатывал, а вместе с ним не появлялся и блок выплат. Ждём не
    время, а сам переход — он и есть условие.
  */
  await page.locator("#statsEmployeeOpen").click();

  const reveal=page.locator(
    '[data-key="statsEmployeeReveal"]'
  );

  await expect(reveal).toHaveClass(/\bon\b/);

  await expect
    .poll(()=>reveal.evaluate(node=>
      node.getAnimations().length
    ))
    .toBe(0);

  await page.locator('[data-stats-employee]:not([data-stats-employee=""])').first().click();

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
      .toHaveText(/ПВЗ без лимита первой выплаты/);

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

    await expect(progress).toContainText("Осталось выплатить");
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
      .toHaveText("10 000 ₽");
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
    ).toHaveText("0 ₽");

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
  "the payout date uses the inline application calendar",
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

    await expect(dateField).toHaveAttribute("aria-expanded","true");
    await expect(page.locator("#datePicker")).not.toHaveClass(/\bon\b/);
    await expect(page.locator(".payout-calendar-reveal")).toHaveClass(/\bon\b/);

    await page
      .locator("#payoutDateCalendar .date-grid .date-day:not(.outside)")
      .nth(9)
      .click();

    await expect(dateField)
      .toHaveText("10 сентября 2026");
    await expect(dateField).toHaveAttribute("aria-expanded","false");
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


/* Фактический аванс сверх заработанного — отдельное осознанное действие. */
test("an explicit advance records issued money above earnings and can be corrected",async({page})=>{
  const source=payoutSeed();
  source.shifts=source.shifts.slice(0,1);
  source.shifts[0].base_amount=3500;
  await openStats(page,[],source);
  await expandPayout(page);
  await page.locator(".payout-block.open [data-payout-add]").click();
  await page.locator("#payoutAmount").fill("10000");
  await expect(page.locator("[data-payout-amount-error]")).toContainText("3 500 ₽");
  await expect(page.locator("[data-payout-save]")).toBeDisabled();
  expect(await page.evaluate(()=>window.__stubDb.employee_payouts.length)).toBe(0);
  await page.locator('[data-payout-mode="advance"]').click();
  await expect(page.locator(".payout-advance-note")).toContainText("Между периодами автоматически не переносится");
  await page.locator("[data-payout-save]").click();
  await expect(page.locator("#appConfirm")).toContainText("6 500 ₽");
  await page.locator("#appConfirmOk").click();
  await expect(page.locator("#toast")).toContainText("Аванс сохранён");
  await expect(page.locator(".payout-record")).toContainText("Аванс");
  await expect(page.locator(".payout-block.open .payout-status")).toHaveText("Выдано вперёд");
  await expect(page.locator(".payout-block.open [data-payout-overpaid]")).toHaveText("6 500 ₽");
  await expect(page.locator(".payout-block.open [data-payout-issued]")).toHaveText("10 000 ₽");
  await expect(page.locator(".payout-block.open .payout-progress strong")).toHaveText("0 ₽");
  const saved=await page.evaluate(()=>window.__stubDb.employee_payouts[0]);
  expect(saved.is_advance).toBe(true);
  expect(saved.amount).toBe(10000);
  await page.locator("[data-payout-edit]").click();
  await expect(page.locator('[data-payout-mode="advance"]')).toHaveAttribute("aria-pressed","true");
  await page.locator("#payoutAmount").fill("9000");
  await page.locator("#payoutComment").fill("Уточнили сумму фактической выдачи");
  await page.locator("[data-payout-save]").click();
  await page.locator("#appConfirmOk").click();
  await expect(page.locator("#toast")).toContainText("Аванс сохранён");
  expect(await page.evaluate(()=>window.__stubDb.employee_payouts.length)).toBe(1);
  await expect(page.locator(".payout-block.open [data-payout-overpaid]")).toHaveText("5 500 ₽");
  await expect(page.locator(".payout-block.open [data-payout-issued]")).toHaveText("9 000 ₽");
  await expect(page.locator(".payout-block.open .payout-progress strong")).toHaveText("0 ₽");
  await page.locator("[data-payout-delete]").click();
  await page.locator("#appConfirmOk").click();
  await expect(page.locator("#toast")).toContainText("Запись выплаты удалена");
  await expect(page.locator(".payout-block.open .payout-progress strong")).toHaveText("3 500 ₽");
});

test("an advance before the first shift needs confirmation and stays in its chosen period",async({page})=>{
  const source=payoutSeed();
  source.shifts=[];
  await openStats(page,[],source);
  await expandPayout(page);
  await page.locator(".payout-block.open [data-payout-add]").click();
  await expect(page.locator('[data-payout-mode="advance"]')).toHaveAttribute("aria-pressed","true");
  await expect(page.locator('[data-payout-mode="regular"]')).toBeDisabled();
  await page.locator("#payoutAmount").fill("10000");
  await page.locator("[data-payout-save]").click();
  await page.locator("#appConfirmCancel").click();
  await expect(page.locator("[data-payout-save]")).toBeEnabled();
  expect(await page.evaluate(()=>window.__stubDb.employee_payouts.length)).toBe(0);
  await page.locator("[data-payout-save]").click();
  await page.locator("#appConfirmOk").click();
  await expect(page.locator("#toast")).toContainText("Аванс сохранён");
  await expect(page.locator(".payout-block.open .payout-status")).toHaveText("Выдано вперёд");
  expect(await page.evaluate(()=>window.__stubDb.employee_payouts[0].period_month)).toBe("2026-09-01");
  await expect(page.locator('[data-payout-toggle="second_half"] .payout-status')).toHaveText("Без выплаты");
});


test("new earnings cover an existing advance and leave only the true balance",async({page})=>{
  const source=payoutSeed([{amount:10000,isAdvance:true}]);
  source.shifts=source.shifts.slice(0,1);
  source.shifts[0].base_amount=3500;
  await openStats(page,[],source);
  await expandPayout(page);
  await expect(page.locator(".payout-block.open .payout-progress strong")).toHaveText("0 ₽");
  await expect(page.locator(".payout-block.open [data-payout-overpaid]")).toHaveText("6 500 ₽");
  await page.evaluate(()=>{
    const shift=structuredClone(window.__stubDb.shifts[0]);
    shift.id="shift-after-advance";
    shift.shift_date="2026-09-10";
    shift.base_amount=8500;
    window.__stubDb.shifts.push(shift);
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.locator(".payout-block.open .payout-progress strong")).toHaveText("2 000 ₽");
  await expect(page.locator(".payout-record")).toContainText("Аванс");
  expect(await page.evaluate(()=>window.__stubDb.employee_payouts[0].amount)).toBe(10000);
});


test("editing a payout cannot carry its record into another employee",async({page})=>{
  await openStats(page,[{amount:5000}]);
  await expandPayout(page);
  await page.locator("[data-payout-edit]").click();
  await expect(page.locator("#payoutAmount")).toHaveValue("5000");
  await page.locator("#statsEmployeeOpen").click();
  await page.locator('[data-stats-employee="employee-2"]').click();
  await expect(page.locator(".payout-editor")).toHaveCount(0);
  await page.locator(".payout-block.open [data-payout-add]").click();
  await expect(page.locator("#payoutAmount")).toHaveValue("");
  await page.locator('[data-payout-mode="advance"]').click();
  await page.locator("#payoutAmount").fill("100");
  await page.locator("[data-payout-save]").click();
  await page.locator("#appConfirmOk").click();
  await expect(page.locator("#toast")).toContainText("Аванс сохранён");
  const records=await page.evaluate(()=>window.__stubDb.employee_payouts);
  expect(records).toHaveLength(2);
  expect(records.find(item=>item.id==="payout-1").amount).toBe(5000);
  expect(records.find(item=>item.employee_id==="employee-2").amount).toBe(100);
});

test("editing a payout cannot carry its record into another month",async({page})=>{
  await openStats(page,[{amount:5000}]);
  await expandPayout(page);
  await page.locator("[data-payout-edit]").click();
  await page.locator("#nextM").click();
  await expect(page.locator("#app .payout-editor")).toHaveCount(0);
  await page.locator("#app .payout-block.open [data-payout-add]").click();
  await expect(page.locator("#payoutAmount")).toHaveValue("");
  await page.locator('[data-payout-mode="advance"]').click();
  await page.locator("#payoutAmount").fill("100");
  await page.locator("[data-payout-save]").click();
  await page.locator("#appConfirmOk").click();
  await expect(page.locator("#toast")).toContainText("Аванс сохранён");
  const records=await page.evaluate(()=>window.__stubDb.employee_payouts);
  expect(records).toHaveLength(2);
  expect(records.find(item=>item.id==="payout-1").period_month).toBe("2026-09-01");
  expect(records.find(item=>item.id!=="payout-1").period_month).toBe("2026-10-01");
});


test("the team period describes an intentional advance as information",async({page})=>{
  const source=payoutSeed([{amount:10000,isAdvance:true}]);
  source.shifts=source.shifts.slice(0,1);
  source.shifts[0].base_amount=3500;
  await openStats(page,[],source);
  await page.locator("#statsEmployeeOpen").click();
  await page.locator('[data-key="statsEmployeeReveal"] [data-stats-employee=""]').click();
  await expandPayout(page);
  const period=page.locator(".payroll-period.open");
  await expect(period.locator(".payroll-gap.advance")).toContainText("Сверх начисленного 6 500 ₽");
  await expect(period.locator(".payroll-person-meta")).toContainText("выдано вперёд 6 500 ₽");
  await period.locator('[data-period-review="first_half"]').click();
  const finding=period.locator('[data-review-payout="first_half"]');
  await expect(finding).toContainText("Остаток выданного аванса");
  await expect(finding).toHaveClass(/info/);
});


test("a small advance does not turn an ordinary overpayment into a neutral balance",async({page})=>{
  const source=payoutSeed([{amount:10000},{amount:2000,isAdvance:true}]);
  source.shifts=source.shifts.slice(0,1);
  source.shifts[0].base_amount=5000;
  await openStats(page,[],source);
  await expandPayout(page);
  await expect(page.locator(".payout-block.open .payout-progress strong")).toHaveText("0 ₽");
  await expect(page.locator(".payout-block.open [data-payout-overpaid]")).toHaveText("7 000 ₽");
  await expect(page.locator(".payout-block.open [data-payout-issued]")).toHaveText("12 000 ₽");
  await page.locator("#statsEmployeeOpen").click();
  await page.locator('[data-key="statsEmployeeReveal"] [data-stats-employee=""]').click();
  const period=page.locator(".payroll-period.open");
  await expect(period.locator(".payroll-gap.overpaid")).toContainText("Переплата 7 000 ₽");
  await period.locator('[data-period-review="first_half"]').click();
  await expect(period.locator('.payroll-finding-warning[data-review-payout="first_half"]')).toContainText("Выплачено больше, чем начислено");
});

test("an advance for one employee does not hide another employee's overpayment",async({page})=>{
  const source=payoutSeed([{amount:10000,isAdvance:true}]);
  source.shifts=source.shifts.slice(0,1);
  source.shifts[0].base_amount=3500;
  source.employee_payouts.push({
    ...source.employee_payouts[0],
    id:"ordinary-overpayment-other-employee",
    employee_id:"employee-2",
    amount:1000,
    is_advance:false
  });
  await openStats(page,[],source);
  await page.locator("#statsEmployeeOpen").click();
  await page.locator('[data-key="statsEmployeeReveal"] [data-stats-employee=""]').click();
  await expandPayout(page);
  const period=page.locator(".payroll-period.open");
  await expect(period.locator(".payroll-gap.overpaid")).toContainText("Переплата 7 500 ₽");
  await period.locator('[data-period-review="first_half"]').click();
  await expect(period.locator('.payroll-finding-warning[data-review-payout="first_half"]')).toContainText("Роман Белов");
  await expect(period.locator('.payroll-finding-info[data-review-payout="first_half"]')).toContainText("Остаток выданного аванса");
});

for(const width of [390,1440]){
  test(`an advance uses the regular payout entry before any shift and compact history at ${width}px`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:940});
    const source=payoutSeed();
    source.shifts=[];
    source.employee_points=[];
    source.points.forEach(point=>{point.advance_enabled=false;});
    await openStats(page,[],source);
    await expandPayout(page,'second_half');
    await page.locator('.payout-block.open [data-payout-add]').click();
    await expect(page.locator('[data-payout-mode="advance"]')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('[data-payout-mode="regular"]')).toBeDisabled();
    await expect(page.locator('.payout-advance-note')).toContainText('независимо от начислений');
    await page.locator('#payoutAmount').fill('10000');
    await page.locator('[data-payout-save]').click();
    await expect(page.locator('#appConfirm')).toContainText('10 000 ₽');
    await page.locator('#appConfirmOk').click();
    await expect(page.locator('#toast')).toContainText('Аванс сохранён');
    await expect(page.locator('.payout-record')).toContainText('Аванс');
    const record=await page.evaluate(()=>window.__stubDb.employee_payouts[0]);
    expect(record.is_advance).toBe(true);
    expect(record.payout_kind).toBe('second_half');
    const geometry=await page.locator('.payout-record').evaluate(row=>{
      const amount=row.querySelector('b').getBoundingClientRect();
      const actions=row.querySelector('.payout-record-actions').getBoundingClientRect();
      return {height:row.getBoundingClientRect().height,sameRow:Math.abs((amount.top+amount.bottom)/2-(actions.top+actions.bottom)/2)<1};
    });
    expect(geometry.height).toBeLessThanOrEqual(80);
    expect(geometry.sameRow).toBe(true);
    await expect(page.locator('.payout-block.open .payout-progress strong')).toHaveText('0 ₽');
    await expect(page.locator('.payout-block.open [data-payout-overpaid]')).toHaveText('10 000 ₽');
    await expect(page.locator('.payout-block.open .payout-progress > span')).toHaveText('Осталось выплатить');
    await page.screenshot({path:testInfo.outputPath(`advance-history-${width}.png`)});
  });
}

for(const width of [390,1440]){
  test(`payout action and editor keep the original full width below shift details at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:940});
    await openStats(page);
    await expandPayout(page);
    const block=page.locator('.payout-block.open .payout-expanded');
    const add=block.locator('[data-payout-add]');
    await expect(add).toHaveText('Отметить выплату');
    await expect(page.locator('[data-payout-advance]')).toHaveCount(0);
    const positions=await block.evaluate(element=>{
      const box=element.getBoundingClientRect();
      const details=element.querySelector('.payout-breakdown').getBoundingClientRect();
      const progress=element.querySelector('.payout-progress').getBoundingClientRect();
      const action=element.querySelector('[data-payout-add]').getBoundingClientRect();
      return {detailsBottom:details.bottom,progressTop:progress.top,progressBottom:progress.bottom,actionTop:action.top,left:action.left-box.left,right:box.right-action.right};
    });
    expect(positions.detailsBottom).toBeLessThanOrEqual(positions.progressTop);
    expect(positions.progressBottom).toBeLessThanOrEqual(positions.actionTop);
    expect(positions.left).toBeCloseTo(16,0);
    expect(positions.right).toBeCloseTo(16,0);
    await add.click();
    await expect(block.locator('.payout-mode button')).toHaveCount(2);
    await expect(block.locator('[data-payout-mode="regular"]')).toHaveAttribute('aria-pressed','true');
    await expect(block.locator('[data-advance-period]')).toHaveCount(0);
    const form=await block.evaluate(element=>{
      const box=element.getBoundingClientRect();
      const editor=element.querySelector('.payout-editor').getBoundingClientRect();
      const details=element.querySelector('.payout-breakdown').getBoundingClientRect();
      return {left:editor.left-box.left,right:box.right-editor.right,top:editor.top,detailsBottom:details.bottom};
    });
    expect(form.left).toBeCloseTo(16,0);
    expect(form.right).toBeCloseTo(16,0);
    expect(form.top).toBeGreaterThanOrEqual(form.detailsBottom);
  });
}
