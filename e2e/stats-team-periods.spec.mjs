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
  «Итоги» — один экран с одной линзой: выбором сотрудника.

  «Все сотрудники» — общая картина месяца: начислено по команде, две
  половины месяца строками «Выплат» и итог месяца. Строка половины и есть
  период команды: сумма, выплачено, расхождение и состояние видны сразу,
  а люди, проверка, отчёты и действия — в раскрытии. Выбранный человек
  меняет те же строки на свои выплаты.

  Цифры команды не считаются заново: это сумма тех же payouts(), что
  рисуют итоги каждого человека, поэтому здесь они сверяются друг с
  другом и с известными суммами сида.
*/

const YEAR=FROZEN_TODAY.getFullYear();

const MONTH=String(
  FROZEN_TODAY.getMonth()+1
).padStart(2,"0");

const PERIOD_MONTH=`${YEAR}-${MONTH}-01`;

const day=number=>
  `${YEAR}-${MONTH}-${String(number).padStart(2,"0")}`;

/*
  ПВЗ с окладом 3 000 ₽ без аванса: у Марины две смены в первой
  половине (6 000 ₽), у Романа — одна (3 000 ₽). Во второй половине
  смен нет ни у кого.
*/
function seed(){
  const source=structuredClone(ADMIN_SEED);
  const point=source.points.find(item=>item.id==="point-2");

  const shift=(id,employee,number)=>({
    id,
    employee_id:employee.id,
    shift_date:day(number),
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
    point:{...point},
    bonuses:[],
    penalties:[]
  });

  const [marina,roman]=source.employees;

  source.shifts=[
    shift("m-3",marina,3),
    shift("m-8",marina,8),
    shift("r-5",roman,5)
  ];

  return source;
}

const first=page=>page.locator(".payroll-period").first();
const second=page=>page.locator(".payroll-period").nth(1);

async function settled(locator){
  await expect
    .poll(()=>locator.evaluate(node=>
      node.getAnimations({subtree:true}).length
    ))
    .toBe(0);
}

