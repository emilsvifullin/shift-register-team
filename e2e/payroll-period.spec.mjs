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
  Расчётный период — половина месяца, и его состояние означает факт, а не
  пометку на экране.

  Проверяется весь путь: «В работе» → «Проверено» → «Закрыто» →
  «Выплачено», возврат в работу, и главное — что «Проверено» перестаёт
  быть правдой, как только данные периода изменились.

  Суммы периода берутся из того же расчёта, что и плитки выплат, поэтому
  тесты сверяют их друг с другом, а не с заранее выписанным числом.
*/

const YEAR=FROZEN_TODAY.getFullYear();

const MONTH=String(
  FROZEN_TODAY.getMonth()+1
).padStart(2,"0");

const day=number=>
  `${YEAR}-${MONTH}-${
    String(number).padStart(2,"0")
  }`;

function seed({days=[3,8]}={}){
  const source=structuredClone(ADMIN_SEED);

  const point=source.points.find(
    item=>item.id==="point-2"
  );

  source.employee_points=[
    {
      employee_id:"employee-1",
      point_id:"point-2",
      active:true
    }
  ];

  source.shifts=days.map((number,index)=>({
    id:`shift-${index}`,
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
      fullHours:12,
      advanceEnabled:false
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
  }));

  return source;
}

function periodRow(page,index){
  return page
    .locator(".payroll-period")
    .nth(index);
}

async function openStats(page){
  await page.locator("#tab-stats").click();

  await expect(
    page.locator(".payroll-periods")
  ).toBeVisible();
}

test.use({
  viewport:{width:402,height:874}
});

test(
  "a period walks from open to paid and says so",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openStats(page);

    const first=periodRow(page,0);

    await expect(first).toContainText("1–15");
    await expect(first).toContainText("В работе");

    /* Сумма периода — та же, что на плитке выплаты 25-го. */
    await expect(first).toContainText("6 000 ₽");

    await first
      .locator("[data-period-check]")
      .click();

    await expect(
      page.locator("#toast")
    ).toContainText("проверенным");

    await expect(first).toContainText("Проверено");

    await first
      .locator("[data-period-close]")
      .click();

    await page.locator("#appConfirmOk").click();

    await expect(first).toContainText("Закрыто");

    /* Снимок закрытия записан по сотрудникам. */
    expect(
      await page.evaluate(()=>
        (window.__stubDb.payroll_period_entries || []).map(item=>({
          employee:item.employee_id,
          shifts:item.shifts,
          due:item.due
        }))
      )
    ).toMatchObject([
      {
        employee:"employee-1",
        shifts:2,
        due:6000
      }
    ]);

    /*
      «Выплачено» — факт, а не пометка: без записанных выплат состояние
      не меняется.
    */
    await first
      .locator("[data-period-paid]")
      .click();

    await expect(
      page.locator("#toast")
    ).toContainText("Сначала запишите выплаты");

    await expect(first).toContainText("Закрыто");

    await page.evaluate(month=>{
      window.__stubDb.employee_payouts.push({
        id:"payout-1",
        employee_id:"employee-1",
        period_month:month,
        payout_kind:"first_half",
        amount:6000,
        paid_on:month,
        comment:null
      });
    },`${YEAR}-${MONTH}-01`);

    await page.evaluate(()=>
      window.dispatchEvent(new Event("online"))
    );

    await expect(first).toContainText("Закрыто");

    await first
      .locator("[data-period-paid]")
      .click();

    await expect(first).toContainText("Выплачено");
  }
);

test(
  "a checked period stops being checked when the data changes",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openStats(page);

    const first=periodRow(page,0);

    await first
      .locator("[data-period-check]")
      .click();

    await expect(first).toContainText("Проверено");

    /* Появилась ещё одна смена в этой половине месяца. */
    await page.evaluate(date=>{
      const db=window.__stubDb;
      const base=db.shifts[0];

      db.shifts.push({
        ...base,
        id:"shift-added",
        shift_date:date
      });
    },day(5));

    await page.evaluate(()=>
      window.dispatchEvent(new Event("online"))
    );

    await expect(first).toContainText(
      "Данные изменились"
    );

    /* И проверить можно заново — уже с новыми цифрами. */
    await first
      .locator("[data-period-check]")
      .click();

    await expect(first).toContainText("Проверено");
    await expect(first).toContainText("9 000 ₽");
  }
);

