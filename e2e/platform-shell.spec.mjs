import {
  test,
  expect
} from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/platform-shell.html";

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
      await page.evaluate(()=>({
        width:
          getComputedStyle(
            document.documentElement
          ).getPropertyValue(
            "--app-viewport-width"
          ),
        height:
          getComputedStyle(
            document.documentElement
          ).getPropertyValue(
            "--app-viewport-height"
          )
      }));

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
