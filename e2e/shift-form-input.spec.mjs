import {
  test,
  expect
} from "@playwright/test";

import {
  ADMIN_SEED,
  openApp
} from "./support/supabase-stub.mjs";

/*
  Набранное в форме смены не теряется.

  Форма перерисовывается от каждого действия, а перерисовка берёт
  значения полей из черновика — значит всё, что человек набрал, должно
  попадать в черновик сразу, а не «когда-нибудь до сохранения». И
  отложенный фокус не должен уводить набор в соседнее поле.

  Оба дефекта были настоящими и оба прятались за посторонним: первый —
  за таймером сохранения состояния, который срабатывал от прокрутки и
  заодно читал форму, второй — за тем, что кадр обычно успевал прийти
  вовремя.
*/

function seed(){
  return structuredClone(ADMIN_SEED);
}

async function settle(page,key){
  const element=page.locator(
    `[data-key="${key}"]`
  );

  await expect
    .poll(()=>element.evaluate(node=>
      node.getAnimations().length
    ))
    .toBe(0);
}

async function openNewShift(page){
  await page.locator("#shiftAdd").click();

  await page.locator("#f-point-open").click();
  await settle(page,"shiftPointReveal");

  await page
    .locator("[data-shift-point]")
    .first()
    .click();

  await page.locator("#f-employee-open").click();
  await settle(page,"shiftEmployeeReveal");

  await page
    .locator("[data-shift-employee]")
    .first()
    .click();
}

function draftState(page){
  return page.evaluate(()=>{
    const saved=JSON.parse(
      sessionStorage.getItem(
        "shift-register-team-ui-v3"
      ) || "{}"
    );

    return {
      note:saved.draft?.note ?? null,
      reason:saved.draft?.baseOverrideReason ?? null,
      bonus:saved.draft?.bonuses?.[0]?.comment ?? null
    };
  });
}

test.use({
  viewport:{width:402,height:874}
});

test(
  "the adjustment reason and the bonus comment survive a redraw",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openNewShift(page);

    await page
      .locator('[data-pay-mode="manual"]')
      .click();

    await settle(page,"shiftPaymentReveal")
      .catch(()=>{});

    await page
      .locator("#f-base-override")
      .fill("2500");

    await page
      .locator('[data-adjustment-add="bonuses"]')
      .click();

    await page
      .locator("[data-adjustment-amount]")
      .first()
      .fill("300");

    /*
      Эти два поля расчёт не меняют, и именно поэтому их когда-то не
      внесли в список тех, что попадают в черновик по ходу ввода.
    */
    await page
      .locator("#f-base-reason")
      .fill("Договорились о доплате");

    await page
      .locator("[data-adjustment-comment]")
      .first()
      .fill("За переработку");

    expect(await draftState(page)).toMatchObject({
      reason:"Договорились о доплате",
      bonus:"За переработку"
    });

    /*
      Стрелка месяца в календаре — перерисовка всей формы. Раньше её
      ветка черновик не перечитывала.
    */
    await page.locator("#f-date-open").click();

    await page
      .locator("[data-shift-date-step]")
      .first()
      .click();

    await expect(
      page.locator("#f-base-reason")
    ).toHaveValue("Договорились о доплате");

    await expect(
      page.locator("[data-adjustment-comment]").first()
    ).toHaveValue("За переработку");

    expect(await draftState(page)).toMatchObject({
      reason:"Договорились о доплате",
      bonus:"За переработку"
    });
  }
);

test(
  "typing in the point search does not drop the other fields",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openNewShift(page);

    await page
      .locator("#f-note")
      .fill("Комментарий к смене");

    await page.locator("#f-point-open").click();
    await settle(page,"shiftPointReveal");

    /* Каждая буква поиска перерисовывает лист целиком. */
    await page
      .locator("#shiftPointSearch")
      .pressSequentially("Кораб",{delay:30});

    await expect(
      page.locator("#f-note")
    ).toHaveValue("Комментарий к смене");

    expect(await draftState(page)).toMatchObject({
      note:"Комментарий к смене"
    });
  }
);

test(
  "a deferred focus never takes the field away from typing",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openNewShift(page);

    /*
      Переход на ручную сумму ставит фокус в «Фактическую оплату»
      следующим кадром. Если сразу начать печатать в комментарии, набор
      должен остаться там: у «Фактической оплаты» стоит фильтр цифр, и
      уехавший туда текст исчезал совсем.
    */
    await page
      .locator('[data-pay-mode="manual"]')
      .click();

    await page
      .locator("#f-note")
      .fill("Комментарий к смене");

    await expect(
      page.locator("#f-note")
    ).toHaveValue("Комментарий к смене");

    expect(await draftState(page)).toMatchObject({
      note:"Комментарий к смене"
    });

    /* И фокус остался у человека, а не уехал к сумме. */
    expect(
      await page.evaluate(()=>
        document.activeElement?.id
      )
    ).toBe("f-note");

    await expect(
      page.locator("#f-base-override")
    ).toHaveValue("");
  }
);

test(
  "everything typed reaches the saved shift",
  async({page})=>{
    await openApp(page,{seed:seed()});
    await openNewShift(page);

    await page
      .locator('[data-pay-mode="manual"]')
      .click();

    await page
      .locator("#f-base-override")
      .fill("2500");

    await page
      .locator("#f-note")
      .fill("Комментарий к смене");

    await page
      .locator("#f-base-reason")
      .fill("Договорились о доплате");

    await page
      .locator('[data-adjustment-add="penalties"]')
      .click();

    await page
      .locator("[data-adjustment-amount]")
      .first()
      .fill("150");

    await page
      .locator("[data-adjustment-comment]")
      .first()
      .fill("Опоздание");

    await page.locator("#sheetSave").click();

    await expect(
      page.locator("#sheet")
    ).not.toHaveClass(/\bon\b/);

    const saved=await page.evaluate(()=>
      window.__stubDb?.saved_shifts?.at(-1)
    );

    expect(saved).toMatchObject({
      p_note:"Комментарий к смене",
      p_base_amount_override:2500,
      p_base_amount_reason:"Договорились о доплате"
    });

    expect(saved.p_penalties).toMatchObject([
      {amount:150,comment:"Опоздание"}
    ]);
  }
);
