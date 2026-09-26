/*
  Оболочка приложения кешируется целиком и по поколениям.

  Правила, которые здесь важны:

  1. HTML, модули и стили всегда приходят из одного поколения кеша.
     Прежний worker брал документ из сети, а модули из своего кеша:
     после выкладки новая разметка запускалась со старым app.js, и так
     повторялось при каждом открытии, пока приложение не закроют целиком.

  2. Поколение либо собрано полностью и совпадает с отпечатком
     SHELL_FINGERPRINT, либо установка проваливается и продолжает работать
     прошлая версия. Файлы качаются мимо HTTP-кеша: GitHub Pages отдаёт
     max-age=600, и без этого в новое поколение попадали старые файлы.

  3. Новая версия не подменяет ресурсы под работающей вкладкой: момент
     переключения выбирает страница (src/pwa.js). Исключение — переход с
     поколений до 7.0: их страницы не умеют просить об обновлении, поэтому
     такой переход worker завершает сам и перезагружает их окна.

  Отпечаток пересчитывает `npm run stamp:sw`; tests/service-worker.test.js
  падает, если его забыли обновить после правки любого файла оболочки.
*/

const VERSION="7.0.0";

const SHELL_FINGERPRINT="9284f8f5f40364b1c21a3d0e4510fe2564b098f60902f95dd31bf74d240f58b8";

const CACHE_PREFIX="sr-shell-";

const CACHE_NAME=`${CACHE_PREFIX}v${VERSION}-${SHELL_FINGERPRINT.slice(0,12)}`;

/*
  Кеши поколений до 7.0 назывались sr-team-runtime-v*. Их worker
  перехватывал документы через сеть, а страница не отвечала на
  сообщение об обновлении.
*/
const LEGACY_CACHE_PREFIX="sr-team-";

const INDEX_FILE="./index.html";

const DOCUMENTS=[
  INDEX_FILE,
  "./login.html",
  "./manifest.webmanifest"
];

const STYLES=[
  "./styles.css",
  "./styles/accessibility.css",
  "./styles/motion.css",
  "./styles/workflow.css",
  "./styles/auth.css",
  "./styles/platform.css",
  "./styles/refinement.css",
  "./styles/interaction-core.css",
  "./styles/management.css",
  "./styles/motion-reference.css",
  "./styles/modal-motion-exact.css",
  "./styles/inline-fields.css",
  "./styles/interaction.css",
  "./styles/shift-views.css"
];

const SCRIPTS=[
  "./src/frame-guard.js",
  "./src/api/employees.js",
  "./src/api/payouts.js",
  "./src/api/points.js",
  "./src/api/read.js",
  "./src/api/realtime.js",
  "./src/api/result.js",
  "./src/api/shifts.js",
  "./src/app.js",
  "./src/auth.js",
  "./src/config.js",
  "./src/domain.js",
  "./src/field-reveal.js",
  "./src/format.js",
  "./src/interactions.js",
  "./src/login.js",
  "./src/manage-swipe.js",
  "./src/modal-motion.js",
  "./src/network-routes.js",
  "./src/month-picker-swipe.js",
  "./src/payroll-period.js",
  "./src/payroll-pdf.js",
  "./src/payroll-recalc.js",
  "./src/payroll-report.js",
  "./src/payroll-review.js",
  "./src/phone.js",
  "./src/picker-position.js",
  "./src/platform-shell.js",
  "./src/point-summary.js",
  "./src/pwa.js",
  "./src/reference-swipes.js",
  "./src/render/dom-patch.js",
  "./src/render/schedule.js",
  "./src/shift-views.js",
  "./src/storage.js",
  "./src/supabase.js",
  "./src/swipe-close-guard.js",
  "./src/tariff-rules.js",
  "./src/team-domain.js",
  "./src/team-motion.js",
  "./src/team.js",
  "./src/ui/input-behavior.js",
  "./src/wheel-gesture.js",
  "./src/workflow.js",
  "./vendor/supabase-js-2.112.3.js"
];

