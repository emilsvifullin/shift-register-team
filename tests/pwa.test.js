import test from "node:test";
import assert from "node:assert/strict";

import {
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
