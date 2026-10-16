import {expect,test} from "@playwright/test";
import {openApp} from "./support/supabase-stub.mjs";
import {demoSeed} from "../docs/manual/demo-seed.mjs";

/*
  Реальная смена наполненного октября на пустые ноябрь и сентябрь.
  Прежний тест входа в «Контроль» не задевал этот путь: при замене месяца
  249 переиспользованных кнопок одновременно анимировали свои цвета,
  вызывая около 1500 Paint за один переход вместо нескольких снимков.
*/
for(const [name,viewport] of [
  ["desktop",{width:1440,height:940}],
  ["phone",{width:390,height:844}]
]){
  test.describe(name,()=>{
    test.use({viewport});

    test("a populated October changes in both directions without animating every cell",async({page,browserName},testInfo)=>{
      const seed=JSON.parse(JSON.stringify(demoSeed()).replaceAll("2026-09","2026-10"));
      await openApp(page,{seed});

      const settle=()=>page.waitForFunction(()=>
        !document.documentElement.hasAttribute("data-month-motion") &&
        !document.querySelector('body > main[aria-hidden="true"][inert]')
      );
      await page.locator("#nextM").click();
      await settle();
      await page.locator('[data-shift-view="control"]').click();
      await expect(page.locator(".sv-cell.has")).toHaveCount(249);
      await page.waitForTimeout(350);

      const session=browserName==="chromium"
        ? await page.context().newCDPSession(page)
        : null;
      const paintCounts=[];

      for(const [button,label] of [
        ["nextM","НОЯБРЬ 2026"],
        ["prevM","СЕНТЯБРЬ 2026"]
      ]){
        const events=[];
        const collect=({value})=>events.push(...value);
        if(session){
          session.on("Tracing.dataCollected",collect);
          await session.send("Tracing.start",{
            categories:"devtools.timeline",
            transferMode:"ReportEvents"
          });
        }

        const transition=await page.evaluate(id=>{
          document.getElementById(id).click();
          const app=document.getElementById("app");
          return {
            period:document.getElementById("period").textContent.trim(),
            cellTransitions:document.getAnimations().filter(animation=>
              animation.constructor.name==="CSSTransition" &&
              animation.effect?.target?.closest?.(".sv-cell,.sh")
            ).length,
            contentMotion:app.getAnimations().some(animation=>
              animation.effect.getKeyframes().some(frame=>frame.transform?.includes("matrix") || frame.transform?.includes("translate"))
            )
          };
        },button);

        expect(transition.period.toUpperCase()).toBe(label);
        expect(transition.cellTransitions).toBe(0);
        expect(transition.contentMotion).toBe(true);
        await settle();
        await expect(page.locator(".sv-cell.has")).toHaveCount(0);

        if(session){
          const complete=new Promise(resolve=>session.once("Tracing.tracingComplete",resolve));
          await session.send("Tracing.end");
          await complete;
          session.off("Tracing.dataCollected",collect);
          const paints=events.filter(event=>event.name==="Paint").length;
          paintCounts.push({label,paints});
          // A device-independent work budget; no promise of a fixed machine FPS.
          expect(paints).toBeLessThan(60);
        }

        // Return to populated October before testing the other direction.
        await page.locator(button==="nextM" ? "#prevM" : "#nextM").click();
        await settle();
        await expect(page.locator(".sv-cell.has")).toHaveCount(249);
      }

      // Interactive cell feedback must return after the month movement ends.
      expect(await page.locator(".sv-cell button").first().evaluate(button=>
        getComputedStyle(button).transitionProperty
      )).toContain("background-color");
      await session?.detach();
      if(paintCounts.length){
        await testInfo.attach("month-paint-counts",{
          body:JSON.stringify(paintCounts,null,2),
          contentType:"application/json"
        });
      }
    });
  });
}
