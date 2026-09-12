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

function appVersionFromConfig(source){
  const match=source.match(/APP_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(match,"APP_VERSION must be declared in src/config.js");
  return match[1];
}

async function finalInteractionCss(){
  const [entry,core,management]=await Promise.all([
    read("styles/interaction.css"),
    read("styles/interaction-core.css"),
    read("styles/management.css")
  ]);

  const coreImport=entry.indexOf('@import url("./interaction-core.css")');
  const managementImport=entry.indexOf('@import url("./management.css")');

  assert.notEqual(coreImport,-1,"interaction core import must stay explicit");
  assert.notEqual(managementImport,-1,"management import must stay explicit");
  assert.ok(coreImport<managementImport,"management overrides must load after interaction core");

  return `${core}\n${management}`;
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
  const css=await finalInteractionCss();

  assert.match(css,/--ui-target:44px/);
  assert.match(css,/nav\.tabs button[\s\S]*?min-height:44px/);
  assert.match(css,/\.date-day[\s\S]*?height:44px/);
  assert.match(css,/\.picker-toolbar-title[\s\S]*?left:clamp\(76px,21vw,84px\)[\s\S]*?right:clamp\(76px,21vw,84px\)/);
  assert.match(css,/touch-active[\s\S]*?transform:scale\(\.985\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);

  assert.doesNotMatch(
    css,
    /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i,
    "interaction polish must reuse the existing palette"
  );
});

test("fluid mobile contract covers safe areas narrow phones foldables and landscape",async()=>{
  const css=await finalInteractionCss();

  assert.match(css,/env\(safe-area-inset-left\)/);
  assert.match(css,/env\(safe-area-inset-right\)/);
  assert.match(css,/@media \(max-width:319px\)/);
  assert.match(css,/@media \(min-width:521px\) and \(max-width:899px\)/);
  assert.match(css,/@media \(orientation:landscape\) and \(max-height:520px\)/);
  assert.match(
    css,
    /max-height:min\([\s\S]*?--app-viewport-height[\s\S]*?100dvh/,
    "overlays must be bounded by both JS viewport metrics and the live dynamic viewport"
  );
});

test("bottom dock clips page scrolling and keeps final navigation geometry consistent",async()=>{
  const css=await finalInteractionCss();

  assert.match(css,/--bottom-dock-space:calc\(/);
  assert.match(css,/--app-shell-height:100dvh/);
  assert.doesNotMatch(css,/--app-shell-height:max\(/);
  assert.match(css,/\.bottom-controls\{[\s\S]*?bottom:0;[\s\S]*?background:var\(--bg\)/);
  assert.ok(
    css.lastIndexOf("border-radius:16px")>
      css.lastIndexOf("border-radius:999px"),
    "management polish must override the outer pill radius"
  );
  assert.ok(
    css.lastIndexOf("border-radius:12px")>
      css.lastIndexOf("border-radius:999px"),
    "management polish must override tab pill radii"
  );
  assert.match(css,/main\{[\s\S]*?height:calc\([\s\S]*?--app-shell-height[\s\S]*?--bottom-dock-space[\s\S]*?padding-bottom:16px/);
  assert.match(css,/#shiftSearch\{[\s\S]*?width:100%/);
  assert.match(css,/#shiftFilterOpen\{[\s\S]*?width:100%[\s\S]*?min-height:52px/);
});

test("management detail keeps the chevron in the header and sizes list rows for mobile",async()=>{
  const management=await read("styles/management.css");

  assert.match(management,/\.manage-back[\s\S]*?position:fixed/);
  assert.match(management,/\.manage-back[\s\S]*?top:calc\(14px \+ env\(safe-area-inset-top\)\)/);
  assert.match(management,/\.manage-back[\s\S]*?visibility:visible[\s\S]*?opacity:1/);
  assert.match(management,/\.manage-back svg[\s\S]*?stroke:currentColor/);
  assert.match(management,/#employeeList,[\s\S]*?#pointManageList[\s\S]*?flex:1 1 0/);
  assert.match(management,/#employeeList > \.manage-menu,[\s\S]*?#pointManageList > \.manage-menu[\s\S]*?height:100%[\s\S]*?overflow-y:auto/);
  assert.match(management,/#employeeList \.employee-row\{[\s\S]*?min-height:clamp\(76px,8\.8dvh,79px\)/);
  assert.match(management,/#pointManageList \.point-manage-row\{[\s\S]*?min-height:clamp\(54px,6\.15dvh,55px\)/);
});

test("standalone iOS shell uses the full app viewport and modal states remove the dock",async()=>{
  const css=await finalInteractionCss();

  assert.match(css,/@media \(display-mode:standalone\)[\s\S]*?--app-shell-height:100vh/);
  assert.match(css,/@media \(display-mode:standalone\)[\s\S]*?\.bottom-controls\{[\s\S]*?position:absolute;[\s\S]*?bottom:0/);
  assert.match(css,/body\.point-picker-open \.bottom-controls[\s\S]*?visibility:hidden[\s\S]*?pointer-events:none/);
  assert.match(css,/@media \(display-mode:standalone\)[\s\S]*?\.point-veil[\s\S]*?height:100vh/);
});

test("PWA release includes the complete final interaction layer",async()=>{
  const [sw,config]=await Promise.all([
    read("sw.js"),
    read("src/config.js")
  ]);

  const appVersion=appVersionFromConfig(config);

  assert.ok(
    sw.includes(`"sr-team-runtime-v${appVersion}"`),
    "PWA cache version must follow APP_VERSION"
  );
  assert.match(sw,/"\.\/styles\/interaction-core\.css"/);
  assert.match(sw,/"\.\/styles\/management\.css"/);
  assert.match(sw,/"\.\/styles\/interaction\.css"/);
});
