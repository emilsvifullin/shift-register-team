import assert from "node:assert/strict";
import test from "node:test";
import {normalizeDraftForSave} from "../src/domain.js";
import {SCHEMA_VERSION} from "../src/config.js";
import {businessDate,payoutAccruals,payoutBalance} from "../src/payout-balance.js";

let nextId=0;
function shift({day=1,base=3500,advance=false,bonus=0,penalties=[],employeeId="e-1",...rest}={}){
  const normalized=normalizeDraftForSave({
    v:SCHEMA_VERSION,
    id:`s-balance-${++nextId}`,
    date:`2026-10-${String(day).padStart(2,"0")}`,
    point:advance ? "Прокатная 2" : "Коммунальная Улица 10",
    type:"main",shk:"",partial:false,hours:"",bonus,
    fine:penalties.reduce((sum,item)=>sum+item.amount,0),
    ...rest
  });
  return {...normalized,employeeId,baseAmount:base,penalties};
}
function record(amount,extra={}){
  return {
    id:`p-balance-${++nextId}`,
    employee_id:"e-1",period_month:"2026-10-01",payout_kind:"first_half",
    amount,is_advance:false,...extra
  };
}
function balance(extra={}){
  return payoutBalance({
    ym:"2026-10",kind:"first_half",employeeId:"e-1",asOf:"2026-10-16",
    ...extra
  });
}

test("дата расчёта совпадает с московской датой по обе стороны полуночи",()=>{
  assert.equal(businessDate(new Date("2026-10-15T20:59:59.999Z")),"2026-10-15");
  assert.equal(businessDate(new Date("2026-10-15T21:00:00.000Z")),"2026-10-16");
  assert.equal(businessDate(new Date("2026-12-31T21:00:00.000Z")),"2027-01-01");
});

test("начисления до расчётного дня включительно доступны для обычной выплаты",()=>{
  const first=balance({shifts:[shift({day:15})]});
  assert.equal(first.due,3500);
  assert.equal(first.remaining,3500);
  assert.equal(first.allowedRegular,3500);
  assert.equal(first.regularAvailable,true);
  assert.equal(first.defaultIsAdvance,false);
  const second=balance({kind:"second_half",shifts:[shift({day:16,base:3000}),shift({day:17,base:4000})]});
  assert.equal(second.due,3000);
  assert.equal(second.forecastDue,7000);
});

test("внесённые будущие смены остаются прогнозом и не разрешают обычную выплату",()=>{
  const result=balance({asOf:"2026-10-03",shifts:[shift({day:4}),shift({day:15})]});
  assert.equal(result.forecastDue,7000);
  assert.equal(result.due,0);
  assert.equal(result.allowedRegular,0);
  assert.equal(result.defaultIsAdvance,true);
  assert.equal(result.regularAvailable,false);
});

test("явная дата обязательна: некорректный ввод не заменяется часами компьютера",()=>{
  for(const asOf of [undefined,"","2026-02-30"]){
    assert.throws(()=>balance({asOf}),/некорректная дата расчёта/);
    assert.throws(()=>payoutAccruals({ym:"2026-10",asOf}),/некорректная дата расчёта/);
  }
  assert.throws(()=>balance({kind:"wrong"}),/некорректный расчётный период/);
});

test("один аванс 10000 при начисленных 3500 учитывается целиком и погашается дальнейшими начислениями",()=>{
  const records=[record(10000,{is_advance:true})];
  const original=structuredClone(records);
  const shifts=[shift({day:1}),shift({day:4,base:8500})];
  const before=balance({asOf:"2026-10-02",shifts,records});
  assert.equal(before.due,3500);
  assert.equal(before.paid,10000);
  assert.equal(before.advancePaid,10000);
  assert.equal(before.remaining,0);
  assert.equal(before.overpaid,6500);
  assert.equal(before.defaultIsAdvance,true);
  const after=balance({asOf:"2026-10-04",shifts,records});
  assert.equal(after.due,12000);
  assert.equal(after.paid,10000);
  assert.equal(after.remaining,2000);
  assert.equal(after.overpaid,0);
  assert.deepEqual(records,original);
});

test("аванс меньше начисленного и обычная выплата одинаково уменьшают доступный остаток",()=>{
  const result=balance({shifts:[shift({base:12000})],records:[
    record(3000,{is_advance:true}),record(2000)
  ]});
  assert.equal(result.paid,5000);
  assert.equal(result.advancePaid,3000);
  assert.equal(result.regularPaid,2000);
  assert.equal(result.remaining,7000);
  assert.equal(result.allowedRegular,7000);
  assert.equal(result.defaultIsAdvance,false);
});

test("покрытые начисления не предлагают повторную обычную выплату",()=>{
  const result=balance({shifts:[shift()],records:[record(3500,{is_advance:true})]});
  assert.equal(result.due,3500);
  assert.equal(result.remaining,0);
  assert.equal(result.regularAvailable,false);
  assert.equal(result.defaultIsAdvance,true);
});

