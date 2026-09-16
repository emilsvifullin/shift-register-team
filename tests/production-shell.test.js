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
        'src="./src/platform-shell.js?shell=7"'
      );

    const app=
      positionOf(
        html,
        'src="./src/app.js?shell=7"'
      );

    assert.ok(
      platformCss<refinementCss,
      "refinement.css must load after platform.css"
    );

    assert.ok(
      platformShell<app,
      "platform shell must start before the application"
    );

    assert.doesNotMatch(
      html,
      /rel="modulepreload"/,
      "WebKit reuses a preloaded module past the service worker after an update"
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
      /src="\.\/src\/login\.js\?shell=7"/
    );

    assert.doesNotMatch(
      html,
      /rel="modulepreload"/
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

