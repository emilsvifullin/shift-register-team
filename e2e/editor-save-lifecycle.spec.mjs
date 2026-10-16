import {test,expect} from "@playwright/test";
import {ADMIN_SEED,FROZEN_TODAY,openApp} from "./support/supabase-stub.mjs";
import {settleScreen} from "./support/settle.mjs";
async function newEmployee(page){
 await page.locator('#tab-manage').click(); await settleScreen(page);
 await page.locator('#app [data-manage-section="employees"]').click(); await settleScreen(page);
 await page.locator('#employeeAdd').click(); await settleScreen(page);
}
async function blockSave(page){
 await page.evaluate(()=>{
  const client=globalThis.supabase.createClient(),rpc=client.rpc.bind(client);
  globalThis.__auditWrites=[];
  client.rpc=async(name,args)=>{
   if(name==='admin_save_employee_profile'){
    globalThis.__auditWrites.push(structuredClone(args));
    await new Promise(resolve=>globalThis.__auditRelease=resolve);
   }
   return rpc(name,args);
  };
 });
}
const YEAR=FROZEN_TODAY.getFullYear();

const MONTH=String(
  FROZEN_TODAY.getMonth()+1
).padStart(2,"0");

const day=number=>
  `${YEAR}-${MONTH}-${
    String(number).padStart(2,"0")
  }`;

function recalcSeed(){
  const source=structuredClone(ADMIN_SEED);

  const point=source.points.find(
    item=>item.id==="point-2"
  );

  source.employee_points=[
    {
      employee_id:"employee-1",
      point_id:"point-2",
      active:true
    }
  ];

  source.shifts=[3,8,12].map((number,index)=>({
    id:`shift-${index}`,
    employee_id:"employee-1",
    shift_date:day(number),
    point_id:point.id,
    shift_type:"main",
    shk:200,
    partial:false,
    hours:null,
    full_hours:12,
    base_amount:3000,
    pricing_snapshot:{
      version:2,
      fixed:true,
      pricingType:"fixed",
      rate:3000,
      fullHours:12,
      advanceEnabled:false
    },
    note:"",
    employee:{
      id:"employee-1",
      user_id:"user-1",
      full_name:"Марина Абрамова",
      status:"active"
    },
    point:{...point},
    bonuses:[],
    penalties:[]
  }));

  return source;
}

async function changeCurrentTariff(page,rate){
  await page.locator("#tab-manage").click();

  await page
    .locator('#app [data-manage-section="points"]')
    .click();

  await page
    .locator('[data-point-id="point-2"]')
    .click();

  await page.locator("#manageEditorSave").click();

  await page
    .locator('[data-tariff-intent="edit-current"]')
    .click();

  await page.locator("#manageFixedRate").fill(rate);
  await page.locator("#manageTariffSave").click();
}



async function attemptDismiss(page,sheetId,veilId,cancelId){
  await page.keyboard.press("Escape");
  await page.locator(`#${veilId}`).dispatchEvent("click");
  await page.locator(`#${cancelId}`).dispatchEvent("click");
  await page.locator(`#${sheetId} .shead`).evaluate(header=>{
    for(const [type,y] of [["touchstart",100],["touchmove",260],["touchend",260]]){
      const touch={identifier:11,clientX:180,clientY:y};
      const event=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperties(event,{
        touches:{value:type==="touchend" ? [] : [touch]},
        changedTouches:{value:[touch]}
      });
      header.dispatchEvent(event);
    }
  });
  await expect(page.locator(`#${sheetId}`)).toHaveClass(/\bon\b/);
}

test("employee save owns its draft through Escape, backdrop and cancel",async({page})=>{
  await openApp(page); await newEmployee(page);
  await page.locator("#employeeName").fill("Сотрудник в ожидании");
  await blockSave(page);
  await page.locator("#employeeSheetSave").click();
  await expect.poll(()=>page.evaluate(()=>globalThis.__auditWrites.length)).toBe(1);
  await expect(page.locator("#employeeName")).toBeDisabled();
  await expect(page.locator("#employeeSheetCancel")).toBeDisabled();
  await attemptDismiss(page,"employeeSheet","employeeVeil","employeeSheetCancel");
  // A synthetic background click bypasses modal inertness deliberately.
  await page.locator("#employeeAdd").dispatchEvent("click");
  await expect(page.locator("#employeeName")).toHaveValue("Сотрудник в ожидании");
  await page.evaluate(()=>globalThis.__auditRelease());
  await expect(page.locator("#toast")).toHaveText("Сотрудник сохранён");
  await expect(page.locator("#employeeSheet")).not.toHaveClass(/\bon\b/);
  expect(await page.evaluate(()=>globalThis.__stubDb.employees.filter(item=>item.full_name==="Сотрудник в ожидании").length)).toBe(1);
  await page.locator("#employeeAdd").click();
  await expect(page.locator("#employeeName")).toHaveValue("");
  await expect(page.locator("#employeeName")).toBeEnabled();
});

