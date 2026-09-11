import {test,expect} from "@playwright/test";

test("login stays inside the viewport and remains keyboard accessible",async({page})=>{
  await page.goto("/login.html");

  await expect(page).toHaveTitle("Shift Register");
  const email=page.getByLabel("Почта");
  const password=page.getByLabel("Пароль");
  const submit=page.getByRole("button",{name:"Войти"});

  await expect(email).toBeVisible();
  await expect(password).toBeVisible();
  await expect(submit).toBeVisible();

  const overflow=await page.evaluate(()=>
    document.documentElement.scrollWidth-document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await email.focus();
  await expect(email).toBeFocused();
});

test("application shell exposes a labelled tab panel",async({page})=>{
  await page.route("**/src/app.js",route=>route.fulfill({
    status:200,
    contentType:"application/javascript",
    body:'import "./platform/runtime.js"; import {installPlatformRuntime} from "./platform/runtime.js"; installPlatformRuntime();'
  }));

  await page.goto("/index.html");

  const tablist=page.getByRole("tablist");
  await expect(tablist).toBeVisible();

  const selected=page.getByRole("tab",{selected:true});
  await expect(selected).toHaveAttribute("id","tab-shifts");

  const panel=page.getByRole("tabpanel");
  await expect(panel).toHaveAttribute("aria-labelledby","tab-shifts");
  await expect(panel).toHaveAttribute("tabindex","0");

  const platformStyle=page.locator('link[data-sr-platform]');
  await expect(platformStyle).toHaveCount(1);
});

test("PWA metadata and modular service worker assets are reachable",async({request})=>{
  const manifest=await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  const data=await manifest.json();
  expect(data.display).toBe("standalone");
  expect(data.icons.some(icon=>icon.purpose==="maskable")).toBeTruthy();

  const sw=await request.get("/sw.js");
  expect(sw.ok()).toBeTruthy();
  const source=await sw.text();
  expect(source).toContain("./src/platform/runtime.js");
  expect(source).toContain("./styles/platform.css");
});
