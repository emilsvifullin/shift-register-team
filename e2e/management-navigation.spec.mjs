import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/management-navigation.html";

test.use({
  viewport:{width:414,height:896},
  hasTouch:true,
  colorScheme:"dark"
});

test("management tiles and header back work from the first user tap",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const points=page.locator(
    '[data-manage-section="points"]'
  );

  await expect(points).toBeVisible();
  await points.click();

  await expect(
    page.locator("#manageBack")
  ).toHaveCount(1);

  expect(
    await page.evaluate(()=>
      window.manageForwardAttempts
    )
  ).toBeGreaterThanOrEqual(2);

  const headerBack=
    page.locator("#prevM");

  await expect(headerBack).toBeVisible();
  await expect(headerBack).toBeEnabled();
  await expect(headerBack).toHaveAttribute(
    "data-manage-back-proxy",
    "true"
  );
  await expect(headerBack).toHaveAttribute(
    "aria-label",
    "Назад в управление"
  );

  await expect(
    page.locator("#manageBack")
  ).toBeHidden();

  await headerBack.click();

  await expect(points).toBeVisible();

  expect(
    await page.evaluate(()=>
      window.manageBackAttempts
    )
  ).toBeGreaterThanOrEqual(2);

  await expect(headerBack).toHaveClass(
    /is-hidden/
  );
  await expect(headerBack).toBeDisabled();
});
