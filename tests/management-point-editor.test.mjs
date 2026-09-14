import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCurrentTariffDate,
  assertNewTariffDate,
  currentTariffForDate,
  dateLabelToYmd
} from "../src/management-point-editor.js";

test("parses Russian tariff date labels",()=>{
  assert.equal(
    dateLabelToYmd("1 сентября 2026"),
    "2026-09-01"
  );
  assert.equal(
    dateLabelToYmd("31 февраля 2026"),
    ""
  );
});

test("current tariff is the latest tariff active today",()=>{
  const tariffs=[
    {id:"old",effective_from:"2026-09-01"},
    {id:"current",effective_from:"2026-09-14"},
    {id:"planned",effective_from:"2026-09-20"}
  ];

  assert.equal(
    currentTariffForDate(
      tariffs,
      "2026-09-14"
    )?.id,
    "current"
  );
});

test("editing current tariff never turns it into history",()=>{
  const tariffs=[
    {id:"old",effective_from:"2026-08-01"},
    {id:"current",effective_from:"2026-09-14"}
  ];

  assert.doesNotThrow(()=>
    assertCurrentTariffDate({
      tariffs,
      tariffId:"current",
      effectiveFrom:"2026-09-01",
      today:"2026-09-14"
    })
  );

  assert.throws(()=>
    assertCurrentTariffDate({
      tariffs,
      tariffId:"current",
      effectiveFrom:"2026-07-31",
      today:"2026-09-14"
    }),
    /позже предыдущего тарифа/i
  );

  assert.throws(()=>
    assertCurrentTariffDate({
      tariffs,
      tariffId:"current",
      effectiveFrom:"2026-09-20",
      today:"2026-09-14"
    }),
    /новый тариф с даты/i
  );
});

test("new tariff must start after the current version",()=>{
  const tariffs=[
    {id:"current",effective_from:"2026-09-14"}
  ];

  assert.throws(()=>
    assertNewTariffDate({
      tariffs,
      effectiveFrom:"2026-09-01",
      today:"2026-09-14"
    }),
    /измените текущий тариф/i
  );

  assert.doesNotThrow(()=>
    assertNewTariffDate({
      tariffs,
      effectiveFrom:"2026-09-15",
      today:"2026-09-14"
    })
  );
});
