import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  readFile
} from "node:fs/promises";

import {
  serviceWorkerShell,
  serviceWorkerSource,
  shellFingerprint
} from "../scripts/stamp-sw.mjs";

/*
  Поведение sw.js проверяется на настоящем коде worker: он выполняется в
  песочнице с Cache Storage, fetch и clients в памяти. Так видно, что
  именно получит страница после выкладки, а не то, как выглядит исходник.
*/

const root=new URL("../",import.meta.url);
const SCOPE="https://shift.example/";
const CDN="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3";

const source=await serviceWorkerSource();
const shell=serviceWorkerShell(source);

function absolute(input){
  return new URL(
    typeof input==="string" ? input : input.url,
    SCOPE
  );
}

class FakeRequest{
  constructor(input,init={}){
    this.url=absolute(input).href;
    this.method=init.method || "GET";
    this.mode=init.mode || "cors";
    this.cache=init.cache || "default";
  }
}

class FakeCache{
  constructor(fetchImpl){
    this.fetch=fetchImpl;
    this.entries=new Map();
  }

  async match(input,{ignoreSearch=false}={}){
    const wanted=absolute(input);

    for(const [key,response] of this.entries){
      const url=new URL(key);

      const same=ignoreSearch
        ? url.origin+url.pathname===wanted.origin+wanted.pathname
        : url.href===wanted.href;

      if(same){
        return response.clone();
      }
    }

    return undefined;
  }

  async put(input,response){
    this.entries.set(absolute(input).href,response.clone());
  }

  async add(input){
    await this.addAll([input]);
  }

  async addAll(inputs){
    const requests=inputs.map(input=>
      input instanceof FakeRequest ? input : new FakeRequest(input)
    );

    const responses=await Promise.all(
      requests.map(request=>this.fetch(request))
    );

    if(responses.some(response=>!response.ok)){
      throw new TypeError("addAll: bad response");
    }

    requests.forEach((request,index)=>
      this.entries.set(request.url,responses[index])
    );
  }
}

function createWorker({
  files={},
  legacyCaches=[],
  windows=[],
  offline=false
}={}){
  const listeners={};
  const calls={
    fetch:[],
    skipWaiting:0,
    claim:0,
    navigate:[]
  };

  const fetchImpl=async request=>{
    calls.fetch.push({
      url:request.url,
      cache:request.cache
    });

    if(offline){
      throw new TypeError("offline");
    }

    if(request.url===CDN){
      return new Response("globalThis.supabase={};",{status:200});
    }

    const path="./"+new URL(request.url).pathname.slice(1);

    if(path in files){
      return new Response(files[path],{status:200});
    }

    try{
      const body=await readFile(
        new URL(path==="./" ? "index.html" : path,root)
      );

      return new Response(body,{
        status:200,
        headers:{
          "content-type":path.endsWith(".html") || path==="./"
            ? "text/html; charset=utf-8"
            : "text/plain"
        }
      });
    }catch{
      return new Response("not found",{status:404});
    }
  };

  const store=new Map();

  const caches={
    async open(name){
      if(!store.has(name)){
        store.set(name,new FakeCache(fetchImpl));
      }

      return store.get(name);
    },
    async keys(){
      return [...store.keys()];
    },
    async delete(name){
      return store.delete(name);
    },
    async has(name){
      return store.has(name);
    }
  };

  for(const name of legacyCaches){
    store.set(name,new FakeCache(fetchImpl));
  }

  /*
    Как в браузере: навигация клиента обслуживается только после того,
    как активация worker завершилась.
  */
  let activated=()=>{};
  const activation=new Promise(resolve=>{
    activated=resolve;
  });

  const clients=windows.map(url=>({
    url,
    navigate(target){
      calls.navigate.push(target);
      return activation.then(()=>this);
    }
  }));

  const context={
    self:{
      registration:{scope:SCOPE},
      addEventListener(type,listener){
        listeners[type]=listener;
      },
      skipWaiting(){
        calls.skipWaiting++;
        return Promise.resolve();
      },
      clients:{
        claim(){
          calls.claim++;
          return Promise.resolve();
        },
        matchAll(){
          return Promise.resolve(clients);
        }
      }
    },
    caches,
    fetch:fetchImpl,
    Request:FakeRequest,
    Response,
    URL,
    TextEncoder,
    crypto:globalThis.crypto,
    AbortController,
    setTimeout,
    clearTimeout,
    console
  };

  context.globalThis=context;

  vm.runInNewContext(source,context);

  const extendable=type=>async(extra={})=>{
    let pending=Promise.resolve();

    const event={
      ...extra,
      waitUntil(promise){
        pending=promise;
      },
      respondWith(promise){
        pending=promise;
        event.responded=true;
      }
    };

    listeners[type](event);

    const value=await Promise.race([
      pending,
      new Promise((_,reject)=>setTimeout(
        ()=>reject(new Error(`${type} never settled`)),
        1000
      ))
    ]);

    if(type==="activate"){
      activated();
    }

    return {event,value};
  };

  return {
    calls,
    store,
    install:extendable("install"),
    activate:extendable("activate"),
    async navigate(path){
      const {event,value}=await extendable("fetch")({
        request:new FakeRequest(path,{mode:"navigate"})
      });

      return event.responded ? value : null;
    },
    async get(path){
      const {event,value}=await extendable("fetch")({
        request:new FakeRequest(path)
      });

      return event.responded ? value : null;
    },
    message(data){
      listeners.message({data});
    }
  };
}

