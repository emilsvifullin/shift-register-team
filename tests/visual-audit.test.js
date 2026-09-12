import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

const productionStyles=[
  "styles.css",
  "styles/accessibility.css",
  "styles/motion.css",
  "styles/workflow.css",
  "styles/auth.css",
  "styles/platform.css",
  "styles/refinement.css",
  "styles/interaction.css"
];

function stylesheetOrder(source,prefix="./"){
  return productionStyles.map(path=>{
    const token=`href=\"${prefix}${path}\"`;
    const index=source.indexOf(token);
    assert.notEqual(index,-1,`missing ${token}`);
    return index;
  });
}

test("production and browser fixture share the full style cascade",async()=>{
  const [index,fixture]=await Promise.all([
    read("index.html"),
    read("tests/fixtures/platform-shell.html")
  ]);

  const production=stylesheetOrder(index,"./");
  const browser=stylesheetOrder(fixture,"../../");

  assert.deepEqual(production,[...production].sort((a,b)=>a-b));
  assert.deepEqual(browser,[...browser].sort((a,b)=>a-b));
});

test("interaction layer restores touch geometry after refinement",async()=>{
  const css=await read("styles/interaction.css");

  assert.match(css,/--ui-target:44px/);
  assert.match(css,/nav\.tabs button[\s\S]*?min-height:44px/);
  assert.match(css,/\.date-day[\s\S]*?height:44px/);
  assert.match(css,/\.picker-toolbar-title[\s\S]*?left:clamp\(68px,21vw,84px\)[\s\S]*?right:clamp\(68px,21vw,84px\)/);
  assert.match(css,/touch-active[\s\S]*?transform:scale\(\.985\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);

  assert.doesNotMatch(
    css,
    /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i,
    "interaction polish must reuse the existing palette"
  );
});

test("fluid mobile contract covers safe areas narrow phones foldables and landscape",async()=>{
  const css=await read("styles/interaction.css");

  assert.match(css,/env\(safe-area-inset-left\)/);
  assert.match(css,/env\(safe-area-inset-right\)/);
  assert.match(css,/@media \(max-width:319px\)/);
  assert.match(css,/@media \(min-width:521px\) and \(max-width:899px\)/);
  assert.match(css,/@media \(orientation:landscape\) and \(max-height:520px\)/);
  assert.match(css,/max-height:calc\([\s\S]*?--app-viewport-height/);
});

test("PWA release includes the final interaction layer",async()=>{
  const sw=await read("sw.js");

  assert.match(sw,/sr-team-runtime-v6/);
  assert.match(sw,/"\.\/styles\/interaction\.css"/);
});
