import {
  test,
  expect
} from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/platform-shell.html";

async function waitForViewportSync(page){
  await expect.poll(
    ()=>page.evaluate(()=>
      document.documentElement.style
        .getPropertyValue(
          "--app-viewport-height"
        )
    )
  ).toMatch(/px$/);
}

async function expectNoHorizontalOverflow(page,label="page"){
  const metrics=await page.evaluate(()=>({
    document:
      document.documentElement.scrollWidth-
      document.documentElement.clientWidth,
    body:
      document.body.scrollWidth-
      document.body.clientWidth,
    app:
      document.getElementById("app").scrollWidth-
      document.getElementById("app").clientWidth
  }));

  expect(metrics.document,`${label}: document overflow`)
    .toBeLessThanOrEqual(1);
  expect(metrics.body,`${label}: body overflow`)
    .toBeLessThanOrEqual(1);
  expect(metrics.app,`${label}: app overflow`)
    .toBeLessThanOrEqual(1);
}

async function openSurface(
  page,
  selector,
  bodyClass
){
  await page.locator(selector).evaluate((element,openClass)=>{
    element.style.display="block";
    element.setAttribute("aria-hidden","false");
    element.classList.remove("on");
    void element.offsetHeight;
    document.body.classList.add(openClass);
    element.classList.add("on");
  },bodyClass);
}

async function closeSurface(
  page,
  selector,
  bodyClass
){
  await page.locator(selector).evaluate((element,openClass)=>{
    element.classList.remove("on");
    element.setAttribute("aria-hidden","true");
    document.body.classList.remove(openClass);
  },bodyClass);
}

async function surfaceMetrics(page,selector){
  return page.locator(selector).evaluate(element=>{
    const box=element.getBoundingClientRect();
    const style=getComputedStyle(element);

    return {
      left:box.left,
      right:box.right,
      top:box.top,
      bottom:box.bottom,
      width:box.width,
      height:box.height,
      viewportWidth:window.innerWidth,
      viewportHeight:window.innerHeight,
      transform:style.transform,
      opacity:style.opacity,
      pointerEvents:style.pointerEvents
    };
  });
}

test(
  "tab destination state exists before synchronous content render",
  async({page})=>{
    await page.setViewportSize({
      width:390,
      height:844
    });

    await page.goto(FIXTURE);

    await expect(page.locator("body"))
      .toHaveAttribute("data-active-tab","shifts");

    await page.locator("#tab-stats").click();

    const snapshot=await page.evaluate(()=>
      window.__fixtureRenderSnapshots.at(-1)
    );

    expect(snapshot.tab).toBe("stats");
    expect(snapshot.activeTabAtRender)
      .toBe("stats");
    expect(snapshot.statsBorder)
      .toBe("1px");
    expect(snapshot.statsRadius)
      .not.toBe("0px");

    await expect(page.locator("body"))
      .toHaveAttribute(
        "data-input-modality",
        "pointer"
      );

    await expect(page.locator("#statsEmployeeOpen"))
      .not.toBeFocused();

    await expectNoHorizontalOverflow(
      page,
      "stats first frame"
    );
  }
);

test(
  "speculative tab state rolls back if the application rejects a rapid switch",
  async({page})=>{
    await page.setViewportSize({
      width:390,
      height:844
    });

    await page.goto(FIXTURE);

    await page.evaluate(()=>{
      const target=
        document.getElementById("tab-data");

      target.addEventListener(
        "click",
        event=>{
          event.stopImmediatePropagation();
        },
        {
          capture:true,
          once:true
        }
      );
    });

    await page.locator("#tab-data").click();

    await expect.poll(
      ()=>page.locator("body")
        .getAttribute("data-active-tab")
    ).toBe("shifts");

    await expect(page.locator("#tab-shifts"))
      .toHaveAttribute("aria-selected","true");

    await expect(page.locator("#tab-data"))
      .toHaveAttribute("aria-selected","false");
  }
);

