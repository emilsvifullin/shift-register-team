import assert from "node:assert/strict";
import test from "node:test";

import {
  pointEmployeeSummary,
  pointTariffSummary
} from "../src/point-summary.js";

import {
  tariffForDate
} from "../src/team-domain.js";

const pointId="point-1";

const employees=[
  {
    id:"employee-1",
    full_name:"Марина",
    status:"active",
    is_system_substitute:false
  },
  {
    id:"employee-2",
    full_name:"Роман",
    status:"active",
    is_system_substitute:false
  },
  {
    id:"employee-3",
    full_name:"Елена",
    status:"active",
    is_system_substitute:false
  },
  {
    id:"employee-4",
    full_name:"Архивный",
    status:"inactive",
    is_system_substitute:false
  },
  {
    id:"substitute",
    full_name:"Подмена",
    status:"active",
    is_system_substitute:true
  }
];

const assignment=employee_id=>({
  employee_id,
  point_id:pointId,
  active:true
});

test(
  "point employee summary covers empty, named and counted states",
  ()=>{
    assert.equal(
      pointEmployeeSummary(
        pointId,
        employees,
        []
      ),
      "Сотрудники не назначены"
    );

    assert.equal(
      pointEmployeeSummary(
        pointId,
        employees,
        [assignment("employee-1")]
      ),
      "1 сотрудник: Марина"
    );

    assert.equal(
      pointEmployeeSummary(
        pointId,
        employees,
        [
          assignment("employee-2"),
          assignment("employee-1")
        ]
      ),
      "2 сотрудника: Марина, Роман"
    );

    assert.equal(
      pointEmployeeSummary(
        pointId,
        employees,
        [
          assignment("employee-1"),
          assignment("employee-2"),
          assignment("employee-3"),
          assignment("employee-4"),
          assignment("substitute")
        ]
      ),
      "3 сотрудника"
    );
  }
);

test(
  "point tariff summary shows fixed tariff and advance",
  ()=>{
    assert.equal(
      pointTariffSummary(
        {
          id:pointId,
          advance_enabled:true
        },
        {
          point_id:pointId,
          effective_from:"2026-01-01",
          pricing_type:"fixed",
          fixed_rate:3500,
          shk_tiers:null
        }
      ),
      "Фиксированный · 3\u00A0500\u00A0₽ · Аванс"
    );
  }
);

test(
  "point tariff summary shows the range of SHK rates",
  ()=>{
    assert.equal(
      pointTariffSummary(
        {
          id:pointId,
          advance_enabled:false
        },
        {
          point_id:pointId,
          effective_from:"2026-01-01",
          pricing_type:"shk_tiers",
          fixed_rate:null,
          shk_tiers:[
            {up_to:350,rate:3000},
            {up_to:null,rate:6500}
          ]
        }
      ),
      "По ШК · 3\u00A0000\u00A0₽–6\u00A0500\u00A0₽"
    );
  }
);

test(
  "a point without a tariff says so",
  ()=>{
    assert.equal(
      pointTariffSummary(
        {id:pointId,advance_enabled:false},
        null
      ),
      "Тариф не задан"
    );
  }
);

/*
  Какой именно тариф считается текущим, решает tariffForDate — карточка
  ПВЗ и расчёт смены обязаны отвечать на этот вопрос одинаково.
*/
test(
  "the card summarises the same tariff the shift calculation uses",
  ()=>{
    const tariffs=[
      {
        id:"today",
        point_id:pointId,
        effective_from:"2026-01-01",
        pricing_type:"fixed",
        fixed_rate:3500,
        shk_tiers:null
      },
      {
        id:"planned",
        point_id:pointId,
        effective_from:"2099-01-01",
        pricing_type:"fixed",
        fixed_rate:9999,
        shk_tiers:null
      }
    ];

    assert.equal(
      pointTariffSummary(
        {id:pointId,advance_enabled:false},
        tariffForDate(
          tariffs,
          pointId,
          "2026-09-14"
        )
      ),
      "Фиксированный · 3\u00A0500\u00A0₽"
    );
  }
);
