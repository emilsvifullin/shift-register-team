import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

import {
  createRouteFetch,
  isReplayable,
  WriteOutcomeUnknownError
} from "../src/network-routes.js";

import {resultData} from "../src/api/result.js";

/*
  Сеть здесь поддельная, но ведёт себя как настоящие отказы: путь,
  который режется на соединении (TypeError), путь, который отвечает
  заголовками и замирает посреди тела (так выглядит фильтрация
  Cloudflare), и шлюз, который отвечает 502.
*/

const PROXY="https://proxy.example";
const DIRECT="https://direct.example";

const ROUTES=[
  {id:"proxy",base:PROXY},
  {id:"direct",base:DIRECT}
];

function network(behaviour){
  const calls=[];

  async function fetchImpl(url,init={}){
    calls.push({url,method:init.method || "GET"});

    const host=url.startsWith(PROXY) ? "proxy" : "direct";
    const mode=behaviour[host] || "ok";

    if(mode==="refused"){
      throw new TypeError("Failed to fetch");
    }

    if(mode==="gateway"){
      return new Response("bad gateway",{status:502});
    }

    /*
      Так выглядит фильтрация Cloudflare: крошечный ответ проверки
      проходит, а настоящий ответ замирает после первых килобайт.
    */
    const throttled=
      mode==="throttled" &&
      !url.endsWith("/auth/v1/health");

    if(mode==="stall" || throttled){
      /*
        Заголовки пришли, тело — никогда. Отмена по сигналу рвёт чтение
        тела, как в браузере.
      */
      return {
        ok:true,
        status:200,
        statusText:"OK",
        headers:new Headers(),
        arrayBuffer:()=>new Promise((_,reject)=>{
          init.signal?.addEventListener("abort",()=>{
            reject(new DOMException("aborted","AbortError"));
          });
        })
      };
    }

    return new Response(
      JSON.stringify({via:host,path:new URL(url).pathname}),
      {status:200,headers:{"content-type":"application/json"}}
    );
  }

  return {fetchImpl,calls};
}

function memoryStorage(){
  const map=new Map();

  return {
    getItem:key=>map.has(key) ? map.get(key) : null,
    setItem:(key,value)=>map.set(key,String(value))
  };
}

function routed(behaviour,extra={}){
  const net=network(behaviour);

  const router=createRouteFetch({
    routes:ROUTES,
    fetchImpl:net.fetchImpl,
    readTimeout:60,
    probeTimeout:60,
    probeStagger:5,
    wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
    ...extra
  });

  return {...net,router};
}

test(
  "a healthy network keeps using the proxy",
  async()=>{
    const {router,calls}=routed({});

    const response=await router.fetch(`${PROXY}/rest/v1/shifts`);

    assert.deepEqual(await response.json(),{
      via:"proxy",
      path:"/rest/v1/shifts"
    });

    /*
      Одна лёгкая проверка на страницу и сам запрос — прямой путь на
      здоровой сети не трогается вовсе.
    */
    assert.deepEqual(
      calls.map(call=>call.url),
      [`${PROXY}/auth/v1/health`,`${PROXY}/rest/v1/shifts`]
    );
  }
);

test(
  "a read goes the other way when the proxy is cut off",
  async()=>{
    const {router,calls}=routed({proxy:"refused"});

    const response=await router.fetch(`${PROXY}/rest/v1/shifts?select=id`);

    assert.equal((await response.json()).via,"direct");

    /* Путь и запрос сохранены, сменился только хост. */
    assert.equal(
      calls.at(-1).url,
      `${DIRECT}/rest/v1/shifts?select=id`
    );

    /* Дальше сразу прямым путём, не спотыкаясь о прокси. */
    await router.fetch(`${PROXY}/rest/v1/points`);

    assert.equal(calls.at(-1).url,`${DIRECT}/rest/v1/points`);
    assert.equal(router.current.id,"direct");
  }
);

