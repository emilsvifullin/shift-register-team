import {
  test,
  expect
} from "@playwright/test";

import {
  ADMIN_SEED,
  openApp
} from "./support/supabase-stub.mjs";

/*
  Уход в другой основной раздел возвращает покинутый раздел на базовый
  экран.

  Правило одно на все разделы: вложенный экран закрывается, раскрытое
  внутри страницы сворачивается, временный поиск внутри раскрытого
  очищается. Настройки самого экрана — месяц, выбранный сотрудник,
  поиск и фильтры списков — остаются: человек задал их осознанно и
  видит на экране, когда возвращается.

  Проверяется обе стороны правила: и то, что сбрасывается, и то, что
  переживает переключение, — иначе «навести порядок» легко превращается
  в потерю уже сделанной работы.
*/

test.use({
  viewport:{width:402,height:874}
});

async function openManage(page){
  await page.locator("#tab-manage").click();
}

function manageScreen(page){
  return page.evaluate(()=>
    document.querySelector(
      '[data-manage-section="employees"]'
    )
      ? "home"
      : document.getElementById("employeeList")
        ? "employees"
        : document.getElementById("pointManageList")
          ? "points"
          : "unknown"
  );
}

test(
  "management reopens at its home screen, not where it was left",
  async({page})=>{
    await openApp(page,{seed:ADMIN_SEED});
    await openManage(page);

    await page
      .locator('#app [data-manage-section="employees"]')
      .click();

    await expect
      .poll(()=>manageScreen(page))
      .toBe("employees");

    await page.locator("#tab-shifts").click();
    await openManage(page);

    await expect
      .poll(()=>manageScreen(page))
      .toBe("home");

    /* Обе плитки раздела на месте — это и есть базовый экран. */
    await expect(
      page.locator("#app [data-manage-section]")
    ).toHaveCount(2);
  }
);

test(
  "moving inside management keeps what the screen was set to",
  async({page})=>{
    await openApp(page,{seed:ADMIN_SEED});
    await openManage(page);

    await page
      .locator('#app [data-manage-section="points"]')
      .click();

    await expect
      .poll(()=>manageScreen(page))
      .toBe("points");

    await page.locator("#pointSearch").fill("Кораб");

    await expect(
      page.locator(".point-manage-row")
    ).toHaveCount(1);

    /* «Назад» — это навигация внутри раздела, а не уход из него. */
    await page.locator("#manageBack").click();

    await expect
      .poll(()=>manageScreen(page))
      .toBe("home");

    await page
      .locator('#app [data-manage-section="points"]')
      .click();

    await expect(
      page.locator("#pointSearch")
    ).toHaveValue("Кораб");
  }
);

test(
  "the stats employee list never stays open across sections",
  async({page})=>{
    await openApp(page,{seed:ADMIN_SEED});

    await page.locator("#tab-stats").click();
    await page.locator("#statsEmployeeOpen").click();

    await page
      .locator('[data-stats-employee="employee-1"]')
      .click();

    await expect(
      page.locator("#statsEmployeeOpen")
    ).toContainText("Марина Абрамова");

    await page.locator("#statsEmployeeOpen").click();
    await page.locator("#statsEmployeeSearch").fill("Ром");

    await expect(
      page.locator("#statsEmployeeOpen")
    ).toHaveAttribute("aria-expanded","true");

    await page.locator("#tab-data").click();
    await page.locator("#tab-stats").click();

    /* Список свёрнут, набранное в нём не ждёт возвращения. */
    await expect(
      page.locator("#statsEmployeeOpen")
    ).toHaveAttribute("aria-expanded","false");

    await expect(
      page.locator("#statsEmployeeSearch")
    ).toHaveValue("");

    /*
      А сам выбор остаётся: без сотрудника «Итоги» показывают пустой
      экран, и заставлять выбирать заново после каждого перехода
      значило бы сделать раздел непригодным.
    */
    await expect(
      page.locator("#statsEmployeeOpen")
    ).toContainText("Марина Абрамова");
  }
);

test(
  "an expanded payout block collapses when the section is left",
  async({page})=>{
    await openApp(page,{seed:ADMIN_SEED});

    await page.locator("#tab-stats").click();
    await page.locator("#statsEmployeeOpen").click();

    await page
      .locator('[data-stats-employee="employee-1"]')
      .click();

    const payout=page
      .locator("[data-payout-toggle]")
      .first();

    await payout.click();

    await expect(payout).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    await page.locator("#tab-shifts").click();
    await page.locator("#tab-stats").click();

    await expect(
      page.locator("[data-payout-toggle]").first()
    ).toHaveAttribute("aria-expanded","false");
  }
);

test(
  "shifts and data have nothing to lose when sections change",
  async({page})=>{
    await openApp(page,{seed:ADMIN_SEED});

    const month=await page
      .locator("#period")
      .innerText();

    await page.locator("#prevM").click();

    const previousMonth=await page
      .locator("#period")
      .innerText();

    expect(previousMonth).not.toBe(month);

    await page.locator("#shiftSearch").fill("Мар");

    await page.locator("#tab-data").click();
    await page.locator("#tab-manage").click();
    await page.locator("#tab-shifts").click();

    /* Месяц и поиск — настройки экрана, а не место, где остановились. */
    await expect
      .poll(()=>
        page.locator("#period").innerText()
      )
      .toBe(previousMonth);

    await expect(
      page.locator("#shiftSearch")
    ).toHaveValue("Мар");
  }
);

test(
  "fast repeated section taps land on the base screen",
  async({page})=>{
    await openApp(page,{seed:ADMIN_SEED});
    await openManage(page);

    await page
      .locator('#app [data-manage-section="employees"]')
      .click();

    await expect
      .poll(()=>manageScreen(page))
      .toBe("employees");

    /* Каждое нажатие приходит раньше, чем закончится переход. */
    for(const id of [
      "#tab-shifts",
      "#tab-stats",
      "#tab-data",
      "#tab-manage"
    ]){
      await page.locator(id).click({timeout:5000});
    }

    await expect
      .poll(()=>
        page.evaluate(()=>
          document.body.dataset.activeTab
        )
      )
      .toBe("manage");

    await expect
      .poll(()=>manageScreen(page))
      .toBe("home");
  }
);
