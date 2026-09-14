import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read=path=>
  fs.readFileSync(
    new URL(`../${path}`,import.meta.url),
    "utf8"
  );

test("reference team motion is bootstrapped and precached",()=>{
  const frameGuard=read("src/frame-guard.js");
  const serviceWorker=read("sw.js");

  assert.match(
    frameGuard,
    /\.\/team-motion\.js/
  );

  assert.match(
    serviceWorker,
    /\.\/src\/team-motion\.js/
  );
});

test("team motion carries the exact shift-register tab timing and smooth management motion",()=>{
  const motion=read("src/team-motion.js");

  assert.match(
    motion,
    /duration:250/
  );

  assert.match(
    motion,
    /cubic-bezier\(\.22,\.72,\.22,1\)/
  );

  assert.match(
    motion,
    /duration:320/
  );

  assert.match(
    motion,
    /duration:260/
  );

  assert.match(
    motion,
    /employeeSheetBody/
  );

  assert.match(
    motion,
    /manageEditorBody/
  );
});