test(
  "a response that stalls mid-body is abandoned for the other route",
  async()=>{
    /*
      Прокси проходит проверку здоровья — ответ крошечный, — а на
      настоящем ответе замирает. Именно этот случай проверкой не поймать,
      его ловит срок чтения.
    */
    const {router}=routed({proxy:"throttled"});

    assert.equal((await router.ensureRoute()).id,"proxy");

    const response=await router.fetch(`${PROXY}/rest/v1/shifts`);

    assert.equal((await response.json()).via,"direct");
    assert.equal(router.current.id,"direct");
  }
);

test(
  "a gateway error on a read is treated as a route failure",
  async()=>{
    const {router}=routed({proxy:"gateway"});

    const response=await router.fetch(`${PROXY}/rest/v1/shifts`);

    assert.equal(response.status,200);
    assert.equal((await response.json()).via,"direct");
  }
);

test(
  "when every route returns a gateway error, that error is returned",
  async()=>{
    const {router}=routed({proxy:"gateway",direct:"gateway"});

    const response=await router.fetch(`${PROXY}/rest/v1/shifts`);

    assert.equal(response.status,502);
  }
);

test(
  "a read fails like the network only when every route is down",
  async()=>{
    const {router}=routed({proxy:"refused",direct:"refused"});

    await assert.rejects(
      router.fetch(`${PROXY}/rest/v1/shifts`),
      error=>error instanceof TypeError
    );
  }
);

/*
  Главное свойство: запись не отправляется дважды. Новая выплата
  создаётся на сервере — повтор другим путём после потерянного ответа
  задвоил бы деньги.
*/
test(
  "a write is sent once, over a route checked beforehand",
  async()=>{
    const {router,calls}=routed({proxy:"refused"});

    const response=await router.fetch(
      `${PROXY}/rest/v1/rpc/admin_save_employee_payout`,
      {method:"POST",body:"{}"}
    );

    assert.equal((await response.json()).via,"direct");

    const writes=calls.filter(call=>call.method==="POST");

    assert.equal(writes.length,1);
    assert.equal(
      writes[0].url,
      `${DIRECT}/rest/v1/rpc/admin_save_employee_payout`
    );

    /* Проверка пути — лёгкий запрос здоровья, а не сама запись. */
    assert.ok(
      calls.some(call=>
        call.method==="GET" &&
        call.url.endsWith("/auth/v1/health")
      )
    );
  }
);

test(
  "a write that fails is not resent, but the next one goes the other way",
  async()=>{
    let proxyUp=true;
    const calls=[];

    const router=createRouteFetch({
      routes:ROUTES,
      readTimeout:60,
      probeTimeout:60,
      probeStagger:5,
      async fetchImpl(url,init={}){
        calls.push({url,method:init.method || "GET"});

        if(url.startsWith(PROXY) && !proxyUp){
          throw new TypeError("Failed to fetch");
        }

        return new Response("{}",{status:200});
      }
    });

    /* Прокси проверен и выбран. */
    await router.ensureRoute();
    assert.equal(router.current.id,"proxy");

    proxyUp=false;

    await assert.rejects(
      router.fetch(`${PROXY}/rest/v1/rpc/admin_save_point`,{
        method:"POST",
        body:"{}"
      })
    );

    assert.equal(
      calls.filter(call=>call.method==="POST").length,
      1,
      "упавшая запись не повторяется сама"
    );

    await router.fetch(`${PROXY}/rest/v1/rpc/admin_save_point`,{
      method:"POST",
      body:"{}"
    });

    assert.equal(
      calls.filter(call=>call.method==="POST").at(-1).url,
      `${DIRECT}/rest/v1/rpc/admin_save_point`
    );
  }
);

