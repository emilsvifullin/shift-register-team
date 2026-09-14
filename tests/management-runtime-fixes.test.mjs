import test from "node:test";
import assert from "node:assert/strict";

import {
  MANAGEMENT_RUNTIME_STYLE,
  currentTariffForPoint,
  shouldClearManagementBackFocus
} from "../src/management-runtime-fixes.js";

test("current tariff cache selects the latest active tariff for one point",()=>{
  const tariffs=[
    {
      id:"older",
      point_id:"point-a",
      effective_from:"2026-08-01"
    },
    {
      id:"current",
      point_id:"point-a",
      effective_from:"2026-09-01"
    },
    {
      id:"future",
      point_id:"point-a",
      effective_from:"2026-10-01"
    },
    {
      id:"other",
      point_id:"point-b",
      effective_from:"2026-09-10"
    }
  ];

  assert.equal(
    currentTariffForPoint(
      tariffs,
      "point-a",
      "2026-09-14"
    )?.id,
    "current"
  );
});

test("point list remains visible while summary placeholders reserve final geometry",()=>{
  assert.match(
    MANAGEMENT_RUNTIME_STYLE,
    /#pointManageList\[data-point-card-summaries-pending="true"\][\s\S]*visibility:visible !important/
  );
  assert.match(
    MANAGEMENT_RUNTIME_STYLE,
    /data-point-card-summary-placeholder="true"[\s\S]*visibility:hidden !important/
  );
});

test("proxy back focus is cleared for touch and pointer but kept for keyboard",()=>{
  assert.equal(
    shouldClearManagementBackFocus({
      isProxy:true,
      modality:"pointer"
    }),
    true
  );
  assert.equal(
    shouldClearManagementBackFocus({
      isProxy:true,
      modality:"keyboard"
    }),
    false
  );
  assert.equal(
    shouldClearManagementBackFocus({
      isProxy:false,
      modality:"pointer"
    }),
    false
  );
});
