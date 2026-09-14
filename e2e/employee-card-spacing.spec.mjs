import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/management-layout.html";

test.use({
  viewport:{width:414,height:896},
  hasTouch:true,
  colorScheme:"dark"
});

test("employee card three-line rhythm matches point card rhythm",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const metrics=await page.evaluate(()=>{
    const list=document.getElementById("employeeList");
    list.innerHTML=`
      <div class="card manage-menu">
        <button type="button" class="manage-row employee-row">
          <span class="manage-row-copy">
            <span class="manage-row-title">Сотрудник 1</span>
            <span class="manage-row-detail">ПВЗ не назначены</span>
            <span class="employee-account-label">Без аккаунта</span>
          </span>
          <span class="manage-chevron">›</span>
        </button>
      </div>
    `;

    const benchmark=document.createElement("div");
    benchmark.id="pointManageList";
    benchmark.style.cssText="position:fixed;left:-2000px;top:0;width:382px;";
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

    const employee=list.querySelector(".employee-row");
    const point=benchmark.querySelector(".point-manage-row");
    const employeeCopy=employee.querySelector(".manage-row-copy");
    const pointCopy=point.querySelector(".manage-row-copy");
    const employeeAccount=employee.querySelector(".employee-account-label");
    const pointLast=point.querySelectorAll(".manage-row-detail")[1];
    const employeeStyle=getComputedStyle(employee);
    const pointStyle=getComputedStyle(point);
    const employeeAccountStyle=getComputedStyle(employeeAccount);
    const pointLastStyle=getComputedStyle(pointLast);

    const result={
      employeeHeight:employee.getBoundingClientRect().height,
      pointHeight:point.getBoundingClientRect().height,
      employeePaddingTop:employeeStyle.paddingTop,
      pointPaddingTop:pointStyle.paddingTop,
      employeePaddingBottom:employeeStyle.paddingBottom,
      pointPaddingBottom:pointStyle.paddingBottom,
      employeeGap:getComputedStyle(employeeCopy).gap,
      pointGap:getComputedStyle(pointCopy).gap,
      employeeAccountFontSize:employeeAccountStyle.fontSize,
      pointLastFontSize:pointLastStyle.fontSize,
      employeeAccountLineHeight:employeeAccountStyle.lineHeight,
      pointLastLineHeight:pointLastStyle.lineHeight
    };

    benchmark.remove();
    return result;
  });

  expect(Math.abs(metrics.employeeHeight-metrics.pointHeight)).toBeLessThanOrEqual(1);
  expect(metrics.employeePaddingTop).toBe(metrics.pointPaddingTop);
  expect(metrics.employeePaddingBottom).toBe(metrics.pointPaddingBottom);
  expect(metrics.employeeGap).toBe(metrics.pointGap);
  expect(metrics.employeeAccountFontSize).toBe(metrics.pointLastFontSize);
  expect(metrics.employeeAccountLineHeight).toBe(metrics.pointLastLineHeight);
});