test("employee write failure preserves fields and allows a single retry",async({page})=>{
  await openApp(page); await newEmployee(page);
  await page.locator("#employeeName").fill("Повтор сотрудника");
  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient(),rpc=client.rpc.bind(client);
    let fail=true;
    client.rpc=async(name,args)=>{
      if(name==="admin_save_employee_profile" && fail){fail=false;return {data:null,error:{message:"Контрольный отказ"}};}
      return rpc(name,args);
    };
  });
  await page.locator("#employeeSheetSave").click();
  await expect(page.locator("#toast")).toContainText("Контрольный отказ");
  await expect(page.locator("#employeeName")).toHaveValue("Повтор сотрудника");
  await expect(page.locator("#employeeName")).toBeEnabled();
  await page.locator("#employeeSheetSave").click();
  await expect(page.locator("#toast")).toHaveText("Сотрудник сохранён");
  expect(await page.evaluate(()=>globalThis.__stubDb.employees.filter(item=>item.full_name==="Повтор сотрудника").length)).toBe(1);
});

async function editPoint(page){
  await page.locator("#tab-manage").click(); await settleScreen(page);
  await page.locator('#app [data-manage-section="points"]').click(); await settleScreen(page);
  await page.locator('[data-point-id="point-2"]').click(); await settleScreen(page);
  await page.locator("#manageEditorSave").click();
}

test("point and tariff save retain their original context while pending",async({page})=>{
  await openApp(page); await editPoint(page);
  await page.locator("#managePointName").fill("ПВЗ в ожидании");
  await page.locator('[data-tariff-intent="edit-current"]').click();
  await page.locator("#manageFixedRate").fill("4100");
  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient(),rpc=client.rpc.bind(client);
    client.rpc=async(name,args)=>{
      if(name==="admin_save_point") await new Promise(resolve=>globalThis.__releasePoint=resolve);
      return rpc(name,args);
    };
  });
  await page.locator("#manageEditorSave").click();
  await expect.poll(()=>page.evaluate(()=>Boolean(globalThis.__releasePoint))).toBe(true);
  await expect(page.locator("#managePointName")).toBeDisabled();
  await expect(page.locator("#manageFixedRate")).toBeDisabled();
  await attemptDismiss(page,"manageEditorSheet","manageEditorVeil","manageEditorCancel");
  await page.locator("#pointAdd").dispatchEvent("click");
  await expect(page.locator("#managePointName")).toHaveValue("ПВЗ в ожидании");
  await page.evaluate(()=>globalThis.__releasePoint());
  await expect(page.locator("#toast")).toContainText("текущий тариф сохранены");
  expect(await page.evaluate(()=>({
    name:globalThis.__stubDb.points.find(item=>item.id==="point-2").name,
    rate:globalThis.__stubDb.point_tariffs.find(item=>item.point_id==="point-2").fixed_rate
  }))).toEqual({name:"ПВЗ в ожидании",rate:4100});
});

async function interceptReprice(page,{failSecond=false}={}){
  await page.evaluate(({failSecond})=>{
    const client=globalThis.supabase.createClient(),rpc=client.rpc.bind(client);
    globalThis.__repriceWrites=[];
    client.rpc=async(name,args)=>{
      if(name==="admin_reprice_shift_v2"){
        globalThis.__repriceWrites.push(structuredClone(args));
        if(globalThis.__repriceWrites.length===1) await new Promise(resolve=>globalThis.__releaseReprice=resolve);
        if(failSecond && globalThis.__repriceWrites.length===2) return {data:null,error:{message:"Вторая смена отклонена"}};
      }
      return rpc(name,args);
    };
  },{failSecond});
}

test("pending recalculation cannot be cancelled into a partial hidden operation",async({page})=>{
  await openApp(page,{seed:recalcSeed()}); await changeCurrentTariff(page,"3300");
  await expect(page.locator("#recalcSheet")).toHaveClass(/\bon\b/);
  await interceptReprice(page);
  await page.locator("#recalcApply").click();
  await expect.poll(()=>page.evaluate(()=>globalThis.__repriceWrites.length)).toBe(1);
  await expect(page.locator("#recalcCancel")).toBeDisabled();
  await attemptDismiss(page,"recalcSheet","recalcVeil","recalcCancel");
  await page.locator('[data-recalc-mode="skip"]').first().dispatchEvent("click");
  await page.evaluate(()=>globalThis.__releaseReprice());
  await expect(page.locator("#toast")).toContainText("Пересчитано 3 смены");
  await expect(page.locator("#recalcSheet")).not.toHaveClass(/\bon\b/);
  expect(await page.evaluate(()=>globalThis.__stubDb.shifts.map(item=>Number(item.base_amount)))).toEqual([3300,3300,3300]);
});

