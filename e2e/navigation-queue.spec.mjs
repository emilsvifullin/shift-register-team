import {
  test,
  expect
} from "@playwright/test";

import {
  openApp
} from "./support/supabase-stub.mjs";

test.use({
  viewport:{width:390,height:844},
  hasTouch:true
});

/*
  Навигация во время перехода ставится в очередь и выполняется, когда он
  закончится. Шаги по месяцам складываются: быстрый тап не пропадает и не
  схлопывается с соседним.
*/

async function period(page){
  return (await page.locator("#period").innerText()).trim();
}

async function settle(page){
  await expect.poll(()=>
    page.evaluate(()=>
      document.querySelectorAll('body > main[aria-hidden="true"][inert]').length+
      document.getAnimations().filter(animation=>
        animation.playState==="running"
      ).length
    )
  ).toBe(0);
}

async function step(page,selector){
  await page.locator(selector).click();
  await settle(page);
}

test(
  "rapid month taps each move one month",
  async({page})=>{
    await openApp(page);

    const start=await period(page);

    await page.locator("#nextM").click();
    await page.locator("#nextM").click();
    await page.locator("#nextM").click();
    await settle(page);

    const moved=await period(page);

    expect(moved).not.toBe(start);

    await step(page,"#prevM");
    await step(page,"#prevM");

    expect(await period(page)).not.toBe(start);

    await step(page,"#prevM");

    expect(await period(page)).toBe(start);
  }
);

test(
  "next then previous during a transition returns to the same month",
  async({page})=>{
    await openApp(page);

    const start=await period(page);

    await page.locator("#nextM").click();
    await page.locator("#prevM").click();
    await settle(page);

    expect(await period(page)).toBe(start);
  }
);

test(
  "a tab tapped during a month transition is not lost",
  async({page})=>{
    await openApp(page);

    await page.locator("#nextM").click();
    await page.locator("#tab-stats").click();
    await settle(page);

    await expect(
      page.locator("body")
    ).toHaveAttribute("data-active-tab","stats");
  }
);
