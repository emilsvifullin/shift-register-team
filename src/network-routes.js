/*
  Маршруты до Supabase.

  До сервера есть два пути: прокси на Vercel и сам проект Supabase за
  Cloudflare. Разные сети режут разное: Cloudflare в российских сетях
  фильтруется с лета 2025 года (иногда отдаёт только первые килобайты
  ответа и замирает), а инфраструктуру Vercel часть операторов, прежде
  всего мобильных, режет по-своему. Приложение ходило ровно одним путём —
  через прокси, — поэтому у человека, чья сеть режет Vercel, вход
  заканчивался «Сеть не пропускает сервер авторизации», хотя прямой путь
  у него, возможно, открыт.

  Здесь путь выбирается по факту: какой ответил, тем и ходим, а
  отказавший откладывается.

  Главное ограничение — запись нельзя отправлять повторно. Новая выплата
  или новый ПВЗ создаются на сервере; если первый запрос дошёл, а ответ
  потерялся по дороге, повтор другим путём задвоил бы деньги. Поэтому:

  — маршрут для записи выбирается ДО отправки: проверенный недавно или
    проверенный прямо сейчас лёгким запросом здоровья;
  — повторяется автоматически только то, что можно повторить без
    последствий: чтение и вход по паролю;
  — отказ при записи откладывает маршрут, и следующая попытка — уже самого
    человека — идёт другим путём.

  Чтение буферизуется целиком внутри срока. Так замирание посреди тела
  ответа, характерное для фильтрации Cloudflare, видно здесь, а не
  зависает где-то в разборе JSON.
*/

const DEFAULTS=Object.freeze({
  /* Сколько ждать чтение целиком, прежде чем идти другим путём. */
  readTimeout:15000,
  /* Сколько ждать ответа на проверку пути. */
  probeTimeout:6000,
  /* Фора первому пути при проверке, прежде чем стартует следующий. */
  probeStagger:350,
  /* Сколько проверенный путь считается свежим для записи. */
  freshFor:60000,
  /* Сколько отказавший путь пропускается, если есть другие. */
  demoteFor:5*60000,
  probePath:"/auth/v1/health",
  storageKey:"sr-network-route-v1"
});

/* Ответ шлюза — отказ пути, а не запроса. */
const GATEWAY_FAILURES=new Set([502,504]);

const EMPTY_BODY_STATUSES=new Set([204,205,304]);

export class NetworkRouteError extends TypeError{
  constructor(message="Failed to fetch"){
    super(message);
    this.name="NetworkRouteError";
  }
}

function methodOf(input,init){
  return String(
    init?.method ||
    (typeof input==="object" && input?.method) ||
    "GET"
  ).toUpperCase();
}

function urlOf(input){
  if(typeof input==="string"){
    return input;
  }

  if(input instanceof URL){
    return input.href;
  }

  return input?.url || "";
}

/*
  Повторять можно то, что не меняет данных, и вход по паролю: второй
  выданный сеанс ничего не портит. Обновление токена сюда не входит —
  Supabase считает повтор старого refresh-токена за пределами короткого
  окна попыткой кражи и отзывает все сеансы.
*/
export function isReplayable(method,url){
  if(method==="GET" || method==="HEAD"){
    return true;
  }

  if(method!=="POST"){
    return false;
  }

  try{
    const parsed=new URL(url);

    return (
      parsed.pathname.endsWith("/auth/v1/token") &&
      parsed.searchParams.get("grant_type")==="password"
    );
  }catch{
    return false;
  }
}

