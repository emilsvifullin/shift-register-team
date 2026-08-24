import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePhone,
  optionalPhone,
  phoneLabel
} from "../src/phone.js";

test(
  "Russian employee phones normalize to E.164",
  ()=>{
    assert.equal(
      normalizePhone(
        "8 (999) 123-45-67"
      ),
      "+79991234567"
    );

    assert.equal(
      normalizePhone(
        "999 123 45 67"
      ),
      "+79991234567"
    );
  }
);

test(
  "international employee phones stay valid",
  ()=>{
    assert.equal(
      normalizePhone(
        "+44 7700 900123"
      ),
      "+447700900123"
    );

    assert.equal(
      optionalPhone(""),
      null
    );
  }
);

test(
  "invalid phone is rejected and Russian phone is formatted",
  ()=>{
    assert.throws(
      ()=>normalizePhone("123"),
      /кодом страны/u
    );

    assert.equal(
      phoneLabel("+79991234567"),
      "+7 (999) 123-45-67"
    );
  }
);
