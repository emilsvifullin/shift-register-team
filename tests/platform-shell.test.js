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
          offsetLeft:0.4,
          scale:1
        },
        innerWidth:430,
        innerHeight:932
      }),
      {
        width:390,
        height:613,
        top:42,
        left:0,
        windowHeight:932
      }
    );
  }
);

test(
  "obviously broken unzoomed WebKit viewport geometry falls back to layout viewport",
  ()=>{
    assert.deepEqual(
      viewportMetrics({
        visualViewport:{
          width:100,
          height:844,
          offsetTop:0,
          offsetLeft:0,
          scale:1
        },
        innerWidth:390,
        innerHeight:844
      }),
      {
        width:390,
        height:844,
        top:0,
        left:0,
        windowHeight:844
      }
    );
  }
);

test(
  "legitimate zoomed visual viewport stays authoritative",
  ()=>{
    assert.deepEqual(
      viewportMetrics({
        visualViewport:{
          width:195,
          height:422,
          offsetTop:12,
          offsetLeft:8,
          scale:2
        },
        innerWidth:390,
        innerHeight:844
      }),
      {
        width:195,
        height:422,
        top:12,
        left:8,
        windowHeight:844
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
        left:0,
        windowHeight:900
      }
    );

    assert.deepEqual(
      viewportMetrics(),
      {
        width:1,
        height:1,
        top:0,
        left:0,
        windowHeight:1
      }
    );
  }
);

/*
  Клавиатура не уменьшает окно приложения, она его закрывает: высота окна
  берётся из layout viewport, а не из видимой области. Иначе оболочка
  установленного приложения оказывается выше окна, документ становится
  прокручиваемым, и привязанная к документу нижняя панель уезжает вверх.
*/
test(
  "the window height ignores a keyboard covering the visible area",
  ()=>{
    const metrics=viewportMetrics({
      visualViewport:{
        width:402,
        height:567,
        offsetTop:78,
        offsetLeft:0,
        scale:1
      },
      innerWidth:402,
      innerHeight:878
    });

    assert.equal(metrics.height,567);
    assert.equal(metrics.windowHeight,878);
  }
);

/*
  Высота окна берётся из прямого измерения layout viewport, а не из
  window.innerHeight. В установленном на домашний экран приложении iOS
  сообщает innerHeight ниже окна на верхнюю safe-area: собранная по такому
  значению оболочка заканчивалась выше нижней границы экрана, под нижней
  панелью оставалась пустая полоса, а список терял столько же высоты.
*/
test(
  "a measured layout viewport outranks an under-reporting innerHeight",
  ()=>{
    const metrics=viewportMetrics({
      visualViewport:{
        width:440,
        height:956,
        offsetTop:0,
        offsetLeft:0,
        scale:1
      },
      innerWidth:440,
      innerHeight:894,
      layoutHeight:956
    });

    assert.equal(metrics.windowHeight,956);
  }
);

/*
  Измерение остаётся ведущим и когда окно действительно меньше: в
  установленном приложении клавиатура уменьшает само окно, и оболочка
  обязана уменьшиться вместе с ним, иначе документ станет прокручиваемым.
*/
test(
  "a measured layout viewport also wins when the window really shrank",
  ()=>{
    const metrics=viewportMetrics({
      visualViewport:{
        width:440,
        height:878,
        offsetTop:0,
        offsetLeft:0,
        scale:1
      },
      innerWidth:440,
      innerHeight:956,
      layoutHeight:878
    });

    assert.equal(metrics.windowHeight,878);
  }
);

/*
  До первого измерения и там, где его нет, остаётся прежнее значение.
*/
test(
  "the window height falls back to innerHeight without a measurement",
  ()=>{
    const metrics=viewportMetrics({
      visualViewport:{
        width:440,
        height:956,
        offsetTop:0,
        offsetLeft:0,
        scale:1
      },
      innerWidth:440,
      innerHeight:894,
      layoutHeight:0
    });

    assert.equal(metrics.windowHeight,894);
  }
);
