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

async function installPicker(page){
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
}

async function openPicker(page){
  return page.evaluate(()=>{
    const element=
      document.getElementById("monthPicker");

    element
      .getAnimations?.()
      .forEach(animation=>animation.cancel());

    /* Match the production prepare/open ordering. */
    element.dispatchEvent(
      new Event("bottomsheetopen")
    );
    element.style.removeProperty("transition");
    element.style.removeProperty("--month-drag");
    element.style.display="block";
    element.classList.remove("on");
    element.setAttribute("aria-hidden","false");
    void element.offsetHeight;
    element.classList.add("on");

    return {
      top:element.getBoundingClientRect().top,
      viewportHeight:window.innerHeight,
      transform:getComputedStyle(element).transform
    };
  });
}

async function swipePickerClosed(page){
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

  /* Safari can report a smaller release Y than the last painted move. */
  await dispatchTouch(
    page,
    HANDLE,
    "touchend",
    {
      x:point.x,
      y:point.y+78
    }
  );

  return draggedTop;
}

test("month picker release continues immediately downward and never re-enters",async({page})=>{
  await installPicker(page);

  await openPicker(page);
  const draggedTop=
    await swipePickerClosed(page);

  const samples=[draggedTop];

  for(const delay of [16,24,36,52,72]){
    await page.waitForTimeout(delay);
    samples.push(await top(page));
  }

  for(let index=1;index<samples.length;index++){
    expect(
      samples[index],
      `month picker moved upward: ${samples.join(", ")}`
    ).toBeGreaterThanOrEqual(
      samples[index-1]-1.5
    );
  }

  /*
    The old implementation waited across requestAnimationFrame boundaries and
    visibly stalled for one or two frames after release. By roughly 40ms the
    close continuation must already have made clear downward progress.
  */
  expect(
    samples[2],
    `month picker stalled after release: ${samples.join(", ")}`
  ).toBeGreaterThan(
    draggedTop+8
  );

  await expect(page.locator(PICKER))
    .not.toHaveClass(/\bon\b/,{
      timeout:800
    });

  for(const delay of [0,24,40,60,90,130,180]){
    await page.waitForTimeout(delay);

    const state=
      await page.locator(PICKER)
        .evaluate(element=>({
          display:
            getComputedStyle(element).display,
          top:
            element.getBoundingClientRect().top,
          viewportHeight:
            window.innerHeight,
          referenceClosing:
            element.getAttribute(
              "data-reference-closing"
            ),
          referenceAnimations:
            element
              .getAnimations()
              .filter(animation=>
                String(animation.id || "")
                  .startsWith(
                    "shift-register-modal-"
                  )
              ).length
        }));

    expect(
      state.display==="none" ||
      state.top>=state.viewportHeight-2,
      `month picker re-entered viewport after swipe close: ${JSON.stringify(state)}`
    ).toBe(true);

    expect(state.referenceClosing)
      .not.toBe("true");

    expect(state.referenceAnimations)
      .toBe(0);
  }
});

test("month picker swipe close then reopen has no fully visible ghost frame",async({page})=>{
  await installPicker(page);

  await openPicker(page);
  await swipePickerClosed(page);

  await expect(page.locator(PICKER))
    .not.toHaveClass(/\bon\b/,{
      timeout:800
    });

  await expect(page.locator(PICKER))
    .toHaveCSS("display","none");

  const closedState=
    await page.locator(PICKER)
      .evaluate(element=>({
        transform:element.style.transform,
        transition:element.style.transition,
        drag:element.style.getPropertyValue(
          "--month-drag"
        ),
        swipeClosing:element.getAttribute(
          "data-month-swipe-closing"
        )
      }));

  expect(closedState.transform).toBe("");
  expect(closedState.transition).toBe("");
  expect(closedState.drag).toBe("");
  expect(closedState.swipeClosing).toBeNull();

  const immediate=await openPicker(page);

  /*
    The reopen must still be staged below the viewport. The previous bug
    cleared modal-motion's hidden transform here, painting the fully-open
    picker for one frame before the real entrance started.
  */
  expect(
    immediate.top,
    `month picker was fully visible before reopen animation: ${JSON.stringify(immediate)}`
  ).toBeGreaterThanOrEqual(
    immediate.viewportHeight-2
  );

  const reopenSamples=
    await page.locator(PICKER)
      .evaluate(element=>
        new Promise(resolve=>{
          const samples=[];
          let remaining=10;

          const sample=()=>{
            samples.push({
              top:element.getBoundingClientRect().top,
              display:getComputedStyle(element).display,
              transform:getComputedStyle(element).transform
            });

            remaining-=1;

            if(remaining<=0){
              resolve(samples);
              return;
            }

            requestAnimationFrame(sample);
          };

          requestAnimationFrame(sample);
        })
      );

  expect(reopenSamples[0].top)
    .toBeGreaterThanOrEqual(
      immediate.viewportHeight-2
    );

  for(let index=1;index<reopenSamples.length;index++){
    expect(
      reopenSamples[index].top,
      `month picker ghosted during reopen: ${JSON.stringify(reopenSamples)}`
    ).toBeLessThanOrEqual(
      reopenSamples[index-1].top+1.5
    );
  }

  await page.waitForTimeout(520);

  await expect(page.locator(PICKER))
    .toHaveClass(/\bon\b/);

  await expect(page.locator(PICKER))
    .toHaveCSS("display","block");
});
