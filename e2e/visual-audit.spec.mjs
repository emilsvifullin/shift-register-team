import {test, expect} from "@playwright/test";
import {mkdir, writeFile} from "node:fs/promises";

const BASE="http://127.0.0.1:4173";
const FIXTURE=`${BASE}/tests/fixtures/platform-shell.html`;
const OUT="visual-audit";

const viewports=[
  {name:"iphone-se",width:320,height:568},
  {name:"mobile-360",width:360,height:800},
  {name:"iphone-390",width:390,height:844},
  {name:"iphone-max",width:430,height:932},
  {name:"tablet",width:768,height:1024},
  {name:"laptop",width:1366,height:768},
  {name:"desktop",width:1440,height:900}
];

const screenMarkup={
  shifts:`
    <div class="ml">Смены</div>
    <div class="card">
      <button class="sh" type="button"><div class="day"><span class="d">12</span><span class="w">Сб</span></div><div class="mid"><div class="p">Нагатинская Набережная 56а</div><div class="meta"><span>Марина</span><span class="tag g">основная</span></div></div><div class="amt">3 200 ₽</div></button>
      <button class="sh" type="button"><div class="day"><span class="d">13</span><span class="w">Вс</span></div><div class="mid"><div class="p">Большой Овчинниковский Переулок 16</div><div class="meta"><span>Наталья</span><span class="tag">неполная</span></div></div><div class="amt">1 850 ₽</div></button>
      <button class="sh" type="button"><div class="day"><span class="d">14</span><span class="w">Пн</span></div><div class="mid"><div class="p">Новоясеневский Проспект 22к1</div><div class="meta"><span>Елена</span><span class="tag bonus">бонус</span></div></div><div class="amt">3 600 ₽</div></button>
    </div>
    <button class="manage-add" type="button"><span class="manage-add-plus"></span>Добавить смену</button>
  `,
  stats:`
    <div class="ml">Фильтры</div>
    <div class="card employee-editor"><button type="button" class="row point-row stats-filter-row"><div class="l"><div class="t">Сотрудник</div></div><div class="point-value">Марина</div></button></div>
    <div class="card hero"><div class="k">К выплате</div><div class="n">48 750<small>₽</small></div><div class="sub">Расчёт за сентябрь 2026</div></div>
    <div class="ml">Расчёт</div>
    <div class="card payout-card">
      <div class="payout-block open"><button class="row payout-summary" type="button"><div class="l"><div class="t">25 сентября</div><div class="s">Аванс и первая половина месяца</div></div><div class="payout-summary-right"><div class="v">24 000 ₽</div><div class="payout-status partial">частично</div></div></button><div class="payout-expanded"><div class="payout-breakdown"><div class="row"><div class="l"><div class="t">Смены</div></div><div class="v">22 400 ₽</div></div><div class="row"><div class="l"><div class="t">Бонусы</div></div><div class="v pos">1 600 ₽</div></div></div></div></div>
      <div class="payout-block"><button class="row payout-summary" type="button"><div class="l"><div class="t">10 октября</div><div class="s">Финальный расчёт</div></div><div class="payout-summary-right"><div class="v">24 750 ₽</div><div class="payout-status">ожидает</div></div></button></div>
    </div>
  `,
  manage:`
    <div class="ml">Управление</div>
    <div class="card"><button class="manage-row" type="button"><div class="manage-row-copy"><div class="manage-row-title">Сотрудники</div><div class="manage-row-detail">Состав команды, доступы и пункты</div></div><span class="manage-chevron">›</span></button><button class="manage-row" type="button"><div class="manage-row-copy"><div class="manage-row-title">Пункты выдачи</div><div class="manage-row-detail">Тарифы и параметры ПВЗ</div></div><span class="manage-chevron">›</span></button><button class="manage-row" type="button"><div class="manage-row-copy"><div class="manage-row-title">Тарифы</div><div class="manage-row-detail">История ставок и границ</div></div><span class="manage-chevron">›</span></button></div>
    <div class="ml">Команда</div>
    <div class="card"><button class="manage-row employee-row" type="button"><div class="manage-row-copy"><div class="manage-row-title">Марина</div><div class="manage-row-detail">3 пункта · активна</div></div><span class="manage-row-value">24 смены</span></button><button class="manage-row employee-row" type="button"><div class="manage-row-copy"><div class="manage-row-title">Наталья</div><div class="manage-row-detail">2 пункта · активна</div></div><span class="manage-row-value">18 смен</span></button></div>
  `,
  data:`
    <div class="ml">Данные</div>
    <div class="card data-status"><div class="data-status-copy"><div class="data-status-title">Синхронизация</div><div class="data-status-detail">Сервер подключён, данные актуальны</div></div></div>
    <div class="ml">Хранилище</div>
    <div class="card"><div class="row"><div class="l"><div class="t">Версия приложения</div></div><div class="v">6.19.0</div></div><div class="row"><div class="l"><div class="t">Последнее обновление</div></div><div class="v">сейчас</div></div></div>
    <button class="btn" type="button">Обновить данные</button>
  `
};

