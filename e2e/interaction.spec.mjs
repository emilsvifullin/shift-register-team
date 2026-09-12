import {test,expect} from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/platform-shell.html";

async function show(page,selector){
  await page.locator(selector).evaluate(element=>{
    element.style.display="block";
    element.classList.add("on");
  });
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
    await page.setViewportSize({width:320,height:568});
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
