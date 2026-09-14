import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/team-motion.html";

test.use({
  viewport:{width:390,height:844},
  hasTouch:true,
  colorScheme:"dark"
});

test("team tab motion now uses the exact shift-register route timing",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const result=await page.evaluate(()=>{
    const app=document.getElementById("app");
    const animation=app.animate(
      [
        {transform:"translate3d(24px,0,0)"},
        {transform:"translate3d(0,0,0)"}
      ],
      {
        duration:220,
        easing:"cubic-bezier(.2,.8,.2,1)",
        fill:"both"
      }
    );

    const timing=animation.effect.getTiming();
    const frames=animation.effect.getKeyframes();
    animation.cancel();

    return {
      duration:timing.duration,
      easing:timing.easing,
      firstLeft:frames[0].left,
      lastLeft:frames.at(-1).left
    };
  });

  expect(result.duration).toBe(250);
  expect(result.easing).toBe("cubic-bezier(0.22, 0.72, 0.22, 1)");
  expect(result.firstLeft).toBe("24px");
  expect(result.lastLeft).toBe("0px");
});

test("management navigation uses the same 320ms slide-fade language as shift-register month motion",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const result=await page.evaluate(()=>{
    const app=document.getElementById("app");
    const animation=app.animate(
      [
        {opacity:0,transform:"translate3d(20px,0,0)"},
        {opacity:1,transform:"translate3d(0,0,0)"}
      ],
      {
        duration:260,
        easing:"cubic-bezier(.22,.72,.22,1)",
        fill:"both"
      }
    );

    const timing=animation.effect.getTiming();
    const frames=animation.effect.getKeyframes();
    animation.cancel();

    return {
      duration:timing.duration,
      firstTransform:frames[0].transform
    };
  });

  expect(result.duration).toBe(320);
  expect(result.firstTransform).toContain("28px");
});

test("employee view to edit and back visibly animate instead of replacing content abruptly",async({page},testInfo)=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await page.locator("#employeeSheetSave").click();
  await page.waitForTimeout(40);

  const forward=await page.locator("#employeeSheetBody").evaluate(element=>{
    const animation=element.getAnimations()[0];
    if(!animation) return null;

    const timing=animation.effect.getTiming();
    const frames=animation.effect.getKeyframes();

    return {
      duration:timing.duration,
      firstOpacity:frames[0].opacity,
      firstTransform:frames[0].transform
    };
  });

  expect(forward).not.toBeNull();
  expect(forward.duration).toBe(260);
  expect(Number(forward.firstOpacity)).toBeCloseTo(.18,2);
  expect(forward.firstTransform).toContain("14px");
  await expect(page.locator("#employeeSheetTitle")).toHaveText("Редактирование");

  await page.screenshot({
    path:testInfo.outputPath("team-motion-edit-mid.png"),
    fullPage:false
  });

  await page.waitForTimeout(280);
  await page.locator("#employeeSheetCancel").click();
  await page.waitForTimeout(40);

  const back=await page.locator("#employeeSheetBody").evaluate(element=>{
    const animation=element.getAnimations()[0];
    if(!animation) return null;
    return animation.effect.getKeyframes()[0].transform;
  });

  expect(back).toContain("-14px");
  await expect(page.locator("#employeeSheetTitle")).toHaveText("Сотрудник");
});

test("stats month ghost keeps the exact live vertical geometry after clone ids are stripped",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const result=await page.evaluate(()=>{
    document.body.dataset.activeTab="stats";

    const app=document.getElementById("app");
    app.innerHTML=`
      <div class="ml">Фильтры</div>
      <div class="card">
        <button class="row stats-filter-row" type="button">
          <span class="t">Сотрудник</span>
          <span class="point-value">Все сотрудники</span>
        </button>
      </div>
      <div class="ml">Начислено</div>
      <div class="card hero"><div class="n">0</div></div>
    `;

    const ghost=app.cloneNode(true);
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id]").forEach(node=>node.removeAttribute("id"));
    ghost.setAttribute("aria-hidden","true");
    ghost.setAttribute("inert","");
    document.body.append(ghost);

    const liveLabel=app.children[0];
    const ghostLabel=ghost.children[0];
    const liveFilter=app.children[1];
    const ghostFilter=ghost.children[1];
    const liveNextLabel=app.children[2];
    const ghostNextLabel=ghost.children[2];

    const liveRect=liveNextLabel.getBoundingClientRect();
    const ghostRect=ghostNextLabel.getBoundingClientRect();

    const values={
      liveLabelDisplay:getComputedStyle(liveLabel).display,
      ghostLabelDisplay:getComputedStyle(ghostLabel).display,
      liveFilterBorder:getComputedStyle(liveFilter).borderTopWidth,
      ghostFilterBorder:getComputedStyle(ghostFilter).borderTopWidth,
      liveFilterBackground:getComputedStyle(liveFilter).backgroundColor,
      ghostFilterBackground:getComputedStyle(ghostFilter).backgroundColor,
      verticalDelta:Math.abs(liveRect.top-ghostRect.top)
    };

    ghost.remove();
    return values;
  });

  expect(result.liveLabelDisplay).toBe("none");
  expect(result.ghostLabelDisplay).toBe("none");
  expect(result.ghostFilterBorder).toBe(result.liveFilterBorder);
  expect(result.ghostFilterBackground).toBe(result.liveFilterBackground);
  expect(result.verticalDelta).toBeLessThanOrEqual(0.5);
});

test("reduced motion disables the added editor transition",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await page.locator("#employeeSheetSave").click();
  await page.waitForTimeout(40);

  const count=await page.locator("#employeeSheetBody").evaluate(element=>
    element.getAnimations().length
  );

  expect(count).toBe(0);
});