let navigationId=0;

async function setup(page,viewport,screen){
  navigationId+=1;
  await page.setViewportSize({width:viewport.width,height:viewport.height});
  await page.goto(`${FIXTURE}?audit=${navigationId}#${screen}`);
  await page.locator("body").evaluate((body,screen)=>{
    body.setAttribute("data-active-tab",screen);
    const old=document.getElementById("auditHeader");
    old?.remove();
    const header=document.createElement("header");
    header.id="auditHeader";
    header.innerHTML=`<div class="nav"><button type="button" aria-label="Назад">‹</button><button type="button" class="period clickable">Сентябрь 2026</button><button type="button" aria-label="Вперёд">›</button></div>`;
    document.body.insertBefore(header,document.getElementById("app"));

    for(const id of ["fixturePointPicker","fixtureDatePicker"]){
      const el=document.getElementById(id);
      if(el){el.classList.remove("on");el.style.removeProperty("display");}
    }
  },screen);
  await page.locator("#app").evaluate((app,html)=>{app.innerHTML=html;},screenMarkup[screen]);
  await page.waitForTimeout(100);
}

async function metrics(page){
  return page.evaluate(()=>{
    const q=s=>Array.from(document.querySelectorAll(s));
    const visible=el=>{
      const s=getComputedStyle(el);
      const r=el.getBoundingClientRect();
      return s.display!=="none"&&s.visibility!=="hidden"&&Number(s.opacity)!==0&&r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth;
    };
    const interactive=q("button,a,input,select,textarea,[role=button],[role=tab]").filter(visible).map(el=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return {tag:el.tagName,cls:String(el.className),id:el.id,text:(el.textContent||el.getAttribute("aria-label")||"").trim().replace(/\s+/g," ").slice(0,60),x:r.x,y:r.y,w:r.width,h:r.height,transition:s.transitionDuration,transitionProperty:s.transitionProperty};});
    const horizontalOverflow=q("body *").filter(visible).map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,cls:String(el.className),id:el.id,left:r.left,right:r.right,width:r.width};}).filter(r=>r.left<-1||r.right>innerWidth+1);
    const smallTargets=interactive.filter(r=>r.w<44||r.h<44);
    const abruptTargets=interactive.filter(r=>r.transition==="0s"&&/BUTTON|A/.test(r.tag));
    return {viewport:{w:innerWidth,h:innerHeight},smallTargets,horizontalOverflow,abruptTargets,interactiveCount:interactive.length};
  });
}

async function fillCalendar(page){
  await page.locator("#fixtureDatePicker .date-grid").evaluate(grid=>{
    grid.innerHTML="";
    for(let index=0;index<42;index+=1){
      const button=document.createElement("button");
      button.type="button";
      button.className="date-day"+(index===17?" on":"")+(index<2||index>31?" outside":"");
      button.textContent=String(((index+29)%30)+1);
      grid.append(button);
    }
  });
}

async function fillEmployees(page){
  await page.locator("#fixturePointPicker .point-list").evaluate(list=>{
    list.innerHTML=["Марина","Наталья","Елена","Роман","Александра","Владислав"].map((name,index)=>`<button type="button" class="point-option${index===0?" on":""}"><span class="point-check">✓</span><span class="point-name">${name}</span></button>`).join("");
  });
}

test("capture full visual audit matrix",async({page})=>{
  await mkdir(OUT,{recursive:true});
  const report=[];
  for(const viewport of viewports){
    for(const screen of Object.keys(screenMarkup)){
      await setup(page,viewport,screen);
      report.push({viewport:viewport.name,screen,...(await metrics(page))});
      await page.screenshot({path:`${OUT}/${viewport.name}-${screen}.png`});
    }

    await setup(page,viewport,"stats");
    await fillEmployees(page);
    await page.locator("#fixturePointPicker").evaluate(el=>{el.style.display="block";el.classList.add("on");});
    report.push({viewport:viewport.name,screen:"employee-picker",...(await metrics(page))});
    await page.screenshot({path:`${OUT}/${viewport.name}-employee-picker.png`});

    await setup(page,viewport,"shifts");
    await fillCalendar(page);
    await page.locator("#fixtureDatePicker").evaluate(el=>{el.style.display="block";el.classList.add("on");});
    report.push({viewport:viewport.name,screen:"date-picker",...(await metrics(page))});
    await page.screenshot({path:`${OUT}/${viewport.name}-date-picker.png`});
  }

  await page.setViewportSize({width:390,height:844});
  await page.goto(`${BASE}/login.html?audit=login`);
  await page.waitForTimeout(300);
  await page.screenshot({path:`${OUT}/live-login-mobile.png`});
  report.push({viewport:"iphone-390",screen:"login",...(await metrics(page))});

  await writeFile(`${OUT}/metrics.json`,JSON.stringify(report,null,2));
  expect(report.length).toBeGreaterThan(30);
});
