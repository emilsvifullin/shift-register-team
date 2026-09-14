/*
  Набор экранов, по которым снимаются снимки интерфейса. Держится рядом с
  подставным Supabase, чтобы визуальная проверка гоняла настоящий
  index.html и настоящие модули, а не копию разметки.
*/

export const SCREENS=[
  {
    name:"shifts",
    async open(){}
  },
  {
    name:"stats",
    async open(page){
      await page.locator("#tab-stats").click();
    }
  },
  {
    name:"data",
    async open(page){
      await page.locator("#tab-data").click();
    }
  },
  {
    name:"manage-home",
    async open(page){
      await page.locator("#tab-manage").click();
    }
  },
  {
    name:"manage-employees",
    async open(page){
      await page.locator("#tab-manage").click();
      await page
        .locator('#app [data-manage-section="employees"]')
        .click();
      await page
        .locator("#employeeList")
        .waitFor();
    }
  },
  {
    name:"manage-points",
    async open(page){
      await page.locator("#tab-manage").click();
      await page
        .locator('#app [data-manage-section="points"]')
        .click();
      await page
        .locator("#pointManageList")
        .waitFor();
    }
  },
  {
    name:"point-editor",
    async open(page){
      await page.locator("#tab-manage").click();
      await page
        .locator('#app [data-manage-section="points"]')
        .click();
      await page
        .locator('[data-point-id="point-1"]')
        .click();
      await page
        .locator("#manageEditorSheet.on")
        .waitFor();
    }
  },
  {
    name:"point-tariff-editor",
    async open(page){
      await page.locator("#tab-manage").click();
      await page
        .locator('#app [data-manage-section="points"]')
        .click();
      await page
        .locator('[data-point-id="point-2"]')
        .click();
      await page
        .locator("#manageEditorSheet.on")
        .waitFor();
      await page
        .locator("#manageEditorSave")
        .click();
      await page
        .locator('[data-tariff-intent="edit-current"]')
        .click();
      await page
        .locator("#manageFixedRate")
        .waitFor();
    }
  },
  {
    name:"employee-editor",
    async open(page){
      await page.locator("#tab-manage").click();
      await page
        .locator('#app [data-manage-section="employees"]')
        .click();
      await page
        .locator('[data-employee-id="employee-1"]')
        .click();
      await page
        .locator("#employeeSheet.on")
        .waitFor();
    }
  },
  {
    name:"month-picker",
    async open(page){
      await page.locator("#period").click();
      await page
        .locator("#monthPicker.on")
        .waitFor();
    }
  }
];
