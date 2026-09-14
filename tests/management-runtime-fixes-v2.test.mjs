import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

import {
  MANAGEMENT_RUNTIME_STYLE,
  shouldPrimeCurrentTariff
} from "../src/management-runtime-fixes.js";

const source=await readFile(
  new URL(
    "../src/management-runtime-fixes.js",
    import.meta.url
  ),
  "utf8"
);

test("management runtime never blocks the native tariff click chain",()=>{
  assert.doesNotMatch(
    source,
    /stopImmediatePropagation\s*\(/
  );
  assert.doesNotMatch(
    source,
    /preventDefault\s*\(/
  );
});

test("current tariff can be primed but create passthrough never is",()=>{
  assert.equal(
    shouldPrimeCurrentTariff({
      createPass:false,
      text:"Изменить текущий тариф",
      hasCurrent:true
    }),
    true
  );

  assert.equal(
    shouldPrimeCurrentTariff({
      createPass:true,
      text:"Изменить текущий тариф",
      hasCurrent:true
    }),
    false
  );

  assert.equal(
    shouldPrimeCurrentTariff({
      createPass:false,
      text:"Отменить",
      hasCurrent:true
    }),
    false
  );
});

test("pointer focus suppression is applied before the back proxy can flash",()=>{
  assert.match(
    MANAGEMENT_RUNTIME_STYLE,
    /#prevM\[data-pointer-focus-suppressed="true"\]:focus-visible/
  );
  assert.match(
    MANAGEMENT_RUNTIME_STYLE,
    /background:transparent !important/
  );
});
