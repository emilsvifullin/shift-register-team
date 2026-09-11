import {defineConfig,devices} from "@playwright/test";

export default defineConfig({
  testDir:"./tests/browser",
  timeout:30_000,
  expect:{timeout:5_000},
  fullyParallel:true,
  retries:1,
  reporter:"line",
  use:{
    baseURL:"http://127.0.0.1:4173",
    trace:"retain-on-failure"
  },
  webServer:{
    command:"python3 -m http.server 4173 --bind 127.0.0.1",
    url:"http://127.0.0.1:4173/login.html",
    reuseExistingServer:false,
    timeout:15_000
  },
  projects:[
    {name:"chromium-desktop",use:{...devices["Desktop Chrome"]}},
    {name:"firefox-desktop",use:{...devices["Desktop Firefox"]}},
    {name:"webkit-desktop",use:{...devices["Desktop Safari"]}},
    {name:"chromium-android",use:{...devices["Pixel 7"]}},
    {name:"webkit-ios",use:{...devices["iPhone 13"]}}
  ]
});
