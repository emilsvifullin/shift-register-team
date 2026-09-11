import test from "node:test";
import assert from "node:assert/strict";

import {
  hashForTab,
  tabNameFromHash,
  viewportMetrics
} from "../src/platform-shell.js";

test(
  "platform tab routes are stable and case-insensitive",
  ()=>{
    assert.equal(
      hashForTab("shifts"),
      "#shifts"
    );

    assert.equal(
      hashForTab("manage"),
      "#manage"
    );

    assert.equal(
      hashForTab("unknown"),
      ""
    );

    assert.equal(
      tabNameFromHash("#STATS"),
      "stats"
    );

    assert.equal(
      tabNameFromHash("#unknown"),
      null
    );
  }
);

test(
  "visual viewport metrics take priority when available",
  ()=>{
    assert.deepEqual(
      viewportMetrics({
        visualViewport:{
          width:390.4,
          height:612.6,
          offsetTop:42.2,
          offsetLeft:0.4
        },
        innerWidth:430,
        innerHeight:932
      }),
      {
        width:390,
        height:613,
        top:42,
        left:0
      }
    );
  }
);

test(
  "viewport metrics fall back to the layout viewport safely",
  ()=>{
    assert.deepEqual(
      viewportMetrics({
        innerWidth:1440,
        innerHeight:900
      }),
      {
        width:1440,
        height:900,
        top:0,
        left:0
      }
    );

    assert.deepEqual(
      viewportMetrics(),
      {
        width:1,
        height:1,
        top:0,
        left:0
      }
    );
  }
);
