import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>
  readFile(
    new URL(
      `../${path}`,
      import.meta.url
    ),
    "utf8"
  );

function positionOf(
  source,
  value
){
  const index=
    source.indexOf(value);

  assert.notEqual(
    index,
    -1,
    `Expected ${value}`
  );

  return index;
}

function appVersionFromConfig(source){
  const match=
    source.match(
      /APP_VERSION\s*=\s*"([^"]+)"/
    );

  assert.ok(
    match,
    "APP_VERSION must be declared in src/config.js"
  );

  return match[1];
}

test(
  "production entrypoint activates platform and refinement layers",
  async()=>{
    const html=
      await read("index.html");

    const platformCss=
      positionOf(
        html,
        "./styles/platform.css"
      );

    const refinementCss=
      positionOf(
        html,
        "./styles/refinement.css"
      );

    const platformShell=
      positionOf(
        html,
        'src="./src/platform-shell.js"'
      );

    const app=
      positionOf(
        html,
        'src="./src/app.js"'
      );

    assert.ok(
      platformCss<refinementCss,
      "refinement.css must load after platform.css"
    );

    assert.ok(
      platformShell<app,
      "platform shell must start before the application"
    );

    assert.match(
      html,
      /rel="modulepreload"[\s\S]*?href="\.\/src\/app\.js"/
    );

    assert.match(
      html,
      /rel="preconnect"[\s\S]*?cdn\.jsdelivr\.net/
    );
  }
);

test(
  "frame guard does not hide duplicate platform loading",
  async()=>{
    const frameGuard=
      await read("src/frame-guard.js");

    assert.match(
      frameGuard,
      /globalThis\.self!==globalThis\.top/
    );

    assert.doesNotMatch(
      frameGuard,
      /platform\.css|platform-shell|import\(/
    );
  }
);

test(
  "browser fixture declares the same platform layers explicitly",
  async()=>{
    const html=
      await read(
        "tests/fixtures/platform-shell.html"
      );

    assert.match(
      html,
      /href="\.\.\/\.\.\/styles\/platform\.css"/
    );

    assert.match(
      html,
      /href="\.\.\/\.\.\/styles\/refinement\.css"/
    );

    assert.match(
      html,
      /src="\.\.\/\.\.\/src\/platform-shell\.js"/
    );
  }
);

test(
  "login uses the shared responsive refinement layers",
  async()=>{
    const html=
      await read("login.html");

    assert.match(
      html,
      /href="\.\/styles\/platform\.css"/
    );

    assert.match(
      html,
      /href="\.\/styles\/refinement\.css"/
    );

    assert.match(
      html,
      /href="\.\/src\/login\.js"/
    );
  }
);

test(
  "refinement keeps the existing palette and honors reduced motion",
  async()=>{
    const css=
      await read(
        "styles/refinement.css"
      );

    assert.doesNotMatch(
      css,
      /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i,
      "refinement layer must reuse existing color tokens"
    );

    assert.match(
      css,
      /prefers-reduced-motion:reduce/
    );

    assert.match(
      css,
      /--ui-ease-out:/
    );
  }
);

test(
  "service worker serves versioned static assets from cache first",
  async()=>{
    const [sw,config]=
      await Promise.all([
        read("sw.js"),
        read("src/config.js")
      ]);

    const appVersion=
      appVersionFromConfig(config);

    assert.ok(
      sw.includes(
        `"sr-team-runtime-v${appVersion}"`
      ),
      "service worker cache must follow APP_VERSION"
    );

    assert.match(
      sw,
      /"\.\/styles\/refinement\.css"/
    );

    assert.match(
      sw,
      /async function cacheFirst/
    );

    assert.match(
      sw,
      /ASSET_PATHS\.has\(url\.pathname\)[\s\S]*?cacheFirst\(request\)/
    );
  }
);
