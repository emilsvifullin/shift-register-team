import test from "node:test";
import assert from "node:assert/strict";
import {adjustmentPayload,resultData} from "../src/api/shared.js";

test("resultData returns successful payload",()=>{
  assert.deepEqual(
    resultData({data:{ok:true},error:null},"fallback"),
    {ok:true}
  );
});

test("resultData maps known server errors",()=>{
  assert.throws(
    ()=>resultData(
      {data:null,error:{message:"rpc failed: forbidden",code:"42501"}},
      "fallback"
    ),
    error=>{
      assert.equal(error.message,"Недостаточно прав для этой операции");
      assert.equal(error.code,"42501");
      return true;
    }
  );
});

test("adjustmentPayload normalizes money and optional payout kind",()=>{
  assert.deepEqual(
    adjustmentPayload(
      [{id:"a",amount:"125.50",comment:"  тест  ",payoutKind:"first_half"}],
      {includePayoutKind:true}
    ),
    [{id:"a",amount:125.5,comment:"тест",payoutKind:"first_half"}]
  );
});