test(
  "pointer focus never flashes a keyboard ring but keyboard focus stays visible",
  async({page})=>{
    await page.setViewportSize({
      width:390,
      height:844
    });

    await page.goto(FIXTURE);
    await page.locator("#tab-stats").click();

    const row=page.locator("#statsEmployeeOpen");
    await row.focus();

    const pointerOutline=await row.evaluate(element=>({
      width:getComputedStyle(element).outlineWidth,
      style:getComputedStyle(element).outlineStyle
    }));

    expect(pointerOutline.width).toBe("0px");

    await page.locator("#tab-stats").focus();
    await page.keyboard.press("Home");

    await expect(page.locator("body"))
      .toHaveAttribute(
        "data-input-modality",
        "keyboard"
      );

    const keyboardOutline=
      await page.locator("#tab-shifts")
        .evaluate(element=>({
          width:getComputedStyle(element).outlineWidth,
          style:getComputedStyle(element).outlineStyle
        }));

    expect(keyboardOutline.style)
      .not.toBe("none");
    expect(Number.parseFloat(keyboardOutline.width))
      .toBeGreaterThanOrEqual(1);
  }
);

test(
  "real phone, large phone and foldable geometries survive every tab state",
  async({page})=>{
    const viewports=[
      {width:280,height:653},
      {width:320,height:568},
      {width:344,height:882},
      {width:360,height:800},
      {width:375,height:812},
      {width:390,height:844},
      {width:393,height:852},
      {width:402,height:874},
      {width:412,height:915},
      {width:414,height:896},
      {width:430,height:932},
      {width:520,height:900},
      {width:600,height:960},
      {width:768,height:1024},
      {width:884,height:1104},
      {width:899,height:1200}
    ];

    await page.goto(FIXTURE);

    for(const viewport of viewports){
      await page.setViewportSize(viewport);
      await waitForViewportSync(page);

      for(const name of [
        "shifts",
        "stats",
        "manage",
        "data"
      ]){
        await page.locator(`#tab-${name}`).click();

        await expect(page.locator("body"))
          .toHaveAttribute(
            "data-active-tab",
            name
          );

        await expect(page.locator(`#tab-${name}`))
          .toHaveAttribute(
            "aria-selected",
            "true"
          );

        const snapshot=await page.evaluate(()=>
          window.__fixtureRenderSnapshots.at(-1)
        );

        expect(
          snapshot.activeTabAtRender,
          `${viewport.width}x${viewport.height} ${name}`
        ).toBe(name);

        await expectNoHorizontalOverflow(
          page,
          `${viewport.width}x${viewport.height} ${name}`
        );

        const nav=await page.locator("nav.tabs")
          .boundingBox();

        expect(nav).not.toBeNull();
        expect(nav.x).toBeGreaterThanOrEqual(-1);
        expect(nav.x+nav.width)
          .toBeLessThanOrEqual(viewport.width+1);
        expect(nav.y+nav.height)
          .toBeLessThanOrEqual(viewport.height+1);
      }
    }
  }
);

test(
  "short landscape transitions keep navigation and content reachable",
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
      await waitForViewportSync(page);

      for(const name of ["shifts","stats","manage","data"]){
        await page.locator(`#tab-${name}`).click();
        await expectNoHorizontalOverflow(
          page,
          `landscape ${viewport.width}x${viewport.height} ${name}`
        );

        const nav=await page.locator("nav.tabs")
          .boundingBox();

        expect(nav.y+nav.height)
          .toBeLessThanOrEqual(viewport.height+1);
      }
    }
  }
);

test(
  "bottom sheets and pickers stay geometrically stable during intermediate frames",
  async({page})=>{
    await page.setViewportSize({
      width:390,
      height:844
    });

    await page.goto(FIXTURE);

    const surfaces=[
      ["#fixtureSheet","sheet-open"],
      ["#fixturePointPicker","point-picker-open"],
      ["#fixtureMonthPicker","month-picker-open"],
      ["#fixtureDatePicker","date-picker-open"]
    ];

    for(const [selector,bodyClass] of surfaces){
      await openSurface(
        page,
        selector,
        bodyClass
      );

      for(const delay of [0,16,70,170,330]){
        if(delay){
          await page.waitForTimeout(delay);
        }

        const metrics=
          await surfaceMetrics(
            page,
            selector
          );

        expect(metrics.width)
          .toBeGreaterThan(0);
        expect(metrics.left)
          .toBeGreaterThanOrEqual(-1);
        expect(metrics.right)
          .toBeLessThanOrEqual(
            metrics.viewportWidth+1
          );
        expect(metrics.transform)
          .not.toContain("NaN");
        expect(metrics.transform)
          .not.toContain("Infinity");

        await expectNoHorizontalOverflow(
          page,
          `${selector} after ${delay}ms`
        );
      }

      const settled=
        await surfaceMetrics(
          page,
          selector
        );

      expect(settled.top)
        .toBeGreaterThanOrEqual(-1);
      expect(settled.bottom)
        .toBeLessThanOrEqual(
          settled.viewportHeight+1
        );

      await closeSurface(
        page,
        selector,
        bodyClass
      );

      const closing=
        await surfaceMetrics(
          page,
          selector
        );

      expect(closing.pointerEvents)
        .toBe("none");

      await page.locator(selector)
        .evaluate(element=>{
          element.style.display="none";
        });
    }
  }
);

