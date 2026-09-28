import {
  test,
  expect
} from "@playwright/test";

import {
  ADMIN_SEED,
  FROZEN_TODAY,
  openApp
} from "./support/supabase-stub.mjs";

/*
  Состояния нажатия и режимы выбора.

  Любая кнопка раньше заливалась при нажатии серым прямоугольником
  (inset 999px), и у текстовых действий без фона он выглядел случайной
  рамкой фокуса. Здесь закреплено, что у каждого вида элемента одна
  реакция — одинаковая для мыши и пальца, — а рамка остаётся только у
  фокуса с клавиатуры. И что режимы выбора в реестре и календаре собраны
  из одних и тех же частей.
*/

const YEAR=FROZEN_TODAY.getFullYear();

const MONTH=String(
  FROZEN_TODAY.getMonth()+1
).padStart(2,"0");

const day=number=>
  `${YEAR}-${MONTH}-${String(number).padStart(2,"0")}`;

function seed(){
  const source=structuredClone(ADMIN_SEED);
  const point=source.points.find(item=>item.id==="point-2");
  const employee=source.employees[0];

  source.shifts=[2,3,5,8].map(number=>({
    id:`shift-${number}`,
    employee_id:employee.id,
    shift_date:day(number),
    point_id:point.id,
    shift_type:"main",
    shk:null,
    partial:false,
    hours:null,
    full_hours:12,
    base_amount:3000,
    pricing_snapshot:{
      version:2,
      fixed:true,
      pricingType:"fixed",
      rate:3000,
      fullHours:12
    },
    note:"",
    employee:{
      id:employee.id,
      user_id:employee.user_id,
      full_name:employee.full_name,
      status:employee.status
    },
    point:{...point},
    bonuses:[],
    penalties:[]
  }));

  return source;
}

function look(locator){
  return locator.evaluate(element=>{
    const style=getComputedStyle(element);

    return {
      shadow:style.boxShadow,
      background:style.backgroundColor,
      opacity:Number(style.opacity),
      outline:style.outlineStyle==="none" ||
        parseFloat(style.outlineWidth)===0
        ? "none"
        : style.outlineStyle
    };
  });
}

/* Нажать и держать, снять состояние, увести курсор и отпустить мимо. */
async function pressedLook(page,locator){
  const box=await locator.boundingBox();

  await page.mouse.move(
    box.x+box.width/2,
    box.y+box.height/2
  );

  await page.mouse.down();
  await page.waitForTimeout(250);

  const state=await look(locator);

  await page.mouse.move(1,1);
  await page.mouse.up();

  return state;
}

/*
  «Итоги» в режиме «Все сотрудники» с раскрытой первой половиной
  месяца: там и отчёты, и действия периода.
*/
async function openStats(page){
  await page.locator("#tab-stats").click();

  const row=page.locator(".payroll-period").first();

  await row.locator("[data-payout-toggle]").click();

  await expect
    .poll(()=>row.evaluate(node=>
      node.getAnimations({subtree:true}).length
    ))
    .toBe(0);
}

