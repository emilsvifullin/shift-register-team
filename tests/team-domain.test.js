import test from "node:test";
import assert from "node:assert/strict";

import {
  calc,
  payouts
} from "../src/domain.js";

import {
  calculateBaseAmount,
  createPricingSnapshot,
  filterEmployeeShifts,
  legacyShiftPayload,
  mapServerShift,
  pricingDriversChanged,
  rateForTariff,
  roleCapabilities,
  shiftEmployeeChoices,
  shiftPointChoices,
  tariffForDate
} from "../src/team-domain.js";

const point={
  id:"11111111-1111-4111-8111-111111111111",
  code:"kommunalnaya-10",
  name:"Коммунальная Улица 10",
  active:true,
  advance_enabled:false
};

const fixedPoint={
  ...point,
  id:"22222222-2222-4222-8222-222222222222",
  code:"radialnaya-3k11",
  name:"6-Я Радиальная 3к11"
};

const tierTariff={
  id:"33333333-3333-4333-8333-333333333333",
  point_id:point.id,
  effective_from:"2026-01-01",
  pricing_type:"shk_tiers",
  fixed_rate:null,
  shk_tiers:[
    {up_to:350,rate:3000},
    {up_to:450,rate:3500},
    {up_to:550,rate:4500},
    {up_to:650,rate:5500},
    {up_to:null,rate:6500}
  ]
};

const fixedTariff={
  id:"44444444-4444-4444-8444-444444444444",
  point_id:fixedPoint.id,
  effective_from:"2026-01-01",
  pricing_type:"fixed",
  fixed_rate:3000,
  shk_tiers:null
};

function shiftWithPricing({
  pricing,
  type="main",
  partial=false,
  hours="",
  bonus="",
  fine="",
  date="2026-08-05"
}){
  return {
    v:3,
    id:"55555555-5555-4555-8555-555555555555",
    employeeId:"employee-1",
    pointId:point.code,
    point:point.name,
    date,
    type,
    shk:350,
    partial,
    hours,
    bonus,
    fine,
    pricing
  };
}

test("team pricing keeps a full shift at exactly 12 hours",()=>{
  const pricing=createPricingSnapshot({
    tariff:tierTariff,
    point,
    shiftDate:"2026-08-05",
    shk:350
  });

  assert.equal(pricing.fullHours,12);
  assert.equal(
    calc(shiftWithPricing({pricing})).hours,
    12
  );
});

test("fixed full and fixed partial use the existing rounding rule",()=>{
  const pricing=createPricingSnapshot({
    tariff:fixedTariff,
    point:fixedPoint,
    shiftDate:"2026-08-05",
    shk:999999
  });

  assert.equal(
    calculateBaseAmount(
      pricing,
      {partial:false,hours:null}
    ),
    3000
  );

  assert.equal(
    calculateBaseAmount(
      pricing,
      {partial:true,hours:5.5}
    ),
    1375
  );
});

test("every current SHK tier and its upper boundary resolve exactly",()=>{
  assert.deepEqual(
    [0,349,350,449,450,549,550,649,650]
      .map(shk=>rateForTariff(tierTariff,shk)),
    [3000,3000,3500,3500,4500,4500,5500,5500,6500]
  );
});

test("tariff lookup selects the latest effective tariff on the shift date",()=>{
  const future={
    ...tierTariff,
    id:"66666666-6666-4666-8666-666666666666",
    effective_from:"2026-09-01",
    shk_tiers:[
      {up_to:null,rate:9000}
    ]
  };

  assert.equal(
    tariffForDate(
      [future,tierTariff],
      point.id,
      "2026-08-31"
    ).id,
    tierTariff.id
  );

  assert.equal(
    tariffForDate(
      [tierTariff,future],
      point.id,
      "2026-09-01"
    ).id,
    future.id
  );
});

