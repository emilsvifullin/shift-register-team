import {
  test,
  expect
} from "@playwright/test";

import {
  openApp
} from "./support/supabase-stub.mjs";

import {
  SCREENS
} from "./support/screens.mjs";

/*
  Дымовой прогон настоящего приложения: те же index.html, модули и стили,
  что в production, подставлен только Supabase. Проверяется, что каждый
  экран открывается без ошибок страницы, помещается по ширине и оставляет
  нижнюю навигацию на месте.
*/

const VIEWPORTS=[
  {
    name:"phone",
    viewport:{width:390,height:844},
    hasTouch:true
  },
  {
    name:"laptop",
    viewport:{width:1440,height:900},
    hasTouch:false
  }
];

for(const size of VIEWPORTS){
  for(const screen of SCREENS){
    test(
      `${screen.name} opens cleanly on ${size.name}`,
      async({browser})=>{
        const context=await browser.newContext({
          viewport:size.viewport,
          hasTouch:size.hasTouch
        });

        const page=await context.newPage();
        const failures=[];

        page.on(
          "pageerror",
          error=>failures.push(String(error))
        );

        page.on(
          "console",
          message=>{
            if(message.type()==="error"){
              failures.push(message.text());
            }
          }
        );

        await openApp(page);
        await screen.open(page);

        await expect(
          page.locator("#app")
        ).toBeVisible();

        const layout=await page.evaluate(()=>({
          horizontalOverflow:
            document.documentElement.scrollWidth>
            document.documentElement.clientWidth,
          dockVisible:Boolean(
            document.querySelector(
              ".bottom-controls"
            )?.getBoundingClientRect().height
          ),
          emptyPanel:
            document.getElementById("app")
              .childElementCount===0
        }));

        expect(failures).toEqual([]);
        expect(layout.horizontalOverflow).toBe(false);
        expect(layout.dockVisible).toBe(true);
        expect(layout.emptyPanel).toBe(false);

        await context.close();
      }
    );
  }
}

test(
  "the manage back control lives in the header and returns to the section list",
  async({page})=>{
    await page.setViewportSize({
      width:390,
      height:844
    });

    await openApp(page);

    const back=page.locator("header #manageBack");

    await expect(back).toBeHidden();

    await page.locator("#tab-manage").click();
    await expect(back).toBeHidden();

    await page
      .locator('#app [data-manage-section="points"]')
      .click();

    await expect(back).toBeVisible();
    await expect(
      page.locator("#pointManageList")
    ).toBeVisible();

    /*
      Заголовок остаётся ровно по центру: кнопка «назад» занимает слот
      стрелки месяца, а не добавляет к шапке ещё один элемент.
    */
    const centred=await page.evaluate(()=>{
      const box=document
        .getElementById("period")
        .getBoundingClientRect();

      return Math.abs(
        box.x+box.width/2-
        window.innerWidth/2
      );
    });

    expect(centred).toBeLessThanOrEqual(1);

    await back.click();

    await expect(
      page.locator('#app [data-manage-section="points"]')
    ).toBeVisible();

    await expect(back).toBeHidden();
  }
);

test(
  "a non-admin never sees the management tab",
  async({page})=>{
    const {ADMIN_SEED}=await import(
      "./support/supabase-stub.mjs"
    );

    const seed=structuredClone(ADMIN_SEED);
    seed.profile.role="employee";
    seed.employees[0].user_id=seed.profile.id;

    await openApp(page,{seed});

    await expect(
      page.locator("#tab-manage")
    ).toBeHidden();
  }
);

/*
  Блок «Аккаунт» показывает данные вошедшего пользователя: у настоящего
  Supabase в сессии есть почта и метаданные, и они должны попадать на экран.
*/
test(
  "the account card shows the signed-in account",
  async({page})=>{
    await openApp(page);

    await page.locator("#tab-data").click();

    const account=page
      .locator(".ml", {hasText:/^Аккаунт$/})
      .locator("xpath=following-sibling::div[1]");

    await expect(account).toContainText("Администратор");
    await expect(account).toContainText("Эмиль Сайфуллин");
    await expect(account).toContainText("admin@example.test");
  }
);

test(
  "switching tabs does not move focus onto the next screen",
  async({page})=>{
    await openApp(page);

    await page.locator("#tab-manage").click();

    await page.evaluate(()=>
      document
        .querySelector('#app [data-manage-section="employees"]')
        .focus()
    );

    await page.evaluate(()=>
      document
        .getElementById("tab-stats")
        .dispatchEvent(new MouseEvent("click",{bubbles:true}))
    );

    /*
      Экран считается переключённым, когда содержимое «Итогов» уже
      отрисовано: атрибут вкладки на body ставится раньше рендера.
    */
    await expect(
      page.locator("#statsEmployeeOpen")
    ).toBeVisible();

    await expect
      .poll(()=>page.evaluate(()=>
        document.querySelectorAll(
          'body > main[aria-hidden="true"][inert]'
        ).length
      ))
      .toBe(0);

    expect(
      await page.evaluate(()=>({
        active:document.activeElement.tagName,
        id:document.activeElement.id
      }))
    ).toEqual({active:"BODY",id:""});
  }
);
