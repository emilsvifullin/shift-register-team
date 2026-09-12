import {test,expect} from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/platform-shell.html";

async function show(page,selector){
  await page.locator(selector).evaluate(element=>{
    element.style.display="block";
    element.classList.add("on");
  });
}

async function hide(page,selector){
  await page.locator(selector).evaluate(element=>{
    element.classList.remove("on");
    element.style.display="none";
  });
}

async function installGeometryFixture(page){
  await page.locator("#app").evaluate(app=>{
    app.innerHTML=`
      <div class="card">
        <div class="sh">
          <div class="day"><span class="d">28</span><span class="w">пн</span></div>
          <div class="mid">
            <div class="p">Большой Овчинниковский Переулок 16</div>
            <div class="meta">650 ШК · Александр Очень-Длинная-Фамилия</div>
          </div>
          <div class="amt">10 000 ₽</div>
        </div>
        <div class="row">
          <div class="l"><div class="t">Пункт</div></div>
          <div class="v">Большой Овчинниковский Переулок 16</div>
        </div>
      </div>
      <div class="segbox">
        <div class="seg">
          <button type="button" class="on">По умолчанию</button>
          <button type="button">25 сентября 2026</button>
          <button type="button">10 октября 2026</button>
        </div>
      </div>
    `;
  });

  await page.evaluate(()=>{
    const sheet=document.createElement("div");
    sheet.id="fixtureSheet";
    sheet.className="sheet on";
    sheet.innerHTML=`
      <div class="grab"></div>
      <div class="shead">
        <button class="lnk">Отмена</button>
        <div class="ttl">Редактирование сотрудника</div>
        <button class="lnk b">Готово</button>
      </div>
      <div class="sbody"><div style="height:900px"></div></div>
    `;
    document.body.append(sheet);
  });
}

async function expectInsideViewport(page,selector){
  const result=await page.locator(selector).evaluate(element=>{
    const box=element.getBoundingClientRect();
    return {
      left:box.left,
      right:box.right,
      top:box.top,
      bottom:box.bottom,
      width:box.width,
      height:box.height,
      viewportWidth:window.innerWidth,
      viewportHeight:window.innerHeight
    };
  });

  expect(result.left).toBeGreaterThanOrEqual(-1);
  expect(result.right).toBeLessThanOrEqual(result.viewportWidth+1);
  expect(result.width).toBeLessThanOrEqual(result.viewportWidth+1);

  return result;
}

