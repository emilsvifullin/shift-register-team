import {expect,test} from "@playwright/test";

/*
  Бюджет проверяет число перерасчётов геометрии, а не FPS конкретной
  машины. Раньше перехват team-motion превращал transform в left и
  запускал Layout на каждом кадре полного месяца.
*/
test("a populated control month slides without laying out every animation frame",async({page,browserName})=>{
  test.skip(browserName!=="chromium","Layout counters are provided by Chromium CDP");

  await page.setViewportSize({width:1440,height:940});
  await page.goto("http://127.0.0.1:4173/tests/fixtures/team-motion.html");

  await page.evaluate(async()=>{
    const {controlViewHTML}=await import("/src/shift-views.js");
    const stylesheet=document.createElement("link");
    stylesheet.rel="stylesheet";
    stylesheet.href="/styles/shift-views.css";
    await new Promise(resolve=>{
      stylesheet.onload=resolve;
      document.head.append(stylesheet);
    });

    document.querySelectorAll(".sheet,.preview-actions,.bottom-controls")
      .forEach(node=>node.remove());

    const points=Array.from({length:80},(_,index)=>({
      id:`point-${index}`,
      name:`Пункт выдачи ${index+1}`
    }));

    const shifts=points.flatMap(point=>
      Array.from({length:31},(_,index)=>({
        pointId:point.id,
        date:`2026-10-${String(index+1).padStart(2,"0")}`
      }))
    );

    const app=document.getElementById("app");
    app.innerHTML=controlViewHTML({
      cursor:"2026-10",
      today:"2026-10-15",
      points,
      shifts,
      format:{esc:value=>String(value)}
    });

    // Finish the initial layout before measuring just the transition.
    void app.offsetWidth;
    await new Promise(requestAnimationFrame);
  });

  await expect(page.locator("[data-control-cell]")).toHaveCount(2480);

  const session=await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const layouts=async()=>{
    const {metrics}=await session.send("Performance.getMetrics");
    return metrics.find(metric=>metric.name==="LayoutCount").value;
  };

  const before=await layouts();

  const motion=await page.evaluate(async()=>{
    const app=document.getElementById("app");
    const animation=app.animate([
      {transform:"translate3d(-24px,0,0)"},
      {transform:"translate3d(0,0,0)"}
    ],{
      duration:220,
      easing:"cubic-bezier(.2,.8,.2,1)",
      fill:"both"
    });

    const first=animation.effect.getKeyframes()[0];
    const duration=animation.effect.getTiming().duration;
    await animation.finished;
    animation.cancel();

    return {
      transform:first.transform,
      animatesLeft:Object.hasOwn(first,"left"),
      duration
    };
  });

  const layoutCount=(await layouts())-before;
  await session.detach();

  expect(motion.transform).toBe("translate3d(-24px, 0px, 0px)");
  expect(motion.animatesLeft).toBe(false);
  expect(motion.duration).toBe(250);
  // Entering/leaving a composited layer may cause a layout at either end.
  expect(layoutCount).toBeLessThanOrEqual(4);
});
