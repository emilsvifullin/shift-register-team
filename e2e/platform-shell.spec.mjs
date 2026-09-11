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
          "--app-viewport-width"
        )
    )
  ).toMatch(/px$/);

  return page.evaluate(()=>({
    width:
      document.documentElement.style
        .getPropertyValue(
          "--app-viewport-width"
        ),
    height:
      document.documentElement.style
        .getPropertyValue(
          "--app-viewport-height"
        )
  }));
}

test(
  "tab routing, accessibility and viewport stay synchronized",
  async({page})=>{
    await page.setViewportSize({
      width:390,
      height:844
    });

    await page.goto(
      `${FIXTURE}#stats`
    );

    await expect(
      page.locator("#tab-stats")
    ).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await expect(
      page.locator("#app")
    ).toHaveAttribute(
      "aria-labelledby",
      "tab-stats"
    );

    await expect(
      page.locator("body")
    ).toHaveAttribute(
      "data-active-tab",
      "stats"
    );

    const viewport=
      await waitForViewportSync(page);

    expect(
      Number.parseFloat(
        viewport.width
      )
    ).toBeGreaterThan(300);

    expect(
      Number.parseFloat(
        viewport.height
      )
    ).toBeGreaterThan(500);

    await page.locator(
      "#tab-stats"
    ).focus();

    await page.keyboard.press("End");

    await expect(
      page.locator("#tab-data")
    ).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await expect(page).toHaveURL(
      /#data$/
    );

    await page.goBack();

    await expect(
      page.locator("#tab-stats")
    ).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await expect(
      page.locator("#app")
    ).toHaveAttribute(
      "aria-labelledby",
      "tab-stats"
    );
  }
);

test(
  "Home and End follow the ARIA tabs keyboard model",
  async({page})=>{
    await page.goto(FIXTURE);

    await page.locator(
      "#tab-manage"
    ).click();

    await page.locator(
      "#tab-manage"
    ).focus();

    await page.keyboard.press("Home");

    await expect(
      page.locator("#tab-shifts")
    ).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await expect(page).toHaveURL(
      /#shifts$/
    );
  }
);

test(
  "laptop layout uses available space without becoming edge-to-edge",
  async({page})=>{
    await page.setViewportSize({
      width:1440,
      height:900
    });

    await page.goto(
      `${FIXTURE}#manage`
    );

    await expect(
      page.locator("body")
    ).toHaveAttribute(
      "data-active-tab",
      "manage"
    );

    await waitForViewportSync(page);

    const box=
      await page.locator("#app")
        .boundingBox();

    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(900);
    expect(box.width).toBeLessThanOrEqual(1120);
    expect(box.x).toBeGreaterThan(100);
  }
);

test(
  "desktop tab bar stays centered with equal sections",
  async({page})=>{
    await page.setViewportSize({
      width:1440,
      height:900
    });

    await page.goto(FIXTURE);

    const metrics=
      await page.locator("nav.tabs")
        .evaluate(nav=>({
          width:nav.getBoundingClientRect().width,
          viewport:window.innerWidth,
          buttons:Array.from(
            nav.querySelectorAll("button")
          ).map(button=>
            button.getBoundingClientRect().width
          )
        }));

    expect(metrics.width).toBeLessThanOrEqual(520);
    expect(metrics.width).toBeGreaterThan(440);

    const first=metrics.buttons[0];

    for(const width of metrics.buttons){
      expect(Math.abs(width-first))
        .toBeLessThan(1.5);
    }
  }
);

test(
  "employee choice picker uses the full workspace sheet instead of a narrow popover",
  async({page})=>{
    await page.setViewportSize({
      width:1440,
      height:900
    });

    await page.goto(
      `${FIXTURE}#stats`
    );

    await page.locator(
      "#fixturePointPicker"
    ).evaluate(picker=>{
      picker.style.display="block";
      picker.classList.add("on");
    });

    const box=
      await page.locator(
        "#fixturePointPicker"
      ).boundingBox();

    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(650);
    expect(box.width).toBeLessThanOrEqual(720);
    expect(box.x).toBeGreaterThan(300);
    expect(900-box.y-box.height).toBeLessThan(32);

    await expect(
      page.locator(
        "#fixturePointPicker .picker-toolbar"
      )
    ).toBeVisible();
  }
);

test(
  "date picker stays compact and calendar rows are not square",
  async({page})=>{
    await page.setViewportSize({
      width:1440,
      height:900
    });

    await page.goto(FIXTURE);

    await page.locator(
      "#fixtureDatePicker"
    ).evaluate(picker=>{
      picker.style.display="block";
      picker.classList.add("on");
    });

    const pickerBox=
      await page.locator(
        "#fixtureDatePicker"
      ).boundingBox();

    const dayBox=
      await page.locator(
        "#fixtureDatePicker .date-day"
      ).first().boundingBox();

    expect(pickerBox).not.toBeNull();
    expect(dayBox).not.toBeNull();
    expect(pickerBox.width).toBeLessThanOrEqual(520);
    expect(dayBox.height).toBeLessThanOrEqual(42);
    expect(dayBox.width).toBeGreaterThan(dayBox.height+10);
  }
);