test(
  "the worker computes the same shell fingerprint as the stamp script",
  async()=>{
    const worker=createWorker();

    await worker.install();

    assert.equal(worker.store.size,1);
    assert.equal(
      [...worker.store.keys()][0],
      shell.cacheName
    );

    assert.equal(
      shell.fingerprint,
      await shellFingerprint(shell.assets)
    );
  }
);

test(
  "installing precaches every shell file past the HTTP cache",
  async()=>{
    const worker=createWorker();

    await worker.install();

    const shellFetches=worker.calls.fetch.filter(call=>
      call.url!==CDN
    );

    assert.equal(shellFetches.length,shell.assets.length);

    assert.ok(
      shellFetches.every(call=>call.cache==="reload"),
      "GitHub Pages sends max-age=600: precache must bypass the HTTP cache"
    );

    assert.equal(worker.calls.skipWaiting,0);
  }
);

test(
  "a generation mixed with stale files is never installed",
  async()=>{
    const worker=createWorker({
      files:{
        "./src/app.js":"// файл из прошлой выкладки"
      }
    });

    await assert.rejects(
      worker.install(),
      /собрана не полностью/
    );

    assert.equal(
      worker.store.has(shell.cacheName),
      false,
      "a rejected generation must not leave a partial cache behind"
    );
  }
);

test(
  "shell documents come from the same generation as the modules",
  async()=>{
    const worker=createWorker();

    await worker.install();
    await worker.activate();

    worker.calls.fetch.length=0;

    const cachedIndex=await readFile(new URL("index.html",root),"utf8");

    for(const path of ["./","./index.html","./index.html?from=login"]){
      const response=await worker.navigate(path);

      assert.equal(await response.text(),cachedIndex);
    }

    const login=await worker.navigate("./login.html");

    assert.equal(
      await login.text(),
      await readFile(new URL("login.html",root),"utf8")
    );

    const app=await worker.get("./src/app.js");

    assert.equal(
      await app.text(),
      await readFile(new URL("src/app.js",root),"utf8")
    );

    assert.deepEqual(
      worker.calls.fetch,
      [],
      "a document from the network would run with modules from the cache"
    );
  }
);

test(
  "a running page decides when a regular update takes over",
  async()=>{
    const worker=createWorker({
      legacyCaches:["sr-shell-v7.0.0-000000000000"],
      windows:[SCOPE+"index.html#shifts"]
    });

    await worker.install();

    assert.equal(worker.calls.skipWaiting,0);

    await worker.activate();

    assert.deepEqual(worker.calls.navigate,[]);
    assert.deepEqual(
      [...worker.store.keys()],
      [shell.cacheName]
    );

    worker.message({type:"activate-update"});

    assert.equal(worker.calls.skipWaiting,1);
  }
);

test(
  "upgrading from a pre-7 generation reloads its windows once",
  async()=>{
    const worker=createWorker({
      legacyCaches:["sr-team-runtime-v6.22.63"],
      windows:[
        SCOPE+"index.html#manage",
        SCOPE+"login.html"
      ]
    });

    await worker.install();

    assert.equal(
      worker.calls.skipWaiting,
      1,
      "a pre-7 page never sends activate-update"
    );

    await worker.activate();

    assert.equal(worker.calls.claim,1);

    assert.deepEqual(
      worker.calls.navigate,
      [
        SCOPE+"index.html",
        SCOPE+"login.html"
      ],
      "a URL that differs only by #fragment would not reload the page"
    );

    assert.deepEqual(
      [...worker.store.keys()],
      [shell.cacheName]
    );
  }
);

test(
  "a reinstall of the same generation reuses the verified cache",
  async()=>{
    const worker=createWorker();

    await worker.install();

    worker.calls.fetch.length=0;

    await worker.install();

    assert.deepEqual(
      worker.calls.fetch.map(call=>call.url),
      [CDN]
    );
  }
);

test(
  "the shell keeps working offline",
  async()=>{
    const online=createWorker();

    await online.install();
    await online.activate();

    const cache=online.store.get(shell.cacheName);
    const offline=createWorker({offline:true});

    offline.store.set(shell.cacheName,cache);

    const index=await offline.navigate("./index.html");
    assert.equal(index.status,200);

    const unknown=await offline.navigate("./somewhere");
    assert.equal(
      await unknown.text(),
      await readFile(new URL("index.html",root),"utf8")
    );

    const module=await offline.get("./src/render/dom-patch.js");
    assert.equal(module.status,200);
  }
);
