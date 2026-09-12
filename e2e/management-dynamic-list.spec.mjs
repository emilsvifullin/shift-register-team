import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/management-layout.html";

test.use({
  viewport:{width:414,height:896},
  hasTouch:true,
  colorScheme:"dark"
});

test("short management lists hug their rows instead of filling the viewport",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await page.evaluate(()=>{
    document
      .querySelectorAll(
        "#employeeList .employee-row"
      )
      .forEach((row,index)=>{
        if(index>1){
          row.remove();
        }
      });
  });

  const employeeMenu=
    page.locator(
      "#employeeList > .manage-menu"
    );

  const employeeRows=
    page.locator(
      "#employeeList .employee-row"
    );

  const [employeeMenuBox,lastEmployeeBox,dockBox]=
    await Promise.all([
      employeeMenu.boundingBox(),
      employeeRows.last().boundingBox(),
      page.locator(
        ".bottom-controls"
      ).boundingBox()
    ]);

  expect(employeeMenuBox).not.toBeNull();
  expect(lastEmployeeBox).not.toBeNull();
  expect(dockBox).not.toBeNull();

  expect(
    Math.abs(
      employeeMenuBox.y+
      employeeMenuBox.height-
      (
        lastEmployeeBox.y+
        lastEmployeeBox.height
      )
    )
  ).toBeLessThanOrEqual(3);

  expect(employeeMenuBox.height)
    .toBeLessThan(170);

  expect(
    dockBox.y-
    (employeeMenuBox.y+employeeMenuBox.height)
  ).toBeGreaterThan(80);

  await page.evaluate(()=>{
    const list=
      document.getElementById(
        "employeeList"
      );

    list.id="pointManageList";
    list.innerHTML=`
      <div class="card manage-menu point-manage-menu">
        <button type="button" class="manage-row point-manage-row">
          <span class="manage-row-copy"><span class="manage-row-title">Пятницкий Переулок 2</span></span>
          <span class="manage-chevron">›</span>
        </button>
        <button type="button" class="manage-row point-manage-row">
          <span class="manage-row-copy"><span class="manage-row-title">Ярцевская 25а</span></span>
          <span class="manage-chevron">›</span>
        </button>
      </div>
    `;
  });

  const pointMenu=
    page.locator(
      "#pointManageList > .manage-menu"
    );

  const pointRows=
    page.locator(
      "#pointManageList .point-manage-row"
    );

  const [pointMenuBox,lastPointBox]=
    await Promise.all([
      pointMenu.boundingBox(),
      pointRows.last().boundingBox()
    ]);

  expect(pointMenuBox).not.toBeNull();
  expect(lastPointBox).not.toBeNull();

  expect(
    Math.abs(
      pointMenuBox.y+
      pointMenuBox.height-
      (
        lastPointBox.y+
        lastPointBox.height
      )
    )
  ).toBeLessThanOrEqual(3);

  expect(pointMenuBox.height)
    .toBeLessThan(125);
});
