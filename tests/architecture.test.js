import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(
  new URL(`../${path}`,import.meta.url),
  "utf8"
);

test("team API is split behind a stable facade",async()=>{
  const team=await read("src/team.js");
  const modules=[
    "src/api/shared.js",
    "src/api/team-read.js",
    "src/api/employees.js",
    "src/api/shifts.js",
    "src/api/points.js",
    "src/api/payouts.js"
  ];

  for(const path of modules){
    const source=await read(path);
    assert.ok(source.length>0,`${path} is empty`);
  }

  assert.match(team,/\.\/api\/team-read\.js/);
  assert.match(team,/\.\/api\/employees\.js/);
  assert.match(team,/\.\/api\/shifts\.js/);
  assert.match(team,/\.\/api\/points\.js/);
  assert.match(team,/\.\/api\/payouts\.js/);
  assert.ok(team.length<7000,"team.js should remain a facade, not grow into a god file again");
});

test("cross-platform runtime owns viewport and tab accessibility contracts",async()=>{
  const runtime=await read("src/platform/runtime.js");
  const css=await read("styles/platform.css");

  assert.match(runtime,/visualViewport/);
  assert.match(runtime,/aria-labelledby/);
  assert.match(runtime,/event\.key==="Home"/);
  assert.match(runtime,/event\.key==="End"/);
  assert.match(runtime,/MutationObserver/);
  assert.match(css,/100dvh/);
  assert.match(css,/forced-colors:active/);
  assert.match(css,/scrollbar-width:thin/);
});

test("service worker precaches modular runtime",async()=>{
  const sw=await read("sw.js");

  for(const asset of [
    "./styles/platform.css",
    "./src/platform/runtime.js",
    "./src/api/shared.js",
    "./src/api/team-read.js",
    "./src/api/employees.js",
    "./src/api/shifts.js",
    "./src/api/points.js",
    "./src/api/payouts.js"
  ]){
    assert.ok(sw.includes(asset),`${asset} is not precached`);
  }
});

test("application version stays synchronized",async()=>{
  const pkg=JSON.parse(await read("package.json"));
  const lock=JSON.parse(await read("package-lock.json"));
  const config=await read("src/config.js");
  const sw=await read("sw.js");

  assert.equal(pkg.version,lock.version);
  assert.equal(pkg.version,lock.packages[""].version);
  assert.ok(config.includes(`APP_VERSION = "${pkg.version}"`));
  assert.ok(sw.includes(`v${pkg.version.replaceAll(".","")}`));
});
