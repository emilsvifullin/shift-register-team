import test from "node:test";
import assert from "node:assert/strict";

import {
  stabilizeTariffHelp,
  tariffHelpMessage
} from "../src/management-tariff-freeze-guard.js";

function createFixture(intent="edit-current"){
  const classes=new Set(["employee-help"]);
  let text="Исходная подсказка";
  let writes=0;

  const help={
    classList:{
      add(value){
        classes.add(value);
      },
      remove(value){
        classes.delete(value);
      }
    }
  };

  Object.defineProperty(
    help,
    "textContent",
    {
      get(){
        return text;
      },
      set(value){
        writes+=1;
        text=value;
      }
    }
  );

  const sheet={
    dataset:{tariffIntent:intent},
    querySelectorAll(selector){
      if(selector.includes(".employee-help")){
        return classes.has("employee-help")
          ? [help]
          : [];
      }

      if(selector.includes(".tariff-editor-help")){
        return classes.has("tariff-editor-help")
          ? [help]
          : [];
      }

      return [];
    }
  };

  const documentRef={
    getElementById(id){
      return id==="manageEditorSheet"
        ? sheet
        : null;
    }
  };

  return {
    classes,
    documentRef,
    getText:()=>text,
    getWrites:()=>writes
  };
}

test("tariff help message follows editor intent",()=>{
  assert.match(
    tariffHelpMessage("edit-current"),
    /текущий тариф/i
  );
  assert.match(
    tariffHelpMessage("create"),
    /новая версия тарифа/i
  );
});

test("tariff help stabilization breaks the observer feedback selector",()=>{
  const fixture=createFixture();

  assert.equal(
    stabilizeTariffHelp(fixture.documentRef),
    1
  );
  assert.equal(
    fixture.classes.has("employee-help"),
    false
  );
  assert.equal(
    fixture.classes.has("tariff-editor-help"),
    true
  );
  assert.match(
    fixture.getText(),
    /текущий тариф/i
  );
});

test("repeated observer passes are idempotent and do not rewrite text",()=>{
  const fixture=createFixture();

  stabilizeTariffHelp(fixture.documentRef);
  const writesAfterFirstPass=
    fixture.getWrites();

  stabilizeTariffHelp(fixture.documentRef);

  assert.equal(
    fixture.getWrites(),
    writesAfterFirstPass
  );
});
