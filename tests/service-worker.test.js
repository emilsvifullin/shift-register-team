import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  access,
  readFile
} from "node:fs/promises";

import {
  posix
} from "node:path";

const root=new URL("../",import.meta.url);

const read=path=>
  readFile(
    new URL(path,root),
    "utf8"
  );

/*
  Список ресурсов оболочки читается из самого service worker: тест
  сравнивает его с реальным графом модулей и стилей, поэтому забытый
  или лишний файл виден сразу, а не превращается в неработающий офлайн.
*/
async function serviceWorkerShell(){
  const source=await read("sw.js");

  const context={
    self:{
      registration:{
        scope:"https://example.test/app/"
      },
      addEventListener(){},
      skipWaiting(){},
      clients:{claim(){}}
    },
    caches:{},
    fetch(){},
    AbortController,
    setTimeout,
    clearTimeout,
    Response:{error(){}},
    URL
  };

  context.globalThis=context;

  vm.runInNewContext(
    `${source}
    globalThis.__shell={
      assets:ASSETS,
      cacheName:CACHE_NAME,
      version:VERSION
    };`,
    context
  );

  return context.__shell;
}

const IMPORT_PATTERNS=[
  /(?:^|[\s(=])(?:import|export)[^;]*?from\s*["'](\.[^"']+)["']/g,
  /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
  /^import\s+["'](\.[^"']+)["']/gm
];

async function moduleGraph(entries){
  const seen=new Set();

  const walk=async file=>{
    if(seen.has(file)){
      return;
    }

    seen.add(file);

    const source=await read(file);

    for(const pattern of IMPORT_PATTERNS){
      for(const match of source.matchAll(pattern)){
        await walk(
          posix.normalize(
            posix.join(
              posix.dirname(file),
              match[1]
            )
          )
        );
      }
    }
  };

  for(const entry of entries){
    await walk(entry);
  }

  return seen;
}

function referencedAssets(html,attribute){
  return [
    ...html.matchAll(
      new RegExp(
        `${attribute}="\\./([^"]+)"`,
        "g"
      )
    )
  ].map(match=>match[1]);
}

test(
  "every precached asset exists on disk",
  async()=>{
    const {assets}=await serviceWorkerShell();

    for(const asset of assets){
      if(asset==="./"){
        continue;
      }

      await access(
        new URL(asset,root)
      );
    }
  }
);

test(
  "the precache covers the whole runtime module graph",
  async()=>{
    const {assets}=await serviceWorkerShell();

    const cached=new Set(
      assets.map(asset=>
        asset.replace(/^\.\//,"")
      )
    );

    const graph=await moduleGraph([
      "src/app.js",
      "src/platform-shell.js",
      "src/interactions.js",
      "src/login.js"
    ]);

    graph.add("src/frame-guard.js");

    for(const file of graph){
      assert.ok(
        cached.has(file),
        `${file} must be precached by sw.js`
      );
    }

    for(const asset of cached){
      if(
        !asset.startsWith("src/") ||
        !asset.endsWith(".js")
      ){
        continue;
      }

      assert.ok(
        graph.has(asset) ||
        asset==="src/pwa.js",
        `${asset} is precached but no longer reachable`
      );
    }
  }
);

test(
  "the precache covers every stylesheet both entrypoints load",
  async()=>{
    const {assets}=await serviceWorkerShell();

    const cached=new Set(assets);

    for(const page of ["index.html","login.html"]){
      const html=await read(page);

      const styles=referencedAssets(
        html,
        "href"
      ).filter(href=>href.endsWith(".css"));

      assert.ok(
        styles.length>0,
        `${page} must load stylesheets`
      );

      for(const style of styles){
        assert.ok(
          cached.has(`./${style}`),
          `./${style} must be precached by sw.js`
        );
      }
    }
  }
);

test(
  "no stylesheet is pulled in through a blocking @import",
  async()=>{
    for(const file of [
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
    ]){
      const css=(await read(file))
        .replace(/\/\*[\s\S]*?\*\//g,"");

      assert.doesNotMatch(
        css,
        /@import/,
        `${file} must be linked, not imported`
      );
    }
  }
);

test(
  "the cache name, the manifest version and the app version agree",
  async()=>{
    const {cacheName,version}=
      await serviceWorkerShell();

    const pkg=JSON.parse(
      await read("package.json")
    );

    const config=await read("src/config.js");

    assert.equal(version,pkg.version);
    assert.ok(cacheName.endsWith(pkg.version));

    assert.match(
      config,
      new RegExp(
        `APP_VERSION = "${pkg.version.replace(/\./g,"\\.")}"`
      )
    );
  }
);

test(
  "a new version never takes over a running page on its own",
  async()=>{
    const sw=await read("sw.js");

    /*
      `skipWaiting` допустим только по явному сообщению страницы:
      иначе догруженный по import() модуль приходит из следующей
      сборки, и в одной сессии работают два поколения кода.
    */
    const installBlock=sw.slice(
      sw.indexOf('"install"'),
      sw.indexOf('"activate"')
    );

    assert.doesNotMatch(
      installBlock,
      /skipWaiting/
    );

    assert.match(
      sw,
      /activate-update/
    );

    assert.match(
      sw,
      /cache\.addAll\(ASSETS\)/
    );

    assert.match(
      sw,
      /self\.clients\.claim\(\)/
    );

    assert.match(
      sw,
      /AbortController/
    );
  }
);