/* Настоящее потоковое тело: заголовки пришли, JSON так и не закончился. */
function stalledWrite(extra={}){
  const calls=[];
  let writeSignal;
  let signalStarted;
  const started=new Promise(resolve=>{signalStarted=resolve;});
  const router=createRouteFetch({
    routes:ROUTES,
    readTimeout:20,
    writeTimeout:40,
    probeTimeout:20,
    probeStagger:5,
    async fetchImpl(url,init={}){
      calls.push({url,method:init.method || "GET"});
      if(url.endsWith("/auth/v1/health")){
        return new Response("{}");
      }
      writeSignal=init.signal;
      const stream=new ReadableStream({
        start(controller){
          controller.enqueue(new TextEncoder().encode('{"id":'));
          init.signal.addEventListener("abort",()=>{
            controller.error(init.signal.reason);
          },{once:true});
        }
      });
      signalStarted();
      return new Response(stream,{headers:{"content-type":"application/json"}});
    },
    ...extra
  });
  return {router,calls,started,get signal(){return writeSignal;}};
}

test("a stalled write body times out with an unknown result and only one POST",async()=>{
  const net=stalledWrite();
  const pending=net.router.fetch(`${PROXY}/rest/v1/rpc/admin_save_shift_v4`,{
    method:"POST",body:"{}"
  });
  await net.started;
  await assert.rejects(pending,error=>{
    assert.ok(error instanceof WriteOutcomeUnknownError);
    assert.equal(error.code,"write_outcome_unknown");
    assert.equal(error.message,"Результат сохранения неизвестен. Обновите данные перед повтором");
    return true;
  });
  assert.equal(net.signal.aborted,true,"срок отменяет также чтение тела");
  assert.equal(net.calls.filter(call=>call.method==="POST").length,1);
  assert.equal(net.router.current,null,"зависший путь отложен");
  assert.ok(net.calls.every(call=>call.url.startsWith(PROXY)));
});

test("cancelling a write after headers reports an unknown result without demoting the route",async()=>{
  const net=stalledWrite({writeTimeout:1000});
  const controller=new AbortController();
  const pending=net.router.fetch(`${PROXY}/rest/v1/rpc/admin_save_shift_v4`,{
    method:"POST",body:"{}",signal:controller.signal
  });
  await net.started;
  controller.abort();
  await assert.rejects(pending,error=>error.code==="write_outcome_unknown");
  assert.equal(net.signal.aborted,true,"внешний сигнал действует до конца тела");
  assert.equal(net.calls.filter(call=>call.method==="POST").length,1);
  assert.equal(net.router.current.id,"proxy");
});

test("a Request keeps its cancellation signal while waiting for a write body",async()=>{
  const net=stalledWrite({writeTimeout:1000});
  const controller=new AbortController();
  const request=new Request(`${PROXY}/rest/v1/rpc/admin_save_shift_v4`,{
    method:"POST",body:"{}",signal:controller.signal
  });
  const pending=net.router.fetch(request);
  await net.started;
  controller.abort();
  await assert.rejects(pending,error=>error.code==="write_outcome_unknown");
  assert.equal(net.signal.aborted,true);
  assert.equal(net.calls.filter(call=>call.method==="POST").length,1);
});

test("a write cancelled before sending has no unknown result and sends no POST",async()=>{
  const net=stalledWrite();
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(net.router.fetch(`${PROXY}/rest/v1/rpc/admin_save_shift_v4`,{
    method:"POST",body:"{}",signal:controller.signal
  }),error=>error.name==="AbortError" && !error.code?.startsWith?.("write_"));
  assert.equal(net.calls.filter(call=>call.method==="POST").length,0);
});

test("a write with no response headers also finishes within its deadline and is never retried",async()=>{
  let posts=0;
  const router=createRouteFetch({
    routes:ROUTES,writeTimeout:30,probeTimeout:20,probeStagger:5,
    async fetchImpl(url,init){
      if(url.endsWith("/auth/v1/health")) return new Response("{}");
      posts+=1;
      return new Promise((_,reject)=>init.signal.addEventListener("abort",()=>reject(init.signal.reason),{once:true}));
    }
  });
  await assert.rejects(router.fetch(`${PROXY}/rest/v1/rpc/admin_save_shift_v4`,{
    method:"POST",body:"{}"
  }),error=>error.code==="write_outcome_unknown");
  assert.equal(posts,1);
});

