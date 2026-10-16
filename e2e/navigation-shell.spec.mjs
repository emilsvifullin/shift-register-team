import {test,expect} from '@playwright/test';
import {openApp} from './support/supabase-stub.mjs';

for(const width of [390,1440]){
  test(`navigation stays below content at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:940});
    await openApp(page);
    for(const name of ['shifts','stats','manage','data']){
      await page.locator(`#tab-${name}`).click();
      await expect(page).toHaveURL(new RegExp(`#${name}$`));
      await expect(page.locator('[role="tablist"]')).toHaveCount(1);
      const geometry=await page.evaluate(()=>{
        const dock=document.querySelector('.bottom-controls').getBoundingClientRect();
        const tabs=document.querySelector('nav.tabs').getBoundingClientRect();
        const header=document.querySelector('header').getBoundingClientRect();
        return {dockBottom:dock.bottom,tabsTop:tabs.top,headerBottom:header.bottom,
          viewportHeight:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      expect(geometry.dockBottom).toBe(geometry.viewportHeight);
      expect(geometry.tabsTop).toBeGreaterThan(geometry.headerBottom);
      expect(geometry.overflow).toBe(false);
    }
    await page.locator('#tab-manage').click();
    await page.locator('[data-manage-section="points"]').click();
    await page.locator('#pointAdd').click();
    await expect(page.locator('#manageEditorSheet.on')).toBeVisible();
  });
}
