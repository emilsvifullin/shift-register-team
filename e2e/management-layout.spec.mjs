import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/management-layout.html";

test.use({
  viewport:{width:414,height:896},
  hasTouch:true
});

test("management back chevron sits in the page header and employee rows use the intended mobile height",async({page},testInfo)=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const back=page.locator(".manage-back");
  const period=page.locator("header .period");
  const sectionLabel=page.locator("main > .ml").first();
  const menu=page.locator("#employeeList > .manage-menu");
  const firstRow=page.locator("#employeeList .employee-row").first();
  const dock=page.locator(".bottom-controls");
  const tabs=page.locator("nav.tabs");

  await expect(back).toBeVisible();
  await expect(menu).toBeVisible();

  const [backBox,periodBox,labelBox,menuBox,rowBox,dockBox]=await Promise.all([
    back.boundingBox(),
    period.boundingBox(),
    sectionLabel.boundingBox(),
    menu.boundingBox(),
    firstRow.boundingBox(),
    dock.boundingBox()
  ]);

  for(const box of [backBox,periodBox,labelBox,menuBox,rowBox,dockBox]){
    expect(box).not.toBeNull();
  }

  expect(
    Math.abs(
      (backBox.y+backBox.height/2)-
      (periodBox.y+periodBox.height/2)
    )
  ).toBeLessThanOrEqual(1);
  expect(backBox.x+backBox.width).toBeLessThan(periodBox.x+periodBox.width/2);
  expect(Math.abs(labelBox.x-menuBox.x)).toBeLessThanOrEqual(8);

  const backVisual=await page.locator(".manage-back svg path").evaluate(element=>({
    stroke:getComputedStyle(element).stroke,
    opacity:getComputedStyle(element).opacity
  }));

  expect(backVisual.stroke).not.toBe("none");
  expect(Number(backVisual.opacity)).toBeGreaterThan(0);
  expect(rowBox.height).toBeGreaterThanOrEqual(78);

  const menuMetrics=await menu.evaluate(element=>({
    clientHeight:element.clientHeight,
    scrollHeight:element.scrollHeight,
    radius:parseFloat(getComputedStyle(element).borderTopLeftRadius)
  }));

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
    path:testInfo.outputPath("management-employees.png"),
    fullPage:false
  });
});

test("point rows slightly expand without losing the rounded scroll window",async({page},testInfo)=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await page.evaluate(()=>{
    const list=document.getElementById("employeeList");
    list.id="pointManageList";
    list.innerHTML=`
      <div class="card manage-menu point-manage-menu">
        ${[
          "6-Я Радиальная 3к11",
          "Большой Овчинниковский Переулок 16",
          "Волгоградский Проспект 73с1",
          "Коммунальная Улица 10",
          "Корабельная 1",
          "Крузенштерна 9",
          "Кузьминская 5",
          "Мустая Карима 12",
          "Нагатинская Набережная 56а",
          "Новоясеневский Проспект 22к1"
        ].map(name=>`
          <button type="button" class="manage-row point-manage-row">
            <span class="manage-row-copy"><span class="manage-row-title">${name}</span></span>
            <span class="manage-chevron">›</span>
          </button>
        `).join("")}
      </div>
    `;
    document.querySelector("main > .ml").textContent="Пункты выдачи и тарифы";
  });

  const menu=page.locator("#pointManageList > .manage-menu");
  const firstRow=page.locator("#pointManageList .point-manage-row").first();
  await expect(menu).toBeVisible();

  const [menuBox,rowBox]=await Promise.all([
    menu.boundingBox(),
    firstRow.boundingBox()
  ]);

  expect(menuBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  expect(rowBox.height).toBeGreaterThanOrEqual(55);

  const metrics=await menu.evaluate(element=>({
    clientHeight:element.clientHeight,
    scrollHeight:element.scrollHeight,
    radius:parseFloat(getComputedStyle(element).borderBottomLeftRadius)
  }));

  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.radius).toBeGreaterThanOrEqual(14);

  await page.screenshot({
    path:testInfo.outputPath("management-points.png"),
    fullPage:false
  });
});
