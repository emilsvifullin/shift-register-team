import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/management-navigation.html";

test.use({
  viewport:{width:414,height:896},
  hasTouch:true,
  colorScheme:"dark"
});

test("management tiles and header back work from the first user tap without pointer focus flash",async({page})=>{
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

  await headerBack.focus();

  await expect.poll(
    ()=>page.evaluate(()=>
      document.activeElement?.id || ""
    )
  ).not.toBe("prevM");

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

test("management header back stays transparent and untransformed through the iOS touch state",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await page.locator(
    '[data-manage-section="points"]'
  ).click();

  const headerBack=page.locator("#prevM");

  await expect(headerBack).toHaveAttribute(
    "data-manage-back-proxy",
    "true"
  );

  await headerBack.evaluate(element=>{
    element.classList.add("touch-active");
    element.focus();
  });

  const touchStyle=await headerBack.evaluate(element=>{
    const style=getComputedStyle(element);

    return {
      backgroundColor:style.backgroundColor,
      boxShadow:style.boxShadow,
      transform:style.transform,
      outlineStyle:style.outlineStyle,
      outlineWidth:style.outlineWidth
    };
  });

  expect(touchStyle.backgroundColor).toBe(
    "rgba(0, 0, 0, 0)"
  );
  expect(touchStyle.boxShadow).toBe("none");
  expect(touchStyle.transform).toBe("none");
  expect(touchStyle.outlineStyle).toBe("none");
  expect(touchStyle.outlineWidth).toBe("0px");

  await headerBack.evaluate(element=>
    element.classList.remove("touch-active")
  );

  await page.evaluate(()=>{
    document.body.dataset.inputModality="keyboard";
  });

  await headerBack.focus();

  await expect.poll(
    ()=>page.evaluate(()=>
      document.activeElement?.id || ""
    )
  ).toBe("prevM");

  const keyboardFocus=await headerBack.evaluate(element=>{
    const style=getComputedStyle(element);

    return {
      backgroundColor:style.backgroundColor,
      transform:style.transform,
      outlineWidth:style.outlineWidth
    };
  });

  expect(keyboardFocus.backgroundColor).toBe(
    "rgba(0, 0, 0, 0)"
  );
  expect(keyboardFocus.transform).toBe("none");
  expect(Number.parseFloat(keyboardFocus.outlineWidth))
    .toBeGreaterThan(0);
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

test("employee deletion is hidden in read-only view and appears after Edit",async({page},testInfo)=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await page.evaluate(()=>{
    window.openEmployeeView();
  });

  const originalDelete=
    page.locator("#employeeDelete");

  await expect(originalDelete).toBeHidden();
  await expect(
    page.locator("#employeeEditDelete")
  ).toHaveCount(0);

  await page.locator(
    "#employeeSheetSave"
  ).click();

  await expect(
    page.locator("#employeeName")
  ).toBeVisible();

  const editDelete=
    page.locator("#employeeEditDelete");

  await expect(editDelete).toBeVisible();
  await expect(editDelete).toHaveText(
    "Удалить сотрудника"
  );

  await editDelete.click();

  await expect(
    page.locator("#appConfirm")
  ).toHaveClass(/on/);

  expect(
    await page.evaluate(()=>
      window.employeeDeleteCalls
    )
  ).toBe(1);

  await expect(
    page.locator("#employeeSheetSave")
  ).toHaveText("Готово");

  await expect(
    page.locator("#employeeName")
  ).toBeVisible();

  await page.locator(
    "#appConfirmCancel"
  ).click();

  await expect(editDelete).toBeVisible();

  await page.screenshot({
    path:testInfo.outputPath(
      "management-employee-edit-delete.png"
    ),
    fullPage:false
  });
});