import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/management-layout.html";

test.use({
  viewport:{width:414,height:896},
  hasTouch:true,
  colorScheme:"dark"
});

test("management back chevron stays aligned and employee rows use five-card rhythm",async({page},testInfo)=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await page.locator("#employeeList > .manage-menu").evaluate(menu=>{
    const substitution=document.createElement("button");
    substitution.type="button";
    substitution.className="manage-row employee-row";
    substitution.innerHTML=`
      <span class="manage-row-copy">
        <span class="manage-row-title">Подмена</span>
        <span class="manage-row-detail">Для смен на всех ПВЗ</span>
        <span class="manage-row-detail">Без итогов и аккаунта</span>
      </span>
      <span class="manage-chevron">›</span>
    `;
    menu.prepend(substitution);
  });

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
  expect(backBox.x).toBeGreaterThan(0);
  expect(backBox.x+backBox.width).toBeLessThanOrEqual(periodBox.x+1);
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

  const rowMetrics=await page.evaluate(()=>{
    const employee=document.querySelector("#employeeList .employee-row");
    const width=employee.parentElement.getBoundingClientRect().width;
    const benchmark=document.createElement("div");
    benchmark.id="pointManageList";
    benchmark.style.cssText=`position:fixed;left:-2000px;top:0;width:${width}px;`;
    benchmark.innerHTML=`
      <div class="card manage-menu point-manage-menu">
        <button type="button" class="manage-row point-manage-row">
          <span class="manage-row-copy">
            <span class="manage-row-title">Адрес 1</span>
            <span class="manage-row-detail">Сотрудники не назначены</span>
            <span class="manage-row-detail">Фиксированный · 3 000 ₽</span>
          </span>
          <span class="manage-chevron">›</span>
        </button>
      </div>
    `;
    document.body.append(benchmark);

    const point=benchmark.querySelector(".point-manage-row");
    const employeeCopy=employee.querySelector(".manage-row-copy");
    const pointCopy=point.querySelector(".manage-row-copy");
    const employeeTitle=employee.querySelector(".manage-row-title");
    const pointTitle=point.querySelector(".manage-row-title");
    const employeeDetail=employee.querySelector(".manage-row-detail");
    const pointDetail=point.querySelector(".manage-row-detail");
    const employeeStyle=getComputedStyle(employee);
    const pointStyle=getComputedStyle(point);

    const result={
      employeeHeight:employee.getBoundingClientRect().height,
      pointHeight:point.getBoundingClientRect().height,
      employeePaddingTop:employeeStyle.paddingTop,
      pointPaddingTop:pointStyle.paddingTop,
      employeePaddingBottom:employeeStyle.paddingBottom,
      pointPaddingBottom:pointStyle.paddingBottom,
      employeeGap:getComputedStyle(employeeCopy).gap,
      pointGap:getComputedStyle(pointCopy).gap,
      employeeTitleLineHeight:getComputedStyle(employeeTitle).lineHeight,
      pointTitleLineHeight:getComputedStyle(pointTitle).lineHeight,
      employeeDetailLineHeight:getComputedStyle(employeeDetail).lineHeight,
      pointDetailLineHeight:getComputedStyle(pointDetail).lineHeight
    };

    benchmark.remove();
    return result;
  });

  expect(rowMetrics.employeeHeight-rowMetrics.pointHeight).toBeGreaterThanOrEqual(4.5);
  expect(rowMetrics.employeeHeight-rowMetrics.pointHeight).toBeLessThanOrEqual(5.5);
  expect(rowMetrics.employeePaddingTop).toBe(rowMetrics.pointPaddingTop);
  expect(rowMetrics.employeePaddingBottom).toBe(rowMetrics.pointPaddingBottom);
  expect(rowMetrics.employeeGap).toBe("5.5px");
  expect(rowMetrics.pointGap).toBe("3px");
  expect(rowMetrics.employeeTitleLineHeight).toBe(rowMetrics.pointTitleLineHeight);
  expect(rowMetrics.employeeDetailLineHeight).toBe(rowMetrics.pointDetailLineHeight);

  const menuBottom=menuBox.y+menuBox.height;
  const gap=dockBox.y-menuBottom;

  expect(gap).toBeGreaterThanOrEqual(8);
  expect(gap).toBeLessThanOrEqual(32);

  const menuMetrics=await menu.evaluate(element=>({
    clientHeight:element.clientHeight,
    scrollHeight:element.scrollHeight,
    scrollTop:element.scrollTop,
    radius:parseFloat(getComputedStyle(element).borderTopLeftRadius)
  }));

  expect(menuMetrics.scrollHeight).toBeGreaterThan(menuMetrics.clientHeight);
  expect(menuMetrics.scrollTop).toBe(0);
  expect(menuMetrics.radius).toBeGreaterThanOrEqual(14);

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

test("long point cards fill the available window and the last card scrolls fully into view",async({page},testInfo)=>{
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
            <span class="manage-row-copy">
              <span class="manage-row-title">${name}</span>
              <span class="manage-row-detail">Сотрудники не назначены</span>
              <span class="manage-row-detail">Фиксированный · 3 000 ₽</span>
            </span>
            <span class="manage-chevron">›</span>
          </button>
        `).join("")}
      </div>
    `;
    document.querySelector("main > .ml").textContent="Пункты выдачи и тарифы";
  });

  const menu=page.locator("#pointManageList > .manage-menu");
  const rows=page.locator("#pointManageList .point-manage-row");
  const dock=page.locator(".bottom-controls");

  await expect(menu).toBeVisible();

  const [menuBox,firstRowBox,dockBox]=await Promise.all([
    menu.boundingBox(),
    rows.nth(0).boundingBox(),
    dock.boundingBox()
  ]);

  for(const box of [menuBox,firstRowBox,dockBox]){
    expect(box).not.toBeNull();
  }

  expect(firstRowBox.height).toBeGreaterThanOrEqual(72);

  const gap=dockBox.y-(menuBox.y+menuBox.height);
  expect(gap).toBeGreaterThanOrEqual(8);
  expect(gap).toBeLessThanOrEqual(32);

  const metrics=await menu.evaluate(element=>({
    clientHeight:element.clientHeight,
    scrollHeight:element.scrollHeight,
    radius:parseFloat(getComputedStyle(element).borderBottomLeftRadius)
  }));

  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.radius).toBeGreaterThanOrEqual(14);

  await menu.evaluate(element=>{
    element.scrollTop=element.scrollHeight;
  });

  await page.waitForTimeout(50);

  const [scrolledMenuBox,lastRowBox]=await Promise.all([
    menu.boundingBox(),
    rows.last().boundingBox()
  ]);

  expect(scrolledMenuBox).not.toBeNull();
  expect(lastRowBox).not.toBeNull();

  const menuBottom=scrolledMenuBox.y+scrolledMenuBox.height;
  const lastBottom=lastRowBox.y+lastRowBox.height;

  expect(lastRowBox.y).toBeGreaterThanOrEqual(scrolledMenuBox.y-1);
  expect(lastBottom).toBeLessThanOrEqual(menuBottom+1);
  expect(Math.abs(menuBottom-lastBottom)).toBeLessThanOrEqual(3);

  await page.screenshot({
    path:testInfo.outputPath("management-points.png"),
    fullPage:false
  });
});