test("pricing snapshot makes a historical shift independent of later tariffs",()=>{
  const original=createPricingSnapshot({
    tariff:tierTariff,
    point,
    shiftDate:"2026-08-05",
    shk:351
  });

  const changed=createPricingSnapshot({
    tariff:{
      ...tierTariff,
      id:"77777777-7777-4777-8777-777777777777",
      effective_from:"2026-09-01",
      shk_tiers:[
        {up_to:null,rate:9000}
      ]
    },
    point,
    shiftDate:"2026-09-05",
    shk:351
  });

  const historical=
    shiftWithPricing({
      pricing:original
    });

  assert.equal(calc(historical).base,3500);
  assert.equal(changed.rate,9000);
  assert.equal(calc(historical).base,3500);
});

test("pricing drivers exclude shift type when it does not affect the rate",()=>{
  const previous={
    employee_id:"employee-1",
    point_id:point.id,
    shift_date:"2026-08-05",
    shift_type:"main",
    shk:350,
    partial:false,
    hours:null
  };

  assert.equal(
    pricingDriversChanged(
      previous,
      {...previous,note:"Комментарий"}
    ),
    false
  );

  assert.equal(
    pricingDriversChanged(
      previous,
      {
        ...previous,
        shift_type:"extra"
      }
    ),
    false
  );

  for(const changed of [
    {employee_id:"employee-2"},
    {point_id:fixedPoint.id},
    {shift_date:"2026-08-06"},
    {shk:351},
    {partial:true,hours:6}
  ]){
    assert.equal(
      pricingDriversChanged(
        previous,
        {...previous,...changed}
      ),
      true
    );
  }
});

test("pricing drivers support mapped shifts used by the employee UI",()=>{
  const previous={
    employeeId:"employee-1",
    dbPointId:"point-1",
    date:"2026-08-01",
    type:"main",
    shk:350,
    partial:false,
    hours:""
  };

  assert.equal(
    pricingDriversChanged(
      previous,
      {
        ...previous,
        type:"extra"
      }
    ),
    false
  );

  assert.equal(
    pricingDriversChanged(
      previous,
      {
        ...previous,
        dbPointId:"point-2"
      }
    ),
    true
  );
});

test("main, extra, partial and extra partial retain the same calculation",()=>{
  const pricing=createPricingSnapshot({
    tariff:tierTariff,
    point,
    shiftDate:"2026-08-05",
    shk:451
  });

  assert.equal(
    calc(shiftWithPricing({pricing,type:"main"})).base,
    4500
  );

  assert.equal(
    calc(shiftWithPricing({pricing,type:"extra"})).base,
    4500
  );

  assert.equal(
    calc(shiftWithPricing({pricing,partial:true,hours:6})).base,
    2250
  );

  assert.equal(
    calc(shiftWithPricing({pricing,type:"extra",partial:true,hours:6})).base,
    2250
  );
});

test("server bonuses and penalties are included separately and together",()=>{
  const mapped=mapServerShift({
    id:"88888888-8888-4888-8888-888888888888",
    employee_id:"employee-1",
    point_id:point.id,
    shift_date:"2026-08-05",
    shift_type:"main",
    shk:350,
    partial:false,
    hours:null,
    full_hours:12,
    base_amount:3000,
    pricing_snapshot:createPricingSnapshot({
      tariff:tierTariff,
      point,
      shiftDate:"2026-08-05",
      shk:350
    }),
    point,
    employee:{full_name:"Сотрудник",status:"active"},
    bonuses:[{id:"bonus-1",amount:500,comment:"Премия"}],
    penalties:[{id:"penalty-1",amount:200,comment:"Штраф"}]
  });

  assert.equal(calc({...mapped,penalties:[],fine:""}).total,4000);
  assert.equal(calc({...mapped,bonuses:[],bonus:""}).total,3300);
  assert.equal(calc(mapped).total,3800);
});

