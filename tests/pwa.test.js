import test from "node:test";
import assert from "node:assert/strict";

import {
  canApplyUpdate,
  installPwa,
  shouldCheckForUpdate
} from "../src/pwa.js";

/*
  Возвращение на вкладку раньше запускало registration.update() каждый
  раз. На телефоне это сетевой запрос при каждом переключении приложения.
*/
test(
  "update checks are throttled between visibility changes",
  ()=>{
    const interval=15*60*1000;

    assert.equal(
      shouldCheckForUpdate(0,interval-1,interval),
      false
    );

    assert.equal(
      shouldCheckForUpdate(0,interval,interval),
      true
    );
  }
);

test(
  "a browser without service workers is left alone",
  ()=>{
    const controller=installPwa({
      navigatorRef:{},
      documentRef:{
        addEventListener(){
          assert.fail(
            "must not listen without support"
          );
        }
      }
    });

    assert.equal(typeof controller.stop,"function");
    assert.equal(typeof controller.applyUpdate,"function");
  }
);

test(
  "an update only takes over when the reload costs the person nothing",
  ()=>{
    assert.equal(
      canApplyUpdate({hidden:false,interacted:false,ready:true}),
      true,
      "a page nobody has touched yet"
    );

    assert.equal(
      canApplyUpdate({hidden:true,interacted:true,ready:true}),
      true,
      "the app was sent to the background"
    );

    assert.equal(
      canApplyUpdate({hidden:false,interacted:true,ready:true}),
      false,
      "the person is using the page right now"
    );

    assert.equal(
      canApplyUpdate({hidden:true,interacted:false,ready:false}),
      false,
      "an open form or a running save always wins"
    );
  }
);

class Target{
  constructor(){
    this.listeners=new Map();
  }

  addEventListener(type,listener){
    if(!this.listeners.has(type)){
      this.listeners.set(type,new Set());
    }

    this.listeners.get(type).add(listener);
  }

  removeEventListener(type,listener){
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type,event={}){
    for(const listener of this.listeners.get(type) || []){
      listener(event);
    }
  }
}

class FakeWorker extends Target{
  constructor(state="installing"){
    super();
    this.state=state;
    this.messages=[];
  }

  postMessage(message){
    this.messages.push(message);
  }

  become(state){
    this.state=state;
    this.dispatch("statechange");
  }
}

async function setup({
  controlled=true,
  waiting=null,
  ready=()=>true
}={}){
  const registration=new Target();
  registration.waiting=waiting;
  registration.installing=null;
  registration.update=async()=>{};

  const serviceWorker=new Target();
  serviceWorker.controller=controlled ? {} : null;
  serviceWorker.register=async()=>registration;

  const documentRef=new Target();
  documentRef.visibilityState="visible";

  const timers=[];
  const windowRef={
    reloads:0,
    location:{
      reload(){
        windowRef.reloads++;
      }
    },
    setTimeout(callback){
      timers.push(callback);
      return timers.length;
    },
    clearTimeout(){}
  };

  const pwa=installPwa({
    isReadyForUpdate:ready,
    windowRef,
    documentRef,
    navigatorRef:{serviceWorker}
  });

  await new Promise(resolve=>setImmediate(resolve));

  const deliver=worker=>{
    registration.installing=worker;
    registration.dispatch("updatefound");
    worker.become("installed");
    registration.waiting=worker;
  };

  const hide=()=>{
    documentRef.visibilityState="hidden";
    documentRef.dispatch("visibilitychange");
  };

  const touch=()=>documentRef.dispatch("pointerdown");

  return {
    pwa,
    registration,
    serviceWorker,
    documentRef,
    windowRef,
    timers,
    deliver,
    hide,
    touch
  };
}

const ACTIVATE={type:"activate-update"};

test(
  "a version waiting at startup takes over before the page is used",
  async()=>{
    const waiting=new FakeWorker("installed");
    const env=await setup({waiting});

    assert.deepEqual(waiting.messages,[ACTIVATE]);

    env.serviceWorker.dispatch("controllerchange");

    assert.equal(env.windowRef.reloads,1);
  }
);

test(
  "an update that arrives mid-use waits until the app is backgrounded",
  async()=>{
    const env=await setup();
    const next=new FakeWorker();

    env.touch();
    env.deliver(next);

    assert.deepEqual(
      next.messages,
      [],
      "must not reload under the person's finger"
    );

    env.hide();

    assert.deepEqual(next.messages,[ACTIVATE]);

    env.serviceWorker.dispatch("controllerchange");

    assert.equal(env.windowRef.reloads,1);
  }
);

test(
  "unsaved work postpones the update even in the background",
  async()=>{
    let busy=true;
    const env=await setup({ready:()=>!busy});
    const next=new FakeWorker();

    env.deliver(next);
    env.hide();

    assert.deepEqual(next.messages,[]);

    busy=false;
    env.documentRef.dispatch("visibilitychange");

    assert.deepEqual(next.messages,[ACTIVATE]);
  }
);

test(
  "the first install claiming the page does not reload it",
  async()=>{
    const env=await setup({controlled:false});

    env.serviceWorker.controller={};
    env.serviceWorker.dispatch("controllerchange");

    assert.equal(env.windowRef.reloads,0);
  }
);

test(
  "a version switched by another tab reloads this one at the next safe moment",
  async()=>{
    const env=await setup();

    env.touch();
    env.serviceWorker.dispatch("controllerchange");

    assert.equal(
      env.windowRef.reloads,
      0,
      "the person is using this tab"
    );

    env.hide();

    assert.equal(env.windowRef.reloads,1);
  }
);

test(
  "an activation that never switches the controller is retried later",
  async()=>{
    const env=await setup();
    const first=new FakeWorker();

    env.deliver(first);

    assert.deepEqual(first.messages,[ACTIVATE]);

    first.become("redundant");

    const second=new FakeWorker();

    env.deliver(second);

    assert.deepEqual(second.messages,[ACTIVATE]);
  }
);
