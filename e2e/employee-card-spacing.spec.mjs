import { expect, test } from "@playwright/test";

import {
  ADMIN_SEED,
  openApp
} from "./support/supabase-stub.mjs";

/*
  Окно списка сотрудников растягивается до нижней панели (styles/management.css),
  поэтому сколько плиток в нём видно, решает высота экрана, а не число строк.
  Ритм плитки подобран под iPhone 16 Pro Max с приложением на домашнем экране:
  окно 440×956 и safe area 62px сверху и 34px снизу. Без этих отступов
  (desktop-браузер, копия разметки в tests/fixtures) окно на ~90px выше, и
  проверка «ровно пять плиток» теряет смысл — поэтому она идёт на настоящем
  приложении с отступами iPhone.
*/
const IPHONE_SAFE_AREA={top:62,right:0,bottom:34,left:0};

test.use({
  viewport:{width:440,height:956},
  hasTouch:true,
  colorScheme:"dark"
});

/*
  Браузер не даёт задать env(safe-area-inset-*), поэтому стили приходят с
  подставленными значениями iPhone — остальной CSS не меняется.
*/
async function emulateSafeArea(page,insets){
  await page.route(
    url=>url.pathname.endsWith(".css"),
    async route=>{
      const response=await route.fetch();
      const css=(await response.text()).replace(
        /env\(safe-area-inset-(top|right|bottom|left)\)/g,
        (match,side)=>`${insets[side]}px`
      );

      await route.fulfill({response,body:css});
    }
  );
}

function employeesSeed(){
  const seed=structuredClone(ADMIN_SEED);
  const substitute=seed.employees.find(
    employee=>employee.is_system_substitute
  );
  const template=seed.employees.find(
    employee=>!employee.is_system_substitute
  );

  /*
    Имена идут по алфавиту после «Подменный сотрудник», поэтому первой
    плиткой, как и в рабочем списке, стоит подмена, за ней сотрудники.
  */
  const names=[
    "Роман Белов",
    "Светлана Жукова",
    "Тимур Исаев",
    "Ульяна Котова",
    "Фёдор Лебедев",
    "Юлия Морозова"
  ];

  seed.employees=[
    substitute,
    ...names.map((full_name,index)=>({
      ...template,
      id:`employee-list-${index}`,
      full_name,
      user_id:index===0 ? "user-1" : null
    }))
  ];
  seed.employee_points=names.map((name,index)=>({
    employee_id:`employee-list-${index}`,
    point_id:index%2 ? "point-2" : "point-1",
    active:true
  }));
  seed.accounts=[{user_id:"user-1",login:"roman@example.test"}];

  return seed;
}

test("the employee list window shows exactly five complete tiles",async({page})=>{
  await emulateSafeArea(page,IPHONE_SAFE_AREA);
  await openApp(page,{seed:employeesSeed()});

  await page.locator("#tab-manage").click();
  await page
    .locator('#app [data-manage-section="employees"]')
    .click();

  const rows=page.locator("#employeeList .employee-row");

  await expect(rows).toHaveCount(7);
  await expect(rows.first()).toContainText("Для смен на всех ПВЗ");
  await expect.poll(()=>page.evaluate(()=>
    document.getElementById("app").getAnimations().length
  )).toBe(0);

  const metrics=await page.evaluate(()=>{
    const menu=document.querySelector("#employeeList > .manage-menu");
    const rows=[...menu.querySelectorAll(".employee-row")];
    const menuRect=menu.getBoundingClientRect();
    const windowTop=menuRect.top+menu.clientTop;
    const rowRects=rows.map(row=>row.getBoundingClientRect());
    const detail=rows[1].querySelector(".manage-row-detail");
    const account=rows[1].querySelector(".employee-account-label");

    return {
      unresolvedSafeArea:[...document.styleSheets].some(sheet=>
        [...sheet.cssRules].some(rule=>
          rule.cssText.includes("safe-area-inset")
        )
      ),
      clientHeight:menu.clientHeight,
      scrollHeight:menu.scrollHeight,
      windowTop,
      windowBottom:windowTop+menu.clientHeight,
      rowHeights:rowRects.map(rect=>rect.height),
      fifthContentBottom:rows[4]
        .querySelector(".manage-row-copy")
        .getBoundingClientRect().bottom,
      sixthTop:rowRects[5].top,
      rowGap:getComputedStyle(
        rows[1].querySelector(".manage-row-copy")
      ).gap,
      detailType:[
        getComputedStyle(detail).fontSize,
        getComputedStyle(detail).lineHeight
      ],
      accountType:[
        getComputedStyle(account).fontSize,
        getComputedStyle(account).lineHeight
      ]
    };
  });

  // Все стили получили отступы iPhone, ни одного env(safe-area-inset-*) не осталось.
  expect(metrics.unresolvedSafeArea).toBe(false);

  // Длинный список прокручивается внутри окна.
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  // Три строки разведены шире, чем у ПВЗ; строка аккаунта набрана как строка деталей.
  expect(metrics.rowGap).toBe("5.5px");
  expect(metrics.accountType).toEqual(metrics.detailType);

  // Подмена и сотрудники — плитки одной высоты.
  expect(Math.max(...metrics.rowHeights)-Math.min(...metrics.rowHeights))
    .toBeLessThanOrEqual(1);

  /*
    Ровно пять целых плиток: все три строки пятой плитки видны, а шестая
    начинается за нижней границей окна, без тонкого хвоста.
  */
  expect(metrics.fifthContentBottom).toBeLessThanOrEqual(metrics.windowBottom);
  expect(metrics.sixthTop).toBeGreaterThanOrEqual(metrics.windowBottom-1);
});