test(
  "a closed period can be reopened deliberately",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openStats(page);

    const first=periodRow(page,0);

    await first
      .locator("[data-period-check]")
      .click();

    await first
      .locator("[data-period-close]")
      .click();

    await page.locator("#appConfirmOk").click();

    await expect(first).toContainText("Закрыто");

    await first
      .locator("[data-period-reopen]")
      .click();

    await expect(
      page.locator("#appConfirmDetail")
    ).toContainText("Снимок закрытия останется");

    await page.locator("#appConfirmOk").click();

    await expect(first).toContainText("В работе");

    /* Снимок остался: закрытие было и его видно. */
    expect(
      await page.evaluate(()=>
        (window.__stubDb.payroll_period_entries || []).length
      )
    ).toBe(1);
  }
);

test(
  "both halves of the month are separate periods",
  async({page})=>{
    await openApp(page,{seed:seed({days:[3,20]})});
    await openStats(page);

    await expect(
      page.locator(".payroll-period")
    ).toHaveCount(2);

    const first=periodRow(page,0);
    const second=periodRow(page,1);

    await expect(first).toContainText("1–15");
    await expect(second).toContainText(
      "16–конец месяца"
    );

    await first
      .locator("[data-period-check]")
      .click();

    await expect(first).toContainText("Проверено");

    /* Вторая половина живёт своей жизнью. */
    await expect(second).toContainText("В работе");
  }
);

/*
  Проверка периода: сводка отвечает на вопрос «можно ли закрывать», а из
  находки человек уходит туда, где проблему видно.
*/
test(
  "the review counts people and leads to the problem",
  async({page})=>{
    const source=seed();

    /* У одной смены нет ставки на её дату — это и есть находка. */
    source.shifts[0].pricing_snapshot={
      ...source.shifts[0].pricing_snapshot,
      rate:0
    };

    source.shifts[0].base_amount=0;

    await openApp(page,{seed:source});
    await openStats(page);

    const first=periodRow(page,0);

    const summary=first.locator(
      "[data-period-review]"
    );

    await expect(summary).toContainText(
      "есть вопросы"
    );

    await summary.click();

    const finding=first
      .locator(".payroll-finding")
      .first();

    await expect(finding).toContainText(
      "Смена без ставки"
    );

    /* Клик уводит в саму смену. */
    await finding.click();

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    await expect(
      page.locator("#sheetBody")
    ).toContainText("Корабельная 1");
  }
);

test(
  "a clean period says everyone is ready",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openStats(page);

    await expect(
      periodRow(page,0).locator("[data-period-review]")
    ).toContainText("готовы");

    await expect(
      periodRow(page,0).locator(".payroll-review-count")
    ).toHaveCount(0);
  }
);

/*
  Закрытый период исправить можно, но не молча: сервер отказывает, пока
  человек не согласится, а согласие оставляет след.
*/
test(
  "a closed period refuses a silent change and asks first",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openStats(page);

    const first=periodRow(page,0);

    await first
      .locator("[data-period-check]")
      .click();

    await first
      .locator("[data-period-close]")
      .click();

    await page.locator("#appConfirmOk").click();

    await expect(first).toContainText("Закрыто");

    /* Правка смены из закрытого периода спрашивает. */
    await page.locator("#tab-shifts").click();
    await page.locator(".sh").first().click();
    await page.locator("#sheetSave").click();

    await page.locator("#f-note").fill("Правка после закрытия");
    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#appConfirmTitle")
    ).toContainText("в закрытом периоде");

    await expect(
      page.locator("#appConfirmDetail")
    ).toContainText("1–15");

    /* Отказ ничего не меняет. */
    await page.locator("#appConfirmCancel").click();

    expect(
      await page.evaluate(()=>
        window.__stubDb.shifts.map(item=>item.note)
      )
    ).not.toContain("Правка после закрытия");

    /* Согласие — меняет. */
    await page.locator("#sheetSave").click();
    await page.locator("#appConfirmOk").click();

    await expect
      .poll(()=>page.evaluate(()=>
        window.__stubDb.shifts.map(item=>item.note)
      ))
      .toContain("Правка после закрытия");
  }
);
