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