test(
  "virtual keyboard height changes cannot push an open picker outside the visual viewport",
  async({page})=>{
    await page.setViewportSize({
      width:390,
      height:844
    });

    await page.goto(FIXTURE);
    await openSurface(
      page,
      "#fixturePointPicker",
      "point-picker-open"
    );

    await page.locator(
      "#fixturePointPicker input"
    ).focus();

    await page.setViewportSize({
      width:390,
      height:430
    });

    await waitForViewportSync(page);

    await expect.poll(
      ()=>page.evaluate(()=>
        document.documentElement.style
          .getPropertyValue(
            "--app-viewport-height"
          )
      )
    ).toBe("430px");

    const picker=
      await surfaceMetrics(
        page,
        "#fixturePointPicker"
      );

    expect(picker.height)
      .toBeLessThanOrEqual(430);
    expect(picker.top)
      .toBeGreaterThanOrEqual(-1);
    expect(picker.bottom)
      .toBeLessThanOrEqual(431);

    const toolbar=await page.locator(
      "#fixturePointPicker .picker-toolbar"
    ).boundingBox();

    expect(toolbar).not.toBeNull();
    expect(toolbar.y)
      .toBeGreaterThanOrEqual(-1);

    await expectNoHorizontalOverflow(
      page,
      "keyboard-height picker"
    );
  }
);

test(
  "long production-like content never changes the page width",
  async({page})=>{
    await page.goto(FIXTURE);

    for(const width of [280,320,344,360,390,430]){
      await page.setViewportSize({
        width,
        height:844
      });

      for(const name of [
        "shifts",
        "stats",
        "manage",
        "data"
      ]){
        await page.locator(`#tab-${name}`).click();

        await page.evaluate(()=>{
          const app=document.getElementById("app");
          const target=
            app.querySelector(
              ".p,.manage-row-detail,.data-status-detail,.point-value"
            );

          if(target){
            target.textContent=
              "ОченьДлинноеЗначениеБезПробелов".repeat(18);
          }
        });

        await expectNoHorizontalOverflow(
          page,
          `long content ${width}px ${name}`
        );
      }
    }
  }
);

test(
  "reduced motion leaves transient surfaces immediately usable",
  async({page})=>{
    await page.emulateMedia({
      reducedMotion:"reduce"
    });

    await page.setViewportSize({
      width:390,
      height:844
    });

    await page.goto(FIXTURE);

    for(const [selector,bodyClass] of [
      ["#fixtureSheet","sheet-open"],
      ["#fixturePointPicker","point-picker-open"],
      ["#fixtureMonthPicker","month-picker-open"],
      ["#fixtureDatePicker","date-picker-open"]
    ]){
      await openSurface(
        page,
        selector,
        bodyClass
      );

      const durations=
        await page.locator(selector)
          .evaluate(element=>
            getComputedStyle(element)
              .transitionDuration
              .split(",")
              .map(value=>
                Number.parseFloat(value) || 0
              )
          );

      expect(Math.max(...durations))
        .toBeLessThanOrEqual(.001);

      const metrics=
        await surfaceMetrics(
          page,
          selector
        );

      expect(metrics.bottom)
        .toBeLessThanOrEqual(
          metrics.viewportHeight+1
        );

      await closeSurface(
        page,
        selector,
        bodyClass
      );

      await page.locator(selector)
        .evaluate(element=>{
          element.style.display="none";
        });
    }
  }
);
