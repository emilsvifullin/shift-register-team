import {test,expect} from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/platform-shell.html";

async function installLongView(page,kind="manage"){
  await page.locator("#app").evaluate((app,viewKind)=>{
    if(viewKind==="shifts"){
      app.className="shifts-layout";
      app.innerHTML=`
        <div class="ml">Смены</div>
        <button type="button" class="btn">+ Добавить смену</button>
        <div class="ml">Поиск и фильтр</div>
        <div class="card employee-editor" id="shiftSearchCard">
          <label class="row" id="shiftSearchRow">
            <input type="search" id="shiftSearch" placeholder="Поиск">
          </label>
          <button type="button" class="row point-row" id="shiftFilterOpen">
            <div class="t">Фильтр</div>
            <div class="point-value">Все смены</div>
          </button>
        </div>
        <div id="shiftListArea">
          <div class="ml">Список</div>
          <div class="shift-window">
            <div class="shift-scroll" id="fixtureShiftScroll">
              <div class="card">
                ${Array.from({length:24},(_,index)=>`
                  <button type="button" class="sh">
                    <span class="day"><span class="d">${(index%28)+1}</span><span class="w">ср</span></span>
                    <span class="mid"><span class="p">Пункт выдачи ${index+1}</span><span class="meta">120 ШК · Сотрудник</span></span>
                    <span class="amt">3 000 ₽</span>
                  </button>
                `).join("")}
              </div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    app.className="";
    app.innerHTML=`
      <div class="ml">Список</div>
      <div class="card manage-menu">
        ${Array.from({length:28},(_,index)=>`
          <button type="button" class="manage-row">
            <span class="manage-row-copy">
              <span class="manage-row-title">Пункт выдачи ${index+1}</span>
              <span class="manage-row-detail">Настройки пункта и тарифа</span>
            </span>
            <span class="manage-chevron">›</span>
          </button>
        `).join("")}
      </div>
    `;
  },kind);
}

async function geometry(page){
  return page.evaluate(()=>{
    const main=document.querySelector("main").getBoundingClientRect();
    const dock=document.querySelector(".bottom-controls").getBoundingClientRect();
    const tabs=document.querySelector("nav.tabs").getBoundingClientRect();

    return {
      viewportHeight:window.innerHeight,
      mainBottom:main.bottom,
      dockTop:dock.top,
      dockBottom:dock.bottom,
      tabsTop:tabs.top,
      tabsBottom:tabs.bottom
    };
  });
}

test(
  "bottom navigation owns the bottom viewport and scrolling content stops above it",
  async({page})=>{
    await page.goto(FIXTURE);

    for(const viewport of [
      {width:320,height:568},
      {width:390,height:844},
      {width:430,height:932},
      {width:568,height:320},
      {width:844,height:390}
    ]){
      await page.setViewportSize(viewport);
      await installLongView(page,"manage");

      const box=await geometry(page);

      expect(box.dockBottom).toBeCloseTo(viewport.height,0);
      expect(box.mainBottom).toBeLessThanOrEqual(box.dockTop+1);
      expect(box.dockTop-box.mainBottom).toBeLessThanOrEqual(1);
      expect(box.viewportHeight-box.tabsBottom).toBeLessThanOrEqual(12);

      const dockBackground=await page.locator(".bottom-controls").evaluate(element=>
        getComputedStyle(element).backgroundColor
      );
      expect(dockBackground).not.toBe("rgba(0, 0, 0, 0)");

      await page.locator("#app").evaluate(element=>{
        element.scrollTop=element.scrollHeight;
      });

      const afterScroll=await geometry(page);
      expect(afterScroll.mainBottom).toBeLessThanOrEqual(afterScroll.dockTop+1);
    }
  }
);

test(
  "shift search and filter use the same full row geometry",
  async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(FIXTURE);
    await installLongView(page,"shifts");

    const [searchRow,searchInput,filterRow]=await Promise.all([
      page.locator("#shiftSearchRow").boundingBox(),
      page.locator("#shiftSearch").boundingBox(),
      page.locator("#shiftFilterOpen").boundingBox()
    ]);

    expect(searchRow).not.toBeNull();
    expect(searchInput).not.toBeNull();
    expect(filterRow).not.toBeNull();

    expect(Math.abs(searchRow.width-filterRow.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(searchRow.height-filterRow.height)).toBeLessThanOrEqual(1);
    expect(searchInput.width).toBeGreaterThan(searchRow.width-32);

    const box=await geometry(page);
    expect(box.mainBottom).toBeLessThanOrEqual(box.dockTop+1);

    const shiftWindow=await page.locator(".shift-window").boundingBox();
    expect(shiftWindow).not.toBeNull();
    expect(shiftWindow.y+shiftWindow.height).toBeLessThanOrEqual(box.dockTop+1);
  }
);

test(
  "bottom navigation uses the compact app curvature",
  async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(FIXTURE);

    const radii=await page.evaluate(()=>{
      const tabs=document.querySelector("nav.tabs");
      const active=document.querySelector('nav.tabs [aria-selected="true"]');
      const tabsStyle=getComputedStyle(tabs);
      const activeStyle=getComputedStyle(active);

      return {
        outer:tabsStyle.borderTopLeftRadius,
        active:activeStyle.borderTopLeftRadius,
        activeRight:activeStyle.borderTopRightRadius
      };
    });

    expect(radii.outer).toBe("16px");
    expect(radii.active).toBe("12px");
    expect(radii.activeRight).toBe("12px");
  }
);

test(
  "modal picker state removes the bottom navigation from the visible stack",
  async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(FIXTURE);

    await page.evaluate(()=>{
      document.body.classList.add("point-picker-open");
      document.getElementById("fixturePointVeil")?.classList.add("on");
    });

    const dockState=await page.locator(".bottom-controls").evaluate(element=>{
      const style=getComputedStyle(element);
      return {
        visibility:style.visibility,
        opacity:style.opacity,
        pointerEvents:style.pointerEvents
      };
    });

    expect(dockState.visibility).toBe("hidden");
    expect(Number(dockState.opacity)).toBe(0);
    expect(dockState.pointerEvents).toBe("none");
  }
);

test(
  "shell height can stay full even when visual viewport metrics are shorter",
  async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(FIXTURE);
    await installLongView(page,"manage");

    const shell=await page.evaluate(()=>{
      const root=document.documentElement;
      root.style.setProperty("--app-viewport-height","760px");
      root.style.setProperty("--app-shell-height","844px");

      const html=getComputedStyle(document.documentElement);
      const body=getComputedStyle(document.body);
      const main=document.querySelector("main").getBoundingClientRect();
      const dock=document.querySelector(".bottom-controls").getBoundingClientRect();

      return {
        htmlHeight:parseFloat(html.height),
        bodyHeight:parseFloat(body.height),
        mainBottom:main.bottom,
        dockTop:dock.top
      };
    });

    expect(shell.htmlHeight).toBeCloseTo(844,0);
    expect(shell.bodyHeight).toBeCloseTo(844,0);
    expect(shell.mainBottom).toBeLessThanOrEqual(shell.dockTop+1);
  }
);

/*
  Панель разделов обязана стоять относительно нижней системной зоны
  телефона одинаково, как бы iOS ни выдала окно.

  Окно приходит двумя способами: либо оно доходит до нижнего края экрана и
  полоса Home Indicator лежит внутри него (env(safe-area-inset-bottom)=34),
  либо оно уже обрезано по безопасной области и та же полоса лежит за его
  границей (env=0). Запас под панелью поэтому складывается из системной
  зоны и собственного зазора: при «или что больше» панель в первом случае
  прижималась к полосе вплотную, а во втором висела над ней на 8px.

  Зазор равен 2px — столько же оставляет над этой зоной плавающая панель
  Safari (замерено на iPhone 17 Pro Max,
  iOS 26.5). Движки safe-area не эмулируют, поэтому env() подменяется
  константой в тех же правилах, что уходят в production.
*/
const SCREEN_HEIGHT=956;
const HOME_INDICATOR=34;
const DOCK_CLEARANCE=2;

async function withBottomInset(page,inset){
  for(const file of [
    "styles.css",
    "styles/refinement.css",
    "styles/interaction-core.css",
    "styles/management.css"
  ]){
    await page.route(`**/${file}`,async route=>{
      const response=await route.fetch();
      const css=await response.text();

      await route.fulfill({
        status:200,
        contentType:"text/css; charset=utf-8",
        body:css.replaceAll(
          "env(safe-area-inset-bottom)",
          inset
        )
      });
    });
  }
}

async function dockGeometry(page){
  return page.evaluate(()=>{
    const tabs=
      document.querySelector("nav.tabs")
        .getBoundingClientRect();

    const dock=
      document.querySelector(".bottom-controls")
        .getBoundingClientRect();

    const main=
      document.querySelector("main")
        .getBoundingClientRect();

    const card=
      document.querySelector("#app .card,#app .manage-row");

    const cardRect=
      card
        ? card.getBoundingClientRect()
        : null;

    return {
      windowHeight:Math.round(
        parseFloat(
          getComputedStyle(document.documentElement).height
        )
      ),
      reserve:Math.round(dock.bottom-tabs.bottom),
      dockBottom:Math.round(dock.bottom),
      tabsBottom:Math.round(tabs.bottom),
      tabsLeft:Math.round(tabs.left),
      tabsRight:Math.round(window.innerWidth-tabs.right),
      cardLeft:cardRect
        ? Math.round(cardRect.left)
        : null,
      cardRight:cardRect
        ? Math.round(window.innerWidth-cardRect.right)
        : null,
      contentGap:Math.round(dock.top-main.bottom),
      overflow:
        document.documentElement.scrollHeight-
        document.documentElement.clientHeight
    };
  });
}

test(
  "the dock keeps one distance to the home indicator in both window layouts",
  async({page})=>{
    const seen=[];

    for(const layout of [
      {
        inset:`${HOME_INDICATOR}px`,
        windowHeight:SCREEN_HEIGHT,
        belowWindow:0
      },
      {
        inset:"0px",
        windowHeight:SCREEN_HEIGHT-HOME_INDICATOR,
        belowWindow:HOME_INDICATOR
      }
    ]){
      const context=
        await page.context().browser().newContext({
          viewport:{
            width:440,
            height:layout.windowHeight
          },
          hasTouch:true
        });

      const phone=await context.newPage();

      await withBottomInset(phone,layout.inset);
      await phone.goto(FIXTURE);
      await installLongView(phone,"shifts");

      const box=await dockGeometry(phone);

      /* Панель целиком внутри окна и не заводит прокрутку документа. */
      expect(box.dockBottom).toBeLessThanOrEqual(box.windowHeight);
      expect(box.overflow).toBe(0);

      /* Содержимое заканчивается ровно у её верхней кромки. */
      expect(Math.abs(box.contentGap)).toBeLessThanOrEqual(1);

      /* Боковые отступы совпадают с рабочей шириной карточек. */
      expect(box.tabsLeft).toBe(box.cardLeft);
      expect(box.tabsRight).toBe(box.cardRight);

      /* Запас под панелью — системная зона плюс собственный зазор. */
      expect(box.reserve).toBe(
        Number.parseInt(layout.inset,10)+DOCK_CLEARANCE
      );

      seen.push(
        box.windowHeight-box.tabsBottom+layout.belowWindow
      );

      await context.close();
    }

    /*
      Итог: в обеих раскладках нижняя кромка панели стоит на одной и той
      же высоте над нижним краем экрана — на зазор выше системной зоны.
    */
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toBe(HOME_INDICATOR+DOCK_CLEARANCE);
  }
);
