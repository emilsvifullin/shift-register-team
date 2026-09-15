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

import {
  serviceWorkerShell as readServiceWorkerShell,
  serviceWorkerSource,
  shellFingerprint
} from "../scripts/stamp-sw.mjs";

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
  return readServiceWorkerShell(
    await serviceWorkerSource()
  );
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
              match[1].replace(/\?.*$/,"")
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
    const {cacheName,version,fingerprint}=
      await serviceWorkerShell();

    const pkg=JSON.parse(
      await read("package.json")
    );

    const config=await read("src/config.js");

    assert.equal(version,pkg.version);
    assert.equal(
      cacheName,
      `sr-shell-v${pkg.version}-${fingerprint.slice(0,12)}`
    );

    assert.match(
      config,
      new RegExp(
        `APP_VERSION = "${pkg.version.replace(/\./g,"\\.")}"`
      )
    );
  }
);

/*
  HTML, модули и стили отдаются из кеша поколения. Если файл оболочки
  изменился, а отпечаток в sw.js — нет, браузер не увидит обновления, и
  пользователи навсегда останутся на прошлой версии.
*/
test(
  "the shell fingerprint in sw.js matches the files on disk",
  async()=>{
    const {assets,fingerprint}=await serviceWorkerShell();

    assert.equal(
      fingerprint,
      await shellFingerprint(assets),
      "run npm run stamp:sw after changing any shell file"
    );
  }
);

/*
  Эти модули предзагружали через modulepreload index.html и login.html
  версий до 7.0. WebKit держит предзагруженный модуль в памяти процесса и
  отдаёт его мимо service worker даже после обновления, поэтому в уже
  запущенном процессе iOS под прежним адресом лежит старый код: страница
  нового поколения запускала старый app.js, тот тянул удалённые модули и
  приложение не стартовало. Поколение 7 запрашивает их с маркером ?shell=7.
*/
const LEGACY_PRELOADED_MODULES=new Set([
  "src/app.js",
  "src/config.js",
  "src/domain.js",
  "src/login.js",
  "src/phone.js",
  "src/platform-shell.js",
  "src/storage.js",
  "src/team-domain.js",
  "src/team.js",
  "src/workflow.js"
]);

const SHELL_MARKER="?shell=7";

test(
  "modules preloaded before 7.0 are only requested under the shell marker",
  async()=>{
    const references=[];

    for(const page of ["index.html","login.html"]){
      const html=await read(page);

      assert.doesNotMatch(
        html,
        /rel="modulepreload"/,
        `${page}: WebKit serves a preloaded module past the service worker`
      );

      for(const match of html.matchAll(/src="\.\/(src\/[^"]+)"/g)){
        references.push({from:page,specifier:match[1],path:match[1]});
      }
    }

    const graph=await moduleGraph([
      "src/app.js",
      "src/platform-shell.js",
      "src/interactions.js",
      "src/login.js"
    ]);

    for(const file of graph){
      const source=await read(file);

      for(const pattern of IMPORT_PATTERNS){
        for(const match of source.matchAll(pattern)){
          references.push({
            from:file,
            specifier:match[1],
            path:posix.normalize(
              posix.join(
                posix.dirname(file),
                match[1].replace(/\?.*$/,"")
              )
            )
          });
        }
      }
    }

    const legacy=references.filter(reference=>
      LEGACY_PRELOADED_MODULES.has(reference.path.replace(/\?.*$/,""))
    );

    assert.ok(legacy.length>=10);

    for(const reference of legacy){
      assert.ok(
        reference.specifier.endsWith(SHELL_MARKER),
        `${reference.from} must request ${reference.path} as ${reference.path}${SHELL_MARKER}`
      );
    }
  }
);