export function createRouteFetch(options){
  const {
    routes,
    fetchImpl,
    storage=null,
    now=()=>Date.now(),
    wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms)),
    probeHeaders={},
    ...rest
  }=options;

  const settings={...DEFAULTS,...rest};

  if(!Array.isArray(routes) || !routes.length){
    throw new Error("Нужен хотя бы один маршрут");
  }

  /* Адреса строит клиент Supabase от первого, канонического пути. */
  const canonical=routes[0].base.replace(/\/+$/,"");

  const demotedUntil=new Map();

  let current=null;
  let verifiedAt=0;
  let probing=null;

  function remembered(){
    try{
      const saved=JSON.parse(
        storage?.getItem(settings.storageKey) || "null"
      );

      return routes.find(route=>route.id===saved?.id) || null;
    }catch{
      return null;
    }
  }

  function remember(route){
    try{
      storage?.setItem(
        settings.storageKey,
        JSON.stringify({id:route.id,at:now()})
      );
    }catch{}
  }

  /*
    Порядок попыток: текущий или запомненный путь первым, дальше по
    конфигурации. Отложенные пути идут в конец, но не исчезают: если
    отказали все, пробуем всё равно — сеть могла поправиться.
  */
  function ordered(){
    const preferred=current || remembered();
    const list=preferred
      ? [preferred,...routes.filter(route=>route!==preferred)]
      : [...routes];

    const at=now();
    const live=list.filter(route=>
      (demotedUntil.get(route.id) || 0)<=at
    );
    const resting=list.filter(route=>!live.includes(route));

    return [...live,...resting];
  }

  function choose(route){
    current=route;
    verifiedAt=now();
    demotedUntil.delete(route.id);
    remember(route);
  }

  function demote(route){
    demotedUntil.set(route.id,now()+settings.demoteFor);

    if(current===route){
      current=null;
      verifiedAt=0;
    }
  }

  function rewrite(url,route){
    return route.base.replace(/\/+$/,"")+
      url.slice(canonical.length);
  }

  /*
    Запрос с собственным сроком. Сигнал вызывающего уважается: его отмена
    — это не отказ пути, и она пробрасывается как есть.
  */
  async function attempt(url,init,timeout,{buffer}){
    const controller=new AbortController();
    const outer=init?.signal;
    let timedOut=false;

    const onOuterAbort=()=>controller.abort(outer.reason);

    if(outer){
      if(outer.aborted){
        controller.abort(outer.reason);
      }else{
        outer.addEventListener("abort",onOuterAbort,{once:true});
      }
    }

    const timer=timeout
      ? setTimeout(()=>{
          timedOut=true;
          controller.abort();
        },timeout)
      : null;

    try{
      const response=await fetchImpl(url,{
        ...init,
        signal:controller.signal
      });

      if(!buffer){
        return {response};
      }

      const body=EMPTY_BODY_STATUSES.has(response.status)
        ? null
        : await response.arrayBuffer();

      return {
        response:new Response(body,{
          status:response.status,
          statusText:response.statusText,
          headers:response.headers
        })
      };
    }catch(error){
      if(outer?.aborted){
        throw error;
      }

      return {
        failure:timedOut
          ? new NetworkRouteError("Сервер не ответил вовремя")
          : error
      };
    }finally{
      if(timer){
        clearTimeout(timer);
      }

      outer?.removeEventListener?.("abort",onOuterAbort);
    }
  }

  /*
    Проверка путей по принципу happy eyeballs: первый путь стартует сразу,
    следующий — с небольшой форой первому. Побеждает первый ответивший;
    на здоровой сети это почти всегда первый путь, и лишних запросов нет.
  */
  function probe(){
    if(probing){
      return probing;
    }

    const candidates=ordered();

    probing=new Promise((resolve,reject)=>{
      let settled=false;
      let pending=candidates.length;

      candidates.forEach(async(route,index)=>{
        if(index){
          await wait(settings.probeStagger*index);
        }

        if(settled){
          pending-=1;
          return;
        }

        const {response}=await attempt(
          route.base.replace(/\/+$/,"")+settings.probePath,
          {method:"GET",headers:probeHeaders},
          settings.probeTimeout,
          {buffer:true}
        );

        pending-=1;

        if(settled){
          return;
        }

        if(response?.ok){
          settled=true;
          choose(route);
          resolve(route);
          return;
        }

        demote(route);

        if(!pending){
          reject(new NetworkRouteError(
            "Ни один путь до сервера не отвечает"
          ));
        }
      });
    }).finally(()=>{
      probing=null;
    });

    return probing;
  }

  async function ensureRoute({force=false}={}){
    if(
      !force &&
      current &&
      now()-verifiedAt<settings.freshFor
    ){
      return current;
    }

    return probe();
  }

  async function routedFetch(input,init={}){
    const url=urlOf(input);

    if(!url.startsWith(canonical)){
      return fetchImpl(input,init);
    }

    const method=methodOf(input,init);

    /*
      Тело запроса из объекта Request переносим в init: сам Request после
      первой отправки прочитан, а повторять его другим путём нужно.
    */
    let requestInit={...init,method};

    if(typeof input==="object" && !(input instanceof URL)){
      requestInit={
        headers:input.headers,
        body:method==="GET" || method==="HEAD"
          ? undefined
          : await input.clone().text(),
        ...requestInit
      };
    }

    if(isReplayable(method,url)){
      /*
        Пока рабочий путь не известен, запрос дожидается проверки — или
        присоединяется к уже идущей. Вслепую первым путём он простоял бы на
        висящем прокси весь срок чтения: на входе это были десятки секунд,
        хотя проверка узнаёт рабочий путь за долю секунды.
      */
      if(probing || !current){
        await (probing || probe()).catch(()=>{});
      }

      let lastFailure=null;
      let gatewayResponse=null;

      for(const route of ordered()){
        const {response,failure}=await attempt(
          rewrite(url,route),
          requestInit,
          settings.readTimeout,
          {buffer:true}
        );

        if(
          response &&
          !GATEWAY_FAILURES.has(response.status)
        ){
          if(route!==current){
            choose(route);
          }

          return response;
        }

        gatewayResponse=response || gatewayResponse;
        lastFailure=failure || lastFailure;
        demote(route);
      }

      /* Ответ шлюза честнее выдуманной сетевой ошибки. */
      if(gatewayResponse){
        return gatewayResponse;
      }

      throw new NetworkRouteError(
        lastFailure?.message || "Failed to fetch"
      );
    }

    /*
      Запись уходит один раз и только проверенным путём. Если путь не
      отвечает, это выясняется лёгкой проверкой до отправки, а не
      повтором самой записи.
    */
    const route=await ensureRoute();

    const {response,failure}=await attempt(
      rewrite(url,route),
      requestInit,
      0,
      {buffer:false}
    );

    if(response){
      return response;
    }

    demote(route);
    throw failure;
  }

  return {
    fetch:routedFetch,
    ensureRoute,
    get current(){
      return current;
    }
  };
}
