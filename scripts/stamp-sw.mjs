/*
  Отпечаток оболочки для sw.js.

  Service worker отдаёт HTML, модули и стили из кеша своего поколения,
  поэтому правка любого файла оболочки должна менять байты sw.js — иначе
  браузер не увидит обновления и пользователи останутся на старой версии.
  Отпечаток — SHA-256 по путям и содержимому файлов в порядке ASSETS; тот же
  расчёт service worker повторяет при установке и отказывается ставить
  смешанное поколение.

    node ./scripts/stamp-sw.mjs          пересчитать и записать в sw.js
    node ./scripts/stamp-sw.mjs --check  только проверить
*/

import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import vm from "node:vm";

const root=new URL("../",import.meta.url);

const FINGERPRINT_PATTERN=/const SHELL_FINGERPRINT="([0-9a-f]*)";/;

export async function serviceWorkerSource(){
  return readFile(new URL("sw.js",root),"utf8");
}

/*
  Список ресурсов берётся из самого sw.js: второй копии, которая могла бы
  разойтись с ним, нет.
*/
export function serviceWorkerShell(source){
  const context={
    self:{
      registration:{scope:"https://example.test/"},
      addEventListener(){}
    },
    URL
  };

  context.globalThis=context;

  vm.runInNewContext(
    `${source}
    globalThis.__shell={
      assets:ASSETS,
      version:VERSION,
      fingerprint:SHELL_FINGERPRINT,
      cacheName:CACHE_NAME
    };`,
    context
  );

  return context.__shell;
}

export async function shellFingerprint(assets,readAsset=path=>readFile(new URL(path,root))){
  const hash=createHash("sha256");

  for(const path of assets){
    hash.update(`${path}\n`);
    hash.update(await readAsset(path));
  }

  return hash.digest("hex");
}

async function main(){
  const check=process.argv.includes("--check");
  const source=await serviceWorkerSource();
  const shell=serviceWorkerShell(source);
  const fingerprint=await shellFingerprint(shell.assets);

  if(shell.fingerprint===fingerprint){
    console.log(`sw.js: отпечаток оболочки актуален (${fingerprint.slice(0,12)})`);
    return;
  }

  if(check){
    console.error(
      "sw.js: отпечаток оболочки устарел. Выполните npm run stamp:sw"
    );
    process.exitCode=1;
    return;
  }

  await writeFile(
    new URL("sw.js",root),
    source.replace(
      FINGERPRINT_PATTERN,
      `const SHELL_FINGERPRINT="${fingerprint}";`
    )
  );

  console.log(`sw.js: отпечаток оболочки обновлён (${fingerprint.slice(0,12)})`);
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  await main();
}
