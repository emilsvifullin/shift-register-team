import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/reference-motion.html";

const PICKER="#monthPicker";
const HANDLE="#monthPickerHandle";

test.use({
  viewport:{width:390,height:844},
  hasTouch:true,
  colorScheme:"dark"
});

async function dispatchTouch(
  page,
  selector,
  type,
  {x,y,id=17}
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

async function top(page){
  return page.locator(PICKER)
    .evaluate(element=>
      element.getBoundingClientRect().top
    );
}

test("month picker continues from the last painted drag position on release",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await page.evaluate(()=>{
    const element=
      document.getElementById("monthPicker");

    element.innerHTML=`
      <div class="month-picker-handle" id="monthPickerHandle">
        <div class="month-picker-grab"></div>
      </div>
      <div class="picker-toolbar">
        <button type="button" class="picker-toolbar-btn cancel" id="monthCancel">Отмена</button>
        <div class="picker-toolbar-title">Выберите месяц</div>
        <button type="button" class="picker-toolbar-btn done">Готово</button>
      </div>
      <div style="height:320px"></div>
    `;

    document
      .getElementById("monthCancel")
      .addEventListener("click",()=>{
        element.classList.remove("on");
        element.setAttribute("aria-hidden","true");
      });
  });

  await page.addScriptTag({
    type:"module",
    url:
      "http://127.0.0.1:4173/src/month-picker-swipe.js"
  });

  await expect(page.locator("html"))
    .toHaveAttribute(
      "data-month-picker-swipe",
      "ready"
    );

  await page.evaluate(()=>{
    const element=
      document.getElementById("monthPicker");

    element.style.display="block";
    element.dispatchEvent(
      new CustomEvent("bottomsheetopen")
    );
    element.classList.add("on");
    element.setAttribute("aria-hidden","false");
  });

  await page.waitForTimeout(520);

  const box=
    await page.locator(HANDLE)
      .boundingBox();

  const point={
    x:box.x+box.width/2,
    y:box.y+box.height/2
  };

  await dispatchTouch(
    page,
    HANDLE,
    "touchstart",
    point
  );

  await dispatchTouch(
    page,
    HANDLE,
    "touchmove",
    {
      x:point.x,
      y:point.y+140
    }
  );

  await page.waitForTimeout(24);
  const draggedTop=await top(page);

  /*
    Simulate the Safari case that caused the bug: changedTouches on touchend
    reports a smaller Y than the last painted touchmove. Closing must ignore
    that corrected release coordinate and continue from the visible position.
  */
  await dispatchTouch(
    page,
    HANDLE,
    "touchend",
    {
      x:point.x,
      y:point.y+78
    }
  );

  const samples=[draggedTop];

  for(const delay of [16,24,36,52,72]){
    await page.waitForTimeout(delay);
    samples.push(await top(page));
  }

  for(let index=1;index<samples.length;index++){
    expect(
      samples[index],
      `month picker jumped upward: ${samples.join(", ")}`
    ).toBeGreaterThanOrEqual(
      samples[index-1]-1.5
    );
  }

  expect(samples[1])
    .toBeGreaterThanOrEqual(
      draggedTop-1.5
    );

  await page.waitForTimeout(420);

  await expect(page.locator(PICKER))
    .not.toHaveClass(/\bon\b/);
});
