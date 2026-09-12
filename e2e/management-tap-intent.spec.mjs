import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/management-tap-intent.html";

test.use({
  viewport:{width:414,height:896},
  hasTouch:true
});

test("one touch intent survives a swallowed click and a busy transition",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const button=page.locator(
    '[data-manage-section="points"]'
  );

  await expect(button).toBeVisible();

  await button.evaluate(element=>{
    const rect=element.getBoundingClientRect();
    const init={
      bubbles:true,
      pointerId:17,
      pointerType:"touch",
      isPrimary:true,
      clientX:rect.left+rect.width/2,
      clientY:rect.top+rect.height/2
    };

    element.dispatchEvent(
      new PointerEvent(
        "pointerdown",
        init
      )
    );

    element.dispatchEvent(
      new PointerEvent(
        "pointerup",
        init
      )
    );
  });

  await expect(
    page.locator("#pointManageList")
  ).toBeVisible({timeout:4000});

  expect(
    await page.evaluate(()=>
      window.manageTapAttempts
    )
  ).toBeGreaterThan(1);
});

test("a scroll gesture does not replay management navigation",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const button=page.locator(
    '[data-manage-section="points"]'
  );

  await button.evaluate(element=>{
    const rect=element.getBoundingClientRect();
    const base={
      bubbles:true,
      pointerId:23,
      pointerType:"touch",
      isPrimary:true,
      clientX:rect.left+rect.width/2,
      clientY:rect.top+rect.height/2
    };

    element.dispatchEvent(
      new PointerEvent(
        "pointerdown",
        base
      )
    );

    element.dispatchEvent(
      new PointerEvent(
        "pointermove",
        {
          ...base,
          clientY:base.clientY+24
        }
      )
    );

    element.dispatchEvent(
      new PointerEvent(
        "pointerup",
        {
          ...base,
          clientY:base.clientY+24
        }
      )
    );
  });

  await page.waitForTimeout(250);

  await expect(button).toBeVisible();
  expect(
    await page.evaluate(()=>
      window.manageTapAttempts
    )
  ).toBe(0);
});
