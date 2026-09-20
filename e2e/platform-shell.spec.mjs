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

/*
  На большом экране навигация — нижний бар страницы, а не плавающая
  пилюля: она отделена линией, идёт в той же мере ширины, что и контент,
  и не носит собственных фона, рамки и тени, которые нужны только
  телефону.
*/
test(
  "the desktop tab bar belongs to the page instead of floating over it",
  async({page})=>{
    await page.setViewportSize({
      width:1440,
      height:900
    });

    await page.goto(FIXTURE);

    const metrics=
      await page.evaluate(()=>{
        const nav=
          document.querySelector("nav.tabs");

        const dock=
          document.querySelector(".bottom-controls");

        const main=
          document.querySelector("main");

        const navRect=
          nav.getBoundingClientRect();

        const navStyle=
          getComputedStyle(nav);

        const dockStyle=
          getComputedStyle(dock);

        return {
          navWidth:Math.round(navRect.width),
          mainWidth:Math.round(
            main.getBoundingClientRect().width
          ),
          viewport:window.innerWidth,
          leftGap:Math.round(navRect.left),
          rightGap:Math.round(
            window.innerWidth-navRect.right
          ),
          navBackground:navStyle.backgroundColor,
          navShadow:navStyle.boxShadow,
          dockBorder:dockStyle.borderTopWidth
        };
      });

    /* Та же мера ширины, что и у контента. */
    expect(metrics.navWidth).toBe(metrics.mainWidth);

    /* И по-прежнему по центру окна. */
    expect(
      Math.abs(metrics.leftGap-metrics.rightGap)
    ).toBeLessThanOrEqual(1);

    /* Бар отделён линией, а не собственной подложкой с тенью. */
    expect(metrics.dockBorder).not.toBe("0px");
    expect(metrics.navBackground)
      .toBe("rgba(0, 0, 0, 0)");
    expect(metrics.navShadow).toBe("none");
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
    expect(dayBox.height).toBeLessThanOrEqual(46);
    expect(dayBox.width).toBeGreaterThan(dayBox.height+10);
  }
);

/*
  Раньше каждый раздел жил по своим правилам ширины: «Смены» тянулись на
  весь монитор, потому что защитное main{max-width:100%} из более позднего
  слоя отменяло desktop-ограничение, «Управление» держалось 960–1020px, а
  «Итоги» и «Данные» — 760px. При переключении вкладок менялся масштаб
  всего интерфейса.

  Теперь мера одна на все разделы, она растёт вместе с окном и
  останавливается на пределе читаемости строки.
*/
test(
  "every section shares one content measure that grows with the window",
  async({page})=>{
    const measures=[];

    for(const width of [1024,1440,1920]){
      await page.setViewportSize({
        width,
        height:900
      });

      await page.goto(FIXTURE);

      const perTab=[];

      for(const tab of [
        "tab-shifts",
        "tab-stats",
        "tab-manage",
        "tab-data"
      ]){
        await page.locator(`#${tab}`).click();

        await expect(
          page.locator("body")
        ).toHaveAttribute(
          "data-active-tab",
          tab.replace("tab-","")
        );

        perTab.push(
          await page.evaluate(()=>Math.round(
            document.querySelector("main")
              .getBoundingClientRect().width
          ))
        );
      }

      /* Один и тот же масштаб во всех разделах. */
      for(const value of perTab){
        expect(value).toBe(perTab[0]);
      }

      /* Колонка не занимает весь монитор и не жмётся в узкую полосу. */
      expect(perTab[0]).toBeLessThan(width-120);
      expect(perTab[0]).toBeGreaterThanOrEqual(700);

      measures.push(perTab[0]);
    }

    /* Мера растёт вместе с окном и упирается в предел. */
    expect(measures[1]).toBeGreaterThan(measures[0]);
    expect(measures[2]).toBeGreaterThanOrEqual(measures[1]);
    expect(measures[2]).toBeLessThanOrEqual(1080);
  }
);