test("a completed server rejection remains a known rejection, with status and JSON intact",async()=>{
  const router=createRouteFetch({
    routes:ROUTES,writeTimeout:30,probeTimeout:20,probeStagger:5,
    async fetchImpl(url){
      return url.endsWith("/auth/v1/health")
        ? new Response("{}")
        : new Response('{"code":"22023","message":"payout_exceeds_due:0"}',{status:400,headers:{"content-type":"application/json"}});
    }
  });
  const response=await router.fetch(`${PROXY}/rest/v1/rpc/admin_save_employee_payout_v2`,{
    method:"POST",body:"{}"
  });
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{code:"22023",message:"payout_exceeds_due:0"});
});

test("the pinned Supabase client carries an unknown write result to the app without retrying",async()=>{
  const sdkContext={
    fetch,Headers,Response,Request,AbortController,URL,URLSearchParams,WebSocket,
    TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,console
  };
  vm.runInNewContext(readFileSync(new URL("../vendor/supabase-js-2.112.3.js",import.meta.url),"utf8"),sdkContext);
  const net=stalledWrite();
  const client=sdkContext.supabase.createClient(PROXY,"test-anon-key",{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:net.router.fetch}
  });
  const result=await client.rpc("admin_save_shift_v4",{p_shift_id:"test"});
  assert.match(result.error.message,/^WriteOutcomeUnknownError:/);
  assert.throws(()=>resultData(result,"Не удалось сохранить смену"),error=>{
    assert.equal(error.code,"write_outcome_unknown");
    assert.equal(error.message,"Результат сохранения неизвестен. Обновите данные перед повтором");
    return true;
  });
  assert.equal(net.calls.filter(call=>call.method==="POST").length,1);
});

test(
  "signing in with a password is retried over the other route",
  async()=>{
    let proxyUp=true;
    const calls=[];

    const router=createRouteFetch({
      routes:ROUTES,
      readTimeout:60,
      probeTimeout:60,
      probeStagger:5,
      async fetchImpl(url,init={}){
        calls.push({url,method:init.method || "GET"});

        if(url.startsWith(PROXY) && !proxyUp){
          throw new TypeError("Failed to fetch");
        }

        return new Response(
          JSON.stringify({via:url.startsWith(PROXY) ? "proxy" : "direct"}),
          {status:200}
        );
      }
    });

    /* Прокси был рабочим — и отказал прямо перед входом. */
    await router.ensureRoute();
    proxyUp=false;

    const response=await router.fetch(
      `${PROXY}/auth/v1/token?grant_type=password`,
      {method:"POST",body:"{}"}
    );

    assert.equal((await response.json()).via,"direct");

    assert.deepEqual(
      calls
        .filter(call=>call.method==="POST")
        .map(call=>call.url.startsWith(PROXY) ? "proxy" : "direct"),
      ["proxy","direct"]
    );
  }
);

test(
  "only safe requests are replayable",
  ()=>{
    assert.equal(isReplayable("GET",`${PROXY}/rest/v1/x`),true);
    assert.equal(isReplayable("HEAD",`${PROXY}/rest/v1/x`),true);

    assert.equal(
      isReplayable("POST",`${PROXY}/auth/v1/token?grant_type=password`),
      true
    );

    /* Повтор refresh-токена Supabase считает кражей сеанса. */
    assert.equal(
      isReplayable("POST",`${PROXY}/auth/v1/token?grant_type=refresh_token`),
      false
    );

    assert.equal(isReplayable("POST",`${PROXY}/rest/v1/rpc/x`),false);
    assert.equal(isReplayable("PATCH",`${PROXY}/rest/v1/x`),false);
    assert.equal(isReplayable("DELETE",`${PROXY}/rest/v1/x`),false);
  }
);