test.describe("mouse",()=>{
  test.use({
    viewport:{width:1440,height:1000}
  });

  test(
    "text actions fade on press and never get a box",
    async({page})=>{
      await openApp(page,{seed:seed()});

      const checks=[
        ["registry toggle","#shiftSelectToggle"]
      ];

      for(const [,selector] of checks){
        const state=await pressedLook(page,page.locator(selector));

        expect(state.shadow).toBe("none");
        expect(state.background).toBe("rgba(0, 0, 0, 0)");
        expect(state.opacity).toBeLessThan(1);
      }

      await page.locator('[data-shift-view="calendar"]').click();

      const pick=await pressedLook(
        page,
        page.locator("[data-calendar-pick-mode]")
      );

      expect(pick.shadow).toBe("none");
      expect(pick.opacity).toBeLessThan(1);

      /* Клетка календаря прожимается, но не сереет поверх своего цвета. */
      const cell=await pressedLook(
        page,
        page.locator(`[data-calendar-day="${day(4)}"]`)
      );

      expect(cell.shadow).toBe("none");

      await openStats(page);

      for(const link of await page.locator(".payroll-report-link").all()){
        const state=await pressedLook(page,link);

        expect(state.shadow).toBe("none");
        expect(state.background).toBe("rgba(0, 0, 0, 0)");
      }

      /* Кнопка с поверхностью прожимается, но тоже без заливки. */
      const action=await pressedLook(
        page,
        page.locator(".payroll-action").first()
      );

      expect(action.shadow).toBe("none");
    }
  );

  /*
    После настоящего клика ни в один момент не появляется рамка: ни
    сразу, ни после перерисовки, которую клик вызвал.
  */
  test(
    "a click leaves no outline behind, before or after the redraw",
    async({page})=>{
      await openApp(page,{seed:seed()});

      const toggle=page.locator("#shiftSelectToggle");

      const samples=[];

      await toggle.click();

      for(const delay of [0,60,160,400]){
        await page.waitForTimeout(delay);
        samples.push(await look(toggle));
      }

      await expect(toggle).toHaveText("Готово");

      for(const state of samples){
        expect(state.outline).toBe("none");
        expect(state.shadow).toBe("none");
      }

      await page.locator('[data-shift-view="calendar"]').click();

      const pick=page.locator("[data-calendar-pick-mode]");

      await pick.click();
      await page.waitForTimeout(200);

      expect(await look(pick)).toMatchObject({
        outline:"none",
        shadow:"none"
      });
    }
  );

  /*
    Вход в выбор дней и выход из него ничего не двигают: календарь и
    панель стоят на месте, меняется только их содержимое.
  */
  test(
    "entering and leaving day picking does not move the calendar",
    async({page})=>{
      await openApp(page,{seed:seed()});
      await page.locator('[data-shift-view="calendar"]').click();

      const geometry=()=>page.evaluate(()=>{
        const box=selector=>{
          const rect=document
            .querySelector(selector)
            .getBoundingClientRect();

          return [
            Math.round(rect.top),
            Math.round(rect.height)
          ];
        };

        return {
          grid:box(".sv-grid"),
          panel:box(".sv-panel"),
          toggle:box("[data-calendar-pick-mode]")[0]
        };
      });

      const before=await geometry();

      await page.locator("[data-calendar-pick-mode]").click();

      expect(await geometry()).toEqual(before);

      await page.locator("[data-calendar-pick-mode]").click();

      expect(await geometry()).toEqual(before);
    }
  );
});

test.describe("keyboard",()=>{
  test.use({
    viewport:{width:1440,height:1000}
  });

  test(
    "keyboard focus stays clearly visible on the same controls",
    async({page,browserName})=>{
      await openApp(page,{seed:seed()});

      /*
        Safari и WebKit по умолчанию переводят Tab только по полям ввода;
        по кнопкам ходят с Option. Проверяется приложение, а не эта
        настройка, поэтому клавиша берётся та, что ходит по кнопкам.
      */
      const next=browserName==="webkit" ? "Alt+Tab" : "Tab";

      const toggle=page.locator("#shiftSelectToggle");

      /* Любая клавиша переводит приложение в клавиатурный режим. */
      await page.keyboard.press("Escape");
      await toggle.focus();

      await expect(toggle).toBeFocused();

      const ring=await toggle.evaluate(element=>{
        const style=getComputedStyle(element);

        return {
          style:style.outlineStyle,
          width:style.outlineWidth,
          radius:style.borderTopLeftRadius
        };
      });

      expect(ring).toEqual({
        style:"solid",
        width:"2px",
        radius:"6px"
      });

      /* Enter включает режим, фокус с рамкой остаётся на «Готово». */
      await page.keyboard.press("Enter");

      await expect(toggle).toHaveText("Готово");
      await expect(toggle).toBeFocused();

      expect(
        await toggle.evaluate(element=>
          getComputedStyle(element).outlineStyle
        )
      ).toBe("solid");

      /* Общий флажок тоже достижим и виден. */
      await page.keyboard.press(next);

      await expect(
        page.locator("[data-select-all]")
      ).toBeFocused();

      await page.keyboard.press("Enter");

      await expect(
        page.locator("[data-select-all]")
      ).toHaveAttribute("aria-pressed","true");
    }
  );
});

test.describe("touch",()=>{
  test.use({
    viewport:{width:390,height:844},
    hasTouch:true
  });

  test(
    "a tap on a text action fades it without a box",
    async({page})=>{
      await openApp(page,{seed:seed()});

      const toggle=page.locator("#shiftSelectToggle");

      /*
        Отметка нажатия ставится на касание и держится долю секунды —
        снимаем её в этот момент.
      */
      const box=await toggle.boundingBox();

      const state=await page.evaluate(({x,y})=>{
        const target=document.elementFromPoint(x,y);
        const init={
          bubbles:true,
          isPrimary:true,
          pointerId:7,
          pointerType:"touch",
          clientX:x,
          clientY:y
        };

        target.dispatchEvent(new PointerEvent("pointerdown",init));
        target.dispatchEvent(new PointerEvent("pointerup",init));

        const element=target.closest("button");
        const style=getComputedStyle(element);

        return {
          active:element.classList.contains("touch-active"),
          shadow:style.boxShadow
        };
      },{
        x:box.x+box.width/2,
        y:box.y+box.height/2
      });

      expect(state).toEqual({
        active:true,
        shadow:"none"
      });

      await expect
        .poll(()=>toggle.evaluate(element=>
          element.classList.contains("touch-active")
        ))
        .toBe(false);
    }
  );
});

