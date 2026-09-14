/*
  Оболочка приложения кешируется целиком и по версиям.

  Правила, которые здесь важны:

  1. Кеш версии либо собран полностью, либо установка проваливается.
     Частично заполненный кеш раньше считался готовым, и приложение
     оставалось офлайн с недостающими модулями.

  2. Новая версия не подменяет ресурсы под работающей вкладкой.
     Раньше `skipWaiting()` в install переключал контроллер сразу, и
     модуль, догруженный по `import()` уже после переключения, приходил
     из следующей сборки — в одной сессии жили два поколения кода.
     Теперь момент переключения выбирает страница (src/pwa.js).
*/

const VERSION="7.0.0";

const CACHE_NAME=`sr-team-runtime-v${VERSION}`;

const INDEX_FILE="./index.html";

const SUPABASE_CDN_URL=
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3";

const DOCUMENTS=[
  "./",
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
  "./styles/interaction.css"
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
  "./src/format.js",
  "./src/interactions.js",
  "./src/login.js",
  "./src/manage-swipe.js",
  "./src/modal-motion.js",
  "./src/month-picker-swipe.js",
  "./src/phone.js",
  "./src/picker-position.js",
  "./src/platform-shell.js",
  "./src/point-summary.js",
  "./src/pwa.js",
  "./src/reference-swipes.js",
  "./src/render/dom-patch.js",
  "./src/render/schedule.js",
  "./src/storage.js",
  "./src/supabase.js",
  "./src/swipe-close-guard.js",
  "./src/tariff-rules.js",
  "./src/team-domain.js",
  "./src/team-motion.js",
  "./src/team.js",
  "./src/ui/input-behavior.js",
  "./src/workflow.js"
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

const ASSET_PATHS=new Set(
  ASSETS.map(path=>
    new URL(
      path,
      self.registration.scope
    ).pathname
  )
);

self.addEventListener(
  "install",
  event=>{
    event.waitUntil(
      (async()=>{
        const cache=await caches.open(CACHE_NAME);

        /*
          addAll атомарен: если хотя бы один файл оболочки недоступен,
          установка проваливается и продолжает работать прошлая версия.
        */
        await cache.addAll(ASSETS);

        /*
          Внешний CDN не должен ронять установку: без него приложение
          всё равно стартует, а запрос повторится при первом обращении.
        */
        await cache
          .add(SUPABASE_CDN_URL)
          .catch(()=>{});
      })()
    );
  }
);

self.addEventListener(
  "activate",
  event=>{
    event.waitUntil(
      (async()=>{
        const names=await caches.keys();

        await Promise.all(
          names
            .filter(name=>
              name!==CACHE_NAME &&
              name.startsWith("sr-team-")
            )
            .map(name=>caches.delete(name))
        );

        await self.clients.claim();
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

async function cacheFirst(request){
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

    if(response.ok){
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

async function navigationResponse(request){
  const cache=await caches.open(CACHE_NAME);

  try{
    const response=await fetchWithTimeout(request);

    if(
      response.ok &&
      (
        response.headers.get("content-type") || ""
      ).includes("text/html")
    ){
      await cache.put(
        request,
        response.clone()
      );
    }

    return response;
  }catch{
    const cached=await cache.match(
      request,
      {ignoreSearch:true}
    );

    if(cached){
      return cached;
    }

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

    if(url.href===SUPABASE_CDN_URL){
      event.respondWith(cacheFirst(request));
      return;
    }

    if(url.origin!==scope.origin){
      return;
    }

    if(request.mode==="navigate"){
      event.respondWith(
        navigationResponse(request)
      );

      return;
    }

    if(ASSET_PATHS.has(url.pathname)){
      event.respondWith(cacheFirst(request));
    }
  }
);
