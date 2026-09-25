import assert from "node:assert/strict";
import test from "node:test";

import {
  createPricingSnapshot,
  employeeRateForDate,
  shiftRateForDate
} from "../src/team-domain.js";

/*
  Правило выбора ставки: индивидуальная ставка сотрудника на этом ПВЗ, а
  если её на эту дату нет — тариф ПВЗ. Ровно это же правило исполняет
  сервер, и проверяется здесь именно правило, а не разметка.
*/

const POINT={
  id:"point-1",
  name:"Коммунальная 10",
  advance_enabled:true
};

const TARIFFS=[
  {
    id:"tariff-1",
    point_id:"point-1",
    effective_from:"2026-01-01",
    pricing_type:"fixed",
    fixed_rate:3000,
    shk_tiers:null
  }
];

const RATES=[
  {
    id:"rate-1",
    employee_id:"employee-1",
    point_id:"point-1",
    effective_from:"2026-03-01",
    pricing_type:"fixed",
    fixed_rate:3300,
    shk_tiers:null
  },
  {
    id:"rate-2",
    employee_id:"employee-1",
    point_id:"point-1",
    effective_from:"2026-09-01",
    pricing_type:"fixed",
    fixed_rate:3900,
    shk_tiers:null
  }
];

test("ставка действует с своей даты и до следующей",()=>{
  assert.equal(
    employeeRateForDate(RATES,"employee-1","point-1","2026-02-28"),
    null
  );

  assert.equal(
    employeeRateForDate(
      RATES,
      "employee-1",
      "point-1",
      "2026-03-01"
    ).id,
    "rate-1"
  );

  assert.equal(
    employeeRateForDate(
      RATES,
      "employee-1",
      "point-1",
      "2026-08-31"
    ).id,
    "rate-1"
  );

  assert.equal(
    employeeRateForDate(
      RATES,
      "employee-1",
      "point-1",
      "2026-09-02"
    ).id,
    "rate-2"
  );
});

test("ставка принадлежит паре «сотрудник + ПВЗ»",()=>{
  assert.equal(
    employeeRateForDate(
      RATES,
      "employee-2",
      "point-1",
      "2026-09-02"
    ),
    null
  );

  assert.equal(
    employeeRateForDate(
      RATES,
      "employee-1",
      "point-2",
      "2026-09-02"
    ),
    null
  );
});

test("без своей ставки остаётся тариф ПВЗ",()=>{
  const resolved=shiftRateForDate({
    tariffs:TARIFFS,
    employeeRates:RATES,
    employeeId:"employee-2",
    pointId:"point-1",
    shiftDate:"2026-09-10"
  });

  assert.equal(resolved.source,"point");
  assert.equal(resolved.tariff.id,"tariff-1");
});

test("своя ставка перекрывает тариф ПВЗ",()=>{
  const resolved=shiftRateForDate({
    tariffs:TARIFFS,
    employeeRates:RATES,
    employeeId:"employee-1",
    pointId:"point-1",
    shiftDate:"2026-09-10"
  });

  assert.equal(resolved.source,"employee");
  assert.equal(resolved.tariff.id,"rate-2");
});

test("до начала своей ставки действует тариф ПВЗ",()=>{
  const resolved=shiftRateForDate({
    tariffs:TARIFFS,
    employeeRates:RATES,
    employeeId:"employee-1",
    pointId:"point-1",
    shiftDate:"2026-02-01"
  });

  assert.equal(resolved.source,"point");
  assert.equal(resolved.tariff.id,"tariff-1");
});

test("снимок называет источник ставки",()=>{
  const own=createPricingSnapshot({
    tariff:RATES[1],
    point:POINT,
    shiftDate:"2026-09-10",
    shk:0,
    source:"employee",
    employeeId:"employee-1"
  });

  assert.equal(own.rateSource,"employee");
  assert.equal(own.employeeRateId,"rate-2");
  assert.equal(own.tariffId,null);
  assert.equal(own.employeeId,"employee-1");
  assert.equal(own.rate,3900);

  const point=createPricingSnapshot({
    tariff:TARIFFS[0],
    point:POINT,
    shiftDate:"2026-09-10",
    shk:0,
    employeeId:"employee-2"
  });

  assert.equal(point.rateSource,"point");
  assert.equal(point.tariffId,"tariff-1");
  assert.equal(point.employeeRateId,null);
  assert.equal(point.rate,3000);
});

test("снимок считает неполную смену от своей ставки",()=>{
  const snapshot=createPricingSnapshot({
    tariff:RATES[1],
    point:POINT,
    shiftDate:"2026-09-10",
    shk:0,
    source:"employee",
    employeeId:"employee-1"
  });

  assert.equal(snapshot.fullHours,12);
  assert.equal(snapshot.rate/snapshot.fullHours,325);
});
