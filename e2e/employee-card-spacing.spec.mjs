import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/management-layout.html";

test.use({
  viewport:{width:440,height:956},
  hasTouch:true,
  colorScheme:"dark"
});

test("the employee list window shows exactly five complete tiles",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await page.evaluate(()=>{
    const list=document.getElementById("employeeList");
    const employee=(index)=>`
      <button type="button" class="manage-row employee-row">
        <span class="manage-row-copy">
          <span class="manage-row-title">Сотрудник ${index}</span>
          <span class="manage-row-detail">ПВЗ не назначены</span>
          <span class="employee-account-label">Без аккаунта</span>
        </span>
        <span class="manage-chevron">›</span>
      </button>
    `;

    list.innerHTML=`
      <div class="card manage-menu">
        <button type="button" class="manage-row employee-row">
          <span class="manage-row-copy">
            <span class="manage-row-title">Подмена</span>
            <span class="manage-row-detail">Для смен на всех ПВЗ</span>
            <span class="manage-row-detail">Без итогов и аккаунта</span>
          </span>
          <span class="manage-chevron">›</span>
        </button>
        ${[1,2,3,4,5].map(employee).join("")}
      </div>
    `;
  });

  const menu=page.locator("#employeeList > .manage-menu");
  const rows=page.locator("#employeeList .employee-row");

  await expect(menu).toBeVisible();
  await expect(rows).toHaveCount(6);

  const metrics=await page.evaluate(()=>{
    const menu=document.querySelector("#employeeList > .manage-menu");
    const rows=[...document.querySelectorAll("#employeeList .employee-row")];
    const menuRect=menu.getBoundingClientRect();
    const rowRects=rows.map(row=>row.getBoundingClientRect());
    const firstFiveHeight=rowRects
      .slice(0,5)
      .reduce((sum,rect)=>sum+rect.height,0);

    return {
      menuHeight:menuRect.height,
      firstFiveHeight,
      fifthBottom:rowRects[4].bottom,
      sixthTop:rowRects[5].top,
      menuBottom:menuRect.bottom,
      rowHeights:rowRects.map(rect=>rect.height),
      rowGap:getComputedStyle(
        rows[1].querySelector(".manage-row-copy")
      ).gap
    };
  });

  expect(metrics.rowGap).toBe("5.5px");
  expect(Math.max(...metrics.rowHeights)-Math.min(...metrics.rowHeights))
    .toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.menuHeight-metrics.firstFiveHeight))
    .toBeLessThanOrEqual(3);
  expect(metrics.fifthBottom).toBeLessThanOrEqual(metrics.menuBottom+2);
  expect(metrics.sixthTop).toBeGreaterThanOrEqual(metrics.menuBottom-2);
});
