import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/management-layout.html";

test.use({
  viewport:{width:414,height:896},
  hasTouch:true,
  colorScheme:"dark"
});

test("management back chevron stays aligned and long employee lists remain scrollable above the dock",async({page},testInfo)=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const back=page.locator(".manage-back");
  const period=page.locator("header .period");
  const sectionLabel=page.locator("main > .ml").first();
  const menu=page.locator("#employeeList > .manage-menu");
  const rows=page.locator("#employeeList .employee-row");
  const dock=page.locator(".bottom-controls");
  const tabs=page.locator("nav.tabs");

  await expect(back).toBeVisible();
  await expect(menu).toBeVisible();

  const [backBox,periodBox,labelBox,menuBox,firstRowBox,dockBox,tabsBox]=await Promise.all([
    back.boundingBox(),
    period.boundingBox(),
    sectionLabel.boundingBox(),
    menu.boundingBox(),
    rows.nth(0).boundingBox(),
    dock.boundingBox(),
    tabs.boundingBox()
  ]);

  for(const box of [backBox,periodBox,labelBox,menuBox,firstRowBox,dockBox,tabsBox]){
    expect(box).not.toBeNull();
  }

  expect(
    Math.abs(
      (backBox.y+backBox.height/2)-
      (periodBox.y+periodBox.height/2)
    )
  ).toBeLessThanOrEqual(1);
  expect(backBox.x).toBeGreaterThan(70);
  expect(backBox.x+backBox.width).toBeLessThan(periodBox.x+periodBox.width/2);
  expect(Math.abs(labelBox.x-menuBox.x)).toBeLessThanOrEqual(8);

  expect(
    Math.abs(tabsBox.x-menuBox.x)
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(tabsBox.width-menuBox.width)
  ).toBeLessThanOrEqual(2);

  const backVisual=await page.locator(".manage-back svg path").evaluate(element=>({
    stroke:getComputedStyle(element).stroke,
    opacity:getComputedStyle(element).opacity
  }));

  expect(backVisual.stroke).not.toBe("none");
  expect(Number(backVisual.opacity)).toBeGreaterThan(0);
  expect(firstRowBox.height).toBeGreaterThanOrEqual(76);

  const menuBottom=menuBox.y+menuBox.height;

  const menuMetrics=await menu.evaluate(element=>({
    clientHeight:element.clientHeight,
    scrollHeight:element.scrollHeight,
    radius:parseFloat(getComputedStyle(element).borderTopLeftRadius)
  }));

  expect(menuMetrics.scrollHeight).toBeGreaterThan(menuMetrics.clientHeight);
  expect(menuMetrics.radius).toBeGreaterThanOrEqual(14);
  expect(menuBox.height).toBeLessThanOrEqual(414);

  const gap=dockBox.y-menuBottom;
  expect(gap).toBeGreaterThanOrEqual(8);

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

test("the seventh point closes the rounded point list window",async({page},testInfo)=>{
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
  const rows=page.locator("#pointManageList .point-manage-row");
  await expect(menu).toBeVisible();

  const [menuBox,firstRowBox,seventhRowBox,eighthRowBox]=await Promise.all([
    menu.boundingBox(),
    rows.nth(0).boundingBox(),
    rows.nth(6).boundingBox(),
    rows.nth(7).boundingBox()
  ]);

  for(const box of [menuBox,firstRowBox,seventhRowBox,eighthRowBox]){
    expect(box).not.toBeNull();
  }

  expect(firstRowBox.height).toBeGreaterThanOrEqual(54);

  const menuBottom=menuBox.y+menuBox.height;
  const seventhBottom=seventhRowBox.y+seventhRowBox.height;
  expect(Math.abs(menuBottom-seventhBottom)).toBeLessThanOrEqual(3);
  expect(eighthRowBox.y).toBeGreaterThanOrEqual(menuBottom-3);

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
