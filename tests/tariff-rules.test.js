import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCurrentTariffDate,
  assertNewTariffDate,
  assertTariffVersionDate,
  currentTariffForDate,
  tariffIntentHelp,
  tariffIntentUpdatesRecord
} from "../src/tariff-rules.js";

test("the editor explains which tariff a save will touch",()=>{
  assert.match(
    tariffIntentHelp("edit-current"),
    /не создаётся/i
  );

  assert.match(
    tariffIntentHelp("create"),
    /останется в истории/i
  );
});

test("a tariff may not collide with an existing effective date",()=>{
  assert.throws(()=>
    assertNewTariffDate({
      tariffs:[
        {id:"current",effective_from:"2026-09-14"}
      ],
      effectiveFrom:"2026-09-14",
      today:"2026-09-14"
    }),
    /уже задан/i
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

/*
  Запись из истории, открытая на редактирование, сохраняется на месте.
  Раньше из режима редактирования ПВЗ её сохранение шло как «новый тариф»
  на ту же дату и падало с «На эту дату тариф уже задан».
*/
test("editing a tariff from history updates that record in place",()=>{
  assert.equal(tariffIntentUpdatesRecord("edit-version"),true);
  assert.equal(tariffIntentUpdatesRecord("edit-current"),true);
  assert.equal(tariffIntentUpdatesRecord("create"),false);

  assert.match(
    tariffIntentHelp("edit-version"),
    /из истории/i
  );

  const tariffs=[
    {id:"old",effective_from:"2025-06-01"},
    {id:"current",effective_from:"2026-01-01"}
  ];

  assert.doesNotThrow(()=>
    assertTariffVersionDate({
      tariffs,
      tariffId:"old",
      effectiveFrom:"2025-06-01"
    })
  );

  assert.throws(()=>
    assertTariffVersionDate({
      tariffs,
      tariffId:"old",
      effectiveFrom:"2026-01-01"
    }),
    /уже задан/i
  );
});
