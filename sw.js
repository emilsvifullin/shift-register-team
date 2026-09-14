const CACHE_NAME=
  "sr-team-runtime-v6.22.55";

const INDEX_FILE=
  "./index.html";

const SUPABASE_CDN_URL=
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3";

const ASSETS=[
  "./",
  INDEX_FILE,
  "./login.html",
  "./styles.css",
  "./styles/platform.css",
  "./styles/accessibility.css",
  "./styles/motion.css",
  "./styles/workflow.css",
  "./styles/auth.css",
  "./styles/refinement.css",
  "./styles/interaction-core.css",
  "./styles/management.css",
  "./styles/motion-reference.css",
  "./styles/modal-motion-exact.css",
  "./styles/interaction.css",
  "./src/ui/input-behavior.js",
  "./manifest.webmanifest",
  "./src/config.js",
  "./src/domain.js",
  "./src/storage.js",
  "./src/team.js",
  "./src/api/result.js",
  "./src/api/read.js",
  "./src/api/employees.js",
  "./src/api/realtime.js",
  "./src/api/shifts.js",
  "./src/api/points.js",
  "./src/api/payouts.js",
  "./src/team-domain.js",
  "./src/workflow.js",
  "./src/phone.js",
  "./src/employee-ui.js",
  "./src/picker-position.js",
  "./src/platform-shell.js",
  "./src/management-employee-points.js",
  "./src/management-tap-intent.js",
  "./src/management-navigation.js",
  "./src/point-card-summaries.js",
  "./src/reference-swipes.js",
  "./src/team-motion.js",
  "./src/modal-motion.js",
  "./src/month-picker-swipe.js",
  "./src/swipe-close-guard.js",
  "./src/supabase.js",
  "./src/auth.js",
  "./src/frame-guard.js",
  "./src/login.js",
  "./src/app.js",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

const REMOTE_ASSETS=[
  SUPABASE_CDN_URL
];

const ASSET_PATHS=
  new Set(
    ASSETS.map(path=>
      new URL(
        path,
        self.registration.scope
      ).pathname
    )
  );

async function precache(
  cache,
  assets
){
  const results=
    await Promise.allSettled(
      assets.map(asset=>
        cache.add(asset)
      )
    );

  const failed=
    results.filter(result=>
      result.status==="rejected"
    );

  if(failed.length){
    console.warn(
      `Не удалось кешировать ${failed.length} ресурсов`
    );
  }
}

self.addEventListener(
  "install",
  event=>{
    event.waitUntil(
      (async()=>{
        const cache=
          await caches.open(
            CACHE_NAME
          );

        await precache(
          cache,
          ASSETS
        );

        await precache(
          cache,
          REMOTE_ASSETS
        );

        await self.skipWaiting();
      })()
    );
  }
);

self.addEventListener(
  "activate",
  event=>{
    event.waitUntil(
      (async()=>{
        const names=
          await caches.keys();

        await Promise.all(
          names
            .filter(
              name=>
                name!==CACHE_NAME
            )
            .filter(
              name=>
                name.startsWith(
                  "sr-team-"
                )
            )
            .map(name=>
              caches.delete(name)
            )
        );

        await self.clients.claim();
      })()
    );
  }
);

function fetchWithTimeout(
  request,
  timeoutMs=5000
){
  const controller=
    new AbortController();

  const timer=
    setTimeout(
      ()=>controller.abort(),
      timeoutMs
    );

  return fetch(
    request,
    {
      cache:"no-store",
      signal:controller.signal
    }
  ).finally(
    ()=>clearTimeout(timer)
  );
}

async function cacheFirst(
  request
){
  const cache=
    await caches.open(
      CACHE_NAME
    );

  const cached=
    await cache.match(
      request,
      {
        ignoreSearch:true
      }
    );

  if(cached){
    return cached;
  }

  try{
    const response=
      await fetchWithTimeout(
        request
      );

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

async function navigationResponse(
  request
){
  const cache=
    await caches.open(
      CACHE_NAME
    );

  try{
    const response=
      await fetchWithTimeout(
        request
      );

    if(response.ok){
      const contentType=
        response.headers.get(
          "content-type"
        ) || "";

      if(
        contentType.includes(
          "text/html"
        )
      ){
        await cache.put(
          request,
          response.clone()
        );
      }
    }

    return response;
  }catch{
    const cached=
      await cache.match(
        request,
        {
          ignoreSearch:true
        }
      );

    if(cached){
      return cached;
    }

    const requestUrl=
      new URL(request.url);

    const scope=
      new URL(
        self.registration.scope
      );

    const indexUrl=
      new URL(
        INDEX_FILE,
        scope
      );

    if(
      requestUrl.pathname===
        scope.pathname ||
      requestUrl.pathname===
        indexUrl.pathname
    ){
      return (
        await cache.match(
          INDEX_FILE
        )
      ) || Response.error();
    }

    return Response.error();
  }
}

self.addEventListener(
  "fetch",
  event=>{
    const request=
      event.request;

    if(request.method!=="GET"){
      return;
    }

    const url=
      new URL(request.url);

    const scope=
      new URL(
        self.registration.scope
      );

    if(
      REMOTE_ASSETS.includes(
        url.href
      )
    ){
      event.respondWith(
        cacheFirst(request)
      );

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
      event.respondWith(
        cacheFirst(request)
      );
    }
  }
);
