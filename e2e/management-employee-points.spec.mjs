import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/management-employee-points.html";

test.use({
  viewport:{width:414,height:896},
  hasTouch:true
});

test("employee editor shows the complete point catalog and protects archived points",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await expect(page.locator("body"))
    .toHaveAttribute(
      "data-management-employee-points",
      "ready"
    );

  const options=
    page.locator(
      "[data-employee-point]"
    );

  await expect(options).toHaveCount(4);

  const ids=
    await options.evaluateAll(items=>
      items.map(item=>
        item.dataset.employeePoint
      )
    );

  expect(ids).toEqual([
    "active-a",
    "active-b",
    "archived-selected",
    "archived-free"
  ]);

  const selectedArchived=
    page.locator(
      '[data-employee-point="archived-selected"]'
    );

  await expect(selectedArchived)
    .toHaveClass(/employee-point-archived/);
  await expect(selectedArchived)
    .toHaveClass(/\bon\b/);
  await expect(selectedArchived)
    .toBeEnabled();
  await expect(
    selectedArchived.locator(
      ".employee-point-state"
    )
  ).toHaveText("В архиве");

  const freeArchived=
    page.locator(
      '[data-employee-point="archived-free"]'
    );

  await expect(freeArchived)
    .toHaveClass(/employee-point-archived/);
  await expect(freeArchived)
    .toBeDisabled();
  await expect(
    freeArchived.locator(
      ".employee-point-state"
    )
  ).toHaveText("В архиве");

  await expect(
    page.locator(
      '[data-employee-point="active-a"]'
    )
  ).toBeEnabled();
});

test("employee editor renders a clear empty state when no pickup points exist",async({page})=>{
  await page.goto(`${FIXTURE}?empty=1`);
  await page.waitForLoadState("networkidle");

  const empty=
    page.locator(
      ".employee-points-empty"
    );

  await expect(empty).toBeVisible();
  await expect(
    empty.locator(
      ".employee-points-empty-title"
    )
  ).toHaveText(
    "Пункты выдачи ещё не добавлены"
  );
  await expect(
    empty.locator(
      ".employee-points-empty-detail"
    )
  ).toHaveText(
    "Добавьте ПВЗ в разделе «Пункты выдачи и тарифы»."
  );

  await expect(
    page.locator(
      "[data-employee-point]"
    )
  ).toHaveCount(0);

  const box=await empty.boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeGreaterThanOrEqual(100);
});
