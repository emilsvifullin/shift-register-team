/*
  Снимки экранов для инструкции.

  Кадр строится по элементам, а не по координатам окна: край проходит по
  границе блока с отступом, а не посреди строки. Панели и диалоги
  снимаются отдельно от фона и без собственных углов, рамки и тени:
  каждый снимок — прямоугольник, а одинаковое скругление и рамку всем
  снимкам даёт build.mjs.

  Номера и рамки на снимок не рисуются. Их положение пишется рядом, в
  shots/<имя>.json, а build.mjs накладывает их при сборке — одного
  размера на всех страницах, как бы ни был уменьшен снимок.

    node docs/manual/capture.mjs            все сцены
    node docs/manual/capture.mjs "^1[0-3]"  только подходящие по имени
*/

import {launch,openDemo,settle,VIEWPORT,ORIGIN} from "./stand.mjs";
import {demoSeed} from "./demo-seed.mjs";
import {mkdirSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const OUT=fileURLToPath(new URL("./out/shots/",import.meta.url));
mkdirSync(OUT,{recursive:true});

const ONLY=process.argv[2] ? new RegExp(process.argv[2]) : null;

/* Колонка приложения с полями под номера слева и справа (CSS-пиксели окна 1838 px). */
const MAIN={x0:350,x1:1488};

/*
  Кадр.

  el       — элемент, по которому берутся границы (и который остаётся
             один на прозрачном фоне, если isolate);
  x0, x1   — горизонтальные границы числом, если кадр не по элементу;
  from     — верх кадра по верху этого элемента;
  until    — низ кадра по низу этого элемента;
  margin   — отступ от from/until/el: число или {t,r,b,l};
  isolate  — оставить только el: фон, затемнение и остальное скрыть.
             Кадр при этом не выходит за границы el.
*/
async function frameOf(page,frame){
  return page.evaluate(frame=>{
    const pick=spec=>{
      if(!spec){
        return null;
      }
      const [sel,text,index=0]=Array.isArray(spec) ? spec : [spec];
      const all=[...document.querySelectorAll(sel)].filter(el=>{
        const r=el.getBoundingClientRect();
        return r.width>0 && r.height>0;
      });
      const list=text
        ? all.filter(el=>el.textContent.replace(/\s+/g," ").includes(text))
        : all;
      const el=list[index];
      if(!el){
        throw new Error("кадр: не найден "+sel+(text ? ` «${text}»` : ""));
      }
      return el;
    };

    const m=typeof frame.margin==="object"
      ? {t:0,r:0,b:0,l:0,...frame.margin}
      : {t:frame.margin ?? 0,r:frame.margin ?? 0,b:frame.margin ?? 0,l:frame.margin ?? 0};

    const el=pick(frame.el);
    const box=el ? el.getBoundingClientRect() : null;

    let left=frame.x0 ?? (box ? box.left-m.l : 0);
    let right=frame.x1 ?? (box ? box.right+m.r : innerWidth);
    let top=frame.from ? pick(frame.from).getBoundingClientRect().top-m.t : (box ? box.top-m.t : 0);
    let bottom=frame.until ? pick(frame.until).getBoundingClientRect().bottom+m.b : (box ? box.bottom+m.b : innerHeight);

    left=Math.max(0,Math.round(left));
    top=Math.max(0,Math.round(top));
    right=Math.min(innerWidth,Math.round(right));
    bottom=Math.min(innerHeight,Math.round(bottom));

    if(el && frame.isolate){
      el.setAttribute("data-manual-keep","");
      left=Math.max(left,Math.ceil(box.left));
      top=Math.max(top,Math.ceil(box.top));
      right=Math.min(right,Math.floor(box.right));
      bottom=Math.min(bottom,Math.floor(box.bottom));
    }

    return {x:left,y:top,width:right-left,height:bottom-top};
  },frame);
}

/* Положение отметок относительно кадра. */
async function marksOf(page,marks,clip){
  const {found,lost}=await page.evaluate(({marks,clip})=>{
    const visible=el=>{
      const r=el.getBoundingClientRect();
      return r.width>0 && r.height>0;
    };
    const find=m=>{
      const all=[...document.querySelectorAll(m.sel)].filter(visible);
      const list=m.text
        ? all.filter(el=>el.textContent.replace(/\s+/g," ").trim().includes(m.text))
        : all;
      return list[m.index || 0] || null;
    };

    const found=[];
    const lost=[];

    for(const m of marks){
      const el=find(m);
      if(!el){
        lost.push(m.sel+(m.text ? ` «${m.text}»` : ""));
        continue;
      }

      let r=el.getBoundingClientRect();

      /* Рамка по самому тексту, а не по всей ширине кнопки. */
      if(m.content){
        const range=document.createRange();
        range.selectNodeContents(el);
        r=range.getBoundingClientRect();
      }

      found.push({
        n:m.n ?? null,
        box:m.box!==false,
        at:m.at || "left",
        pad:m.pad ?? 5,
        radius:m.radius ?? 12,
        dy:m.dy ?? 0,
        x:r.left-clip.x,
        y:r.top-clip.y,
        w:r.width,
        h:r.height
      });
    }

    return {found,lost};
  },{marks,clip});

  if(lost.length){
    throw new Error("не найдено: "+lost.join(", "));
  }

  /* Отмеченный элемент целиком в кадре — иначе номер повиснет над соседним текстом. */
  const outside=found.filter(m=>
    m.x<-1 || m.y<-1 || m.x+m.w>clip.width+1 || m.y+m.h>clip.height+1
  );
  if(outside.length){
    throw new Error("вне кадра: "+outside.map(m=>m.n ?? "рамка").join(", "));
  }

  return found;
}

/*
  Панель или диалог снимается сам по себе: фон и затемнение скрыты, а
  собственные углы, рамка и тень сняты. Иначе у панели, прижатой к низу
  экрана, скруглён только верх, у диалога — свои углы и тень, и снимки
  выглядели бы разными кусками. Одинаковое скругление и рамку всем даёт
  сборка.
*/
const ISOLATE_CSS=`
  body *{visibility:hidden!important}
  [data-manual-keep],[data-manual-keep] *{visibility:visible!important}
  [data-manual-keep]{box-shadow:none!important;filter:none!important;border-radius:0!important;border-color:transparent!important}
`;

async function shoot(page,name,{frame={},marks=[],wait=700}={}){
  await settle(page,wait);

  const clip=await frameOf(page,frame);
  const found=await marksOf(page,marks,clip);

  let style=null;
  if(frame.isolate){
    style=await page.addStyleTag({content:ISOLATE_CSS});
    await page.waitForTimeout(60);
  }

  const png=await page.screenshot({
    clip:{x:clip.x,y:clip.y,width:clip.width,height:clip.height}
  });

  if(style){
    await style.evaluate(node=>node.remove());
    await page.evaluate(()=>document.querySelectorAll("[data-manual-keep]").forEach(el=>el.removeAttribute("data-manual-keep")));
  }

  writeFileSync(`${OUT}${name}.png`,png);
  writeFileSync(`${OUT}${name}.json`,JSON.stringify({
    width:clip.width,
    height:clip.height,
    device:frame.device || null,
    marks:found
  },null,1));
}

/* ---------- стенд ---------- */

const SCALE=2.4;
const {browser,context}=await launch({scale:SCALE});

/*
  Суммы первой половины месяца считает само приложение: по ним записываются
  выплаты 25-го, и период 1–15 на снимках выглядит выплаченным.
*/
async function firstHalfDues(){
  const page=await openDemo(context);
  await page.locator("#tab-stats").click();
  await page.locator('[data-payout-toggle="first_half"]').click();
  await settle(page,600);
  const dues=await page.locator(".payroll-period").first().locator("[data-stats-person]").evaluateAll(rows=>Object.fromEntries(rows.map(r=>[
    r.dataset.statsPerson,
    Number(r.querySelector("b").textContent.replace(/[^\d]/g,""))
  ])));
  await page.close();
  return dues;
}

const DUES=await firstHalfDues();
const SEED=()=>demoSeed({paidFirstHalf:DUES,firstHalfStatus:"paid"});

/* Высокое окно: панель помещается целиком, кадр режется по нужному блоку. */
const TALL={width:VIEWPORT.width,height:1700};

async function demo({viewport=VIEWPORT}={}){
  const page=await openDemo(context,{seed:SEED()});
  if(viewport!==VIEWPORT){
    await page.setViewportSize(viewport);
    await settle(page,400);
  }
  return page;
}

const scenes=[];
const scene=(name,run)=>scenes.push({name,run});

/* ---------- Начало работы ---------- */

scene("00-cover",async()=>{
  const page=await demo();
  await shoot(page,"00-cover",{frame:{x0:MAIN.x0,x1:MAIN.x1,until:[".shift-scroll .sh","",8]}});
  await page.close();
});

scene("01-login",async()=>{
  const page=await context.newPage();
  await page.route("**/vendor/supabase-js-*.js",r=>r.fulfill({status:200,contentType:"text/javascript",body:"window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}}}}};"}));
  await page.route("**/login.html",async r=>{const res=await r.fetch();const html=await res.text();await r.fulfill({status:200,contentType:"text/html; charset=utf-8",body:html.replace(/\n\s*integrity="[^"]*"/,"")});});
  await page.goto(`${ORIGIN}/login.html`);
  await shoot(page,"01-login",{
    frame:{el:".auth-card",isolate:true},
    marks:[
      {sel:"#email",n:1},
      {sel:"#current-password",n:2},
      {sel:"#authSubmit",n:3}
    ]
  });
  await page.close();
});

scene("02-overview",async()=>{
  const page=await demo();
  await shoot(page,"02-overview",{
    frame:{x0:MAIN.x0,x1:MAIN.x1},
    marks:[
      {sel:"#period",n:1,at:"right",radius:10,content:true,pad:8},
      {sel:"#prevM",n:2,at:"right",radius:999},
      {sel:"#nextM",n:2,at:"left",radius:999},
      {sel:"nav.tabs",n:3,at:"left",radius:18}
    ]
  });
  await page.close();
});

/*
  Тот же экран на телефоне: так Shift Register выглядит в браузере телефона
  и установленным на экран «Домой».
*/
scene("02b-phone",async()=>{
  const phone=await browser.newContext({
    viewport:{width:390,height:844},
    deviceScaleFactor:3,
    isMobile:true,
    hasTouch:true,
    colorScheme:"light",
    serviceWorkers:"block"
  });
  const page=await openDemo(phone,{seed:SEED()});
  await shoot(page,"02b-phone",{frame:{device:"phone"}});
  await phone.close();
});

scene("03-month",async()=>{
  const page=await demo();
  await page.locator("#period").click();
  await shoot(page,"03-month",{
    frame:{el:"#monthPicker",isolate:true},
    marks:[
      {sel:".month-picker-head",n:1,at:"left",radius:12},
      {sel:".month-option",text:"Август",n:2,at:"left",radius:12},
      {sel:"#monthToday",n:3,at:"left",radius:12}
    ]
  });
  await page.close();
});

/* ---------- Смены ---------- */

scene("04-registry",async()=>{
  const page=await demo();
  await shoot(page,"04-registry",{
    frame:{x0:MAIN.x0,x1:MAIN.x1},
    marks:[
      {sel:"#shiftAdd",n:1,at:"left"},
      {sel:".sv-switch .seg",n:2,at:"left"},
      {sel:"#shiftSearch",n:3,at:"left",pad:5},
      {sel:"#shiftFilterOpen",n:4,at:"left",pad:2},
      {sel:"#shiftSelectToggle",n:5,at:"left",radius:8},
      {sel:".shift-scroll .sh",n:6,at:"left",pad:1}
    ]
  });
  await page.close();
});

async function newShiftFilled(page){
  await page.locator("#shiftAdd").click();
  await settle(page,500);
  await page.locator("#f-point-open").click();
  await settle(page,500);
  await page.locator("#sheet [data-shift-point]",{hasText:"Тверская 12"}).first().click().catch(async()=>{
    await page.locator("#sheet button",{hasText:"Тверская 12"}).first().click();
  });
  await settle(page,500);
  await page.locator("#f-employee-open").click();
  await settle(page,500);
  await page.locator("#sheet button",{hasText:"Анна Смирнова"}).first().click();
  await settle(page,500);
}

/* Панель целиком, но не ниже блока until. */
const sheet=(el,until,extra={})=>({el,isolate:true,until,margin:{b:28},...extra});

scene("05-new-shift",async()=>{
  const page=await demo({viewport:TALL});
  await newShiftFilled(page);
  await shoot(page,"05-new-shift",{
    frame:sheet("#sheet","#calcBox"),
    marks:[
      {sel:"#f-date-open",n:1,at:"left",pad:0},
      {sel:"#f-point-open",n:2,at:"left",pad:0},
      {sel:"#f-employee-open",n:3,at:"left",pad:0},
      {sel:"#sheetBody .seg",index:0,n:4,at:"left"},
      {sel:"#sheetBody .seg",index:1,n:5,at:"left"},
      {sel:"#sheetBody .seg",index:2,n:6,at:"left"},
      {sel:".adjustment-add-row",index:0,n:7,at:"left",pad:2},
      {sel:".adjustment-add-row",index:1,n:8,at:"left",pad:2},
      {sel:"#f-note",n:9,at:"left",pad:6},
      {sel:"#calcBox",n:10,at:"left"},
      {sel:"#sheetSave",n:11,at:"left",radius:8}
    ]
  });
  await page.close();
});

scene("06-dates",async()=>{
  const page=await demo({viewport:TALL});
  await newShiftFilled(page);
  await page.locator("#f-date-open").click();
  await settle(page,600);
  for(const d of ["2026-09-29","2026-09-30","2026-09-28"]){
    await page.locator(`#sheet [data-date="${d}"]`).click();
    await settle(page,250);
  }
  await shoot(page,"06-dates",{
    frame:sheet("#sheet",".date-chosen",{margin:{b:12}}),
    marks:[
      {sel:"#sheet .date-day.on",index:0,n:1,at:"left",radius:10,pad:3},
      {sel:"#sheet .date-day.on",index:1,radius:10,pad:3},
      {sel:"#sheet .date-day.on",index:2,radius:10,pad:3},
      {sel:".date-chosen-head",n:2,at:"left",pad:6}
    ]
  });
  await page.close();
});

scene("07-extras",async()=>{
  const page=await demo({viewport:TALL});
  await newShiftFilled(page);
  await page.locator("#sheetBody .seg").nth(1).locator("button",{hasText:"Неполная"}).click();
  await settle(page,400);
  await page.locator("#f-hours").fill("8");
  await page.locator("#sheetBody .seg").nth(2).locator("button",{hasText:"Корректировка"}).click();
  await settle(page,400);
  await page.locator("#f-base-override").fill("2500");
  await page.locator("#f-base-reason").fill("Закрыли пункт раньше");
  await page.locator('[data-adjustment-add="bonuses"]').click();
  await settle(page,400);
  await page.locator('[data-adjustment-kind="bonuses"] [data-adjustment-amount]').fill("500");
  await page.locator('[data-adjustment-kind="bonuses"] [data-adjustment-comment]').fill("Переработка");
  await page.locator('[data-adjustment-add="penalties"]').click();
  await settle(page,400);
  await page.locator('[data-adjustment-kind="penalties"] [data-adjustment-amount]').fill("300");
  await page.locator('[data-adjustment-kind="penalties"] [data-adjustment-comment]').fill("Опоздание");
  await shoot(page,"07-extras",{
    frame:{el:"#sheet",isolate:true,from:["#sheetBody .seg","",1],until:'[data-adjustment-add="penalties"]',margin:{t:44,b:16}},
    marks:[
      {sel:"#sheetBody .row:has(#f-hours)",n:1,at:"left",pad:2},
      {sel:"#sheetBody .row:has(#f-base-override)",n:2,at:"left",pad:2},
      {sel:"#sheetBody .row:has(#f-base-reason)",n:3,at:"left",pad:2},
      {sel:'[data-adjustment-kind="bonuses"]',n:4,at:"left"},
      {sel:'[data-adjustment-kind="penalties"]',n:5,at:"left"}
    ]
  });
  await page.close();
});

scene("08-card",async()=>{
  const page=await demo({viewport:TALL});
  await page.locator(".shift-scroll .sh").first().click();
  await shoot(page,"08a-card",{
    frame:sheet("#sheet",["#sheetBody .calc, #sheetBody .card","За смену"]),
    marks:[
      {sel:"#sheetSave",n:1,at:"left",radius:8},
      {sel:"#sheetBody .calc, #sheetBody .card",text:"За смену",n:2,at:"left"},
      {sel:"#sheetCancel",n:3,at:"right",radius:8}
    ]
  });
  await page.locator("#sheetSave").click();
  await settle(page,500);
  /*
    Окно ниже: панель короче. Она прокручена так, что под шапкой сразу
    начинается блок «Отработано», а внизу целиком видна «Удалить смену»;
    высота окна подбирается под это расстояние.
  */
  const align=()=>page.evaluate(()=>{
    const sheet=document.getElementById("sheet");
    const scroller=[sheet,document.getElementById("sheetBody")].find(el=>el.scrollHeight>el.clientHeight+1);
    const head=sheet.querySelector(".shead").getBoundingClientRect();
    const label=[...sheet.querySelectorAll(".ml")].find(el=>/Отработано/i.test(el.textContent));
    if(scroller){
      scroller.scrollTop+=label.getBoundingClientRect().top-head.bottom-12;
    }
    return innerHeight-document.getElementById("f-del").getBoundingClientRect().bottom;
  });
  let height=820;
  for(let i=0;i<3;i++){
    await page.setViewportSize({width:VIEWPORT.width,height});
    await settle(page,400);
    const room=await align();
    await settle(page,300);
    if(Math.abs(room-22)<3){
      break;
    }
    height+=Math.round(22-room);
  }
  await shoot(page,"08b-edit",{
    frame:{el:"#sheet",isolate:true},
    marks:[
      {sel:"#sheetSave",n:1,at:"left",radius:8},
      {sel:"#f-del",n:2,at:"left"}
    ]
  });
  await page.close();
});

/* Фильтр длинный — два кадра одной панели: верх и низ. */
scene("09-filter",async()=>{
  const page=await demo({viewport:TALL});
  await page.locator("#shiftFilterOpen").click();
  await shoot(page,"09a-filter",{
    frame:sheet("#shiftFilterSheet",["#shiftFilterSheet .card.employee-points","",0],{margin:{b:10}}),
    marks:[
      {sel:"#shiftFilterSheet .seg",n:1,at:"left"},
      {sel:"#shiftFilterSheet .card.employee-points",index:0,n:2,at:"left"},
      {sel:"#shiftFilterSheet button",text:"Готово",n:4,at:"left",radius:8}
    ]
  });
  await shoot(page,"09b-filter",{
    frame:sheet("#shiftFilterSheet","#shiftFilterReset",{from:["#shiftFilterSheet .ml","Сотрудники"],margin:{t:24,b:24}}),
    marks:[
      {sel:"#shiftFilterSheet .card.employee-points",index:1,n:3,at:"left"},
      {sel:"#shiftFilterReset",n:5,at:"left"}
    ]
  });
  await page.close();
});

scene("10-select",async()=>{
  const page=await demo();
  await page.locator("#shiftSelectToggle").click();
  for(const i of [0,1,3]){
    await page.locator("[data-select]").nth(i).click();
  }
  await shoot(page,"10a-select",{
    frame:{x0:MAIN.x0,x1:MAIN.x1},
    marks:[
      {sel:"#shiftSelectToggle",n:1,at:"right",radius:8,dy:-2.2},
      {sel:"[data-select-all]",n:2,at:"left",radius:10},
      {sel:".shift-select-count",n:3,at:"top",radius:8,content:true,pad:6},
      {sel:"#shiftSelectDelete",n:4,at:"right",dy:2.2},
      {sel:".shift-scroll .sh.chosen .sh-check",index:0,n:5,at:"left",radius:8,pad:4}
    ]
  });
  for(const i of [4,5]){
    await page.locator("[data-select]").nth(i).click();
  }
  await page.locator("#shiftSelectDelete").click();
  await page.locator("#appConfirmInput").fill("5");
  await shoot(page,"10b-confirm",{
    frame:{el:".app-confirm-box",isolate:true},
    marks:[
      {sel:"#appConfirmInput",n:1,at:"left"},
      {sel:"#appConfirmOk",n:2,at:"bottom",pad:-4,radius:8}
    ]
  });
  await page.close();
});

/* ---------- Календарь и контроль ---------- */

async function openCalendar(page){
  await page.locator('[data-shift-view="calendar"]').click();
  await settle(page,500);
}

async function choosePoint(page,name){
  await page.locator("#calendarPointOpen").click();
  await settle(page,600);
  await page.locator("#calendarPointSearch").fill(name.slice(0,4));
  await settle(page,300);
  await page.locator("[data-calendar-point]",{hasText:name}).first().click();
  await settle(page,600);
}

scene("11-calendar",async()=>{
  const page=await demo();
  await openCalendar(page);
  await choosePoint(page,"Тверская 12");
  await shoot(page,"11a-calendar",{
    frame:{x0:MAIN.x0,x1:MAIN.x1},
    marks:[
      {sel:"#calendarPointOpen",n:1,at:"left",pad:2},
      {sel:".sv-summary",n:2,at:"left",radius:8,pad:6},
      {sel:"[data-calendar-pick-mode]",n:3,at:"right",radius:8},
      {sel:'[data-calendar-day="2026-09-01"]',n:4,at:"left",radius:14,pad:3},
      {sel:".sv-calendar .sv-legend",n:5,at:"left",radius:8,pad:4},
      {sel:".sv-panel",n:6,at:"right",radius:16},
      {sel:"[data-calendar-add]",n:7,at:"left"}
    ]
  });
  await page.close();
});

scene("12-pick",async()=>{
  const page=await demo();
  await openCalendar(page);
  await choosePoint(page,"Тверская 12");
  await page.locator("[data-calendar-pick-mode]").click();
  await settle(page,300);
  await page.locator('[data-calendar-day="2026-09-14"]').click();
  await page.locator('[data-calendar-day="2026-09-17"]').click({modifiers:["Shift"]});
  await shoot(page,"12-pick",{
    frame:{x0:MAIN.x0,x1:MAIN.x1},
    marks:[
      {sel:"[data-calendar-pick-mode]",n:1,at:"left",radius:8},
      {sel:".sv-day.picked",index:0,n:2,at:"left",radius:14,pad:3},
      {sel:".sv-day.picked",index:1,radius:14,pad:3},
      {sel:".sv-day.picked",index:2,radius:14,pad:3},
      {sel:".sv-day.picked",index:3,radius:14,pad:3},
      {sel:".sv-pick-all",n:3,at:"right",radius:10},
      {sel:".sv-panel-list",n:4,at:"right",radius:12},
      {sel:".sv-panel-note",n:5,at:"right",radius:8},
      {sel:"[data-calendar-add-picked]",n:6,at:"right"},
      {sel:"[data-calendar-delete-picked]",n:7,at:"right"}
    ]
  });
  await page.close();
});

scene("13-control",async()=>{
  const page=await demo();
  await page.locator('[data-shift-view="control"]').click();
  await shoot(page,"13-control",{
    frame:{el:".sv-control",from:[".ml","Дни без смен"],margin:{t:24,r:28,b:28,l:56}},
    marks:[
      {sel:".sv-control-point",index:1,n:1,at:"left",radius:8,pad:3},
      {sel:".sv-cell.missed button",index:0,n:2,at:"top",radius:8,pad:3},
      {sel:".sv-cell.today button",index:0,n:3,at:"top",radius:8,pad:3}
    ]
  });
  await page.close();
});

/* ---------- Итоги ---------- */

scene("14-stats",async()=>{
  const page=await demo();
  await page.locator("#tab-stats").click();
  await shoot(page,"14-stats",{
    frame:{x0:MAIN.x0,x1:MAIN.x1,until:".row.total",margin:{b:40}},
    marks:[
      {sel:"#statsEmployeeOpen",n:1,at:"left",pad:0},
      {sel:".hero",n:2,at:"right",pad:0},
      {sel:".payroll-period",index:0,n:3,at:"left",pad:0},
      {sel:".payroll-period",index:1,n:4,at:"left",pad:0},
      {sel:".row.total",n:5,at:"left",pad:0}
    ]
  });
  await page.close();
});

scene("15-period",async()=>{
  const page=await demo({viewport:{width:VIEWPORT.width,height:1900}});
  await page.locator("#tab-stats").click();
  await page.locator('[data-payout-toggle="second_half"]').click();
  await settle(page,800);
  const row=".payroll-period:nth-child(2)";
  await shoot(page,"15-period",{
    frame:{x0:MAIN.x0,x1:MAIN.x1,from:row,until:`${row} .payroll-period-actions`,margin:{t:6,b:30}},
    marks:[
      {sel:`${row} .payout-summary`,n:1,at:"left",pad:0},
      {sel:`${row} .payroll-person-row`,index:0,n:2,at:"left",pad:2},
      {sel:`${row} .payroll-review-summary`,n:3,at:"left",pad:2},
      {sel:`${row} .payroll-report-actions`,n:4,at:"right",radius:8,pad:2},
      {sel:`${row} .payroll-period-actions`,n:5,at:"left"}
    ]
  });
  await page.close();
});

scene("16-person",async()=>{
  const page=await demo({viewport:TALL});
  await page.locator("#tab-stats").click();
  await page.locator("#statsEmployeeOpen").click();
  await settle(page,600);
  await page.locator('[data-stats-employee="emp-10"]').click();
  await settle(page,500);
  await page.locator('[data-payout-toggle="second_half"]').click();
  await settle(page,600);
  await page.locator('[data-payout-add="second_half"]').click();
  await settle(page,500);
  await page.locator("#payoutAmount").fill("6000");
  await page.locator("#payoutComment").fill("Окончательный расчёт");
  await shoot(page,"16-person",{
    frame:{x0:MAIN.x0,x1:MAIN.x1,from:".payout-block.open",until:".payout-block.open",margin:{t:6,b:6}},
    marks:[
      {sel:".payout-block.open .payout-summary",n:1,at:"left",box:false},
      {sel:".payout-block.open .payout-source-list",n:2,at:"left",pad:2},
      {sel:".payout-editor",n:3,at:"left",pad:4},
      {sel:"[data-payout-save]",n:4,at:"right"},
      {sel:".payout-block.open .payout-period-note",n:5,at:"left",pad:2}
    ]
  });
  await page.close();
});

scene("17-report",async()=>{
  const page=await demo();
  await page.locator("#tab-stats").click();
  await page.locator('[data-payout-toggle="first_half"]').click();
  await settle(page,700);
  const [report]=await Promise.all([
    context.waitForEvent("page"),
    page.locator(".payroll-period").first().locator('[data-period-report]:not([data-report-detailed])').click()
  ]);
  await report.waitForLoadState("domcontentloaded");
  await report.setViewportSize(VIEWPORT);
  await shoot(report,"17a-report",{
    frame:{el:"body > *",until:["tbody tr","",10],margin:{t:36,r:40,b:1,l:40}}
  });
  await report.close();
  await page.close();
});

scene("18b-history",async()=>{
  const page=await demo({viewport:{width:VIEWPORT.width,height:1900}});
  await page.locator("#tab-stats").click();
  await page.locator('[data-payout-toggle="first_half"]').click();
  await settle(page,800);
  const row=".payroll-period:nth-child(1)";
  await page.locator(`${row} .payroll-history-toggle`).click();
  await settle(page,800);
  await shoot(page,"18b-history",{
    frame:{el:row,from:`${row} .payroll-history-toggle`,until:`${row} .payroll-events`,margin:{t:16,b:8,l:-1,r:-1}},
    marks:[
      {sel:`${row} .payroll-history-toggle`,n:1,at:"left",radius:10,pad:3},
      {sel:`${row} .payroll-event`,index:0,n:2,at:"left",pad:2},
      {sel:`${row} .payroll-event-reason`,index:0,n:3,at:"right",box:false,content:true},
      {sel:`${row} .payroll-event-after`,index:0,n:4,at:"right",box:false},
      {sel:`${row} .payroll-event-effect`,index:0,n:5,at:"left",box:false}
    ]
  });
  await page.close();
});

scene("18-closed",async()=>{
  const page=await demo();
  await openCalendar(page);
  await choosePoint(page,"Тверская 12");
  await page.locator('[data-calendar-day="2026-09-08"]').click();
  await settle(page,400);
  await page.locator(".sv-panel [data-edit]").first().click();
  await settle(page,600);
  await page.locator("#sheetSave").click();
  await settle(page,500);
  await page.locator("#f-note").fill("Уточнили время");
  await page.locator("#sheetSave").click();
  await shoot(page,"18-closed",{
    frame:{el:".app-confirm-box",isolate:true},
    marks:[
      {sel:"#appConfirmDetail",n:1,at:"left",box:false},
      {sel:"#appConfirmOk",n:2,at:"bottom",pad:-4,radius:8}
    ]
  });
  await page.close();
});

/* ---------- Управление ---------- */

async function openManage(page,section){
  await page.locator("#tab-manage").click();
  await settle(page,400);
  if(section){
    await page.locator(`#app [data-manage-section="${section}"]`).click();
    await settle(page,600);
  }
}

scene("20-employees",async()=>{
  const page=await demo();
  await openManage(page,"employees");
  await shoot(page,"20-employees",{
    frame:{x0:MAIN.x0,x1:MAIN.x1},
    marks:[
      {sel:"#manageBack",n:1,at:"right",radius:10},
      {sel:"#app .manage-add",n:2,at:"left"},
      {sel:"#app button",text:"Архив",n:3,at:"left"},
      {sel:"#employeeSearch",n:4,at:"left",pad:5},
      {sel:'[data-employee-id="emp-0"]',n:5,at:"left",pad:0}
    ]
  });
  await page.close();
});

scene("21-employee-new",async()=>{
  const page=await demo({viewport:TALL});
  await openManage(page,"employees");
  await page.locator("#app .manage-add").click();
  await shoot(page,"21-employee-new",{
    frame:sheet("#employeeSheet","#employeeSheet .card.employee-points",{margin:{b:4}}),
    marks:[
      {sel:"#employeeSheet .card",index:0,n:1,at:"left"},
      {sel:"#employeeSheet .card",index:1,n:2,at:"left"},
      {sel:"#employeeSheet .seg",index:0,n:3,at:"left"},
      {sel:"#employeeSheet .ml",text:"Пункты выдачи",n:4,at:"left",box:false},
      {sel:"#employeeSheetSave",n:5,at:"left",radius:8}
    ]
  });
  await page.close();
});

scene("22-employee-card",async()=>{
  const page=await demo({viewport:TALL});
  await openManage(page,"employees");
  await page.locator('[data-employee-id="emp-0"]').click();
  await shoot(page,"22a-employee-card",{
    frame:sheet("#employeeSheet",["#employeeSheet .card","Тверская 12"]),
    marks:[
      {sel:"#employeeSheetSave",n:1,at:"left",radius:8},
      {sel:"#employeeSheet .ml",text:"Реквизиты",n:2,at:"left",box:false},
      {sel:"#employeeSheet .ml",text:"Пункты выдачи",n:3,at:"left",box:false}
    ]
  });
  await page.locator("#employeeSheetSave").click();
  await settle(page,500);
  await page.locator('#employeeSheet button:has-text("По тарифу ПВЗ")').first().click();
  await settle(page,600);
  await page.locator('#employeeSheet .employee-point-rate input, #employeeSheet input[inputmode="decimal"]').first().fill("3200").catch(()=>{});
  await shoot(page,"22b-employee-rate",{
    frame:sheet("#employeeSheet",["#employeeSheet button","Удалить сотрудника"],{from:"#employeeSheet .card:has(#employeeEmail)",margin:{t:44,b:28}}),
    marks:[
      {sel:"#employeeSheet .card:has(#employeeEmail)",n:1,at:"left"},
      {sel:"#employeeSheet button",text:"По тарифу ПВЗ",index:0,n:2,at:"left",radius:8},
      {sel:"#employeeSheet button",text:"Задать ставку",n:3,at:"right"},
      {sel:"#employeeSheet button",text:"Удалить сотрудника",n:4,at:"left"}
    ]
  });
  await page.close();
});

scene("23-points",async()=>{
  const page=await demo();
  await openManage(page,"points");
  await shoot(page,"23-points",{
    frame:{x0:MAIN.x0,x1:MAIN.x1,until:["[data-point-id]","",4],margin:{b:0}},
    marks:[
      {sel:"#app .manage-add",n:1,at:"left"},
      {sel:"#app button",text:"Архив",n:2,at:"left"},
      {sel:'[data-point-id="pt-1"]',n:3,at:"left",pad:0}
    ]
  });
  await page.close();
});

scene("24-point-card",async()=>{
  const page=await demo({viewport:TALL});
  await openManage(page,"points");
  await page.locator('[data-point-id="pt-0"]').click();
  await shoot(page,"24a-point-card",{
    frame:sheet("#manageEditorSheet",["#manageEditorSheet .card","",2]),
    marks:[
      {sel:"#manageEditorSave",n:1,at:"left",radius:8},
      {sel:"#manageEditorSheet .ml",text:"Текущий тариф",n:2,at:"left",box:false},
      {sel:"#manageEditorSheet .ml",text:"История тарифов",n:3,at:"left",box:false}
    ]
  });
  await page.locator("#manageEditorSave").click();
  await settle(page,500);
  await shoot(page,"24b-point-edit",{
    frame:sheet("#manageEditorSheet",["#manageEditorSheet button","Удалить ПВЗ"],{from:["#manageEditorSheet .seg","",0],margin:{t:44,b:28}}),
    marks:[
      {sel:"#manageEditorSheet .seg",index:0,n:1,at:"left"},
      {sel:"#manageEditorSheet .seg",index:1,n:2,at:"left"},
      {sel:'[data-tariff-intent="edit-current"]',n:3,at:"left"},
      {sel:'[data-tariff-intent="create"]',n:4,at:"left"},
      {sel:"#manageEditorSheet button",text:"Удалить ПВЗ",n:5,at:"left"}
    ]
  });
  await page.locator('[data-tariff-intent="create"]').click();
  await settle(page,500);
  await page.locator('#manageEditorSheet button:has-text("По ШК")').click();
  await settle(page,500);
  await shoot(page,"24c-tariff-shk",{
    frame:sheet("#manageEditorSheet",["#manageEditorSheet button","Добавить тариф"],{from:["#manageEditorSheet .seg","",2],margin:{t:44,b:8}}),
    marks:[
      {sel:"#manageEditorSheet .seg",index:2,n:1,at:"left"},
      {sel:"#manageEditorSheet .row",text:"Действует с",n:2,at:"left",pad:2},
      {sel:"#manageEditorSheet .tariff-tiers-head",n:3,at:"left",box:false},
      {sel:"#manageEditorSheet button",text:"Добавить границу",n:4,at:"left"},
      {sel:"#manageEditorSheet button",text:"Добавить тариф",n:5,at:"right"}
    ]
  });
  await page.close();
});

scene("25-recalc",async()=>{
  const page=await demo();
  await openManage(page,"points");
  await page.locator('[data-point-id="pt-0"]').click();
  await page.locator("#manageEditorSave").click();
  await page.locator('[data-tariff-intent="edit-current"]').click();
  await page.locator("#manageFixedRate").fill("3200");
  await page.locator('#manageEditorSheet button:has-text("Сохранить тариф")').click();
  await page.locator("#recalcSheet.on").waitFor();
  await page.waitForTimeout(2600);
  await shoot(page,"25-recalc",{
    frame:{el:"#recalcSheet",isolate:true,until:["#recalcSheet .recalc-row","",5],margin:{b:0}},
    marks:[
      {sel:"#recalcSheet .recalc-summary",n:1,at:"left"},
      {sel:"#recalcSheet .seg",index:0,n:2,at:"left"},
      {sel:"#recalcSheet button",text:"Применить",n:3,at:"left",radius:8}
    ]
  });
  await page.close();
});

/* ---------- Данные ---------- */

scene("26-data",async()=>{
  const page=await demo();
  await page.locator("#tab-data").click();
  await shoot(page,"26-data",{
    frame:{x0:MAIN.x0,x1:MAIN.x1,until:"#doSignOut",margin:{b:44}},
    marks:[
      {sel:".data-status, #app .ml",text:"Синхронизация",n:1,at:"left",box:false},
      {sel:"#doExport",n:2,at:"left"},
      {sel:"#doSignOut",n:3,at:"left"}
    ]
  });
  await page.close();
});

let failed=0;

for(const {name,run} of scenes){
  if(ONLY && !ONLY.test(name)){
    continue;
  }

  try{
    await run();
    console.log("ok",name);
  }catch(error){
    failed++;
    console.log("FAIL",name,error.message.split("\n")[0]);
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
