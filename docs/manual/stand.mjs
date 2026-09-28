/*
  Стенд для снимков: приложение с локального сервера, данные — из
  демонстрационного набора через заглушку Supabase из браузерных тестов.
  В сеть ничего не уходит.
*/

import {chromium} from "@playwright/test";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {stubScript} from "../../e2e/support/supabase-stub.mjs";
import {demoSeed} from "./demo-seed.mjs";

export const ORIGIN="http://127.0.0.1:4173";
const ROOT=fileURLToPath(new URL("../../",import.meta.url));

const alive=()=>fetch(`${ORIGIN}/index.html`).then(r=>r.ok,()=>false);

/* Сервер уже запущен (npm run serve) — берём его, иначе поднимаем на время съёмки. */
async function ensureServer(){
  if(await alive()){
    return;
  }
  const server=spawn(process.execPath,["./scripts/serve.mjs","4173"],{cwd:ROOT,stdio:"ignore"});
  process.on("exit",()=>server.kill());
  for(let i=0;i<50;i++){
    if(await alive()){
      return;
    }
    await new Promise(done=>setTimeout(done,100));
  }
  throw new Error("локальный сервер не поднялся на "+ORIGIN);
}

/* Окно как у пользователя: экран 1470×956 точек, масштаб 80%. */
export const VIEWPORT={width:1838,height:1106};

export async function launch({scale=1.6}={}){
  await ensureServer();
  const browser=await chromium.launch();
  const context=await browser.newContext({viewport:VIEWPORT,deviceScaleFactor:scale,colorScheme:"light",serviceWorkers:"block"});
  return {browser,context};
}

export async function openDemo(context,{seed=demoSeed()}={}){
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date(2026,8,28,12,0,0));
  await page.route("**/vendor/supabase-js-*.js",r=>r.fulfill({status:200,contentType:"text/javascript",body:stubScript(seed)}));
  await page.route("**/index.html",async r=>{const res=await r.fetch();const html=await res.text();await r.fulfill({status:200,contentType:"text/html; charset=utf-8",body:html.replace(/\n\s*integrity="[^"]*"/,"")});});
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(()=>!document.body.classList.contains("app-booting"));
  await page.mouse.move(0,0);
  return page;
}

export async function settle(page,ms=700){
  await page.mouse.move(0,0);
  await page.waitForTimeout(ms);
}
