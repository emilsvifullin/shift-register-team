import {
  test,
  expect
} from "@playwright/test";

import {
  openApp
} from "./support/supabase-stub.mjs";

/*
  Окно выбора месяца и панель выбора года в календаре собраны одним и тем
  же жестом смены года. Он захватывал указатель сразу на pointerdown, и
  все последующие события указателя вместе с производным click уходили
  самому окну: кнопка под курсором получала только pointerdown. Внутри
  этих окон не работало ничего — ни месяцы, ни стрелки года, ни «Текущий
  месяц», ни «Отмена» с «Готово».

  Здесь проверяется работа обоих окон мышью, потому что ломалась именно
  мышь: для касаний захват ставится отдельной веткой и click от неё не
  зависит.
*/

test.use({
  viewport:{width:402,height:874},
  colorScheme:"dark"
});

async function openMonthPicker(page){
  await page.locator("#period").click();

  await expect(
    page.locator("#monthPicker")
  ).toHaveClass(/\bon\b/);

  await expect
    .poll(()=>page.evaluate(()=>
      document.getElementById("monthPicker")
        .getAnimations().length
    )).toBe(0);
}

test(
  "every control of the month picker answers a click",
  async({page})=>{
    await openApp(page);

    const period=page.locator("#period");
    const before=(await period.textContent()).trim();

    /* Отмена не меняет месяц и закрывает окно. */
    await openMonthPicker(page);
    await page.locator("#monthYearNext").click();

    await expect(
      page.locator("#monthPickerYear")
    ).toHaveText("2027");

    await page.locator("#monthGrid .month-option").first().click();

    await expect(
      page.locator("#monthGrid .month-option.on")
    ).toHaveText(/Январь/);

    await page.locator("#monthCancel").click();

    await expect
      .poll(()=>page.evaluate(()=>
        getComputedStyle(
          document.getElementById("monthPicker")
        ).display
      )).toBe("none");

    expect((await period.textContent()).trim()).toBe(before);

    /* Стрелка года, выбор месяца и «Готово» применяют выбор. */
    await openMonthPicker(page);
    await page.locator("#monthYearPrev").click();

    await expect(
      page.locator("#monthPickerYear")
    ).toHaveText("2025");

    await page.locator("#monthGrid .month-option").nth(2).click();
    await page.locator("#monthDone").click();

    await expect(period).toHaveText(/Март 2025/);

    /* «Текущий месяц» возвращает окно на сегодняшний месяц. */
    await openMonthPicker(page);
    await page.locator("#monthToday").click();

    await expect(
      page.locator("#monthPickerYear")
    ).toHaveText("2026");

    await expect(
      page.locator("#monthGrid .month-option.on")
    ).toHaveText(/Сентябрь/);

    await page.locator("#monthDone").click();

    await expect(period).toHaveText(/Сентябрь 2026/);
  }
);

test(
  "the year panel inside the calendar answers a click as well",
  async({page})=>{
    await openApp(page);

    await page.locator("#tab-shifts").click();
    await page.locator("#shiftAdd").click();

    await expect(
      page.locator("#sheet")
    ).toHaveClass(/\bon\b/);

    await page.locator("#f-date-open").click();

    await expect(
      page.locator("#datePicker")
    ).toHaveClass(/\bon\b/);

    await page.locator("#datePickerMonth").click();

    await expect(
      page.locator("#dateJump")
    ).toHaveClass(/\bon\b/);

    await page.locator("#dateJumpNextYear").click();

    await expect(
      page.locator("#dateJumpYear")
    ).toHaveText("2027");

    await page
      .locator("#dateJumpMonths .date-jump-month")
      .nth(3)
      .click();

    await expect(
      page.locator("#dateJumpMonths .date-jump-month.on")
    ).toHaveText(/Апрель/);

    await page.locator("#dateJumpDone").click();

    await expect(
      page.locator("#datePickerMonth")
    ).toHaveText(/Апрель 2027/);
  }
);
