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
  Восемь доработок, доведённых после аудита. Каждая проверяется тем
  сценарием, в котором она была не сделана, — чтобы вернуться назад
  незаметно стало нельзя.
*/

const YEAR=FROZEN_TODAY.getFullYear();

const MONTH=String(
  FROZEN_TODAY.getMonth()+1
).padStart(2,"0");

const day=number=>
  `${YEAR}-${MONTH}-${String(number).padStart(2,"0")}`;

function seed({days=[3,8],partial=false}={}){
  const source=structuredClone(ADMIN_SEED);
  const employee=source.employees[0];
  const point=source.points.find(item=>item.id==="point-2");

  source.shifts=days.map((number,index)=>({
    id:`shift-${index+1}`,
    employee_id:employee.id,
    shift_date:day(number),
    point_id:point.id,
    shift_type:"main",
    shk:null,
    partial:partial && index===0,
    hours:partial && index===0 ? 6 : null,
    full_hours:12,
    base_amount:partial && index===0 ? 1500 : 3000,
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

  return source;
}

async function openStats(page){
  await page.locator("#tab-stats").click();
  await page.locator("#statsEmployeeOpen").click();
  await page.locator("[data-stats-employee]").first().click();
}

const periodRow=page=>page.locator(".payroll-period").first();

/* 1. По карточке видно, полная смена или неполная. */
test(
  "the shift card names a full or a partial shift",
  async({page})=>{
    await openApp(page,{seed:seed({partial:true})});

    /* Список идёт от свежей даты к ранней: 8-е полное, 3-е неполное. */
    const rows=page.locator(".sh");

    await rows.nth(0).click();
    await expect(page.locator("#sheetBody"))
      .toContainText("Полная смена · 12 часов");
    await page.locator("#sheetCancel").click();

    await rows.nth(1).click();
    await expect(page.locator("#sheetBody"))
      .toContainText("Неполная смена · 6 часов");
  }
);

/* 2. Подтверждение закрытия коротко и по делу. */
test(
  "closing a period asks briefly",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openStats(page);

    const row=periodRow(page);

    await row.locator("[data-period-check]").click();
    await row.locator("[data-period-close]").click();

    const detail=page.locator("#appConfirmDetail");

    /* Ни одно число не повторяется дважды. */
    await expect(detail)
      .toHaveText("1 сотрудник, 2 смены, 6 000 ₽. Расчёт будет зафиксирован.");

    /* Объяснения, не помогающие решить, ушли. */
    await expect(detail).not.toContainText("каким он закрыт");

    const text=await detail.innerText();
    expect(text.length).toBeLessThan(90);
  }
);

/* 2b. Пустой период говорит об этом прямо. */
test(
  "closing an empty period says it is empty",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openStats(page);

    const second=page.locator(".payroll-period").nth(1);

    await second.locator("[data-period-check]").click();
    await second.locator("[data-period-close]").click();

    await expect(page.locator("#appConfirmDetail"))
      .toContainText("нет ни одной смены");
  }
);

/* 3. Запись истории не повторяет сумму и читается лентой. */
test(
  "a history entry says only what the head does not",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openStats(page);

    const row=periodRow(page);

    await row.locator("[data-period-check]").click();
    await row.locator("[data-period-close]").click();
    await page.locator("#appConfirmOk").click();
    await expect(row).toContainText("Закрыто");

    await page.evaluate(([month,paidOn])=>{
      window.__stubDb.payroll_events=[{
        id:"event-1",
        period_month:month,
        payout_kind:"first_half",
        employee_id:"employee-1",
        kind:"payout_added",
        summary:"аванс",
        reason:"Доплата за переработку",
        effect:4500,
        period_status:"closed",
        details:{date:paidOn},
        occurred_at:new Date().toISOString()
      }];
    },[`${YEAR}-${MONTH}-01`,`${YEAR}-${MONTH}-26`]);

    await page.evaluate(()=>window.dispatchEvent(new Event("online")));
    await row.locator(".payroll-history-toggle").click();

    const entry=page.locator(".payroll-event").first();

    await expect(entry.locator("strong")).toContainText("Выплата записана");
    await expect(entry.locator(".payroll-event-effect")).toContainText("4 500");

    /* Строка под заголовком начинается с заглавной и не повторяет сумму. */
    await expect(entry.locator(".payroll-event-body"))
      .toHaveText("26 сентября · Аванс");

    /* Причина правки больше не теряется. */
    await expect(entry.locator(".payroll-event-reason"))
      .toContainText("Доплата за переработку");

    /* «После закрытия» — отдельная метка, а не хвост строки. */
    await expect(entry.locator(".payroll-event-after"))
      .toContainText("после закрытия");

    await expect(entry.locator(".payroll-event-meta"))
      .toContainText("сегодня");
  }
);

