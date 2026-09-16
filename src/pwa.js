/*
  Регистрация и обновление service worker.

  Новая версия ставится в фоне и ждёт в состоянии `waiting`. Переключение
  на неё перезагружает страницу, поэтому делается только тогда, когда
  перезагрузка ничего не отнимает у человека:

  - приложение свёрнуто — вернувшись, человек увидит уже новую версию;
  - или страница только что открылась и ей ещё не пользовались.

  И в обоих случаях — только если приложение не занято: открытая модалка,
  незаписанный черновик или идущее сохранение откладывают обновление.
*/

const UPDATE_CHECK_INTERVAL=15*60*1000;

/*
  Если worker так и не сменил контроллер (его вытеснила следующая версия
  или он стал redundant), попытка активации снимается и повторится позже.
*/
const ACTIVATION_TIMEOUT=10000;

export function shouldCheckForUpdate(lastCheckedAt,now,interval=UPDATE_CHECK_INTERVAL){
  return now-lastCheckedAt>=interval;
}

export function canApplyUpdate({hidden,interacted,ready}){
  return ready && (hidden || !interacted);
}

export function installPwa({
  isReadyForUpdate=()=>true,
  windowRef=globalThis,
  documentRef=globalThis.document,
  navigatorRef=globalThis.navigator || {}
}={}){
  if(!("serviceWorker" in navigatorRef)){
    return {
      applyUpdate(){},
      stop(){}
    };
  }

  const serviceWorker=navigatorRef.serviceWorker;

  let registration=null;
  let waiting=null;
  let activating=false;
  let activationTimer=0;
  let controlled=Boolean(serviceWorker.controller);
  let stale=false;
  let interacted=false;
  let lastCheckedAt=0;
  let stopped=false;

  const allowed=()=>canApplyUpdate({
    hidden:documentRef.visibilityState==="hidden",
    interacted,
    ready:isReadyForUpdate()
  });

  const checkForUpdate=async()=>{
    const now=Date.now();

    if(
      !registration ||
      !shouldCheckForUpdate(lastCheckedAt,now)
    ){
      return;
    }

    lastCheckedAt=now;

    try{
      await registration.update();
    }catch{
      /*
        Сеть недоступна — приложение продолжает работать из кеша,
        проверка повторится при следующем возвращении на вкладку.
      */
    }
  };

  const reload=()=>{
    stopped=true;
    windowRef.location.reload();
  };

  const applyUpdate=()=>{
    if(stopped || !allowed()){
      return;
    }

    /*
      Версию уже переключила другая вкладка: эта страница работает со
      старыми модулями и должна перезагрузиться при первой возможности.
    */
    if(stale){
      reload();
      return;
    }

    if(!waiting || activating){
      return;
    }

    activating=true;
    waiting.postMessage({type:"activate-update"});

    activationTimer=windowRef.setTimeout(
      ()=>{
        activating=false;
      },
      ACTIVATION_TIMEOUT
    );
  };

  const trackWaiting=worker=>{
    if(!worker){
      return;
    }

    waiting=worker;
    applyUpdate();
  };

  const onControllerChange=()=>{
    windowRef.clearTimeout(activationTimer);

    /*
      Первая установка забирает уже открытую страницу через
      clients.claim(): страница загружена из сети той же версии, и
      перезагружать её незачем.
    */
    if(!controlled){
      controlled=true;
      return;
    }

    if(activating || allowed()){
      reload();
      return;
    }

    stale=true;
  };

  const onInteraction=()=>{
    interacted=true;
  };

  const onVisibilityChange=()=>{
    if(documentRef.visibilityState==="visible"){
      void checkForUpdate();
      return;
    }

    applyUpdate();
  };

  serviceWorker.addEventListener(
    "controllerchange",
    onControllerChange
  );

  documentRef.addEventListener(
    "pointerdown",
    onInteraction,
    {capture:true,passive:true}
  );

  documentRef.addEventListener(
    "keydown",
    onInteraction,
    true
  );

  documentRef.addEventListener(
    "visibilitychange",
    onVisibilityChange
  );

  void (async()=>{
    try{
      registration=await serviceWorker.register(
        "./sw.js",
        {updateViaCache:"none"}
      );

      if(stopped){
        return;
      }

      lastCheckedAt=Date.now();

      registration.addEventListener(
        "updatefound",
        ()=>{
          const installing=registration.installing;

          installing?.addEventListener(
            "statechange",
            ()=>{
              if(
                installing.state==="installed" &&
                serviceWorker.controller
              ){
                trackWaiting(installing);
              }

              if(
                installing.state==="redundant" &&
                waiting===installing
              ){
                waiting=null;
                activating=false;
                windowRef.clearTimeout(activationTimer);
              }
            }
          );
        }
      );

      trackWaiting(registration.waiting);
    }catch(error){
      console.error(
        "Service worker не зарегистрирован:",
        error
      );
    }
  })();

  return {
    applyUpdate,
    stop(){
      stopped=true;
      windowRef.clearTimeout(activationTimer);

      serviceWorker.removeEventListener?.(
        "controllerchange",
        onControllerChange
      );

      documentRef.removeEventListener(
        "pointerdown",
        onInteraction,
        {capture:true}
      );

      documentRef.removeEventListener(
        "keydown",
        onInteraction,
        true
      );

      documentRef.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
    }
  };
}
