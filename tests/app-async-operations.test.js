import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

// Run the actual app entry points with a controlled API, rather than a copy
// of their algorithms. The optional source path also runs these against main.
const source=fs.readFileSync(
  process.env.SHIFT_ASYNC_SOURCE || new URL("../src/app.js",import.meta.url),
  "utf8"
);
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const refreshSource=slice(
  source.includes("let teamDataRefresh=null;") ? "let teamDataRefresh=null;" : "async function refreshTeamData(",
  "async function startAutomaticSync("
);
const saveSource=slice(
  source.includes("let shiftSaveInProgress=false;") ? "let shiftSaveInProgress=false;" : 'document.getElementById("sheetSave").onclick=async()=>{',
  "\n/*\n  Даты, на которых смена"
);
const closeSource=slice("async function requestCloseShiftSheet(){","\nlet datePickerHideTimer;");
const cloneSource=slice("function cloneShiftDraft(value){","\n/*\n  Несколько дат");

function deferred(){
  let resolve;
  let reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
async function until(check){
  for(let i=0;i<20 && !check();i++){
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.ok(check(),"controlled request reached its expected boundary");
}
function refreshContext(){
  const loads=[];
  const c={
    Promise,Error,currentUser:{id:"admin"},currentProfile:{role:"admin"},
    teamDataLoading:false,teamDataError:null,serverDataError:null,
    cursor:"2026-10",periodMonthKey:value=>`${value}-01`,
    loadTeamData:()=>{const next=deferred();loads.push(next);return next.promise;},
    teamData:{},shifts:[],statsEmployeeId:"",renders:0,
    renderWhenReady:()=>{c.renders++;}
  };
  vm.createContext(c);
  vm.runInContext(refreshSource,c);
  return {c,loads};
}
function saveContext(save){
  const elements=new Map(["sheetSave","sheetBody","sheetCancel"].map(id=>[id,{disabled:false,inert:false}]));
  const c={
    Error,Promise,document:{getElementById:id=>elements.get(id)},
    isAdmin:true,shiftSheetMode:"create",shifts:[],
    draft:{id:"first-id",employeeId:"employee-A",type:"main",date:"2026-10-15",dates:["2026-10-15","2026-10-16","2026-10-17"],shk:100,bonuses:[{id:"bonus",amount:200,comment:"initial"}],penalties:[]},
    readForm:()=>{},multiDateMode:()=>true,draftDates:value=>value.dates,
    validateDraft:()=>null,datesToCreate:async chosen=>chosen,
    normalizedDraft:value=>structuredClone(value),
    createTeamId:(()=>{let id=0;return ()=>`generated-${++id}`;})(),
    PERIOD_CHANGE_DECLINED:Symbol("declined"),
    withClosedPeriodConfirm:async(_title,action)=>action(false),
    saveAdminShift:save,refreshes:0,refreshTeamData:async()=>{c.refreshes++;return true;},
    resetCalendarPick:()=>{},resetShiftInline:()=>{},drawSheet:()=>{},saveUIState:()=>{},
    closeSheet:()=>{c.closed=true;c.draft=null;},render:()=>{},
    shiftsWord:count=>`${count} смены`,messages:[],toast:message=>c.messages.push(message),
    navigator:{onLine:true},console:{error:()=>{}},
    shiftDraftChanged:()=>true,appConfirm:async()=>true
  };
  vm.createContext(c);
  vm.runInContext(cloneSource+"\n"+saveSource+"\n"+closeSource,c);
  c.run=elements.get("sheetSave").onclick;
  return {c,elements};
}

test("refresh after a write waits for a new read after the already running one",async()=>{
  const {c,loads}=refreshContext();
  const oldRead=c.refreshTeamData({renderAfter:false});
  await until(()=>loads.length===1);
  let afterWriteDone=false;
  const afterWrite=c.refreshTeamData({renderAfter:false}).then(value=>{afterWriteDone=true;return value;});
  loads[0].resolve({shifts:[{id:"before-write"}]});
  await until(()=>loads.length===2 || afterWriteDone);
  assert.equal(loads.length,2);
  assert.equal(afterWriteDone,false);
  loads[1].resolve({shifts:[{id:"saved-shift"}]});
  assert.equal(await afterWrite,true);
  assert.equal(await oldRead,true);
  assert.equal(c.shifts[0].id,"saved-shift");
  assert.equal(c.teamDataLoading,false);
});

test("multiple writes coalesce after an active read and render only the final result",async()=>{
  const {c,loads}=refreshContext();
  const pending=c.refreshTeamData({renderAfter:false});
  await until(()=>loads.length===1);
  const updates=[c.refreshTeamData(),c.refreshTeamData()];
  loads[0].resolve({shifts:[{id:"old"}]});
  await until(()=>loads.length===2);
  assert.equal(c.renders,0);
  loads[1].resolve({shifts:[{id:"new"}]});
  await Promise.all([pending,...updates]);
  assert.equal(loads.length,2);
  assert.equal(c.renders,1);
});

test("a failed old read does not drop the refresh queued after a write",async()=>{
  const {c,loads}=refreshContext();
  const pending=c.refreshTeamData({renderAfter:false});
  await until(()=>loads.length===1);
  const update=c.refreshTeamData({renderAfter:false});
  loads[0].reject(new Error("old request failed"));
  await until(()=>loads.length===2);
  loads[1].resolve({shifts:[{id:"saved"}]});
  assert.equal(await update,true);
  await pending;
  assert.equal(c.serverDataError,null);
});

test("the entire batch keeps its original employee, count and nested money after editing",async()=>{
  const gate=deferred();
  const payloads=[];
  const {c}=saveContext(async value=>{
    payloads.push(structuredClone(value));
    if(payloads.length===1)await gate.promise;
    return {};
  });
  const saving=c.run();
  await until(()=>payloads.length===1);
  c.draft.employeeId="employee-B";
  c.draft.shk=999;
  c.draft.bonuses[0].amount=9999;
  c.draft.bonuses[0].comment="edited";
  gate.resolve();
  await saving;
  assert.equal(payloads.length,3);
  for(const value of payloads){
    assert.equal(value.employeeId,"employee-A");
    assert.equal(value.shk,100);
    assert.equal(value.bonuses[0].amount,200);
    assert.equal(value.bonuses[0].comment,"initial");
  }
  assert.equal(new Set(payloads.map(value=>value.id)).size,3);
  assert.equal(new Set(payloads.map(value=>value.bonuses[0].id)).size,3);
});

test("the snapshot is taken before waiting for the duplicate-date confirmation",async()=>{
  const gate=deferred();
  const payloads=[];
  const {c}=saveContext(async value=>{payloads.push(value);return {};});
  c.datesToCreate=()=>gate.promise;
  const saving=c.run();
  c.draft.employeeId="employee-B";
  c.draft.bonuses[0].amount=1;
  gate.resolve(["2026-10-16"]);
  await saving;
  assert.equal(payloads.length,1);
  assert.equal(payloads[0].employeeId,"employee-A");
  assert.equal(payloads[0].bonuses[0].amount,200);
});

test("closing and duplicate submission are blocked during a pending batch",async()=>{
  const gate=deferred();
  let calls=0;
  const {c,elements}=saveContext(async()=>{calls++;if(calls===1)await gate.promise;return {};});
  const saving=c.run();
  await until(()=>calls===1);
  assert.equal(elements.get("sheetBody").inert,true);
  assert.equal(elements.get("sheetCancel").disabled,true);
  await c.requestCloseShiftSheet();
  assert.equal(c.closed,undefined);
  await c.run();
  assert.equal(calls,1);
  gate.resolve();
  await saving;
  assert.equal(calls,3);
  assert.equal(elements.get("sheetBody").inert,false);
  assert.equal(elements.get("sheetCancel").disabled,false);
});

test("clearing the live draft cannot corrupt or abort the remaining payloads",async()=>{
  const gate=deferred();
  const payloads=[];
  const {c}=saveContext(async value=>{payloads.push(value);if(payloads.length===1)await gate.promise;return {};});
  const saving=c.run();
  await until(()=>payloads.length===1);
  c.draft=null;
  gate.resolve();
  await saving;
  assert.equal(payloads.length,3);
});

test("declining a closed period reports actual progress and retains only unsaved dates",async()=>{
  const payloads=[];
  let c;
  ({c}=saveContext(async value=>{
    payloads.push(value);
    return payloads.length===2 ? c.PERIOD_CHANGE_DECLINED : {};
  }));
  await c.run();
  assert.equal(c.closed,undefined);
  assert.match(c.messages[0],/Сохранено 1 из 3/);
  assert.deepEqual(Array.from(c.draft.dates),["2026-10-16","2026-10-17"]);
  assert.equal(c.draft.id,payloads[1].id);
  assert.notEqual(c.draft.id,payloads[0].id);
  assert.equal(c.refreshes,1);
  c.saveAdminShift=async value=>{payloads.push(value);return {};};
  await c.run();
  assert.deepEqual(payloads.slice(2).map(value=>value.date),["2026-10-16","2026-10-17"]);
  assert.notEqual(payloads[2].id,payloads[0].id);
});

test("partial API failure leaves the retry dates without recreating the saved first shift",async()=>{
  let calls=0;
  const {c,elements}=saveContext(async()=>{
    calls++;
    if(calls===2)throw new Error("controlled failure");
    return {};
  });
  await c.run();
  assert.equal(c.closed,undefined);
  assert.match(c.messages[0],/Сохранено 1 из 3/);
  assert.deepEqual(Array.from(c.draft.dates),["2026-10-16","2026-10-17"]);
  assert.equal(c.refreshes,1);
  assert.equal(elements.get("sheetSave").disabled,false);
});

test("declining the first closed period preserves the entire operation",async()=>{
  let c;
  ({c}=saveContext(async()=>c.PERIOD_CHANGE_DECLINED));
  await c.run();
  assert.equal(c.closed,undefined);
  assert.match(c.messages[0],/Сохранено 0 из 3/);
  assert.equal(c.draft.dates.length,3);
  assert.equal(c.refreshes,0);
});