test("advance cap and payment dates remain unchanged with a server snapshot",()=>{
  const advancePoint={
    ...point,
    advance_enabled:true
  };

  const pricing=createPricingSnapshot({
    tariff:{
      ...tierTariff,
      shk_tiers:[{up_to:null,rate:6500}]
    },
    point:advancePoint,
    shiftDate:"2026-08-05",
    shk:700
  });

  const shifts=Array.from({length:4},(_,index)=>({
    ...shiftWithPricing({
      pricing,
      date:`2026-08-${String(index+1).padStart(2,"0")}`
    }),
    id:`server-shift-${index}`
  }));

  const result=payouts("2026-08",shifts,{today:"2026-08-25"});

  assert.equal(result.specialAdvance,20000);
  assert.equal(result.payment25,20000);
  assert.equal(result.payment10,6000);
});

test("legacy conversion keeps pricing and produces commented adjustments",()=>{
  const payload=legacyShiftPayload({
    source:{
      v:3,
      id:"s-legacy-12345678",
      date:"2026-08-05",
      pointId:point.code,
      point:point.name,
      type:"main",
      shk:350,
      partial:false,
      hours:"",
      bonus:500,
      fine:200,
      fineEntries:[
        {amount:200,recordedOn:"2026-08-05"}
      ],
      pricing:{
        version:1,
        rulesVersion:"2026-08-12-v3",
        fixed:false,
        rate:3000,
        fullHours:12
      }
    },
    employeeId:"employee-1",
    points:[point]
  });

  assert.equal(payload.legacySourceId,"s-legacy-12345678");
  assert.equal(payload.baseAmount,3000);
  assert.equal(payload.bonuses[0].comment,"Импорт из локального реестра");
  assert.equal(payload.penalties[0].amount,200);
});

test("employee ownership filtering and role capabilities are fail-closed",()=>{
  const rows=[
    {id:"own",employee_id:"employee-1"},
    {id:"other",employee_id:"employee-2"}
  ];

  assert.deepEqual(
    filterEmployeeShifts(rows,"employee-1")
      .map(item=>item.id),
    ["own"]
  );

  assert.deepEqual(
    filterEmployeeShifts(rows,null),
    []
  );

  assert.equal(
    roleCapabilities("admin").createShift,
    true
  );

  assert.equal(
    roleCapabilities("employee").createShift,
    false
  );

  assert.equal(
    roleCapabilities("unknown").manageTeam,
    false
  );
});

test("new shift choices start with a point and only show its active employees",()=>{
  const points=[
    {id:"point-1",active:true},
    {id:"point-2",active:true},
    {id:"point-archive",active:false}
  ];

  const employees=[
    {id:"employee-1",status:"active"},
    {id:"employee-2",status:"active"},
    {id:"employee-archive",status:"inactive"}
  ];

  const employeePoints=[
    {
      employee_id:"employee-1",
      point_id:"point-1",
      active:true
    },
    {
      employee_id:"employee-2",
      point_id:"point-2",
      active:true
    },
    {
      employee_id:"employee-archive",
      point_id:"point-1",
      active:true
    }
  ];

  assert.deepEqual(
    shiftPointChoices(points)
      .map(item=>item.id),
    ["point-1","point-2"]
  );

  assert.deepEqual(
    shiftEmployeeChoices({
      employees,
      employeePoints,
      pointId:""
    }),
    []
  );

  assert.deepEqual(
    shiftEmployeeChoices({
      employees,
      employeePoints,
      pointId:"point-1"
    }).map(item=>item.id),
    ["employee-1"]
  );

  assert.deepEqual(
    shiftEmployeeChoices({
      employees,
      employeePoints,
      pointId:"point-1",
      includeInactive:true
    }).map(item=>item.id),
    ["employee-1","employee-archive"]
  );

  assert.deepEqual(
    shiftEmployeeChoices({
      employees,
      employeePoints,
      pointId:"point-1",
      selectedEmployeeId:
        "employee-archive"
    }).map(item=>item.id),
    ["employee-1","employee-archive"]
  );

  assert.deepEqual(
    shiftPointChoices(
      points,
      "point-archive"
    ).map(item=>item.id),
    [
      "point-1",
      "point-2",
      "point-archive"
    ]
  );
});
