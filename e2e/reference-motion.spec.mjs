import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/reference-motion.html";

const SLIDING_SURFACES=Object.freeze([
  {selector:"#sheet", transformDuration:480, opacityDuration:300},
  {selector:"#employeeSheet", transformDuration:480, opacityDuration:300},
  {selector:"#employeeFilterSheet", transformDuration:480, opacityDuration:300},
  {selector:"#shiftFilterSheet", transformDuration:480, opacityDuration:300},
  {selector:"#manageEditorSheet", transformDuration:480, opacityDuration:300},
  {selector:"#pointPicker", transformDuration:420, opacityDuration:270},
  {selector:"#monthPicker", transformDuration:420, opacityDuration:0},
  {selector:"#datePicker", transformDuration:420, opacityDuration:270}
]);

test.use({
  viewport:{width:390,height:844},
  hasTouch:true,
  colorScheme:"dark"
});

function includesDuration(value,seconds){
  return value
    .split(",")
    .map(item=>item.trim())
    .includes(`${seconds}s`);
}

async function referenceAnimations(locator){
  return locator.evaluate(element=>
    element
      .getAnimations()
      .filter(animation=>
        String(animation.id || "")
          .startsWith(
            "shift-register-modal-"
          )
      )
      .map(animation=>({
        id:String(animation.id || ""),
        duration:Number(
          animation.effect
            .getTiming()
            .duration
        )
      }))
  );
}

async function openSurface(page,selector){
  await page.evaluate(selector=>{
    const element=
      document.querySelector(selector);

    element.classList.remove("on");
    element.style.display="block";
    element.setAttribute(
      "aria-hidden",
      "true"
    );

    void element.offsetHeight;

    element.dispatchEvent(
      new CustomEvent(
        "bottomsheetopen"
      )
    );

    element.classList.add("on");
    element.setAttribute(
      "aria-hidden",
      "false"
    );
  },selector);
}

async function closeSurface(page,selector){
  await page.evaluate(selector=>{
    const element=
      document.querySelector(selector);

    element.classList.remove("on");
    element.setAttribute(
      "aria-hidden",
      "true"
    );
  },selector);
}

test("reference motion timings match shift-register and animate visibly",async({page},testInfo)=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  await expect(page.locator("html"))
    .toHaveAttribute(
      "data-modal-motion",
      "shift-register"
    );

  const timings=await page.evaluate(()=>{
    const read=selector=>
      getComputedStyle(
        document.querySelector(selector)
      );

    return {
      sheet:read(".sheet").transitionDuration,
      veil:read(".veil").transitionDuration,
      point:read(".point-picker").transitionDuration,
      month:read(".month-picker").transitionDuration,
      confirm:read(".app-confirm-box").transitionDuration,
      toast:read(".toast").transitionDuration,
      monthVariable:
        getComputedStyle(document.documentElement)
          .getPropertyValue("--motion-month")
          .trim()
    };
  });

  expect(includesDuration(timings.sheet,.48)).toBe(true);
  expect(includesDuration(timings.veil,.34)).toBe(true);
  expect(includesDuration(timings.point,.42)).toBe(true);
  expect(includesDuration(timings.month,.42)).toBe(true);
  expect(includesDuration(timings.confirm,.24)).toBe(true);
  expect(includesDuration(timings.toast,.22)).toBe(true);
  expect(timings.monthVariable).toBe("320ms");

  await page.locator("#openSheet").click();
  await page.waitForTimeout(90);

  const openingAnimations=
    await referenceAnimations(
      page.locator("#sheet")
    );

  expect(openingAnimations).toContainEqual({
    id:"shift-register-modal-transform",
    duration:480
  });

  expect(openingAnimations).toContainEqual({
    id:"shift-register-modal-opacity",
    duration:300
  });

  const middle=await page.locator("#sheet").evaluate(element=>({
    transform:getComputedStyle(element).transform,
    opacity:Number(getComputedStyle(element).opacity)
  }));

  expect(middle.transform).not.toBe("none");
  expect(middle.transform).not.toBe("matrix(1, 0, 0, 1, 0, 0)");
  expect(middle.opacity).toBeGreaterThan(.95);

  await page.waitForTimeout(500);
  await expect(page.locator("#sheet")).toHaveClass(/\bon\b/);

  await page.screenshot({
    path:testInfo.outputPath("reference-motion-sheet.png"),
    fullPage:false
  });

  await page.locator("#closeSheet").click();
  await page.waitForTimeout(60);

  const closingAnimations=
    await referenceAnimations(
      page.locator("#sheet")
    );

  expect(closingAnimations).toContainEqual({
    id:"shift-register-modal-transform",
    duration:480
  });

  expect(closingAnimations).toContainEqual({
    id:"shift-register-modal-opacity",
    duration:300
  });

  const firstTab=page.locator("nav.tabs button").first();
  await firstTab.evaluate(element=>element.classList.add("touch-active"));
  await page.waitForTimeout(150);

  const pressedTransform=await firstTab.evaluate(element=>
    getComputedStyle(element).transform
  );

  expect(pressedTransform).not.toBe("none");

  await firstTab.evaluate(element=>element.classList.remove("touch-active"));

  await page.locator("#openConfirm").click();
  await page.waitForTimeout(280);

  await page.screenshot({
    path:testInfo.outputPath("reference-motion-confirm.png"),
    fullPage:false
  });
});

