import test from "node:test";
import assert from "node:assert/strict";

import {
  formatAmount,
  formatMoney,
  formatNumber,
  plural,
  pluralForm
} from "../src/format.js";

test(
  "numbers group with non-breaking spaces and round",
  ()=>{
    assert.equal(
      formatNumber(1234567),
      "1 234 567"
    );

    assert.equal(
      formatNumber(349.6),
      "350"
    );

    assert.equal(formatNumber("нет"),"");
  }
);

/*
  Копейки показываются только когда они есть: 3 000 ₽ без дробной части,
  но 3 000,50 ₽ — всегда с двумя знаками, как на чеке.
*/
test(
  "amounts show kopecks only when they exist",
  ()=>{
    assert.equal(
      formatAmount(3000),
      "3 000"
    );

    assert.equal(
      formatAmount(3000.5),
      "3 000,50"
    );

    assert.equal(
      formatMoney(3000),
      "3 000 ₽"
    );

    /*
      Отсутствующее значение остаётся пустым, а не превращается в «0 ₽»:
      подпись «Тариф не задан» должна отличаться от тарифа в ноль рублей.
    */
    assert.equal(formatMoney(undefined),"");
    assert.equal(formatMoney("—"),"");
    assert.equal(formatMoney(0),"0 ₽");
  }
);

test(
  "Russian plural forms follow the 1/2-4/5 rule",
  ()=>{
    const forms=["смена","смены","смен"];

    const label=count=>
      pluralForm(count,forms);

    assert.equal(label(1),"смена");
    assert.equal(label(2),"смены");
    assert.equal(label(4),"смены");
    assert.equal(label(5),"смен");
    assert.equal(label(11),"смен");
    assert.equal(label(12),"смен");
    assert.equal(label(14),"смен");
    assert.equal(label(21),"смена");
    assert.equal(label(22),"смены");
    assert.equal(label(25),"смен");
    assert.equal(label(0),"смен");
    assert.equal(label(111),"смен");
    assert.equal(label(101),"смена");

    assert.equal(
      plural(3,forms),
      "3 смены"
    );
  }
);
