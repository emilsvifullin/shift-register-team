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

async function normalizeFixture(
  page,
  tab
){
  await page.locator("#app").evaluate((app,name)=>{
    app.classList.toggle(
      "shifts-layout",
      name==="shifts"
    );

    if(
      name==="shifts" &&
      !app.querySelector("#shiftListArea")
    ){
      const listLabel=Array.from(
        app.children
      ).find(element=>
        element.classList.contains("ml") &&
        element.textContent.trim()==="Список"
      );

      const listCard=listLabel?.nextElementSibling;

      if(
        listLabel &&
        listCard?.classList.contains("card")
      ){
        const area=document.createElement("div");
        area.id="shiftListArea";

        const scroll=document.createElement("div");
        scroll.className="shift-scroll";
        scroll.setAttribute(
          "aria-label",
          "Список смен"
        );

        while(listCard.firstChild){
          scroll.append(listCard.firstChild);
        }

        listCard.classList.add("shift-window");
        listCard.append(scroll);

        listLabel.before(area);
        area.append(listLabel,listCard);
      }
    }

    if(name==="data"){
      const status=app.querySelector(".data-status");

      if(
        status &&
        !status.querySelector(".data-status-copy")
      ){
        const title=status.querySelector(
          ".data-status-title"
        )?.textContent.trim() ||
          "Синхронизация в реальном времени";

        const detail=status.querySelector(
          ".data-status-detail"
        )?.textContent.trim() || "";

        status.classList.remove("card");
        status.replaceChildren();

        const dot=document.createElement("div");
        dot.className="dot";

        const copy=document.createElement("div");
        copy.className="data-status-copy";

        const titleNode=document.createElement("div");
        titleNode.className="data-status-title";
        titleNode.textContent=title;

        const detailNode=document.createElement("div");
        detailNode.className="data-status-detail";
        detailNode.textContent=detail;

        copy.append(titleNode,detailNode);
        status.append(dot,copy);
      }
    }
  },tab);
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

        await normalizeFixture(
          page,
          tab
        );

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
      await normalizeFixture(
        page,
        tab
      );
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
    await normalizeFixture(
      page,
      "shifts"
    );

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
