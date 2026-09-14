import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/reference-motion.html";

const SHEET="#sheet";
const HEADER="#sheet .ttl";

test.use({
  viewport:{width:390,height:844},
  hasTouch:true,
  colorScheme:"dark"
});

async function installSwipeController(page){
  await page.addScriptTag({
    type:"module",
    url:
      "http://127.0.0.1:4173/src/swipe-close-guard.js"
  });

  await expect(page.locator("html"))
    .toHaveAttribute(
      "data-swipe-close-guard",
      "ready"
    );
}

async function openSheet(page){
  await page.locator("#openSheet").click();
  await page.waitForTimeout(560);
  await expect(page.locator(SHEET))
    .toHaveClass(/\bon\b/);
}

async function dispatchTouch(
  page,
  selector,
  type,
  {x,y,id=11}
){
  await page.evaluate(
    ({selector,type,x,y,id})=>{
      const target=
        document.querySelector(selector);

      const touch={
        identifier:id,
        clientX:x,
        clientY:y
      };

      const event=new Event(
        type,
        {
          bubbles:true,
          cancelable:true,
          composed:true
        }
      );

      Object.defineProperties(
        event,
        {
          touches:{
            value:
              type==="touchend" ||
              type==="touchcancel"
                ? []
                : [touch]
          },
          changedTouches:{
            value:[touch]
          }
        }
      );

      target.dispatchEvent(event);
    },
    {selector,type,x,y,id}
  );
}

async function headerPoint(page){
  const box=
    await page.locator(HEADER)
      .boundingBox();

  return {
    x:box.x+box.width/2,
    y:box.y+box.height/2
  };
}

async function sheetTop(page){
  return page.locator(SHEET)
    .evaluate(element=>
      element.getBoundingClientRect().top
    );
}

test("header swipe release continues downward without an upward rebound",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");
  await installSwipeController(page);
  await openSheet(page);

  const point=await headerPoint(page);

  await dispatchTouch(
    page,
    HEADER,
    "touchstart",
    point
  );

  await dispatchTouch(
    page,
    HEADER,
    "touchmove",
    {
      x:point.x,
      y:point.y+140
    }
  );

  await page.waitForTimeout(24);

  const draggedTop=await sheetTop(page);

  await dispatchTouch(
    page,
    HEADER,
    "touchend",
    {
      x:point.x,
      y:point.y+140
    }
  );

  await page.waitForTimeout(24);

  const activeAnimation=
    await page.locator(SHEET)
      .evaluate(element=>{
        const animation=
          element.getAnimations()
            .find(item=>
              item.id===
                "header-swipe-dismiss"
            );

        return animation
          ? Number(
              animation.effect
                .getTiming()
                .duration
            )
          : null;
      });

  expect(activeAnimation).toBe(420);

  const samples=[draggedTop];

  for(const delay of [16,28,44,64,84,84]){
    await page.waitForTimeout(delay);
    samples.push(await sheetTop(page));
  }

  for(let index=1;index<samples.length;index++){
    expect(
      samples[index],
      `sheet moved upward after release: ${samples.join(", ")}`
    ).toBeGreaterThanOrEqual(
      samples[index-1]-1.5
    );
  }

  expect(samples[1])
    .toBeGreaterThanOrEqual(
      draggedTop-1.5
    );

  await page.waitForTimeout(160);

  const closedState=
    await page.locator(SHEET)
      .evaluate(element=>({
        open:
          element.classList.contains("on"),
        top:
          element.getBoundingClientRect().top,
        viewportHeight:
          window.innerHeight,
        swipeAnimations:
          element.getAnimations()
            .filter(animation=>
              animation.id===
                "header-swipe-dismiss"
            ).length,
        referenceAnimations:
          element.getAnimations()
            .filter(animation=>
              String(animation.id || "")
                .startsWith(
                  "shift-register-modal-"
                )
            ).length
      }));

  expect(closedState.open).toBe(false);
  expect(closedState.swipeAnimations).toBe(0);
  expect(closedState.referenceAnimations).toBe(0);
  expect(closedState.top)
    .toBeGreaterThanOrEqual(
      closedState.viewportHeight-2
    );
});

test("short header drag returns to the same open position and does not close",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");
  await installSwipeController(page);
  await openSheet(page);

  const point=await headerPoint(page);
  const openTop=await sheetTop(page);

  await dispatchTouch(
    page,
    HEADER,
    "touchstart",
    point
  );

  await dispatchTouch(
    page,
    HEADER,
    "touchmove",
    {
      x:point.x,
      y:point.y+18
    }
  );

  await page.waitForTimeout(30);

  const draggedTop=await sheetTop(page);

  expect(draggedTop)
    .toBeGreaterThan(openTop+8);

  await dispatchTouch(
    page,
    HEADER,
    "touchend",
    {
      x:point.x,
      y:point.y+18
    }
  );

  await page.waitForTimeout(470);

  const state=
    await page.locator(SHEET)
      .evaluate(element=>({
        open:
          element.classList.contains("on"),
        top:
          element.getBoundingClientRect().top,
        drag:
          element.style.getPropertyValue(
            "--sheet-drag"
          ),
        transition:
          element.style.getPropertyValue(
            "transition"
          )
      }));

  expect(state.open).toBe(true);
  expect(Math.abs(state.top-openTop))
    .toBeLessThanOrEqual(2);
  expect(state.drag).toBe("");
  expect(state.transition).toBe("");
});

test("normal modal buttons stay untouched by the swipe controller",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");
  await installSwipeController(page);
  await openSheet(page);

  await page.locator("#closeSheet").click();

  await expect(page.locator(SHEET))
    .not.toHaveClass(/\bon\b/);
});
