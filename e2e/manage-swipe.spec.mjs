import {
  test,
  expect
} from "@playwright/test";

import {
  openApp
} from "./support/supabase-stub.mjs";

test.use({
  viewport:{width:390,height:844},
  hasTouch:true,
  isMobile:true
});

/*
  Настоящие касания с генерацией click даёт только Chromium через CDP.
  В WebKit и Firefox поведение жеста проверяется вручную на iPhone.
*/
test.skip(
  ({browserName})=>browserName!=="chromium",
  "touch input is dispatched through CDP"
);

/*
  Касание по элементу, который ещё едет в анимации перехода, промахивается:
  координаты берутся до сдвига. Перед жестом и тапом ждём, пока экран
  остановится.
*/
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

async function touchInput(page){
  const cdp=await page.context().newCDPSession(page);

  const send=(type,points)=>cdp.send(
    "Input.dispatchTouchEvent",
    {
      type,
      touchPoints:points.map(([x,y])=>({x,y}))
    }
  );

  return {
    async swipe(from,to,steps=10){
      await send("touchStart",[from]);

      for(let step=1;step<=steps;step++){
        await send("touchMove",[[
          from[0]+(to[0]-from[0])*step/steps,
          from[1]+(to[1]-from[1])*step/steps
        ]]);
      }

      /*
        Палец останавливается перед отрывом: без этого браузер запускает
        инерционную прокрутку, и следующий тап лишь гасит её.
      */
      await new Promise(resolve=>setTimeout(resolve,80));
      await send("touchMove",[to]);
      await send("touchEnd",[]);
    },

    async tap(locator){
      const box=await locator.boundingBox();
      const point=[box.x+box.width/2,box.y+box.height/2];

      await send("touchStart",[point]);
      await send("touchEnd",[]);
    }
  };
}

test(
  "a month swipe on the shifts tab never swallows the next tap",
  async({page})=>{
    await openApp(page);

    const input=await touchInput(page);
    const period=await page.locator("header").innerText();

    await input.swipe([60,520],[320,524]);

    await expect(
      page.locator("header")
    ).not.toHaveText(period);

    await page.waitForTimeout(450);
    await settle(page);
    await input.tap(page.locator("#shiftAdd"));

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);
  }
);

test(
  "the management back swipe only works inside a section",
  async({page})=>{
    await openApp(page);

    const input=await touchInput(page);

    await page.locator("#tab-manage").click();

    const employees=page.locator(
      '#app [data-manage-section="employees"]'
    );

    await expect(employees).toBeVisible();
    await settle(page);

    await input.swipe([60,420],[320,424]);
    await page.waitForTimeout(200);
    await settle(page);

    await expect(
      page.locator("#manageBack")
    ).toBeHidden();

    await input.tap(employees);

    await expect(
      page.locator("#employeeList")
    ).toBeVisible();

    await expect(
      page.locator("#manageBack")
    ).toBeVisible();

    await settle(page);
    await input.swipe([60,420],[320,424]);

    await expect(
      page.locator('#app [data-manage-section="points"]')
    ).toBeVisible();

    await settle(page);

    await input.tap(
      page.locator('#app [data-manage-section="points"]')
    );

    await expect(
      page.locator("#pointManageList")
    ).toBeVisible();
  }
);
