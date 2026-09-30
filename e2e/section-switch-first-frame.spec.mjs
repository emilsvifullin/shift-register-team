import {
  test,
  expect
} from "@playwright/test";

import {
  ADMIN_SEED,
  openApp
} from "./support/supabase-stub.mjs";

/*
  Раздел открывается сразу в окончательном виде.

  Реконсилятор переиспользует узлы без ключа по совпадению тега, и между
  разделами это совпадение случайно: при переходе «Итоги → Смены» кнопкой
  «Реестр» становилась кнопка строки выплаты. Узел менял класс, и переход
  фона и тени проигрывал это как второе нажатие уже после открытия
  раздела.

  Проверяется сама причина, а не её вид: ни один узел прежнего раздела не
  достаётся новому, и ни одному элементу нового раздела не с чего
  запускать CSS-переход. Способ перехода — мышь, клавиатура, палец —
  на это не влияет, но проверяется каждый: у каждого своя дорога до
  render().
*/

const TABS=["shifts","stats","manage","data"];

test.use({
  viewport:{width:402,height:874}
});

async function watchSwitch(page){
  await page.evaluate(()=>{
    const app=document.getElementById("app");

    window.__previousNodes=new Set(
      app.querySelectorAll("*")
    );

    window.__transitions=[];

    window.__onTransition=event=>{
      if(
        event.target instanceof Element &&
        app.contains(event.target)
      ){
        window.__transitions.push(
          `${event.target.className || event.target.nodeName}: ${event.propertyName}`
        );
      }
    };

    document.addEventListener(
      "transitionrun",
      window.__onTransition,
      true
    );
  });
}

async function switchResult(page){
  /* Переход раздела длится 220 мс; переходам узлов хватило бы и меньше. */
  await page.waitForTimeout(450);

  return page.evaluate(()=>{
    document.removeEventListener(
      "transitionrun",
      window.__onTransition,
      true
    );

    const reused=Array.from(
      document
        .getElementById("app")
        .querySelectorAll("*")
    ).filter(node=>
      window.__previousNodes.has(node)
    ).length;

    return {
      reused,
      transitions:window.__transitions
    };
  });
}

async function expectSelected(page,name){
  await expect(
    page.locator(`#tab-${name}`)
  ).toHaveAttribute("aria-selected","true");
}

test(
  "every section switch builds the screen fresh, with nothing left to animate",
  async({page})=>{
    await openApp(page,{seed:ADMIN_SEED});

    for(const from of TABS){
      for(const to of TABS){
        if(from===to){
          continue;
        }

        await page.locator(`#tab-${from}`).click();
        await expectSelected(page,from);
        await page.waitForTimeout(300);

        await watchSwitch(page);
        await page.locator(`#tab-${to}`).click();
        await expectSelected(page,to);

        expect(
          await switchResult(page),
          `${from} → ${to}`
        ).toEqual({
          reused:0,
          transitions:[]
        });
      }
    }
  }
);

test(
  "«Итоги → Смены» opens on the registry already selected",
  async({page})=>{
    await openApp(page,{seed:ADMIN_SEED});

    await page.locator("#tab-stats").click();
    await expectSelected(page,"stats");
    await page.waitForTimeout(300);

    await watchSwitch(page);
    await page.locator("#tab-shifts").click();

    /* Первый же кадр после нажатия: «Реестр» выбран и никуда не едет. */
    const registry=page.locator(
      '#app [data-shift-view="registry"]'
    );

    await expect(registry).toHaveClass("on");
    await expect(registry).not.toBeFocused();

    expect(await switchResult(page)).toEqual({
      reused:0,
      transitions:[]
    });
  }
);

test(
  "keyboard arrows between sections",
  async({page})=>{
    await openApp(page,{seed:ADMIN_SEED});

    await page.locator("#tab-stats").click();
    await expectSelected(page,"stats");
    await page.waitForTimeout(300);

    await watchSwitch(page);
    await page.locator("#tab-stats").press("ArrowLeft");
    await expectSelected(page,"shifts");

    expect(await switchResult(page)).toEqual({
      reused:0,
      transitions:[]
    });

    await expect(
      page.locator('#app [data-shift-view="registry"]')
    ).toHaveClass("on");
  }
);

test.describe("touch",()=>{
  test.use({
    hasTouch:true
  });

  test(
    "tapping from «Итоги» to «Смены»",
    async({page})=>{
      await openApp(page,{seed:ADMIN_SEED});

      await page.locator("#tab-stats").tap();
      await expectSelected(page,"stats");
      await page.waitForTimeout(300);

      await watchSwitch(page);
      await page.locator("#tab-shifts").tap();
      await expectSelected(page,"shifts");

      expect(await switchResult(page)).toEqual({
        reused:0,
        transitions:[]
      });
    }
  );
});