/* 4. Своя ставка оставляет след в истории. */
test(
  "removing an individual rate reaches the history",
  async({page})=>{
    const source=seed();

    source.employee_point_rates=[{
      id:"rate-1",
      employee_id:"employee-1",
      point_id:"point-2",
      effective_from:day(1),
      pricing_type:"fixed",
      fixed_rate:4100,
      shk_tiers:null,
      created_at:new Date().toISOString()
    }];

    await openApp(page,{seed:source});

    await page.evaluate(async()=>{
      await window.supabase
        .createClient()
        .rpc("admin_delete_employee_rate",{p_rate_id:"rate-1"});
    });

    await page.evaluate(()=>window.dispatchEvent(new Event("online")));

    await openStats(page);

    const row=periodRow(page);
    await row.locator(".payroll-history-toggle").click();

    const entry=page.locator(".payroll-event").first();

    await expect(entry.locator("strong")).toContainText("Своя ставка снята");
    await expect(entry.locator(".payroll-event-body"))
      .toContainText("дальше по тарифу ПВЗ");
  }
);

/* 5. Охват блока периодов назван прямо. */
test(
  "the periods block names its whole-team scope",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await page.locator("#tab-stats").click();

    await expect(page.locator(".payroll-periods-scope"))
      .toContainText("По всей команде");

    await page.locator("#statsEmployeeOpen").click();
    await page.locator("[data-stats-employee]").first().click();

    /* С выбранным сотрудником подпись тем более нужна — и она на месте. */
    await expect(page.locator(".payroll-periods-scope"))
      .toContainText("По всей команде");
  }
);

/* 6. Находка о неполной выплате ведёт к самой выплате. */
test(
  "the partial payout finding opens that payout",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openStats(page);

    await page.evaluate(month=>{
      window.__stubDb.employee_payouts.push({
        id:"payout-1",
        employee_id:"employee-1",
        period_month:month,
        payout_kind:"first_half",
        amount:2000,
        paid_on:month,
        comment:null
      });
    },`${YEAR}-${MONTH}-01`);

    await page.evaluate(()=>window.dispatchEvent(new Event("online")));

    const row=periodRow(page);
    await row.locator(".payroll-review-summary").click();

    const finding=page.locator('[data-review-payout="first_half"]');
    await expect(finding).toContainText("Выплачено не полностью");

    /* Сотрудник уже выбран — и всё равно нажатие приводит к выплате. */
    await finding.click();

    await expect(
      page.locator('[data-key="payoutReveal-first_half"]')
    ).toHaveClass(/\bon\b/);

    await expect(
      page.locator('[data-payout-toggle="first_half"]')
    ).toHaveAttribute("aria-expanded","true");
  }
);

