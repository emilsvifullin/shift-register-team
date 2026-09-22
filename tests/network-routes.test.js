import test from "node:test";
import assert from "node:assert/strict";

import {
  createRouteFetch,
  isReplayable
} from "../src/network-routes.js";

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

    if(mode==="stall"){
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

    assert.equal(calls.length,1);
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
    /* Прямой путь запомнен как рабочий — и замирает на теле ответа. */
    const {router:stuck}=routed(
      {direct:"stall"},
      {
        storage:(()=>{
          const storage=memoryStorage();
          storage.setItem(
            "sr-network-route-v1",
            JSON.stringify({id:"direct"})
          );
          return storage;
        })()
      }
    );

    const response=await stuck.fetch(`${PROXY}/rest/v1/shifts`);

    assert.equal((await response.json()).via,"proxy");
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

test(
  "signing in with a password is retried over the other route",
  async()=>{
    const {router,calls}=routed({proxy:"refused"});

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

    /* Новая страница начинает сразу с рабочего пути. */
    assert.equal(
      second.calls[0].url,
      `${DIRECT}/rest/v1/shifts`
    );
  }
);

test(
  "a caller's own cancellation is not mistaken for a broken route",
  async()=>{
    const {router,calls}=routed({proxy:"stall"});
    const controller=new AbortController();

    const pending=router.fetch(`${PROXY}/rest/v1/shifts`,{
      signal:controller.signal
    });

    setTimeout(()=>controller.abort(),10);

    await assert.rejects(pending);

    /* Прямой путь не пробовали: отменил сам вызывающий. */
    assert.ok(calls.every(call=>call.url.startsWith(PROXY)));
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
