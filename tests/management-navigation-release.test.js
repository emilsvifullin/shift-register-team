import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>
  readFile(
    new URL(`../${path}`,import.meta.url),
    "utf8"
  );

test("management navigation is bootstrapped and cached by the PWA release",async()=>{
  const [guard,navigation,sw,config]=
    await Promise.all([
      read("src/frame-guard.js"),
      read("src/management-navigation.js"),
      read("sw.js"),
      read("src/config.js")
    ]);

  const version=
    config.match(
      /APP_VERSION\s*=\s*"([^"]+)"/
    )?.[1];

  assert.ok(version);
  assert.match(
    guard,
    /management-navigation\.js/
  );
  assert.match(
    navigation,
    /dataset\.manageBackProxy/
  );
  assert.match(
    navigation,
    /MANAGE_RETRY_INTERVAL/
  );
  assert.match(
    sw,
    /"\.\/src\/management-navigation\.js"/
  );
  assert.ok(
    sw.includes(
      `"sr-team-runtime-v${version}"`
    )
  );
});
