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

test("point deletion is exposed only after entering point edit mode",async({page},testInfo)=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await page.locator(
    '[data-manage-section="points"]'
  ).click();

  const point=
    page.locator(
      '[data-point-id="point-demo"]'
    );

  await expect(point).toBeVisible();
  await point.click();

  await expect(
    page.locator("#manageEditorSheet")
  ).toHaveClass(/on/);

  await expect(
    page.locator("#managePointDelete")
  ).toHaveCount(0);

  await page.locator(
    "#manageEditorSave"
  ).click();

  const deleteButton=
    page.locator(
      "#managePointDelete"
    );

  await expect(deleteButton).toBeVisible();
  await expect(deleteButton).toHaveText(
    "Удалить ПВЗ"
  );
  await expect(
    page.locator("#managePointName")
  ).toBeVisible();

  const [buttonBox,editorBox]=await Promise.all([
    deleteButton.boundingBox(),
    page.locator(
      "#manageEditorSheet"
    ).boundingBox()
  ]);

  expect(buttonBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(buttonBox.x).toBeGreaterThanOrEqual(
    editorBox.x+12
  );
  expect(
    buttonBox.x+buttonBox.width
  ).toBeLessThanOrEqual(
    editorBox.x+editorBox.width-12
  );

  await page.screenshot({
    path:testInfo.outputPath(
      "management-point-edit-delete.png"
    ),
    fullPage:false
  });
});