/* 7. Выплаченный период с расхождением не притворяется закрытым. */
test(
  "a paid period with a gap stops claiming it is settled",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openStats(page);

    const row=periodRow(page);

    await row.locator("[data-period-check]").click();
    await row.locator("[data-period-close]").click();
    await page.locator("#appConfirmOk").click();

    await page.evaluate(month=>{
      window.__stubDb.employee_payouts.push(
        {id:"pay-1",employee_id:"employee-1",period_month:month,payout_kind:"first_half",amount:3000,paid_on:month,comment:null},
        {id:"pay-2",employee_id:"employee-1",period_month:month,payout_kind:"first_half",amount:3000,paid_on:month,comment:null}
      );
    },`${YEAR}-${MONTH}-01`);

    await page.evaluate(()=>window.dispatchEvent(new Event("online")));

    await row.locator("[data-period-paid]").click();
    await expect(row.locator(".payroll-period-status")).toContainText("Выплачено");

    /* Часть выплаты удалили — период больше не сходится. */
    await page.evaluate(()=>{
      window.__stubDb.employee_payouts=window.__stubDb.employee_payouts
        .filter(item=>item.id!=="pay-2");
    });

    await page.evaluate(()=>window.dispatchEvent(new Event("online")));

    await expect(row.locator(".payroll-period-status"))
      .toContainText("Есть расхождение");

    await expect(row.locator(".payroll-gap.underpaid")).toContainText("3 000");

    /* Переплата — та же механика в другую сторону. */
    await page.evaluate(()=>{
      window.__stubDb.employee_payouts[0].amount=9000;
    });

    await page.evaluate(()=>window.dispatchEvent(new Event("online")));

    await expect(row.locator(".payroll-period-status"))
      .toContainText("Есть расхождение");

    /* Недостающее доплатили — состояние снова однозначное. */
    await page.evaluate(()=>{
      window.__stubDb.employee_payouts[0].amount=6000;
    });

    await page.evaluate(()=>window.dispatchEvent(new Event("online")));

    await expect(row.locator(".payroll-period-status")).toContainText("Выплачено");

    /*
      Состояние выводится из тех же данных, что и суммы, а не из памяти
      экрана: перезагрузку и чужую сессию оно переживает по построению.
      Здесь это не проверить — заглушка при перезагрузке возвращается к
      исходному сиду, — поэтому reload пройден на production.
    */
  }
);

/* 8c. Выплаченный период защищён так же, как закрытый. */
test(
  "a bulk delete still asks about a paid period",
  async({page})=>{
    await openApp(page,{seed:seed({days:[2,3]})});

    await page.evaluate(month=>{
      window.__stubDb.payroll_periods=[{
        id:"period-paid",
        period_month:month,
        payout_kind:"first_half",
        status:"paid",
        checked_fingerprint:null,
        checked_at:null,
        closed_at:new Date().toISOString(),
        paid_at:new Date().toISOString()
      }];
    },`${YEAR}-${MONTH}-01`);

    await page.evaluate(()=>window.dispatchEvent(new Event("online")));

    await page.locator("#shiftSelectToggle").click();
    await page.locator("[data-select-all]").click();
    await page.locator("#shiftSelectDelete").click();
    await page.locator("#appConfirmOk").click();

    await expect(page.locator("#appConfirmDetail"))
      .toContainText("уже выплачен");

    /* Согласие спрашивают один раз на всю пачку. */
    await page.locator("#appConfirmOk").click();

    await expect(page.locator(".sh")).toHaveCount(0);
  }
);

/* 8. Смены выбираются пачкой и удаляются одним осознанным действием. */
test(
  "shifts can be chosen and removed together",
  async({page})=>{
    await openApp(page,{seed:seed({days:[2,3,4,5,6,7]})});

    await expect(page.locator(".sh")).toHaveCount(6);

    await page.locator("#shiftSelectToggle").click();
    await page.locator("[data-select-all]").click();

    await expect(page.locator(".shift-select-count"))
      .toHaveText("6 смен");

    await page.locator("#shiftSelectDelete").click();

    /* Крупная пачка требует набрать число. */
    await expect(page.locator("#appConfirmOk")).toBeDisabled();
    await page.locator("#appConfirmInput").fill("6");
    await expect(page.locator("#appConfirmOk")).toBeEnabled();

    await page.locator("#appConfirmOk").click();

    await expect(page.locator(".sh")).toHaveCount(0);

    /*
      Шесть удалений идут по очереди и заканчиваются обновлением данных:
      под нагрузкой полного прогона это дольше стандартного ожидания.
    */
    await expect(page.locator("#toast"))
      .toHaveText("Удалено 6 смен",{timeout:15000});
  }
);

/* 8b. Закрытый период спрашивает один раз и не пропускает молча. */
test(
  "a bulk delete still asks about a closed period",
  async({page})=>{
    await openApp(page,{seed:seed({days:[2,3]})});

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
    },`${YEAR}-${MONTH}-01`);

    await page.evaluate(()=>window.dispatchEvent(new Event("online")));

    await page.locator("#shiftSelectToggle").click();
    await page.locator("[data-select-all]").click();
    await page.locator("#shiftSelectDelete").click();
    await page.locator("#appConfirmOk").click();

    await expect(page.locator("#appConfirmTitle"))
      .toContainText("Удалить смены в закрытом периоде?");

    /* Отказ ничего не удаляет. */
    await page.locator("#appConfirmCancel").click();

    await expect(page.locator(".sh")).toHaveCount(2);
  }
);