test(
  "the probe gives the first route a head start but not the win",
  async()=>{
    const {router}=routed({});

    assert.equal((await router.ensureRoute()).id,"proxy");

    const {router:cut}=routed({proxy:"refused"});

    assert.equal((await cut.ensureRoute()).id,"direct");
  }
);

test(
  "the working route is remembered across page loads",
  async()=>{
    const storage=memoryStorage();

    const first=routed({proxy:"refused"},{storage});
    await first.router.fetch(`${PROXY}/rest/v1/shifts`);

    const second=routed({proxy:"refused"},{storage});
    await second.router.fetch(`${PROXY}/rest/v1/shifts`);

    /*
      Новая страница начинает с запомненного пути: он проверяется первым
      и отвечает раньше, чем отказавший успевает получить свою очередь.
    */
    assert.equal(
      second.calls[0].url,
      `${DIRECT}/auth/v1/health`
    );

    assert.ok(
      second.calls.every(call=>call.url.startsWith(DIRECT)),
      "отказавший путь с прошлой страницы даже не пробуется"
    );
  }
);

test(
  "a caller's own cancellation is not mistaken for a broken route",
  async()=>{
    const {router,calls}=routed(
      {proxy:"throttled"},
      {readTimeout:5000}
    );

    await router.ensureRoute();

    const controller=new AbortController();

    const pending=router.fetch(`${PROXY}/rest/v1/shifts`,{
      signal:controller.signal
    });

    setTimeout(()=>controller.abort(),10);

    await assert.rejects(pending);

    /* Прямой путь не пробовали и прокси не отложили: отменил сам вызывающий. */
    assert.ok(calls.every(call=>call.url.startsWith(PROXY)));
    assert.equal(router.current.id,"proxy");
  }
);

test(
  "requests outside the Supabase base are left alone",
  async()=>{
    const {router,calls}=routed({});

    await router.fetch("https://elsewhere.example/file.json");

    assert.deepEqual(calls.map(call=>call.url),[
      "https://elsewhere.example/file.json"
    ]);
  }
);

/*
  Если путь ещё не известен, запрос дожидается проверки, а не идёт вслепую
  первым путём. Иначе висящий прокси стоил бы весь срок чтения — на входе
  это десятки секунд, — хотя проверка узнаёт рабочий путь за долю секунды.
*/
test(
  "without a known route a request waits for the probe instead of the first route",
  async()=>{
    const {router,calls}=routed(
      {proxy:"stall"},
      {readTimeout:5000,probeTimeout:5000,probeStagger:5}
    );

    const started=Date.now();

    const response=await router.fetch(
      `${PROXY}/auth/v1/token?grant_type=password`,
      {method:"POST",body:"{}"}
    );

    assert.equal((await response.json()).via,"direct");

    assert.ok(
      Date.now()-started<1000,
      "висящий путь не должен стоить срок чтения"
    );

    /* Сам вход ушёл один раз и сразу рабочим путём. */
    assert.deepEqual(
      calls
        .filter(call=>call.method==="POST")
        .map(call=>call.url.startsWith(PROXY) ? "proxy" : "direct"),
      ["direct"]
    );
  }
);

test(
  "a request made while a probe is running joins it",
  async()=>{
    const {router,calls}=routed(
      {proxy:"stall"},
      {readTimeout:5000,probeTimeout:5000,probeStagger:5}
    );

    const warming=router.ensureRoute();

    const response=await router.fetch(`${PROXY}/rest/v1/shifts`);

    assert.equal((await response.json()).via,"direct");
    assert.equal((await warming).id,"direct");

    /* Одна проверка на двоих, а не две. */
    assert.equal(
      calls.filter(call=>
        call.url===`${DIRECT}/auth/v1/health`
      ).length,
      1
    );
  }
);
