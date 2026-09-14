import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/reference-swipes.html";

test.use({
  viewport:{width:390,height:844},
  hasTouch:true,
  colorScheme:"dark"
});

async function pointerSwipe(
  page,
  selector,
  {
    pointerType="touch",
    fromX=300,
    toX=240,
    fromY=120,
    toY=120,
    pointerId=17
  }={}
){
  await page.locator(selector).evaluate(
    (element,options)=>{
      const dispatch=(type,x,y,buttons)=>{
        element.dispatchEvent(
          new PointerEvent(
            type,
            {
              bubbles:true,
              cancelable:true,
              pointerId:options.pointerId,
              pointerType:options.pointerType,
              isPrimary:true,
              clientX:x,
              clientY:y,
              button:0,
              buttons
            }
          )
        );
      };

      dispatch(
        "pointerdown",
        options.fromX,
        options.fromY,
        1
      );

      dispatch(
        "pointermove",
        options.toX,
        options.toY,
        1
      );

      dispatch(
        "pointerup",
        options.toX,
        options.toY,
        0
      );
    },
    {
      pointerType,
      fromX,
      toX,
      fromY,
      toY,
      pointerId
    }
  );
}

test("month and date year grids use the shift-register touch/pen swipe thresholds",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await expect(page.locator("html"))
    .toHaveAttribute(
      "data-reference-swipes",
      "shift-register"
    );

  await pointerSwipe(
    page,
    "#monthGrid",
    {fromX:300,toX:250}
  );

  await pointerSwipe(
    page,
    "#monthGrid",
    {
      fromX:250,
      toX:300,
      pointerId:18
    }
  );

  await pointerSwipe(
    page,
    "#dateJumpMonths",
    {
      fromX:300,
      toX:250,
      pointerId:19
    }
  );

  const counters=await page.evaluate(
    ()=>window.swipeCounters
  );

  expect(counters.monthNextYear).toBe(1);
  expect(counters.monthPrevYear).toBe(1);
  expect(counters.dateNextYear).toBe(1);
  expect(counters.legacyMonthYear).toBe(0);
  expect(counters.legacyDateYear).toBe(0);
});

test("whole-picker and mouse horizontal drags no longer change years",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await pointerSwipe(
    page,
    "#monthHead",
    {fromX:300,toX:240}
  );

  await pointerSwipe(
    page,
    "#monthGrid",
    {
      pointerType:"mouse",
      fromX:300,
      toX:240,
      pointerId:22
    }
  );

  await pointerSwipe(
    page,
    "#dateJumpHead",
    {
      fromX:300,
      toX:240,
      pointerId:23
    }
  );

  const counters=await page.evaluate(
    ()=>window.swipeCounters
  );

  expect(counters.monthNextYear).toBe(0);
  expect(counters.monthPrevYear).toBe(0);
  expect(counters.dateNextYear).toBe(0);
  expect(counters.datePrevYear).toBe(0);
  expect(counters.legacyMonthYear).toBe(0);
  expect(counters.legacyDateYear).toBe(0);
});

test("extra desktop pointer and wheel month navigation is suppressed to match shift-register",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await pointerSwipe(
    page,
    "#app",
    {
      pointerType:"mouse",
      fromX:300,
      toX:230,
      pointerId:31
    }
  );

  await page.locator("#app").evaluate(element=>{
    element.dispatchEvent(
      new WheelEvent(
        "wheel",
        {
          bubbles:true,
          cancelable:true,
          deltaX:70,
          deltaY:2
        }
      )
    );
  });

  const counters=await page.evaluate(
    ()=>window.swipeCounters
  );

  expect(counters.legacyMainPointerMove).toBe(0);
  expect(counters.legacyMainPointerUp).toBe(0);
  expect(counters.legacyWheel).toBe(0);
});
