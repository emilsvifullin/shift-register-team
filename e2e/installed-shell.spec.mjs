import {
  test,
  expect
} from "@playwright/test";

import {
  openApp
} from "./support/supabase-stub.mjs";

/*
  Приложение, установленное на домашний экран, собирает оболочку по другим
  правилам: нижняя панель там привязана к документу (position:absolute), а не
  к экрану. Поэтому любая прокрутка документа уводит её вверх.

  На реальном iPhone это и происходило: пока открыта клавиатура, окно
  приложения ниже (878 против 956), а 100vh в iOS остаётся высотой окна без
  клавиатуры. Оболочка оказывалась выше окна, документ становился
  прокручиваемым на эту разницу, iOS прокручивал его, чтобы показать поле, и
  панель уезжала ровно на величину прокрутки (в журнале устройства 864 → 786
  при scrollY 78). Иногда прокрутка так и оставалась.

  Браузер на настольной машине уменьшает 100vh вместе с окном, поэтому здесь
  та же ситуация создаётся прямо: измеренная высота окна задаётся меньше
  окна. Если оболочка читает её, переполнения не возникает; если оболочка
  снова возьмёт 100vh, переполнение вернётся.

  display-mode подставить нельзя ни в одном движке, поэтому открывается
  только условие блока; правила внутри — те, что уходят в production.
*/
async function openInstalled(page){
  await page.route(
    "**/styles/interaction-core.css",
    async route=>{
      const response=await route.fetch();
      const css=await response.text();

      await route.fulfill({
        status:200,
        contentType:"text/css; charset=utf-8",
        body:css.replace(
          "@media (display-mode:standalone){",
          "@media all{"
        )
      });
    }
  );

  await openApp(page);
}

function shellState(){
  const root=document.documentElement;
  const dock=document.querySelector(".bottom-controls");

  return {
    innerHeight:window.innerHeight,
    shellHeight:Math.round(
      parseFloat(getComputedStyle(root).height)
    ),
    windowVariable:getComputedStyle(root)
      .getPropertyValue("--app-window-height")
      .trim(),
    dockPosition:getComputedStyle(dock).position,
    overflow:root.scrollHeight-root.clientHeight,
    scrollTop:Math.round(root.scrollTop),
    dockBelowShell:Math.round(
      dock.getBoundingClientRect().bottom-
      parseFloat(getComputedStyle(root).height)
    )
  };
}

test.use({
  viewport:{width:402,height:956},
  hasTouch:true,
  isMobile:true
});

test(
  "the installed shell is the measured window, so its dock cannot ride a scroll",
  async({page})=>{
    await openInstalled(page);

    const atRest=await page.evaluate(shellState);

    expect(atRest.dockPosition).toBe("absolute");
    expect(atRest.windowVariable).toBe("956px");
    expect(atRest.shellHeight).toBe(956);
    expect(atRest.overflow).toBe(0);

    /*
      iOS сообщает окно ниже, пока открыта клавиатура.
    */
    await page.evaluate(()=>{
      document.documentElement.style.setProperty(
        "--app-window-height",
        "878px"
      );
    });

    const covered=await page.evaluate(shellState);

    expect(covered.shellHeight).toBe(878);
    expect(covered.overflow).toBe(0);
    expect(covered.scrollTop).toBe(0);

    /*
      Панель стоит у нижнего края оболочки, а не у края прежнего окна.
    */
    expect(atRest.dockBelowShell).toBe(0);
    expect(covered.dockBelowShell).toBe(0);

    /*
      Прокрутить документ нечем: прокрутки нет, значит и уехать панели
      некуда.
    */
    await page.evaluate(()=>{
      document.documentElement.scrollTop=78;
      window.scrollTo(0,78);
    });

    const afterScroll=await page.evaluate(shellState);

    expect(afterScroll.scrollTop).toBe(0);
    expect(afterScroll.dockBelowShell).toBe(0);
  }
);
