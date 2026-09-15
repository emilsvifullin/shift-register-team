/*
  Браузерные тесты: `npx playwright test e2e --browser=webkit`.

  Сервер поднимается сам (scripts/serve.mjs). Уже запущенный на том же
  порту сервер используется повторно, поэтому снимки экрана и отладка
  вручную работают так же.
*/

export default {
  testDir:"e2e",
  webServer:{
    command:"node ./scripts/serve.mjs 4173",
    url:"http://127.0.0.1:4173/tests/fixtures/platform-shell.html",
    reuseExistingServer:true,
    timeout:30000
  }
};