test.describe("registry selection",()=>{
  test.use({
    viewport:{width:390,height:844},
    hasTouch:true
  });

  test(
    "the selection bar walks through none, some and all as one control",
    async({page})=>{
      await openApp(page,{seed:seed()});

      await page.locator("#shiftSelectToggle").tap();

      const master=page.locator("[data-select-all]");
      const count=page.locator(".shift-select-count");
      const remove=page.locator("#shiftSelectDelete");

      /* Ничего не выбрано. */
      await expect(master).toHaveAttribute("aria-pressed","false");
      await expect(master).toContainText("Выбрать все");
      await expect(count).toHaveText("Ничего не выбрано");
      await expect(remove).toBeDisabled();

      /*
        Панель — строка управления, а не плитка: своей поверхности у неё
        нет, и пустое место в ней ни на что не реагирует. Флажок стоит в
        одном столбце с флажками строк.
      */
      const layout=await page.evaluate(()=>{
        const bar=document.querySelector(".shift-select-bar");
        const style=getComputedStyle(bar);

        const head=bar
          .querySelector(".sh-check")
          .getBoundingClientRect();

        const row=document
          .querySelector(".shift-scroll .sh-check")
          .getBoundingClientRect();

        return {
          background:style.backgroundColor,
          image:style.backgroundImage,
          border:style.borderTopWidth,
          column:Math.round(Math.abs(head.left-row.left))
        };
      });

      expect(layout).toEqual({
        background:"rgba(0, 0, 0, 0)",
        image:"none",
        border:"0px",
        column:0
      });

      /* Одна. */
      await page.locator("[data-select]").first().tap();

      await expect(master).toHaveAttribute("aria-pressed","mixed");
      await expect(count).toHaveText("Выбрано 1 из 4");
      await expect(remove).toBeEnabled();

      /* Несколько. */
      await page.locator("[data-select]").nth(1).tap();
      await expect(count).toHaveText("Выбрано 2 из 4");

      /* Все — флажок полный, подпись предлагает снять. */
      await master.tap();

      await expect(master).toHaveAttribute("aria-pressed","true");
      await expect(master).toContainText("Снять выбор");
      await expect(count).toHaveText("Выбраны все 4");

      /* Снять — и снова пусто. */
      await master.tap();
      await expect(count).toHaveText("Ничего не выбрано");

      /* Выход — там же, где вход. */
      await page.locator("#shiftSelectToggle").tap();

      await expect(
        page.locator(".shift-select-bar")
      ).toHaveCount(0);

      await expect(
        page.locator("#shiftSelectToggle")
      ).toHaveText("Выбрать");
    }
  );

  test(
    "the calendar uses the same master checkbox for its days",
    async({page})=>{
      await openApp(page,{seed:seed()});

      await page.locator('[data-shift-view="calendar"]').tap();
      await page.locator("[data-calendar-pick-mode]").tap();

      const master=page.locator("[data-calendar-pick-all]");

      await expect(master).toHaveAttribute("aria-pressed","false");

      /* Флажок шапки стоит над флажками строк и здесь. */
      await page.locator(`[data-calendar-day="${day(2)}"]`).tap();

      const column=await page.evaluate(()=>{
        const head=document
          .querySelector(".sv-pick-all .sh-check")
          .getBoundingClientRect();

        const row=document
          .querySelector(".sv-panel-list .sh-check")
          .getBoundingClientRect();

        return Math.round(Math.abs(head.left-row.left));
      });

      expect(column).toBe(0);

      await master.tap();

      /* Все четыре дня со сменами — и только они. */
      await expect(master).toHaveAttribute("aria-pressed","true");
      await expect(page.locator(".sv-day.picked")).toHaveCount(4);

      await expect(
        page.locator(".sv-panel-date")
      ).toHaveText("Выбрано 4 дня");

      await master.tap();

      await expect(page.locator(".sv-day.picked")).toHaveCount(0);
      await expect(master).toHaveAttribute("aria-pressed","false");
    }
  );
});
