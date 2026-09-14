import { expect, test } from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/reference-motion.html";

const SHEETS=[
  "#sheet",
  "#employeeSheet",
  "#employeeFilterSheet",
  "#shiftFilterSheet",
  "#manageEditorSheet"
];

test.use({
  viewport:{width:390,height:844},
  hasTouch:true,
  colorScheme:"dark"
});

async function installGuard(page){
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

async function openSheet(page,selector){
  await page.evaluate(selector=>{
    const element=
      document.querySelector(selector);

    element.style.removeProperty(
      "transition"
    );
    element.style.removeProperty(
      "--sheet-drag"
    );
    element.style.display="block";
    element.classList.add("on");
    element.setAttribute(
      "aria-hidden",
      "false"
    );
    element.dispatchEvent(
      new CustomEvent(
        "bottomsheetopen"
      )
    );
  },selector);

  await page.waitForTimeout(600);
}

async function startSwipeClose(
  page,
  selector,
  {
    startDistance=72,
    hideAfter=100
  }={}
){
  await page.evaluate(
    ({selector,startDistance,hideAfter})=>{
      const element=
        document.querySelector(selector);

      const height=
        element.getBoundingClientRect()
          .height;

      element.style.setProperty(
        "--sheet-drag",
        `${startDistance}px`
      );
      element.style.transition="none";
      void element.offsetHeight;

      /*
        This matches app.js: transition is restored immediately before the
        WAAPI swipe exit and the modal's .on class is then removed.
      */
      element.style.removeProperty(
        "transition"
      );

      const animation=
        element.animate(
          [
            {
              transform:
                `translate3d(0,${startDistance}px,0)`
            },
            {
              transform:
                `translate3d(0,${height+40}px,0)`
            }
          ],
          {
            duration:420,
            easing:
              "cubic-bezier(.4,0,.2,1)",
            fill:"both"
          }
        );

      animation.id=
        "app-header-swipe-close";

      /*
        app.js cancels its temporary WAAPI animation when it finishes. This
        exact cancellation used to expose the open pose and cause the visible
        up/down rebound from the real-device recording.
      */
      animation.finished
        .catch(()=>{})
        .finally(()=>{
          animation.cancel();
        });

      element.classList.remove("on");
      element.setAttribute(
        "aria-hidden",
        "true"
      );

      window.setTimeout(()=>{
        element.style.display="none";
      },hideAfter);
    },
    {
      selector,
      startDistance,
      hideAfter
    }
  );
}

test("every sheet stays rendered and never rebounds after header swipe release",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");
  await installGuard(page);

  for(const selector of SHEETS){
    const sheet=page.locator(selector);

    await openSheet(page,selector);
    await startSwipeClose(
      page,
      selector
    );

    await page.waitForTimeout(180);

    const duringClose=
      await sheet.evaluate(element=>({
        display:
          getComputedStyle(element)
            .display,
        guard:
          element.getAttribute(
            "data-reference-closing"
          ),
        swipeDuration:
          element
            .getAnimations()
            .find(animation=>
              animation.id===
                "app-header-swipe-close"
            )
            ?.effect
            ?.getTiming()
            ?.duration ?? null
      }));

    expect(
      duringClose.display,
      `${selector} must not disappear 100ms into a header swipe close`
    ).toBe("block");

    expect(duringClose.guard)
      .toBe("true");

    expect(duringClose.swipeDuration)
      .toBe(420);

    /*
      Inspect just after app.js cancels the 420ms swipe animation. The modal
      must already remain below the viewport. Before the fix this is where it
      jumped back upward and started another CSS trip down.
    */
    await page.waitForTimeout(270);

    const afterWaapiRelease=
      await sheet.evaluate(element=>({
        display:
          getComputedStyle(element)
            .display,
        guard:
          element.getAttribute(
            "data-reference-closing"
          ),
        top:
          element.getBoundingClientRect()
            .top,
        viewportHeight:
          window.innerHeight,
        transitionDuration:
          getComputedStyle(element)
            .transitionDuration
      }));

    expect(afterWaapiRelease.display)
      .toBe("block");

    expect(afterWaapiRelease.guard)
      .toBe("true");

    expect(
      afterWaapiRelease.top,
      `${selector} must not rebound into the viewport after WAAPI cancel`
    ).toBeGreaterThanOrEqual(
      afterWaapiRelease.viewportHeight-2
    );

    expect(
      afterWaapiRelease.transitionDuration
        .split(",")
        .every(value=>
          Number.parseFloat(value)===0
        )
    ).toBe(true);

    await page.waitForTimeout(100);

    const afterClose=
      await sheet.evaluate(element=>({
        display:
          getComputedStyle(element)
            .display,
        guarded:
          element.hasAttribute(
            "data-reference-closing"
          )
      }));

    expect(afterClose.guarded)
      .toBe(false);

    expect(afterClose.display)
      .toBe("none");
  }
});

test("swipe exit continues from the exact painted release position",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");
  await installGuard(page);

  const selector="#sheet";
  const sheet=page.locator(selector);

  await openSheet(page,selector);

  const releaseTop=
    await sheet.evaluate(element=>{
      element.style.transition="none";
      element.style.setProperty(
        "--sheet-drag",
        "180px"
      );
      void element.offsetHeight;

      return element
        .getBoundingClientRect()
        .top;
    });

  await page.locator(
    `${selector} .shead`
  ).dispatchEvent(
    "pointerup",
    {
      pointerId:17,
      pointerType:"pen",
      isPrimary:true,
      clientX:195,
      clientY:240
    }
  );

  /* Deliberately give the app animation a wrong first keyframe. */
  await page.evaluate(selector=>{
    const element=
      document.querySelector(selector);

    const height=
      element.getBoundingClientRect()
        .height;

    element.style.removeProperty(
      "transition"
    );

    const animation=
      element.animate(
        [
          {
            transform:
              "translate3d(0,40px,0)"
          },
          {
            transform:
              `translate3d(0,${height+40}px,0)`
          }
        ],
        {
          duration:420,
          easing:
            "cubic-bezier(.4,0,.2,1)",
          fill:"both"
        }
      );

    animation.id=
      "app-header-swipe-close";

    animation.finished
      .catch(()=>{})
      .finally(()=>{
        animation.cancel();
      });

    element.classList.remove("on");
    element.setAttribute(
      "aria-hidden",
      "true"
    );

    window.setTimeout(()=>{
      element.style.display="none";
    },500);
  },selector);

  await page.waitForTimeout(34);

  const firstExitFrame=
    await sheet.evaluate(element=>({
      top:
        element.getBoundingClientRect()
          .top,
      guard:
        element.getAttribute(
          "data-reference-closing"
        )
    }));

  expect(firstExitFrame.guard)
    .toBe("true");

  expect(
    firstExitFrame.top,
    "release must continue downward from the painted finger position"
  ).toBeGreaterThanOrEqual(
    releaseTop-2
  );
});
