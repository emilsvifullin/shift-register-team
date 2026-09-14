import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read=path=>
  fs.readFileSync(
    new URL(`../${path}`,import.meta.url),
    "utf8"
  );

test("reference horizontal swipes are bootstrapped and precached",()=>{
  const frameGuard=read("src/frame-guard.js");
  const config=read("src/config.js");
  const serviceWorker=read("sw.js");

  assert.match(
    frameGuard,
    /\.\/reference-swipes\.js/
  );

  assert.match(
    serviceWorker,
    /\.\/src\/reference-swipes\.js/
  );

  assert.match(
    config,
    /APP_VERSION = "6\.22\.23"/
  );

  assert.match(
    serviceWorker,
    /sr-team-runtime-v6\.22\.23/
  );
});

test("main month touch swipe keeps the exact shift-register thresholds",()=>{
  const app=read("src/app.js");

  assert.match(app,/const monthSwipeArea=document;/);
  assert.match(app,/"touchstart"/);
  assert.match(app,/"touchmove"/);
  assert.match(app,/absX>=10 &&\s*absX>absY\*1\.10/);
  assert.match(app,/absY>=14 &&\s*absY>absX\*1\.25/);
  assert.match(app,/absX>=38/);
  assert.match(app,/absX>=22 &&\s*velocity>=0\.30/);
  assert.match(app,/absX>absY\*1\.08/);
});

test("year swipe parity removes team-only horizontal input paths",()=>{
  const swipes=read("src/reference-swipes.js");

  assert.match(swipes,/HORIZONTAL_DEAD_ZONE=8/);
  assert.match(swipes,/HORIZONTAL_LOCK=10/);
  assert.match(swipes,/VERTICAL_LOCK=14/);
  assert.match(swipes,/YEAR_DISTANCE=35/);
  assert.match(swipes,/FLICK_DISTANCE=22/);
  assert.match(swipes,/FLICK_VELOCITY=\.30/);
  assert.match(swipes,/gridId:"monthGrid"/);
  assert.match(swipes,/gridId:"dateJumpMonths"/);
  assert.match(swipes,/pointerType==="touch"/);
  assert.match(swipes,/event\.stopPropagation\(\)/);
  assert.doesNotMatch(swipes,/"touchstart"/);
});

test("month transition ghost keeps shift list flex geometry after ids are stripped",()=>{
  const styles=read("styles/management.css");

  assert.match(
    styles,
    /main\.shifts-layout > :is\(#shiftListArea,div:has\(> \.shift-window\)\)/
  );

  assert.match(
    styles,
    /flex:1 1 auto/
  );

  assert.match(
    styles,
    /main\.shifts-layout > :is\(#shiftListArea,div:has\(> \.shift-window\)\) > \.ml/
  );
});

test("stats month transition ghost keeps the same app-only refinement geometry",()=>{
  const styles=read("styles/management.css");

  assert.match(
    styles,
    /body\[data-active-tab\] > main > \.ml:first-child/
  );

  assert.match(
    styles,
    /body\[data-active-tab="stats"\] > main > \.ml:has\(\+ \.card \.stats-filter-row\)/
  );

  assert.match(
    styles,
    /body\[data-active-tab="stats"\] > main > \.card:has\(\.stats-filter-row\)/
  );
});
