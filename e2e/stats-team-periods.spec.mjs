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
  «Итоги» в два уровня: сначала периоды команды, ниже — расчёт одного
  сотрудника. Выбранный сотрудник виден и в периоде — строкой только для
  чтения, собранной из тех же строк, что и цифры периода. Здесь каждое
  состояние этой строки: без выбора, без выплат, частичная, полная,
  недоплата в закрытом периоде и переплата.
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

async function pickStatsEmployee(page,id){
  await page.locator("#statsEmployeeOpen").click();

  const reveal=page.locator('[data-key="statsEmployeeReveal"]');

  await expect(reveal).toHaveClass(/\bon\b/);

  await expect
    .poll(()=>reveal.evaluate(node=>node.getAnimations().length))
    .toBe(0);

  await page.locator(`[data-stats-employee="${id}"]`).click();
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

const first=page=>page.locator(".payroll-period").first();
const second=page=>page.locator(".payroll-period").nth(1);
const person=row=>row.locator(".payroll-person");

test(
  "team periods come first and the chosen employee reads as a share of them",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await page.locator("#tab-stats").click();

    /* Без выбора в периоде нет ничьей строки — только цифры команды. */
    await expect(page.locator(".payroll-person")).toHaveCount(0);

    await expect(
      first(page).locator(".payroll-period-figures")
    ).toContainText("К выплате 9 000 ₽");

    await expect(
      page.locator(".stats-empty")
    ).toContainText("Выберите сотрудника");

    await pickStatsEmployee(page,"employee-1");

    /* Ничего не выплачено: остаток и так виден, расхождения нет. */
    await expect(person(first(page))).toHaveText(
      /^\s*Марина Абрамова\s+к\sвыплате\s6\s000\s₽\s+выплачено\s0\s₽\s*$/
    );

    /* В половине, где у неё ничего нет, так и сказано. */
    await expect(person(second(page))).toContainText(
      "в этом периоде смен и выплат нет"
    );

    /* Период при этом остаётся периодом команды. */
    await expect(
      first(page).locator(".payroll-period-figures")
    ).toContainText("Сотрудников 2");

    await expect(
      first(page).locator(".payroll-period-figures")
    ).toContainText("К выплате 9 000 ₽");

    /*
      Строка тише цифр периода: мельче шрифтом и без их яркости — чтобы
      не читаться второй шапкой.
    */
    const sizes=await first(page).evaluate(row=>{
      const size=selector=>parseFloat(
        getComputedStyle(row.querySelector(selector)).fontSize
      );

      return {
        figures:size(".payroll-period-figures"),
        person:size(".payroll-person"),
        title:size(".payroll-period-title")
      };
    });

    expect(sizes.person).toBeLessThan(sizes.figures);
    expect(sizes.person).toBeLessThan(sizes.title);

    /* Другой сотрудник — его доля того же периода. */
    await pickStatsEmployee(page,"employee-2");

    await expect(person(first(page))).toContainText("Роман Белов");
    await expect(person(first(page))).toContainText("к выплате 3 000 ₽");
  }
);

test(
  "the share follows partial, full and excess payments",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await page.locator("#tab-stats").click();
    await pickStatsEmployee(page,"employee-1");

    const row=first(page);

    /* Частичная выплата: та же недоплата, что в шапке периода. */
    await setPayout(page,2000);

    await expect(person(row)).toContainText("выплачено 2 000 ₽");
    await expect(person(row).locator(".underpaid"))
      .toHaveText(/^\s*недоплата\s4\s000\s₽\s*$/);

    await expect(row.locator(".payroll-gap.underpaid"))
      .toContainText("Недоплата 4 000 ₽");

    /* Полная выплата: ни недоплаты, ни переплаты. */
    await setPayout(page,6000);

    await expect(person(row)).toContainText("выплачено 6 000 ₽");
    await expect(person(row).locator(".underpaid, .overpaid"))
      .toHaveCount(0);

    /* Переплата. */
    await setPayout(page,7000);

    await expect(person(row).locator(".overpaid"))
      .toHaveText(/^\s*переплата\s1\s000\s₽\s*$/);

    await expect(row.locator(".payroll-gap.overpaid"))
      .toContainText("Переплата 1 000 ₽");
  }
);

test(
  "a closed period with nothing paid shows the underpayment",
  async({page})=>{
    await openApp(page,{seed:seed()});

    await page.evaluate(month=>{
      window.__stubDb.payroll_periods=[{
        id:"period-closed",
        period_month:month,
        payout_kind:"first_half",
        status:"closed",
        checked_fingerprint:null,
        checked_at:null,
        closed_at:new Date().toISOString(),
        paid_at:null
      }];
    },PERIOD_MONTH);

    await page.evaluate(()=>window.dispatchEvent(new Event("online")));

    await page.locator("#tab-stats").click();
    await pickStatsEmployee(page,"employee-1");

    /*
      Закрытием расчёт утверждён, и невыплаченное становится недоплатой —
      по тому же правилу, что и у периода.
    */
    await expect(person(first(page)).locator(".underpaid"))
      .toHaveText(/^\s*недоплата\s6\s000\s₽\s*$/);

    await expect(first(page).locator(".payroll-gap.underpaid"))
      .toContainText("Недоплата 9 000 ₽");
  }
);
