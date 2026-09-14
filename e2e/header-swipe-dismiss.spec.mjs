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

test("every sheet stays rendered for the complete header swipe close",async({page})=>{
  await page.goto(FIXTURE);
  await page.waitForLoadState("networkidle");
  await installGuard(page);

  for(const selector of SHEETS){
    const sheet=page.locator(selector);

    await page.evaluate(selector=>{
      const element=
        document.querySelector(selector);

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

    await page.evaluate(selector=>{
      const element=
        document.querySelector(selector);

      const height=
        element.getBoundingClientRect()
          .height;

      const animation=
        element.animate(
          [
            {
              transform:
                "translate3d(0,72px,0)"
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

    await page.waitForTimeout(340);

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
