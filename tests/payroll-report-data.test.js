import assert from "node:assert/strict";
import test from "node:test";
import {normalizeDraftForSave,payouts} from "../src/domain.js";
import {SCHEMA_VERSION} from "../src/config.js";
import {buildPeriodEntries} from "../src/payroll-period.js";
import {buildPayrollReport} from "../src/payroll-report.js";
import {periodReportDetail,reportCorrections,reportEntries} from "../src/payroll-report-data.js";
import {roundMoney} from "../src/format.js";

let number=0;
function shift({day=1,advance=false,bonus=0,penalties=[],override=null,partial=false,...rest}={}){
  const value=normalizeDraftForSave({
    v:SCHEMA_VERSION,id:`s-report-${++number}`,date:`2026-08-${String(day).padStart(2,"0")}`,
    point:advance ? "Прокатная 2" : "Коммунальная Улица 10",
    type:"main",shk:650,partial,hours:partial ? 6 : "",bonus,
    fine:penalties.reduce((sum,item)=>sum+item.amount,0),...rest
  },null,{recordedOn:"2026-08-28"});
  return {...value,employeeId:"e-1",bonuses:bonus ? [{amount:bonus,comment:"За обучение"}] : [],penalties,
    ...(override===null ? {} : {baseAmount:override,baseOverrideReason:"Согласовано с руководителем"})};
}
function sum(rows,key){return roundMoney(rows.reduce((total,row)=>total+row[key],0));}
function detail(shifts,kind){return periodReportDetail({ym:"2026-08",kind,shifts});}
function assertConserves(shifts){
  const result={};
  for(const kind of ["first_half","second_half"]){
    const rows=buildPeriodEntries({ym:"2026-08",kind,
      employees:[{id:"e-1",full_name:"Марина"}],shifts,payoutRows:[]});
    const entry=rows[0] || {base:0,bonus:0,fine:0};
    const parsed=detail(shifts,kind);
    assert.equal(sum(parsed.shifts,"base"),entry.base,`${kind}: base`);
    assert.equal(sum(parsed.bonuses,"amount"),entry.bonus,`${kind}: bonus`);
    assert.equal(sum(parsed.fines,"amount"),entry.fine,`${kind}: fine`);
    result[kind]=parsed;
  }
  return result;
}

test("обычные ПВЗ: строки отчёта сохраняют деньги и комментарии обеих выплат",()=>{
  const result=assertConserves([
    shift({day:3,bonus:500,penalties:[{amount:200,comment:"Опоздание"}]}),
    shift({day:22,partial:true,bonus:100,penalties:[{amount:50,comment:"Ошибка сборки"}]})
  ]);
  assert.match(result.first_half.bonuses[0].label,/За обучение/);
  assert.match(result.first_half.fines[0].label,/Опоздание/);
  assert.match(result.second_half.fines[0].label,/Ошибка сборки/);
});

test("авансные ПВЗ: бонус и штраф 1–15 показаны в окончательном расчёте, база сверх лимита переносится",()=>{
  const shifts=Array.from({length:5},(_,index)=>shift({
    day:index+1,advance:true,
    bonus:index===0 ? 1000 : 0,
    penalties:index===0 ? [{amount:500,comment:"Недостача"}] : []
  }));
  const result=assertConserves(shifts);
  assert.equal(sum(result.first_half.shifts,"base"),20000);
  assert.equal(result.first_half.bonuses.length,0);
  assert.equal(result.first_half.fines.length,0);
  assert.equal(sum(result.second_half.shifts,"base"),12500);
  assert.match(result.second_half.shifts[0].typeLabel,/перенос/);
  assert.match(result.second_half.bonuses[0].label,/За обучение/);
  assert.match(result.second_half.fines[0].label,/Недостача/);
});

test("targeted штраф поздней смены делится по бюджету выплаты25 и переносит только избыток",()=>{
  const rows=[
    shift({day:2,advance:true,bonus:250}),
    shift({day:20,penalties:[{amount:10000,comment:"Удержать из аванса",payoutKind:"first_half"}]})
  ];
  const result=assertConserves(rows);
  assert.equal(sum(result.first_half.fines,"amount"),6500);
  assert.equal(sum(result.second_half.fines,"amount"),3500);
  assert.match(result.first_half.fines[0].label,/Удержать из аванса/);
  assert.match(result.second_half.fines[0].label,/Удержать из аванса.*перенос/);
});

test("смешанные ПВЗ и несколько штрафов учитывают default fine до targeted budget",()=>{
  const rows=[
    shift({day:1,bonus:100,penalties:[{amount:1000,comment:"Обычный"}]}),
    shift({day:2,advance:true,penalties:[{amount:15000,comment:"Первое удержание",payoutKind:"first_half"}]}),
    shift({day:3,advance:true,penalties:[{amount:15000,comment:"Второе удержание",payout_kind:"first_half"}]}),
    shift({day:18,bonus:200,penalties:[{amount:700,comment:"Окончательный",payoutKind:"second_half"}]})
  ];
  const result=assertConserves(rows);
  const canonical=payouts("2026-08",rows);
  assert.equal(sum(result.first_half.fines,"amount"),canonical.fine25);
  assert.equal(sum(result.second_half.fines,"amount"),canonical.fine10);
  assert.ok(result.second_half.fines.some(item=>item.label.includes("Второе удержание")));
});

test("ручная коррекция до и после лимита относится к той выплате, которую меняет payouts",()=>{
  const below=[shift({day:1,advance:true,override:7000})];
  const above=Array.from({length:5},(_,index)=>shift({day:index+1,advance:true,override:index===0 ? 7000 : null}));
  assertConserves(below);
  assertConserves(above);
  assert.equal(reportCorrections({ym:"2026-08",kind:"first_half",shifts:below}),500);
  assert.equal(reportCorrections({ym:"2026-08",kind:"second_half",shifts:below}),0);
  assert.equal(reportCorrections({ym:"2026-08",kind:"first_half",shifts:above}),0);
  assert.equal(reportCorrections({ym:"2026-08",kind:"second_half",shifts:above}),500);
});

test("копейки и legacy-корректировки без записей сохраняют периодные суммы",()=>{
  const rows=[
    {...shift({day:1,advance:true,override:19999.99}),bonus:0.02,bonuses:[],fine:0.03,penalties:[]},
    {...shift({day:2,advance:true,override:0.02}),bonus:0.04,bonuses:[],fine:0.05,penalties:[]}
  ];
  assertConserves(rows);
});

test("snapshot-only сотрудник остаётся с current0, актуальной выплатой и snapshotDue в своём отчёте",()=>{
  const rows=reportEntries({closed:true,entries:[],snapshot:[{
    employeeId:"historical",employeeName:"Сотрудник из снимка",due:6000,paid:1200
  }]}).map(row=>({...row,snapshotDue:6000,detail:{shifts:[],bonuses:[],fines:[]}}));
  const report=buildPayrollReport({periodLabel:"1–15",monthLabel:"август",rows,employeeId:"historical"});
  assert.equal(report.lines.length,1);
  assert.equal(report.lines[0].employeeName,"Сотрудник из снимка");
  assert.equal(report.lines[0].accrued,0);
  assert.equal(report.lines[0].paid,1200);
  assert.equal(report.closedAtDue,6000);
  assert.equal(report.lines[0].detail.shifts.length,0);
  assert.deepEqual(reportEntries({entries:[],closed:false,snapshot:rows}),[]);
});
