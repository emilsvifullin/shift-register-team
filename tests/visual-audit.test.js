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
  "styles/interaction-core.css",
  "styles/management.css",
  "styles/motion-reference.css",
  "styles/modal-motion-exact.css",
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
  const [index,core,management]=await Promise.all([
    read("index.html"),
    read("styles/interaction-core.css"),
    read("styles/management.css")
  ]);

  const coreLink=index.indexOf('href="./styles/interaction-core.css"');
  const managementLink=index.indexOf('href="./styles/management.css"');

  assert.notEqual(coreLink,-1,"interaction core must stay linked");
  assert.notEqual(managementLink,-1,"management styles must stay linked");
  assert.ok(
    coreLink<managementLink,
    "management overrides must load after interaction core"
  );

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

  /*
    Запас под панелью складывается из системной зоны и собственного зазора.
    С «системная зона или зазор, что больше» одна и та же панель вставала
    по-разному: когда полоса Home Indicator внутри окна, панель прижималась
    к ней вплотную, а когда окно уже обрезано по безопасной области —
    висела над ней на величину зазора.
  */
  assert.match(
    css,
    /--bottom-dock-safe:calc\([\s\S]*?env\(safe-area-inset-bottom\)[\s\S]*?\+[\s\S]*?--bottom-dock-clearance/
  );

  assert.doesNotMatch(
    css,
    /--bottom-dock-safe:max\(/,
    "a max() reserve makes the dock sit differently in the two window layouts"
  );
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

/*
  Кнопка возврата живёт в шапке как обычный элемент разметки, а не
  телепортируется туда из #app через position:fixed. Проверяем и это,
  и то, что длинные списки получают всю свободную высоту.
*/
test("management detail keeps a real header back control and lets long lists use the free space",async()=>{
  const [management,html,app]=await Promise.all([
    read("styles/management.css"),
    read("index.html"),
    read("src/app.js")
  ]);

  assert.match(
    html,
    /<header>[\s\S]*?id="manageBack"[\s\S]*?<\/header>/
  );

  assert.doesNotMatch(
    management,
    /\.manage-back[^{]*\{[^}]*position:fixed/
  );

  assert.match(
    app,
    /getElementById\(\s*"manageBack"\s*\)\s*\.hidden=!manageDetail/
  );

  assert.match(
    management,
    /body main\[data-manage-detail="true"\]\{/
  );

  assert.match(management,/main:has\(#employeeList\),[\s\S]*?main:has\(#pointManageList\)[\s\S]*?padding-bottom:16px/);
  assert.match(management,/#employeeList,[\s\S]*?#pointManageList[\s\S]*?flex:1 1 auto/);
  assert.match(management,/#employeeList > \.manage-menu,[\s\S]*?#pointManageList > \.manage-menu[\s\S]*?height:auto[\s\S]*?max-height:100%[\s\S]*?flex:0 1 auto[\s\S]*?overflow-y:auto/);
  assert.match(management,/#employeeList \.employee-row\{[\s\S]*?min-height:76px/);
  assert.match(management,/#pointManageList \.point-manage-row\{[\s\S]*?min-height:54px/);
  assert.doesNotMatch(management,/max-height:382px|#pointManageList > \.manage-menu\{[\s\S]*?max-height:380px/);
});

test("standalone iOS shell uses the full app viewport and modal states remove the dock",async()=>{
  const css=await finalInteractionCss();

  /*
    Высота окна измеряется, а не берётся из 100vh: в iOS 100vh не
    уменьшается, пока открыта клавиатура, и оболочка оказывается выше окна.
    Документ тогда становится прокручиваемым, а нижняя панель здесь
    привязана к документу и уезжает вверх вместе с прокруткой.
  */
  assert.match(css,/@media \(display-mode:standalone\)[\s\S]*?--app-shell-height:var\(--app-window-height,100vh\)/);
  assert.match(css,/@media \(display-mode:standalone\)[\s\S]*?html,\s*body\{[\s\S]*?height:var\(--app-window-height,100vh\)/);
  assert.doesNotMatch(css,/@media \(display-mode:standalone\)\{[\s\S]*?height:100vh/);
  assert.match(css,/@media \(display-mode:standalone\)[\s\S]*?\.bottom-controls\{[\s\S]*?position:absolute;[\s\S]*?bottom:0/);
  assert.match(css,/body\.point-picker-open \.bottom-controls[\s\S]*?visibility:hidden[\s\S]*?pointer-events:none/);
  assert.match(css,/@media \(display-mode:standalone\)[\s\S]*?\.point-veil[\s\S]*?height:var\(--app-window-height,100vh\)/);
});


function squash(source){
  return source
    .replace(/\/\*[\s\S]*?\*\//g,"")
    .replace(/\s+/g,"");
}

/*
  Закрытая поза окна обязана увести его целиком за нижнюю границу экрана.

  Окна-карточки приподняты над краем на env(safe-area-inset-bottom), поэтому
  этот же отступ входит в ход закрытия. Без него на iPhone с домашним
  индикатором picker не доезжал до края: нижняя часть уходила, а верхняя
  кромка с ручкой оставалась на экране и пропадала отдельным кадром вместе
  с display:none.
*/
test("bottom-anchored windows travel past their own safe-area offset",async()=>{
  const [base,refinement,startingStyle,exact,motion]=await Promise.all([
    read("styles.css"),
    read("styles/refinement.css"),
    read("styles/motion-reference.css"),
    read("styles/modal-motion-exact.css"),
    read("src/modal-motion.js")
  ]);

  const hidden=
    "transform:translate3d(0,calc(100%+24px+env(safe-area-inset-bottom)),0)";

  for(const [name,selector,source] of [
    ["styles.css point picker",".point-picker{",base],
    ["styles.css date picker",".date-picker{",base],
    ["styles.css month picker",".month-picker{",base],
    ["exact point picker",".point-picker:not(.app-picker-anchored){",exact],
    ["exact date picker",".date-picker{",exact],
    ["exact month picker",".month-picker{",exact]
  ]){
    const block=squash(source).split(selector)[1]?.split("}")[0] || "";

    assert.ok(
      block.includes(hidden),
      `${name} must clear its own safe-area offset when closing`
    );
  }

  const startingPose=squash(startingStyle);

  assert.ok(
    startingPose.includes(
      "#pointPicker.on:not(.app-picker-anchored){transform:translate3d(0,calc(100%+24px+env(safe-area-inset-bottom)),0)"
    ),
    "the point picker entrance must start from the same hidden pose"
  );

  const refined=squash(refinement);

  assert.ok(
    refined.includes(
      ".point-picker,.month-picker,.date-picker{transform:translate3d(0,calc(100%+28px+env(safe-area-inset-bottom)),0)"
    ),
    "the refinement layer must not restore a pose without the safe-area offset"
  );

  /*
    Ход закрытия ведёт анимация из modal-motion.js, поэтому safe-area должна
    быть и в ней. Лист стоит вплотную к краю (bottom:0), ему отступ не нужен.
  */
  assert.equal(
    motion.split(
      "translate3d(0,calc(100% + 24px + env(safe-area-inset-bottom)),0)"
    ).length-1,
    3,
    "point, date and month pickers close past the safe area"
  );

  assert.equal(
    motion.split(
      '"translate3d(0,calc(100% + 24px),0)"'
    ).length-1,
    1,
    "only the edge-to-edge sheet closes without the safe-area offset"
  );
});

/*
  Ограничение ширины значения написано для строки «подпись — значение».
  Вложенная стопка значений (плитка выплаты) образует свой блок шириной по
  содержимому, и процент отмерялся уже от него: «15 000 ₽» обрезалось до
  «15 0…» рядом с более длинной подписью состояния.
*/
test("the row value width guard stays on the row's own value",async()=>{
  const css=await finalInteractionCss();

  assert.match(css,/\.row > \.v\{[\s\S]*?max-width:58%/);
  assert.doesNotMatch(
    css,
    /(^|[^>])\s\.row \.v\{/,
    "a descendant selector would clamp nested payout values again"
  );
});

/*
  Поля формы выплаты держат 16px: iOS увеличивает страницу при фокусе в
  поле меньше 16px и после этого не возвращает масштаб.
*/
test("payout editor fields cannot trigger the iOS focus zoom",async()=>{
  const workflow=await read("styles/workflow.css");
  const app=await read("src/app.js");
  const block=squash(workflow).split(".payout-field-input{")[1]?.split("}")[0] || "";

  assert.ok(
    block.includes("font-size:16px"),
    "payout fields must set their own 16px size instead of inheriting the label"
  );

  assert.doesNotMatch(
    workflow,
    /\.payout-editor input\{[\s\S]*?font:inherit/,
    "font:inherit re-inherits the 12px label size"
  );

  assert.doesNotMatch(
    app,
    /id="payoutDate"[^>]*type="date"/,
    "the payout date uses the application date picker, not the native control"
  );

  assert.match(
    app,
    /data-payout-date-open/,
    "the payout date opens the shared date picker"
  );
});

/*
  Высота оболочки измеряется по layout viewport: window.innerHeight в
  установленном приложении iOS ниже окна на верхнюю safe-area.
*/
test("the installed shell measures the layout viewport it is laid out against",async()=>{
  const css=await finalInteractionCss();
  const shell=await read("src/platform-shell.js");

  assert.match(css,/\.app-viewport-probe\{[\s\S]*?position:fixed;[\s\S]*?top:0;[\s\S]*?bottom:0/);
  assert.match(shell,/app-viewport-probe/);
  assert.match(shell,/layoutHeight:\s*\n?\s*probeLayoutHeight\(probe\)/);
  assert.match(shell,/ResizeObserver/);
});