test("recalculation failure refreshes saved rows and retries only the remaining plan",async({page})=>{
  await openApp(page,{seed:recalcSeed()}); await changeCurrentTariff(page,"3300");
  await interceptReprice(page,{failSecond:true});
  await page.locator("#recalcApply").click();
  await expect.poll(()=>page.evaluate(()=>globalThis.__repriceWrites.length)).toBe(1);
  await page.evaluate(()=>globalThis.__releaseReprice());
  await expect(page.locator("#toast")).toContainText("Сохранено 1 из 3 смен. Вторая смена отклонена");
  await expect(page.locator(".recalc-row")).toHaveCount(2);
  await expect(page.locator("#recalcApply")).toBeEnabled();
  expect(await page.evaluate(()=>globalThis.__stubDb.shifts.map(item=>Number(item.base_amount)))).toEqual([3300,3000,3000]);
  await page.locator("#recalcApply").click();
  await expect(page.locator("#toast")).toContainText("Пересчитано 2 смены");
  expect(await page.evaluate(()=>globalThis.__repriceWrites.map(item=>item.p_shift_id))).toEqual(["shift-0","shift-1","shift-1","shift-2"]);
  expect(await page.evaluate(()=>globalThis.__stubDb.shifts.map(item=>Number(item.base_amount)))).toEqual([3300,3300,3300]);
});


test("standalone tariff save blocks editor dismissal until it finishes",async({page})=>{
  await openApp(page); await editPoint(page);
  await page.locator('[data-tariff-intent="edit-current"]').click();
  await page.locator("#manageFixedRate").fill("4200");
  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient(),rpc=client.rpc.bind(client);
    client.rpc=async(name,args)=>{
      if(name==="admin_update_point_tariff") await new Promise(resolve=>globalThis.__releaseTariff=resolve);
      return rpc(name,args);
    };
  });
  await page.locator("#manageTariffSave").click();
  await expect.poll(()=>page.evaluate(()=>Boolean(globalThis.__releaseTariff))).toBe(true);
  await attemptDismiss(page,"manageEditorSheet","manageEditorVeil","manageEditorCancel");
  await expect(page.locator("#manageFixedRate")).toBeDisabled();
  await page.evaluate(()=>globalThis.__releaseTariff());
  await expect(page.locator("#toast")).toHaveText("Текущий тариф сохранён");
  await expect(page.locator("#manageEditorSheet")).toHaveClass(/\bon\b/);
  await expect(page.locator("#manageEditorCancel")).toBeEnabled();
});

test("individual rate save owns the employee card until the response",async({page})=>{
  const seed=structuredClone(ADMIN_SEED);
  seed.shifts=[];
  seed.employee_points.push({employee_id:"employee-1",point_id:"point-2",active:true});
  await openApp(page,{seed});
  await page.locator("#tab-manage").click(); await settleScreen(page);
  await page.locator('#app [data-manage-section="employees"]').click(); await settleScreen(page);
  await page.locator('[data-employee-id="employee-1"]').click(); await settleScreen(page);
  await page.locator("#employeeSheetSave").click();
  await page.locator('[data-employee-rate-point="point-2"]').click();
  await page.locator("#employeeRateAmount").fill("3700");
  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient(),rpc=client.rpc.bind(client);
    client.rpc=async(name,args)=>{
      if(name==="admin_add_employee_rate") await new Promise(resolve=>globalThis.__releaseRate=resolve);
      return rpc(name,args);
    };
  });
  await page.locator("#employeeRateSave").click();
  await expect.poll(()=>page.evaluate(()=>Boolean(globalThis.__releaseRate))).toBe(true);
  await attemptDismiss(page,"employeeSheet","employeeVeil","employeeSheetCancel");
  await expect(page.locator("#employeeRateAmount")).toBeDisabled();
  await page.evaluate(()=>globalThis.__releaseRate());
  await expect(page.locator("#toast")).toHaveText("Индивидуальная ставка задана");
  await expect(page.locator("#employeeSheetCancel")).toBeEnabled();
  expect(await page.evaluate(()=>globalThis.__stubDb.employee_point_rates.find(item=>item.employee_id==="employee-1" && item.point_id==="point-2").fixed_rate)).toBe(3700);
});

for(const [code,message] of [
  ["employee_auth_link_conflict","Доступ сотрудника уже изменён в другой вкладке. Обновите данные перед повтором."],
  ["employee_auth_cleanup_failed","Не удалось завершить привязку аккаунта. Обновите данные и проверьте доступ сотрудника перед повтором."]
]){
  test(`account response ${code} stays visible despite an existing account`,async({page})=>{
    await openApp(page);
    await page.locator("#tab-manage").click(); await settleScreen(page);
    await page.locator('#app [data-manage-section="employees"]').click(); await settleScreen(page);
    await page.locator('[data-employee-id="employee-1"]').click(); await settleScreen(page);
    await page.locator("#employeeSheetSave").click();
    await page.locator("#employeeEmail").fill("employee@example.test");
    await page.evaluate(code=>{
      const fetch=globalThis.fetch.bind(globalThis);
      globalThis.fetch=(input,init)=>String(typeof input==="string" ? input : input.url).includes("/functions/v1/admin-employee-auth")
        ? Promise.resolve(new Response(JSON.stringify({error:code}),{status:409,headers:{"content-type":"application/json"}}))
        : fetch(input,init);
    },code);
    await page.locator("#employeeSheetSave").click();
    await expect(page.locator("#toast")).toContainText(message);
    await expect(page.locator("#toast")).not.toContainText(code);
  });
}