test("учёт изолирован по сотруднику, месяцу и виду выплаты без переноса аванса",()=>{
  const result=balance({shifts:[shift(),shift({employeeId:"e-2",base:90000})],records:[
    record(1000),record(20000,{employee_id:"e-2"}),
    record(30000,{period_month:"2026-09-01"}),record(40000,{payout_kind:"second_half"})
  ]});
  assert.equal(result.due,3500);
  assert.equal(result.paid,1000);
  assert.equal(result.remaining,2500);
  const other=balance({kind:"second_half",records:[record(10000,{is_advance:true})]});
  assert.equal(other.paid,0);
  assert.equal(other.remaining,0);
});

test("лимит первой выплаты и перенос заработанного работают и без смен во второй половине",()=>{
  const shifts=[shift({day:1,advance:true,base:12000}),shift({day:2,advance:true,base:12000}),
    shift({day:10,advance:true,base:10000})];
  const first=balance({asOf:"2026-10-05",shifts});
  assert.equal(first.due,20000);
  assert.equal(first.forecastDue,20000);
  const second=balance({asOf:"2026-10-05",shifts,kind:"second_half"});
  assert.equal(second.due,4000);
  assert.equal(second.forecastDue,14000);
  assert.equal(second.regularAvailable,true);
});

test("премии, обычные и адресные удержания сохраняют правила распределения payouts",()=>{
  const shifts=[
    shift({day:1,advance:true,base:25000,bonus:1000,penalties:[{amount:3000}]}),
    shift({day:2,base:5000,bonus:500,penalties:[{amount:1000}]}),
    shift({day:3,advance:true,base:0,penalties:[{amount:30000,payoutKind:"first_half"}]}),
    shift({day:20,base:15000,bonus:200,penalties:[{amount:500,payoutKind:"second_half"}]})
  ];
  const first=balance({shifts});
  const second=balance({shifts,kind:"second_half"});
  assert.equal(first.due,0); // 25500 − 1000 − 24500; адресный избыток 5500 переносится.
  assert.equal(second.due,-2500); // 5000 + 1000 − 3000 − 5500.
  assert.equal(second.forecastDue,12200); // Будущая смена +15000 +200 −500.
  assert.equal(second.regularAvailable,false);
  assert.equal(second.overpaid,0);
});

test("отрицательные начисления не превращаются в якобы выданные деньги",()=>{
  const shifts=[shift({base:0,penalties:[{amount:500}]})];
  const empty=balance({shifts});
  assert.equal(empty.due,-500);
  assert.equal(empty.paid,0);
  assert.equal(empty.overpaid,0);
  assert.equal(empty.remaining,0);
  const issued=balance({shifts,records:[record(1000,{is_advance:true})]});
  assert.equal(issued.due,-500);
  assert.equal(issued.paid,1000);
  assert.equal(issued.overpaid,1000);
});

test("денежный остаток и части выдачи округляются до копейки",()=>{
  const result=balance({shifts:[shift({base:0.3})],records:[record(0.1),record(0.2,{is_advance:true})]});
  assert.equal(result.due,0.3);
  assert.equal(result.paid,0.3);
  assert.equal(result.remaining,0);
  assert.equal(result.overpaid,0);
  assert.equal(result.advancePaid,0.2);
  assert.equal(result.regularPaid,0.1);
});

test("редактирование исключает текущую запись и сохраняет потолок исторической обычной выплаты",()=>{
  const previous=record(10000);
  const records=[previous,record(1000,{is_advance:true})];
  const result=balance({shifts:[shift()],records,editingId:previous.id});
  assert.equal(result.remaining,0);
  assert.equal(result.otherPaid,1000);
  assert.equal(result.editingRemaining,2500);
  assert.equal(result.allowedRegular,10000);
  assert.equal(result.regularAvailable,true);
  assert.equal(result.defaultIsAdvance,false);
  assert.equal(result.previous,previous);
  const zero=balance({records:[previous],editingId:previous.id});
  assert.equal(zero.due,0);
  assert.equal(zero.allowedRegular,10000);
});

test("прежний аванс не даёт права превратить превышение в обычную выплату",()=>{
  const previous=record(10000,{is_advance:true});
  const result=balance({shifts:[shift()],records:[previous],editingId:previous.id});
  assert.equal(result.allowedRegular,3500);
  assert.equal(result.defaultIsAdvance,true);
  assert.equal(result.editingRemaining,3500);
});

test("повторное использование одной пары начислений сохраняет баланс обеих выплат",()=>{
  const shifts=[shift({day:1}),shift({day:16,base:6000})];
  const asOf="2026-10-16";
  const accruals=payoutAccruals({ym:"2026-10",shifts,asOf});
  for(const kind of ["first_half","second_half"]){
    assert.deepEqual(balance({shifts,kind,accruals}),balance({shifts,kind}));
  }
});