test(
  "320px navigation keeps comfortable vertical targets",
  async({page})=>{
    await page.setViewportSize({width:320,height:568});
    await page.goto(FIXTURE);

    for(const button of await page.locator("nav.tabs button").all()){
      const box=await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
);

test(
  "narrow employee picker title never collides with actions",
  async({page})=>{
    await page.setViewportSize({width:280,height:653});
    await page.goto(FIXTURE);
    await show(page,"#fixturePointPicker");

    const toolbar=page.locator("#fixturePointPicker .picker-toolbar");
    const cancel=toolbar.locator(".cancel");
    const title=toolbar.locator(".picker-toolbar-title");
    const done=toolbar.locator(".done");

    const [cancelBox,titleBox,doneBox]=await Promise.all([
      cancel.boundingBox(),title.boundingBox(),done.boundingBox()
    ]);

    expect(cancelBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(doneBox).not.toBeNull();
    expect(titleBox.x).toBeGreaterThanOrEqual(cancelBox.x+cancelBox.width+2);
    expect(titleBox.x+titleBox.width).toBeLessThanOrEqual(doneBox.x-2);
    expect(cancelBox.height).toBeGreaterThanOrEqual(44);
    expect(doneBox.height).toBeGreaterThanOrEqual(44);
  }
);

test(
  "calendar rows stay compact but vertically tappable",
  async({page})=>{
    await page.setViewportSize({width:320,height:568});
    await page.goto(FIXTURE);
    await show(page,"#fixtureDatePicker");

    const day=page.locator("#fixtureDatePicker .date-day").first();
    const title=page.locator("#fixtureDatePicker .date-calendar-title");
    const today=page.locator("#fixtureDatePicker .date-today");

    const [dayBox,titleBox,todayBox]=await Promise.all([
      day.boundingBox(),title.boundingBox(),today.boundingBox()
    ]);

    expect(dayBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(todayBox).not.toBeNull();
    expect(dayBox.height).toBeGreaterThanOrEqual(44);
    expect(dayBox.height).toBeLessThanOrEqual(46);
    expect(titleBox.height).toBeGreaterThanOrEqual(44);
    expect(todayBox.height).toBeGreaterThanOrEqual(44);
  }
);

test(
  "touch feedback uses the same smooth motion contract",
  async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(FIXTURE);

    const tab=page.locator("#tab-stats");

    const transition=await tab.evaluate(element=>
      getComputedStyle(element).transitionDuration
    );

    expect(transition).not.toBe("0s");

    await tab.evaluate(element=>
      element.classList.add("touch-active")
    );

    const transform=await tab.evaluate(element=>
      getComputedStyle(element).transform
    );

    expect(transform).not.toBe("none");
  }
);

test(
  "calendar actions no longer switch state abruptly",
  async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(FIXTURE);
    await show(page,"#fixtureDatePicker");

    for(const selector of [
      ".date-calendar-title",
      ".date-today",
      ".date-calendar-nav"
    ]){
      const duration=await page
        .locator(`#fixtureDatePicker ${selector}`)
        .first()
        .evaluate(element=>
          getComputedStyle(element).transitionDuration
        );

      expect(duration).not.toBe("0s");
    }
  }
);

test(
  "fluid phone widths stay inside the viewport without collisions",
  async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(FIXTURE);
    await installGeometryFixture(page);

    const widths=[];
    for(let width=280;width<=520;width+=12){
      widths.push(width);
    }

    for(const width of widths){
      const height=Math.max(568,Math.round(width*2.15));
      await page.setViewportSize({width,height});

      const overflow=await page.evaluate(()=>({
        scrollWidth:document.documentElement.scrollWidth,
        innerWidth:window.innerWidth
      }));
      expect(overflow.scrollWidth,`horizontal overflow at ${width}px`)
        .toBeLessThanOrEqual(overflow.innerWidth+1);

      await expectInsideViewport(page,"nav.tabs");

      for(const button of await page.locator("nav.tabs button").all()){
        const box=await button.boundingBox();
        expect(box,`missing tab box at ${width}px`).not.toBeNull();
        expect(box.height,`tab target at ${width}px`).toBeGreaterThanOrEqual(44);
      }

      const rowOverflow=await page.locator("#app").evaluate(app=>
        app.scrollWidth-app.clientWidth
      );
      expect(rowOverflow,`content overflow at ${width}px`).toBeLessThanOrEqual(1);

      await show(page,"#fixturePointPicker");
      const point=await expectInsideViewport(page,"#fixturePointPicker");
      expect(point.bottom).toBeLessThanOrEqual(point.viewportHeight+1);

      const toolbar=page.locator("#fixturePointPicker .picker-toolbar");
      const [cancelBox,titleBox,doneBox]=await Promise.all([
        toolbar.locator(".cancel").boundingBox(),
        toolbar.locator(".picker-toolbar-title").boundingBox(),
        toolbar.locator(".done").boundingBox()
      ]);
      expect(titleBox.x,`picker title left at ${width}px`)
        .toBeGreaterThanOrEqual(cancelBox.x+cancelBox.width+2);
      expect(titleBox.x+titleBox.width,`picker title right at ${width}px`)
        .toBeLessThanOrEqual(doneBox.x-2);
      await hide(page,"#fixturePointPicker");

      await show(page,"#fixtureDatePicker");
      const date=await expectInsideViewport(page,"#fixtureDatePicker");
      expect(date.bottom).toBeLessThanOrEqual(date.viewportHeight+1);

      const lastDay=page.locator("#fixtureDatePicker .date-day").last();
      const lastDayBox=await lastDay.boundingBox();
      expect(lastDayBox.x+lastDayBox.width,`calendar width at ${width}px`)
        .toBeLessThanOrEqual(width+1);
      await hide(page,"#fixtureDatePicker");

      const sheet=await expectInsideViewport(page,"#fixtureSheet");
      expect(sheet.bottom).toBeLessThanOrEqual(sheet.viewportHeight+1);

      const sheetToolbar=page.locator("#fixtureSheet .shead");
      const [sheetCancel,sheetTitle,sheetDone]=await Promise.all([
        sheetToolbar.locator(".lnk").first().boundingBox(),
        sheetToolbar.locator(".ttl").boundingBox(),
        sheetToolbar.locator(".lnk").last().boundingBox()
      ]);
      expect(sheetTitle.x,`sheet title left at ${width}px`)
        .toBeGreaterThanOrEqual(sheetCancel.x+sheetCancel.width);
      expect(sheetTitle.x+sheetTitle.width,`sheet title right at ${width}px`)
        .toBeLessThanOrEqual(sheetDone.x);
    }
  }
);

test(
  "wide foldable and tablet widths use space without becoming desktop",
  async({page})=>{
    await page.goto(FIXTURE);

    for(const width of [540,600,720,768,820,884,899]){
      await page.setViewportSize({width,height:1104});

      const mainBox=await page.locator("#app").boundingBox();
      expect(mainBox).not.toBeNull();
      expect(mainBox.width,`main too narrow at ${width}px`).toBeGreaterThan(500);
      expect(mainBox.width,`main too wide at ${width}px`).toBeLessThanOrEqual(761);

      const tabs=await expectInsideViewport(page,"nav.tabs");
      expect(tabs.width).toBeLessThanOrEqual(561);
    }
  }
);

test(
  "short landscape phones keep fixed controls and overlays reachable",
  async({page})=>{
    await page.goto(FIXTURE);

    for(const viewport of [
      {width:568,height:320},
      {width:667,height:375},
      {width:740,height:360},
      {width:844,height:390},
      {width:896,height:414},
      {width:932,height:430}
    ]){
      await page.setViewportSize(viewport);

      const tabs=await expectInsideViewport(page,"nav.tabs");
      expect(tabs.bottom).toBeLessThanOrEqual(viewport.height+1);

      await show(page,"#fixtureDatePicker");
      const date=await expectInsideViewport(page,"#fixtureDatePicker");
      expect(date.height).toBeLessThanOrEqual(viewport.height+1);
      expect(date.bottom).toBeLessThanOrEqual(viewport.height+1);
      await hide(page,"#fixtureDatePicker");
    }
  }
);
