import {
  test,
  expect
} from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/platform-shell.html";

const PORTRAITS=[
  ["narrow",320,568],
  ["phone",390,844],
  ["large-phone",430,932],
  ["fold-open",884,1104]
];

const TABS=[
  "shifts",
  "stats",
  "manage",
  "data"
];

async function capture(
  page,
  browserName,
  name
){
  await page.screenshot({
    path:`visual-audit/${browserName}/${name}.png`,
    fullPage:false,
    animations:"allow"
  });
}

async function openSurface(
  page,
  selector,
  bodyClass
){
  await page.locator(selector).evaluate((element,openClass)=>{
    element.style.display="block";
    element.setAttribute("aria-hidden","false");
    element.classList.remove("on");
    void element.offsetHeight;
    document.body.classList.add(openClass);
    element.classList.add("on");
  },bodyClass);

  await page.waitForTimeout(360);
}

async function closeSurface(
  page,
  selector,
  bodyClass
){
  await page.locator(selector).evaluate((element,openClass)=>{
    element.classList.remove("on");
    element.setAttribute("aria-hidden","true");
    document.body.classList.remove(openClass);
    element.style.display="none";
  },bodyClass);
}

test(
  "capture representative end-to-end visual states",
  async({page,browserName})=>{
    test.setTimeout(90000);

    await page.goto(FIXTURE);

    for(const [label,width,height] of PORTRAITS){
      await page.setViewportSize({width,height});

      for(const tab of TABS){
        await page.locator(`#tab-${tab}`).click();
        await page.waitForTimeout(280);

        await expect(page.locator("body"))
          .toHaveAttribute("data-active-tab",tab);

        await capture(
          page,
          browserName,
          `${label}-${width}x${height}-${tab}`
        );
      }
    }

    await page.setViewportSize({
      width:844,
      height:390
    });

    for(const tab of TABS){
      await page.locator(`#tab-${tab}`).click();
      await page.waitForTimeout(280);
      await capture(
        page,
        browserName,
        `landscape-844x390-${tab}`
      );
    }

    await page.setViewportSize({
      width:390,
      height:844
    });

    await page.locator("#tab-shifts").click();
    await page.waitForTimeout(280);

    const surfaces=[
      ["sheet","#fixtureSheet","sheet-open"],
      ["employee-picker","#fixturePointPicker","point-picker-open"],
      ["month-picker","#fixtureMonthPicker","month-picker-open"],
      ["date-picker","#fixtureDatePicker","date-picker-open"]
    ];

    for(const [name,selector,bodyClass] of surfaces){
      await openSurface(
        page,
        selector,
        bodyClass
      );

      await capture(
        page,
        browserName,
        `phone-390x844-${name}`
      );

      await closeSurface(
        page,
        selector,
        bodyClass
      );
    }

    await openSurface(
      page,
      "#fixturePointPicker",
      "point-picker-open"
    );

    await page.locator(
      "#fixturePointPicker input"
    ).focus();

    await page.setViewportSize({
      width:390,
      height:430
    });

    await page.waitForTimeout(100);

    await capture(
      page,
      browserName,
      "phone-390x430-picker-keyboard"
    );
  }
);
