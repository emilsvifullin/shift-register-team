import {
  test,
  expect
} from "@playwright/test";

import {
  ADMIN_SEED,
  openApp
} from "./support/supabase-stub.mjs";

/*
  Окно списка смен подгоняется под целое число строк: показывать
  наполовину срезанную смену нечестно. Подогнанная высота — инлайновая
  геометрия, и она устаревает.

  Раньше её ставили только при отрисовке. Окно становилось выше — при
  изменении размера, входе и выходе из полноэкранного режима, — флекс уже
  давал место, а прибитая высота его не отдавала: под последней сменой
  оставался пустой участок до нижней панели. Окно становилось ниже — и та
  же высота уводила список под панель. Снималось это только следующей
  перерисовкой, отсюда и «внезапно занял место».

  Число видимых смен не задано заранее: сколько строк помещается в
  доступную высоту, столько и видно.
*/

function shiftsSeed(count=30){
  const seed=structuredClone(ADMIN_SEED);
  const employee=seed.employees[0];
  const point=seed.points[1];

  seed.shifts=Array.from({length:count},(_,index)=>({
    id:`shift-${index+1}`,
    employee_id:employee.id,
    shift_date:`2026-09-${String((index%28)+1).padStart(2,"0")}`,
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

function listMetrics(){
  const frame=
    document.querySelector(".shift-window");

  const scroller=
    document.querySelector(".shift-scroll");

  const area=
    document.getElementById("shiftListArea");

  const dock=
    document.querySelector(".bottom-controls");

  const box=
    scroller.getBoundingClientRect();

  const rows=
    [...scroller.querySelectorAll(".sh")];

  const whole=rows.filter(row=>{
    const rect=row.getBoundingClientRect();

    return (
      rect.top>=box.top-0.5 &&
      rect.bottom<=box.bottom+0.5
    );
  });

  return {
    rowHeight:Math.round(
      rows[0].getBoundingClientRect().height
    ),
    visibleRows:whole.length,
    available:Math.round(
      area.getBoundingClientRect().height
    ),
    frameBottom:Math.round(
      frame.getBoundingClientRect().bottom
    ),
    dockTop:Math.round(
      dock.getBoundingClientRect().top
    )
  };
}

test.use({
  colorScheme:"dark"
});

test(
  "the shift list follows the height the window actually offers",
  async({page})=>{
    await page.setViewportSize({
      width:1280,
      height:700
    });

    await openApp(page,{seed:shiftsSeed()});

    await expect(
      page.locator(".shift-scroll .sh").first()
    ).toBeVisible();

    const small=await page.evaluate(listMetrics);

    /* Целые строки и никакого захода под нижнюю панель. */
    expect(small.frameBottom)
      .toBeLessThanOrEqual(small.dockTop+1);

    await page.setViewportSize({
      width:1280,
      height:1000
    });

    await expect
      .poll(()=>page.evaluate(listMetrics)
        .then(metrics=>metrics.visibleRows))
      .toBeGreaterThan(small.visibleRows);

    const tall=await page.evaluate(listMetrics);

    /* Прибавка высоты достаётся строкам, а не пустоте под списком. */
    expect(tall.visibleRows)
      .toBeGreaterThan(small.visibleRows);

    expect(tall.frameBottom)
      .toBeLessThanOrEqual(tall.dockTop+1);

    expect(
      tall.dockTop-tall.frameBottom
    ).toBeLessThan(tall.rowHeight);

    await page.setViewportSize({
      width:1280,
      height:640
    });

    await expect
      .poll(()=>page.evaluate(listMetrics)
        .then(metrics=>metrics.visibleRows))
      .toBeLessThan(tall.visibleRows);

    const shrunk=await page.evaluate(listMetrics);

    expect(shrunk.visibleRows)
      .toBeLessThan(tall.visibleRows);

    /* И в обратную сторону список не вылезает под панель. */
    expect(shrunk.frameBottom)
      .toBeLessThanOrEqual(shrunk.dockTop+1);

    /*
      Без перерисовки: ни один экран приложения между замерами не
      перестраивался, высоту отдал сам наблюдатель.
    */
    expect(shrunk.rowHeight).toBe(small.rowHeight);
  }
);
