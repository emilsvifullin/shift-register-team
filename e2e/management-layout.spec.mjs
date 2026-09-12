import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/management-layout.html";

test.use({
  viewport:{width:390,height:844},
  hasTouch:true
});

test("management detail keeps a visible back chevron and full-height rounded list",async({page},testInfo)=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const back=page.locator(".manage-back");
  const sectionLabel=page.locator("main > .ml").first();
  const menu=page.locator("#employeeList > .manage-menu");
  const dock=page.locator(".bottom-controls");
  const tabs=page.locator("nav.tabs");

  await expect(back).toBeVisible();
  await expect(menu).toBeVisible();

  const [backBox,labelBox,menuBox,dockBox]=await Promise.all([
    back.boundingBox(),
    sectionLabel.boundingBox(),
    menu.boundingBox(),
    dock.boundingBox()
  ]);

  expect(backBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(dockBox).not.toBeNull();

  expect(backBox.x).toBeLessThan(labelBox.x);
  expect(
    Math.abs(
      (backBox.y+backBox.height/2)-
      (labelBox.y+labelBox.height/2)
    )
  ).toBeLessThan(18);

  const backVisual=await page.locator(".manage-back svg path").evaluate(element=>({
    stroke:getComputedStyle(element).stroke,
    opacity:getComputedStyle(element).opacity
  }));

  expect(backVisual.stroke).not.toBe("none");
  expect(Number(backVisual.opacity)).toBeGreaterThan(0);

  const menuMetrics=await menu.evaluate(element=>({
    clientHeight:element.clientHeight,
    scrollHeight:element.scrollHeight,
    radius:parseFloat(getComputedStyle(element).borderTopLeftRadius)
  }));

  expect(menuBox.height).toBeGreaterThan(320);
  expect(menuMetrics.scrollHeight).toBeGreaterThan(menuMetrics.clientHeight);
  expect(menuMetrics.radius).toBeGreaterThanOrEqual(14);

  const gap=dockBox.y-(menuBox.y+menuBox.height);
  expect(gap).toBeGreaterThanOrEqual(8);
  expect(gap).toBeLessThanOrEqual(28);

  const tabsRadius=await tabs.evaluate(element=>
    parseFloat(getComputedStyle(element).borderTopLeftRadius)
  );
  expect(tabsRadius).toBeGreaterThanOrEqual(14);
  expect(tabsRadius).toBeLessThanOrEqual(18);

  await page.screenshot({
    path:testInfo.outputPath("management-layout.png"),
    fullPage:false
  });
});
