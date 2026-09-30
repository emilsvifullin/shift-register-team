import {
  test,
  expect
} from "@playwright/test";

import {
  ADMIN_SEED,
  FROZEN_TODAY,
  openApp
} from "./support/supabase-stub.mjs";

import {
  settleScreen
} from "./support/settle.mjs";

/*
  Финансовые гарантии глазами администратора: что он видит, когда
  сервер отказывает, и что приложение показывает там, где раньше
  данные молча терялись.

  Сами правила сервера проверяют db-tests/ на настоящих миграциях;
  здесь — экран поверх них.
*/

const YEAR=FROZEN_TODAY.getFullYear();

const MONTH=String(
  FROZEN_TODAY.getMonth()+1
).padStart(2,"0");

const PERIOD=`${YEAR}-${MONTH}-01`;

const day=number=>
  `${YEAR}-${MONTH}-${String(number).padStart(2,"0")}`;

function shift(source,{id,date,pointId="point-2",base=3000,advance=false}){
  const employee=source.employees[0];
  const point=source.points.find(item=>item.id===pointId);

  return {
    id,
    employee_id:employee.id,
    shift_date:date,
    point_id:point.id,
    shift_type:"main",
    shk:null,
    partial:false,
    hours:null,
    full_hours:12,
    base_amount:base,
    pricing_snapshot:{
      version:2,
      fixed:true,
      pricingType:"fixed",
      rate:base,
      fullHours:12,
      advanceEnabled:advance
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
  };
}

async function openPeriod(page,index){
  await page.locator("#tab-stats").click();

  const row=page.locator(".payroll-period").nth(index);
  const toggle=row.locator("[data-payout-toggle]");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded","true");

  await expect
    .poll(()=>row.evaluate(node=>
      node.getAnimations({subtree:true}).length
    ))
    .toBe(0);

  return row;
}

/*
  История раньше приходила последними 300 событиями на всю базу. Как
  только их становилось больше, ранние периоды оставались без истории —
  молча. Теперь она читается по месяцу и целиком.
*/
test(
  "the history of a period shows every event, however many there are",
  async({page})=>{
    const source=structuredClone(ADMIN_SEED);

    source.shifts=[shift(source,{id:"shift-1",date:day(3)})];

    source.payroll_events=Array.from({length:1250},(_,index)=>({
      id:`event-${index+1}`,
      period_month:PERIOD,
      payout_kind:"first_half",
      employee_id:"employee-1",
      kind:"payout_changed",
      summary:"",
      reason:null,
      effect:null,
      period_status:"open",
      details:{},
      occurred_at:new Date(Date.UTC(YEAR,8,1,index%24)).toISOString()
    }));

    /* Событие другого месяца в этот период не попадает. */
    source.payroll_events.push({
      id:"event-august",
      period_month:`${YEAR}-08-01`,
      payout_kind:"first_half",
      employee_id:"employee-1",
      kind:"payout_added",
      summary:"",
      reason:null,
      effect:1000,
      period_status:"open",
      details:{},
      occurred_at:new Date(Date.UTC(YEAR,7,20)).toISOString()
    });

    await openApp(page,{seed:source});

    const row=await openPeriod(page,0);

    await expect(
      row.locator(".payroll-history-count")
    ).toHaveText("1250");
  }
);

/*
  У ПВЗ с авансом заработанное в первой половине сверх лимита уходит в
  расчёт 10-го. Сотрудник, у которого после 15-го смен нет, раньше
  выпадал из периода «16–конец» целиком — вместе со своими деньгами.
*/
test(
  "the advance carry keeps its employee in the second half",
  async({page})=>{
    const source=structuredClone(ADMIN_SEED);

    source.points.find(item=>item.id==="point-2").advance_enabled=true;

    source.shifts=[1,2,3,4,5,6,7,8].map(number=>
      shift(source,{
        id:`shift-${number}`,
        date:day(number),
        advance:true
      })
    );

    await openApp(page,{seed:source});

    const row=await openPeriod(page,1);

    await expect(row).toContainText("Марина Абрамова");
    await expect(
      row.locator("[data-payout-toggle]")
    ).toContainText("4 000");
  }
);

/*
  Удаление ПВЗ стирает его смены. Закрытый период так не переписывается:
  сервер отказывает, а приложение говорит, какой период мешает.
*/
test(
  "a point with shifts in a closed period is not deleted",
  async({page})=>{
    const source=structuredClone(ADMIN_SEED);

    source.shifts=[shift(source,{id:"shift-1",date:day(3)})];

    source.payroll_periods=[{
      id:"period-1",
      period_month:PERIOD,
      payout_kind:"first_half",
      status:"closed",
      checked_fingerprint:null,
      checked_at:null,
      closed_at:new Date().toISOString(),
      paid_at:null
    }];

    await openApp(page,{seed:source});

    await page.locator("#tab-manage").click();
    await settleScreen(page);
    await page.locator('#app [data-manage-section="points"]').click();
    await settleScreen(page);

    await page.locator('[data-point-id="point-2"]').click();
    await expect(page.locator("#manageEditorSheet")).toHaveClass(/\bon\b/);
    await settleScreen(page);

    await page.locator("#manageEditorSave").click();
    await settleScreen(page);
    await page.locator("#managePointDelete").click();

    await page.locator("#appConfirmInput").fill("Корабельная 1");
    await page.locator("#appConfirmOk").click();

    await expect(page.locator("#toast")).toContainText(
      "У ПВЗ есть смены в закрытом периоде 1–15 за сентябрь 2026"
    );

    expect(
      await page.evaluate(()=>window.__stubDb.shifts.length)
    ).toBe(1);

    expect(
      await page.evaluate(()=>
        window.__stubDb.points.some(point=>point.id==="point-2")
      )
    ).toBe(true);
  }
);