const ICONS=[
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

const ASSETS=[
  ...DOCUMENTS,
  ...STYLES,
  ...SCRIPTS,
  ...ICONS
];

const scopeUrl=path=>
  new URL(
    path,
    self.registration.scope
  );

const ASSET_PATHS=new Set(
  ASSETS.map(path=>scopeUrl(path).pathname)
);

/*
  Документы оболочки. Навигация на них отдаётся из кеша поколения, а
  адрес "./" и "./index.html" — это один и тот же документ.
*/
const SHELL_DOCUMENTS=new Map([
  [scopeUrl("./").pathname,INDEX_FILE],
  [scopeUrl(INDEX_FILE).pathname,INDEX_FILE],
  [scopeUrl("./login.html").pathname,"./login.html"]
]);

/*
  Отпечаток поколения: SHA-256 по путям и байтам всех файлов оболочки в
  порядке ASSETS. Тот же расчёт делает scripts/stamp-sw.mjs; тест сверяет,
  что оба дают одинаковый результат.
*/
async function shellFingerprint(readAsset){
  const encoder=new TextEncoder();
  const parts=[];

  for(const path of ASSETS){
    const bytes=await readAsset(path);

    if(!bytes){
      return null;
    }

    parts.push(encoder.encode(`${path}\n`));
    parts.push(new Uint8Array(bytes));
  }

  const size=parts.reduce((total,part)=>total+part.byteLength,0);
  const bytes=new Uint8Array(size);
  let offset=0;

  for(const part of parts){
    bytes.set(part,offset);
    offset+=part.byteLength;
  }

  const digest=await crypto.subtle.digest("SHA-256",bytes);

  return Array.from(
    new Uint8Array(digest),
    byte=>byte.toString(16).padStart(2,"0")
  ).join("");
}

async function hasLegacyGeneration(){
  const names=await caches.keys();

  return names.some(name=>
    name.startsWith(LEGACY_CACHE_PREFIX)
  );
}

self.addEventListener(
  "install",
  event=>{
    event.waitUntil(
      (async()=>{
        const cache=await caches.open(CACHE_NAME);

        const cachedFingerprint=()=>shellFingerprint(
          async path=>{
            const response=await cache.match(path);
            return response ? response.arrayBuffer() : null;
          }
        );

        /*
          Если изменился только сам worker, поколение с тем же отпечатком
          уже собрано и проверено — его не качаем заново и не трогаем.
        */
        if(await cachedFingerprint()!==SHELL_FINGERPRINT){
          try{
            /*
              addAll атомарен: если хотя бы один файл недоступен, установка
              проваливается. cache:"reload" идёт мимо HTTP-кеша браузера.
            */
            await cache.addAll(
              ASSETS.map(path=>
                new Request(path,{cache:"reload"})
              )
            );

            const fingerprint=await cachedFingerprint();

            /*
              Сразу после выкладки CDN может ещё отдавать часть старых
              файлов. Смешанное поколение не устанавливается: браузер
              повторит попытку при следующей проверке обновления.
            */
            if(fingerprint!==SHELL_FINGERPRINT){
              throw new Error(
                `Оболочка ${VERSION} собрана не полностью: ${fingerprint}`
              );
            }
          }catch(error){
            await caches.delete(CACHE_NAME);
            throw error;
          }
        }

        if(await hasLegacyGeneration()){
          await self.skipWaiting();
        }
      })()
    );
  }
);

self.addEventListener(
  "activate",
  event=>{
    event.waitUntil(
      (async()=>{
        const legacy=await hasLegacyGeneration();
        const names=await caches.keys();

        await Promise.all(
          names
            .filter(name=>
              name!==CACHE_NAME &&
              (
                name.startsWith(CACHE_PREFIX) ||
                name.startsWith(LEGACY_CACHE_PREFIX)
              )
            )
            .map(name=>caches.delete(name))
        );

        await self.clients.claim();

        if(!legacy){
          return;
        }

        /*
          Окна прежнего поколения запущены со смешанной оболочкой и не
          перезагрузятся сами. Навигация на тот же адрес пройдёт уже через
          этот worker и соберёт страницу из одного поколения.

          Навигацию нельзя ждать внутри waitUntil: её запрос обслуживается
          только активированным worker, а активация ждала бы навигацию —
          взаимная блокировка и в WebKit, и в Chromium.

          Адрес берётся без #фрагмента: переход на тот же адрес с фрагментом
          браузер выполняет как прокрутку к якорю, без перезагрузки. Вкладку
          приложение восстановит из сохранённого состояния интерфейса.
        */
        const windows=await self.clients.matchAll({
          type:"window"
        });

        for(const client of windows){
          const target=new URL(client.url);
          target.hash="";

          client
            .navigate(target.href)
            .catch(()=>null);
        }
      })()
    );
  }
);

self.addEventListener(
  "message",
  event=>{
    if(event.data?.type==="activate-update"){
      void self.skipWaiting();
    }
  }
);

function fetchWithTimeout(request,timeoutMs=5000){
  const controller=new AbortController();

  const timer=setTimeout(
    ()=>controller.abort(),
    timeoutMs
  );

  return fetch(
    request,
    {
      cache:"no-store",
      signal:controller.signal
    }
  ).finally(()=>clearTimeout(timer));
}

async function cacheFirst(request,{store=false}={}){
  const cache=await caches.open(CACHE_NAME);

  const cached=await cache.match(
    request,
    {ignoreSearch:true}
  );

  if(cached){
    return cached;
  }

  try{
    const response=await fetchWithTimeout(request);

    /*
      Своё поколение дописывать нельзя: файл из сети может оказаться уже
      из следующей выкладки. Дописывается только внешний supabase-js.
    */
    if(store && response.ok){
      await cache.put(
        request,
        response.clone()
      );
    }

    return response;
  }catch{
    return Response.error();
  }
}

async function shellDocument(request,path){
  const cache=await caches.open(CACHE_NAME);

  const cached=await cache.match(path);

  if(cached){
    return cached;
  }

  try{
    return await fetchWithTimeout(request);
  }catch{
    return Response.error();
  }
}

async function navigationResponse(request){
  try{
    return await fetchWithTimeout(request);
  }catch{
    const cache=await caches.open(CACHE_NAME);

    return (
      await cache.match(INDEX_FILE)
    ) || Response.error();
  }
}

self.addEventListener(
  "fetch",
  event=>{
    const request=event.request;

    if(request.method!=="GET"){
      return;
    }

    const url=new URL(request.url);
    const scope=new URL(self.registration.scope);

    if(url.origin!==scope.origin){
      return;
    }

    if(request.mode==="navigate"){
      const shellPath=SHELL_DOCUMENTS.get(url.pathname);

      event.respondWith(
        shellPath
          ? shellDocument(request,shellPath)
          : navigationResponse(request)
      );

      return;
    }

    if(ASSET_PATHS.has(url.pathname)){
      event.respondWith(cacheFirst(request));
    }
  }
);
