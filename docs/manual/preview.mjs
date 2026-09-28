/*
  Страницы собранной инструкции картинками — чтобы просмотреть вёрстку,
  не открывая PDF.

    node docs/manual/preview.mjs          все страницы
    node docs/manual/preview.mjs 3,7,12   только эти
*/

import {chromium} from "@playwright/test";
import {mkdirSync} from "node:fs";
import {fileURLToPath} from "node:url";

const OUT=fileURLToPath(new URL("./out/",import.meta.url));
mkdirSync(OUT+"preview",{recursive:true});

const only=process.argv[2] ? process.argv[2].split(",").map(Number) : null;
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1123,height:794},deviceScaleFactor:1.4});
await page.goto("file://"+OUT+"manual.html");
await page.waitForLoadState("networkidle");
const pages=await page.locator(".page").all();

for(let i=0;i<pages.length;i++){
  if(only && !only.includes(i+1)){
    continue;
  }
  await pages[i].screenshot({path:`${OUT}preview/p${String(i+1).padStart(2,"0")}.png`});
}

await browser.close();
