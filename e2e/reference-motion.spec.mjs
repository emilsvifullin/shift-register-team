import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/reference-motion.html";

test.use({
  viewport:{width:390,height:844},
  hasTouch:true,
  colorScheme:"dark"
});

function includesDuration(value,seconds){
  return value
    .split(",")
    .map(item=>item.trim())
    .includes(`${seconds}s`);
}

test("reference motion timings match shift-register and animate visibly",async({page},testInfo)=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const timings=await page.evaluate(()=>{
    const read=selector=>
      getComputedStyle(
        document.querySelector(selector)
      );

    return {
      sheet:read(".sheet").transitionDuration,
      veil:read(".veil").transitionDuration,
      point:read(".point-picker").transitionDuration,
      month:read(".month-picker").transitionDuration,
      confirm:read(".app-confirm-box").transitionDuration,
      toast:read(".toast").transitionDuration,
      monthVariable:
        getComputedStyle(document.documentElement)
          .getPropertyValue("--motion-month")
          .trim()
    };
  });

  expect(includesDuration(timings.sheet,.48)).toBe(true);
  expect(includesDuration(timings.veil,.34)).toBe(true);
  expect(includesDuration(timings.point,.42)).toBe(true);
  expect(includesDuration(timings.month,.42)).toBe(true);
  expect(includesDuration(timings.confirm,.24)).toBe(true);
  expect(includesDuration(timings.toast,.22)).toBe(true);
  expect(timings.monthVariable).toBe("320ms");

  await page.locator("#openSheet").click();
  await page.waitForTimeout(160);

  const middle=await page.locator("#sheet").evaluate(element=>({
    transform:getComputedStyle(element).transform,
    opacity:Number(getComputedStyle(element).opacity)
  }));

  expect(middle.transform).not.toBe("none");
  expect(middle.opacity).toBeGreaterThan(.95);

  await page.waitForTimeout(380);
  await expect(page.locator("#sheet")).toHaveClass(/\bon\b/);

  const settledTransform=
    await page.locator("#sheet").evaluate(element=>
      getComputedStyle(element).transform
    );

  expect(settledTransform).toMatch(/matrix/);

  await page.screenshot({
    path:testInfo.outputPath("reference-motion-sheet.png"),
    fullPage:false
  });

  await page.locator("#closeSheet").click();
  await page.waitForTimeout(520);
  await expect(page.locator("#sheet")).not.toHaveClass(/\bon\b/);

  const firstTab=page.locator("nav.tabs button").first();
  await firstTab.evaluate(element=>element.classList.add("touch-active"));
  await page.waitForTimeout(150);

  const pressedTransform=await firstTab.evaluate(element=>
    getComputedStyle(element).transform
  );

  expect(pressedTransform).not.toBe("none");

  await firstTab.evaluate(element=>element.classList.remove("touch-active"));

  await page.locator("#openConfirm").click();
  await page.waitForTimeout(280);

  await page.screenshot({
    path:testInfo.outputPath("reference-motion-confirm.png"),
    fullPage:false
  });
});

test("reduced motion remains respected",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const duration=await page.locator("#sheet").evaluate(element=>
    getComputedStyle(element).transitionDuration
  );

  const values=duration
    .split(",")
    .map(value=>Number.parseFloat(value));

  expect(Math.max(...values)).toBeLessThan(.01);
});
