import assert from "node:assert/strict";
import test from "node:test";

import {
  employeeSearchText,
  filterChoiceOptions,
  filterOptionSelected,
  filterMonthShifts,
  paymentProgress,
  toggleFilterSelection
} from "../src/workflow.js";

const shifts=[
  {
    id:"one",
    date:"2026-08-10",
    dbPointId:"point-a",
    point:"Корабельная 1",
    employeeId:"employee-a",
    employeeName:"Анна Иванова",
    type:"main",
    partial:false,
    shk:350,
    note:"Подмена утром",
    bonuses:[{amount:500,comment:"За качество"}],
    penalties:[]
  },
  {
    id:"two",
    date:"2026-08-18",
    dbPointId:"point-b",
    point:"Прокатная 2",
    employeeId:"employee-b",
    employeeName:"Ольга Фасеева",
    type:"extra",
    partial:true,
    hours:4,
    bonuses:[],
    penalties:[{amount:1000,comment:"Опоздание"}]
  }
];

test("shift filters combine date, point, employee and rich search",()=>{
  assert.deepEqual(
    filterMonthShifts(shifts,{
      query:"качество",
      pointIds:["point-a"],
      employeeIds:["employee-a"],
      fromDay:10,
      toDay:15
    }).map(item=>item.id),
    ["one"]
  );

  assert.deepEqual(
    filterMonthShifts(shifts,{
      query:"опоздание",
      fromDay:16,
      toDay:31
    }).map(item=>item.id),
    ["two"]
  );
});

test("employee search contains every card field",()=>{
  const value=employeeSearchText({
    full_name:"Анна Иванова",
    status:"active",
    employment_type:"substitute",
    phone:"+79990000000",
    transfer_phone:"+78880000000",
    transfer_bank:"Т-Банк",
    transfer_recipient:"Иванова А."
  },{
    pointNames:["Корабельная 1"],
    account:"anna@example.com"
  });

  for(const needle of [
    "анна",
    "+7888",
    "т-банк",
    "корабельная",
    "anna@example.com",
    "активен",
    "подмена"
  ]){
    assert.ok(value.includes(needle));
  }
});

test("choice picker search matches labels and hidden employee data",()=>{
  const options=[
    {
      value:"one",
      label:"Ольга Фасеева",
      searchText:"+79990000000 olga@example.com"
    },
    {
      value:"two",
      label:"Анна Иванова",
      searchText:"Т-Банк"
    }
  ];

  assert.deepEqual(
    filterChoiceOptions(
      options,
      "ОЛЬГА"
    ).map(item=>item.value),
    ["one"]
  );

  assert.deepEqual(
    filterChoiceOptions(
      options,
      "+7999"
    ).map(item=>item.value),
    ["one"]
  );

  assert.deepEqual(
    filterChoiceOptions(
      options,
      "т-банк"
    ).map(item=>item.value),
    ["two"]
  );

  assert.notEqual(
    filterChoiceOptions(
      options,
      ""
    ),
    options
  );
});

test("all filter option selects every row and toggles predictably",()=>{
  const allIds=["point-a","point-b","point-c"];

  assert.equal(
    filterOptionSelected(null,"point-a"),
    true
  );

  assert.deepEqual(
    toggleFilterSelection(
      null,
      "",
      allIds
    ),
    []
  );

  assert.deepEqual(
    toggleFilterSelection(
      null,
      "point-b",
      allIds
    ),
    ["point-a","point-c"]
  );

  assert.equal(
    toggleFilterSelection(
      ["point-a"],
      "",
      allIds
    ),
    null
  );
});

test("partial payout progress preserves remaining and overpayment",()=>{
  assert.deepEqual(
    paymentProgress(5000,[{amount:2000},{amount:1000}]),
    {
      due:5000,
      paid:3000,
      remaining:2000,
      overpaid:0,
      complete:false
    }
  );

  assert.equal(
    paymentProgress(5000,[{amount:5200}]).overpaid,
    200
  );
});