test("every sliding window opens and closes with the same reference speed",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  for(const surface of SLIDING_SURFACES){
    const locator=
      page.locator(surface.selector);

    await openSurface(
      page,
      surface.selector
    );

    await page.waitForTimeout(90);

    const openingAnimations=
      await referenceAnimations(locator);

    const openingTransform=
      openingAnimations.find(animation=>
        animation.id===
          "shift-register-modal-transform"
      );

    expect(
      openingTransform,
      `${surface.selector} must animate while opening`
    ).toBeTruthy();

    expect(openingTransform.duration)
      .toBe(surface.transformDuration);

    if(surface.opacityDuration){
      expect(openingAnimations)
        .toContainEqual({
          id:"shift-register-modal-opacity",
          duration:surface.opacityDuration
        });
    }

    const openingState=
      await locator.evaluate(element=>({
        transform:
          getComputedStyle(element)
            .transform,
        top:
          element.getBoundingClientRect()
            .top
      }));

    expect(openingState.transform)
      .not.toBe("none");

    expect(openingState.transform)
      .not.toBe(
        "matrix(1, 0, 0, 1, 0, 0)"
      );

    await page.waitForTimeout(
      surface.transformDuration+80
    );

    await closeSurface(
      page,
      surface.selector
    );

    await page.waitForTimeout(60);

    const closingAnimations=
      await referenceAnimations(locator);

    const closingTransform=
      closingAnimations.find(animation=>
        animation.id===
          "shift-register-modal-transform"
      );

    expect(
      closingTransform,
      `${surface.selector} must animate while closing`
    ).toBeTruthy();

    expect(closingTransform.duration)
      .toBe(openingTransform.duration);

    if(surface.opacityDuration){
      expect(closingAnimations)
        .toContainEqual({
          id:"shift-register-modal-opacity",
          duration:surface.opacityDuration
        });
    }

    const closingState=
      await locator.evaluate(element=>
        getComputedStyle(element)
          .transform
      );

    expect(closingState)
      .not.toBe("none");

    expect(closingState)
      .not.toBe(
        "matrix(1, 0, 0, 1, 0, 0)"
      );

    await page.waitForTimeout(
      surface.transformDuration+80
    );

    await page.evaluate(selector=>{
      const element=
        document.querySelector(selector);

      element.style.display="none";
    },surface.selector);
  }
});

test("PВZ editor cannot be hidden before its 480ms close motion finishes",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  const selector="#manageEditorSheet";
  const locator=page.locator(selector);

  await openSurface(page,selector);
  await page.waitForTimeout(600);

  await page.evaluate(selector=>{
    const element=
      document.querySelector(selector);

    element.classList.remove("on");
    element.setAttribute(
      "aria-hidden",
      "true"
    );

    window.setTimeout(()=>{
      element.style.display="none";
    },100);
  },selector);

  await page.waitForTimeout(180);

  const duringClose=
    await locator.evaluate(element=>({
      display:getComputedStyle(element).display,
      closing:
        element.getAttribute(
          "data-reference-closing"
        ),
      transform:getComputedStyle(element).transform
    }));

  expect(duringClose.display).toBe("block");
  expect(duringClose.closing).toBe("true");
  expect(duringClose.transform).not.toBe("none");
  expect(duringClose.transform)
    .not.toBe("matrix(1, 0, 0, 1, 0, 0)");

  const animations=
    await referenceAnimations(locator);

  expect(animations).toContainEqual({
    id:"shift-register-modal-transform",
    duration:480
  });

  await page.waitForTimeout(380);

  const afterClose=
    await locator.evaluate(element=>({
      display:getComputedStyle(element).display,
      closing:
        element.hasAttribute(
          "data-reference-closing"
        )
    }));

  expect(afterClose.display).toBe("none");
  expect(afterClose.closing).toBe(false);
});

test("reduced motion leaves every sliding window immediately usable",async({page})=>{
  await page.emulateMedia({
    reducedMotion:"reduce"
  });

  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");

  for(const surface of SLIDING_SURFACES){
    const locator=
      page.locator(surface.selector);

    const durations=
      await locator.evaluate(element=>
        getComputedStyle(element)
          .transitionDuration
          .split(",")
          .map(value=>
            Number.parseFloat(value)
          )
      );

    expect(Math.max(...durations))
      .toBeLessThan(.01);

    await openSurface(
      page,
      surface.selector
    );

    await page.waitForTimeout(30);

    const state=
      await locator.evaluate(element=>({
        animations:
          element
            .getAnimations()
            .filter(animation=>
              String(animation.id || "")
                .startsWith(
                  "shift-register-modal-"
                )
            ).length,
        rect:
          element.getBoundingClientRect(),
        viewportHeight:
          window.innerHeight
      }));

    expect(state.animations).toBe(0);
    expect(state.rect.top)
      .toBeLessThan(state.viewportHeight);
    expect(state.rect.bottom)
      .toBeLessThanOrEqual(
        state.viewportHeight+1
      );

    await closeSurface(
      page,
      surface.selector
    );

    await page.waitForTimeout(10);

    await page.evaluate(selector=>{
      const element=
        document.querySelector(selector);

      element.style.display="none";
    },surface.selector);
  }
});
