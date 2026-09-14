/*
  Регистрация и обновление service worker.

  Обновление применяется только когда страница к этому готова: иначе
  перезагрузка уносит открытую форму или незаписанный черновик. Пока
  приложение занято, новая версия просто ждёт в состоянии `waiting`.
*/

const UPDATE_CHECK_INTERVAL=15*60*1000;

export function shouldCheckForUpdate(lastCheckedAt,now,interval=UPDATE_CHECK_INTERVAL){
  return now-lastCheckedAt>=interval;
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

  let registration=null;
  let waiting=null;
  let reloading=false;
  let lastCheckedAt=0;
  let stopped=false;

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

  const applyUpdate=()=>{
    if(
      stopped ||
      !waiting ||
      reloading ||
      !isReadyForUpdate()
    ){
      return;
    }

    reloading=true;
    waiting.postMessage({type:"activate-update"});
  };

  const trackWaiting=worker=>{
    if(!worker){
      return;
    }

    waiting=worker;
    applyUpdate();
  };

  navigatorRef.serviceWorker.addEventListener(
    "controllerchange",
    ()=>{
      if(reloading){
        windowRef.location.reload();
      }
    }
  );

  const onVisibilityChange=()=>{
    if(documentRef.visibilityState!=="visible"){
      return;
    }

    void checkForUpdate();
    applyUpdate();
  };

  documentRef.addEventListener(
    "visibilitychange",
    onVisibilityChange
  );

  void (async()=>{
    try{
      registration=
        await navigatorRef.serviceWorker.register(
          "./sw.js",
          {updateViaCache:"none"}
        );

      if(stopped){
        return;
      }

      lastCheckedAt=Date.now();
      trackWaiting(registration.waiting);

      registration.addEventListener(
        "updatefound",
        ()=>{
          const installing=registration.installing;

          installing?.addEventListener(
            "statechange",
            ()=>{
              if(
                installing.state==="installed" &&
                navigatorRef.serviceWorker.controller
              ){
                trackWaiting(registration.waiting);
              }
            }
          );
        }
      );
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
      documentRef.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
    }
  };
}