async function openPeriod(page,index=0){
  const row=page.locator(".payroll-period").nth(index);
  const toggle=row.locator("[data-payout-toggle]");

  if(await toggle.getAttribute("aria-expanded")!=="true"){
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute("aria-expanded","true");
  await settled(row);
}

/* Записать Марине выплату за 1–15 и дождаться обновления данных. */
async function setPayout(page,amount){
  await page.evaluate(({month,amount})=>{
    window.__stubDb.employee_payouts=[{
      id:"payout-1",
      employee_id:"employee-1",
      period_month:month,
      payout_kind:"first_half",
      amount,
      paid_on:"2026-09-20",
      comment:"",
      created_at:"2026-09-20T10:00:00Z",
      updated_at:"2026-09-20T10:00:00Z"
    }];
  },{month:PERIOD_MONTH,amount});

  await page.evaluate(()=>window.dispatchEvent(new Event("online")));
}

async function setPeriod(page,status){
  await page.evaluate(({month,status})=>{
    window.__stubDb.payroll_periods=[{
      id:"period-1",
      period_month:month,
      payout_kind:"first_half",
      status,
      checked_fingerprint:null,
      checked_at:null,
      closed_at:["closed","paid"].includes(status)
        ? new Date().toISOString()
        : null,
      paid_at:status==="paid"
        ? new Date().toISOString()
        : null
    }];
  },{month:PERIOD_MONTH,status});

  await page.evaluate(()=>window.dispatchEvent(new Event("online")));
}

test.describe("desktop",()=>{
  test.use({
    viewport:{width:1440,height:1000}
  });

  test(
    "the whole team comes first, compact, with the period folded away",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await page.locator("#tab-stats").click();

      await expect(
        page.locator("#statsEmployeeOpen .point-value")
      ).toHaveText("Все сотрудники");

      /* Начислено по команде — сумма начислений людей. */
      await expect(page.locator(".hero .n")).toContainText("9 000");
      await expect(page.locator(".hero .sub"))
        .toHaveText("Вся команда · 3 смены · 2 сотрудника");

      /* Половина месяца — строка выплаты с состоянием периода. */
      const row=first(page);

      await expect(row.locator(".payout-summary .t"))
        .toHaveText("25 сентября");
      await expect(row.locator(".payroll-period-sub"))
        .toHaveText(/за 1–15\s*·\s*выплачено\s0\s₽/);
      await expect(row.locator(".payroll-period-status"))
        .toHaveText("В работе");
      await expect(row.locator(".payout-summary .v"))
        .toHaveText("9 000 ₽");

      await expect(second(page).locator(".payout-summary .t"))
        .toHaveText("10 октября");

      /*
        Редкие действия периода в свёрнутом виде не видны вовсе, и строка
        остаётся строкой, а не блоком на пол-экрана.
      */
      await expect(
        row.locator("[data-period-check]")
      ).toBeHidden();

      const height=await row.evaluate(node=>
        node.getBoundingClientRect().height
      );

      expect(height).toBeLessThan(90);

      /* Итог месяца по команде сходится с суммой половин. */
      await expect(page.locator(".row.total .v"))
        .toHaveText("9 000 ₽");

      /* В раскрытии — люди, проверка, отчёты и действия. */
      await openPeriod(page,0);

      const people=row.locator(".payroll-person-row");

      await expect(people).toHaveCount(2);
      await expect(people.nth(0)).toContainText("Марина Абрамова");
      await expect(people.nth(0)).toContainText("6 000 ₽");
      await expect(people.nth(1)).toContainText("Роман Белов");
      await expect(people.nth(1)).toContainText("3 000 ₽");

      await expect(row.locator("[data-period-check]")).toBeVisible();
      await expect(row.locator(".payroll-report-link")).toHaveCount(2);

      /* Пустая половина говорит об этом одной строкой. */
      await openPeriod(page,1);

      await expect(second(page).locator(".payout-empty"))
        .toHaveText("В этой половине месяца начислений нет.");
    }
  );

  test(
    "partial, full and excess payments read the same in the row and per person",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await page.locator("#tab-stats").click();
      await openPeriod(page,0);

      const row=first(page);
      const marina=row.locator(".payroll-person-row").first();

      /* Частичная выплата. */
      await setPayout(page,2000);

      await expect(row.locator(".payroll-period-sub"))
        .toContainText("выплачено 2 000 ₽");
      await expect(row.locator(".payroll-gap.underpaid"))
        .toContainText("Недоплата 4 000 ₽");
      await expect(marina.locator(".payroll-person-meta"))
        .toContainText("недоплата 4 000 ₽");

      /* Полная. */
      await setPayout(page,6000);

      await expect(row.locator(".payroll-gap")).toHaveCount(0);
      await expect(marina.locator(".payroll-person-meta"))
        .toHaveText(/^\s*выплачено\s6\s000\s₽\s*$/);

      /* Переплата. */
      await setPayout(page,7000);

      await expect(row.locator(".payroll-gap.overpaid"))
        .toContainText("Переплата 1 000 ₽");
      await expect(marina.locator(".payroll-person-meta"))
        .toContainText("переплата 1 000 ₽");
    }
  );

  test(
    "each period status reads in the row head",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await page.locator("#tab-stats").click();

      const status=first(page).locator(".payroll-period-status");

      /* Отметку «Проверено» без отпечатка данные уже переросли. */
      await setPeriod(page,"checked");
      await expect(status).toHaveText("Данные изменились");

      /* Закрыт без выплат — недоплата по всей команде. */
      await setPeriod(page,"closed");
      await expect(status).toHaveText("Закрыто");
      await expect(first(page).locator(".payroll-gap.underpaid"))
        .toContainText("Недоплата 9 000 ₽");

      /* Выплачен, но деньги не сходятся — так и сказано. */
      await setPeriod(page,"paid");
      await expect(status).toHaveText("Есть расхождение");
    }
  );

  test(
    "a person in the period opens their own payout and leads back",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await setPeriod(page,"closed");

      await page.locator("#tab-stats").click();
      await openPeriod(page,0);

      await first(page)
        .locator('[data-stats-person="employee-1"]')
        .click();

      /* Тот же экран, та же половина месяца — теперь её выплата. */
      await expect(
        page.locator("#statsEmployeeOpen .point-value")
      ).toHaveText("Марина Абрамова");

      await expect(page.locator(".payroll-period")).toHaveCount(0);

      await expect(
        page.locator('[data-payout-toggle="first_half"]')
      ).toHaveAttribute("aria-expanded","true");

      const note=page.locator(".payout-block.open .payout-period-note");

      await expect(note).toContainText("Период 1–15 для всей команды");
      await expect(note).toContainText("Закрыто");

      await note.locator('[data-stats-employee=""]').click();

      await expect(
        page.locator("#statsEmployeeOpen .point-value")
      ).toHaveText("Все сотрудники");

      await expect(
        first(page).locator("[data-payout-toggle]")
      ).toHaveAttribute("aria-expanded","true");
    }
  );
});

test.describe("mobile",()=>{
  test.use({
    viewport:{width:390,height:844},
    hasTouch:true
  });

  /*
    На телефоне общая картина помещается на первом экране целиком:
    выбор, начислено и обе половины месяца видны без прокрутки.
  */
  test(
    "the team overview fits the first phone screen",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await page.locator("#tab-stats").tap();

      const bottom=await second(page).evaluate(node=>
        node.getBoundingClientRect().bottom
      );

      const dock=await page.evaluate(()=>
        document.querySelector("nav.tabs").getBoundingClientRect().top
      );

      expect(bottom).toBeLessThan(dock);
    }
  );
});
