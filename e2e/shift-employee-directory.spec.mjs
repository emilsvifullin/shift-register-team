import {test,expect} from "@playwright/test";
import {ADMIN_SEED,FROZEN_TODAY,openApp} from "./support/supabase-stub.mjs";
import {settleScreen} from "./support/settle.mjs";

const outsider="employee-directory";
const longName="Александрова-Смирнова Елизавета Константиновна Александрова-Смирнова";

function seed(){
  const source=structuredClone(ADMIN_SEED);
  source.employees.push({id:outsider,full_name:longName,status:"active",phone:"+79001112233"});
  source.points.push({...source.points[1],id:"point-4",code:"point-4",name:"Третий ПВЗ"});
  source.employee_points.push(
    {employee_id:outsider,point_id:"point-1",active:false},
    {employee_id:outsider,point_id:"point-2",active:true},
    {employee_id:outsider,point_id:"point-4",active:true}
  );
  return source;
}

async function openShift(page){
  await page.locator("#shiftAdd").click();
  await settleScreen(page);
  await page.locator("#f-point-open").click();
  await settleScreen(page);
  await page.locator('[data-shift-point="point-1"]').click();
  await settleScreen(page);
}

async function openDirectory(page){
  await page.locator("#f-employee-open").click();
  await settleScreen(page);
}

const findOutsider=page=>page.locator('[data-shift-directory-employee="'+outsider+'"]');
const calls=(page,name)=>page.evaluate(name=>globalThis.__stubCalls.filter(call=>call.name===name),name);

test("attach confirms separately, preserves the shift, and retries a failed read only",async({page},info)=>{
  await page.setViewportSize({width:360,height:780});
  await page.emulateMedia({colorScheme:"dark",reducedMotion:"reduce"});
  await openApp(page,{seed:seed()});
  await openShift(page);
  await page.locator("#f-shk").fill("150");
  await page.locator("#f-note").fill("Черновик смены");
  await openDirectory(page);
  await page.locator("#shiftEmployeeSearch").fill("  АЛЕКСАНДРОВА-СМИРНОВА  ");
  await expect(findOutsider(page)).toHaveCount(1);
  await expect(findOutsider(page)).toContainText("Третий ПВЗ");
  expect(await findOutsider(page).evaluate(row=>row.scrollWidth<=row.clientWidth)).toBe(true);
  await findOutsider(page).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath("directory-dark-mobile.png")});

  await findOutsider(page).click();
  await expect(page.locator("#appConfirmDetail")).toContainText(longName);
  await page.screenshot({path:info.outputPath("attach-dark-mobile.png")});
  await page.locator("#appConfirmCancel").click();
  expect(await calls(page,"admin_attach_shift_employee")).toHaveLength(0);

  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient();
    const rpc=client.rpc.bind(client);
    const from=client.from.bind(client);
    let failRead=false;
    client.rpc=async(name,args)=>{
      const result=await rpc(name,args);
      if(name==="admin_attach_shift_employee") failRead=true;
      return result;
    };
    client.from=table=>{
      if(table==="employees" && failRead){
        failRead=false;
        throw new Error("read unavailable");
      }
      return from(table);
    };
  });

  await findOutsider(page).click();
  await expect(page.locator("#appConfirmOk")).toContainText("Прикрепить к");
  await page.locator("#appConfirmOk").click();
  await expect(page.locator("#shiftDirectoryRetry")).toHaveText("Повторить обновление");
  await expect(page.locator(".shift-directory-status")).toContainText("Смена сохраняется отдельно");
  await page.locator("#shiftDirectoryRetry").click();
  await expect(page.locator("#f-employee-open")).toContainText(longName);
  expect(await calls(page,"admin_attach_shift_employee")).toHaveLength(1);
  await expect(page.locator("#f-note")).toHaveValue("Черновик смены");
  await expect(page.locator("#f-shk")).toHaveValue("150");
  expect(await calls(page,"admin_save_shift_v4")).toHaveLength(0);

  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient();
    const rpc=client.rpc.bind(client);
    let rejectShift=true;
    client.rpc=(name,args)=>{
      if(name==="admin_save_shift_v4" && rejectShift){
        rejectShift=false;
        return Promise.resolve({data:null,error:{message:"Контрольный отказ сохранения смены"}});
      }
      return rpc(name,args);
    };
  });
  await page.locator("#sheetSave").click();
  await expect(page.locator("#toast")).toContainText("Контрольный отказ");
  await expect(page.locator(".shift-directory-status")).toContainText("прикреплён к ПВЗ");
  await expect(page.locator("#f-note")).toHaveValue("Черновик смены");
  await page.locator("#sheetSave").click();
  await expect(page.locator("#sheet")).not.toHaveClass(/\bon\b/);
  const saved=await calls(page,"admin_save_shift_v4");
  expect(saved).toHaveLength(1);
  expect(saved[0].args).toMatchObject({p_employee_id:outsider,p_shk:150,p_note:"Черновик смены"});
  const links=await page.evaluate(id=>globalThis.__stubDb.employee_points.filter(link=>link.employee_id===id),outsider);
  expect(links).toEqual([
    {employee_id:outsider,point_id:"point-1",active:true},
    {employee_id:outsider,point_id:"point-2",active:true},
    {employee_id:outsider,point_id:"point-4",active:true}
  ]);
});

test("create from a multi-date calendar shift replays a lost response and restores focus",async({page},info)=>{
  await page.setViewportSize({width:1220,height:900});
  await page.emulateMedia({colorScheme:"light",reducedMotion:"reduce"});
  await openApp(page);
  await page.locator('[data-shift-view="calendar"]').click();
  await settleScreen(page);
  await page.locator("#calendarPointOpen").click();
  await settleScreen(page);
  await page.locator('[data-calendar-point="point-1"]').click();
  await page.locator("[data-calendar-pick-mode]").click();
  const month=FROZEN_TODAY.toISOString().slice(0,7);
  await page.locator('[data-calendar-day="'+month+'-22"]').click();
  await page.locator('[data-calendar-day="'+month+'-23"]').click();
  await page.locator("[data-calendar-add-picked]").click();
  await settleScreen(page);

  const point=page.locator("#f-point-open");
  const pointName=(await point.locator(".point-value").textContent()).trim();
  await page.locator("#f-note").fill("Остаться в той же смене");
  const date=await page.locator("#f-date-open .point-value").textContent();
  await openDirectory(page);
  await page.locator("#shiftDirectoryCreate").click();
  await settleScreen(page);
  await expect(page.locator("#sheet")).toHaveAttribute("inert","");
  await expect(page.locator("#employeeSheet")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#sheet")).not.toHaveAttribute("inert","");
  expect(await calls(page,"admin_save_employee_profile_v2")).toHaveLength(0);

  await page.locator("#shiftDirectoryCreate").click();
  await settleScreen(page);
  await expect(page.locator("#employeeSheet").getByRole("button",{name:pointName+", активен, назначен",exact:true})).toBeDisabled();
  await page.locator("#employeeSheetSave").click();
  await expect(page.locator("#employeeName")).toBeFocused();
  await page.locator("#employeeName").fill("Сотрудник из календаря");
  await expect(page.locator("#toast")).not.toHaveClass(/\bon\b/);
  await page.screenshot({path:info.outputPath("create-light-desktop.png")});
  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient();
    const rpc=client.rpc.bind(client);
    let dropResponse=true;
    client.rpc=async(name,args)=>{
      const result=await rpc(name,args);
      if(name==="admin_save_employee_profile_v2" && dropResponse){
        dropResponse=false;
        return {data:null,error:{code:"write_outcome_unknown"}};
      }
      return result;
    };
  });

  await page.locator("#employeeSheetSave").click();
  await expect(page.locator("#employeeSheetSave")).toHaveText("Повторить");
  await page.locator("#employeeSheetSave").click();
  await expect(page.locator("#employeeSheet")).not.toHaveClass(/\bon\b/);
  await expect(page.locator("#f-employee-open")).toBeFocused();
  await expect(page.locator("#f-employee-open")).toContainText("Сотрудник из календаря");
  await expect(page.locator("#f-date-open .point-value")).toHaveText(date);
  await expect(page.locator("#f-note")).toHaveValue("Остаться в той же смене");
  const writes=await calls(page,"admin_save_employee_profile_v2");
  expect(writes).toHaveLength(2);
  expect(writes[1].args).toEqual(writes[0].args);
  expect(writes[0].args.p_phone).toBeNull();
  const cards=await page.evaluate(()=>globalThis.__stubDb.employees.filter(employee=>employee.full_name==="Сотрудник из календаря"));
  expect(cards).toHaveLength(1);
  expect(await calls(page,"admin_save_shift_v4")).toHaveLength(0);
  await page.locator("#sheetCancel").click();
  await page.locator("#appConfirmOk").click();
  await expect(page.locator("#sheet")).not.toHaveClass(/\bon\b/);
  await page.locator("#tab-manage").click();
  await settleScreen(page);
  await page.locator('[data-manage-section="employees"]').click();
  await expect(page.locator("#app")).toContainText("Сотрудник из календаря");
});

test("directory searches past the first page without fetching per keystroke",async({page})=>{
  const source=seed();
  source.employees.unshift(...Array.from({length:1200},(_,index)=>({
    id:"directory-"+index,full_name:"Сотрудник "+index,status:"active"
  })));
  source.employees.push({id:"archived",full_name:"Архивный однофамилец",status:"inactive"});
  await page.emulateMedia({reducedMotion:"reduce"});
  await openApp(page,{seed:source});
  await openShift(page);
  await openDirectory(page);
  await expect(page.locator("[data-shift-directory-employee]")).toHaveCount(40);
  const reads=()=>page.evaluate(()=>globalThis.__stubReads.length);
  const initialReads=await reads();
  const query=page.locator("#shiftEmployeeSearch");
  await query.fill("  СОТРУДНИК 1199  ");
  await expect(page.locator('[data-shift-directory-employee="directory-1199"]')).toBeVisible();
  await expect(page.locator('[data-shift-directory-employee="directory-1199"]')).toContainText("Без привязки");
  await query.fill("Архивный однофамилец");
  await expect(page.locator(".inline-empty").filter({hasText:"Другие сотрудники не найдены"})).toBeVisible();
  expect(await calls(page,"admin_attach_shift_employee")).toHaveLength(0);
  expect(await reads()).toBe(initialReads);
});

test("an attach response from a different point updates the directory without selecting in the new draft",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await openApp(page,{seed:seed()});
  await openShift(page);
  await openDirectory(page);
  await page.evaluate(()=>{
    const client=globalThis.supabase.createClient();
    const rpc=client.rpc.bind(client);
    client.rpc=async(name,args)=>{
      const result=await rpc(name,args);
      if(name==="admin_attach_shift_employee"){
        await new Promise(resolve=>{globalThis.__releaseDirectoryAttach=resolve;});
      }
      return result;
    };
  });

  await findOutsider(page).click();
  await page.locator("#appConfirmOk").click();
  await expect(page.locator(".shift-directory-status")).toContainText("Прикрепляем сотрудника");
  await expect(page.locator("#sheetSave")).toBeDisabled();

  await page.locator("#f-point-open").click();
  await page.locator('[data-shift-point="point-2"]').click();
  await page.locator("#f-note").fill("Данные нового ПВЗ");
  await page.evaluate(()=>globalThis.__releaseDirectoryAttach());
  await expect.poll(()=>page.evaluate(()=>globalThis.__stubReads.filter(table=>table==="employees").length)).toBeGreaterThan(1);
  await expect(page.locator("#f-employee-open")).toContainText("Выберите сотрудника");
  await expect(page.locator("#f-note")).toHaveValue("Данные нового ПВЗ");
  await expect(page.locator("#sheetSave")).toBeEnabled();
});

test("an account failure rolls back the shift employee and permits a corrected creation",async({page})=>{
  await page.setViewportSize({width:370,height:812});
  await page.emulateMedia({colorScheme:"light",reducedMotion:"reduce"});
  await openApp(page);
  await openShift(page);
  await openDirectory(page);
  await page.locator("#shiftDirectoryCreate").click();
  await settleScreen(page);
  await page.locator("#employeeName").fill("Карточка с доступом");
  await page.locator('[data-employee-account-mode="create"]').click();
  await page.locator("#employeeEmail").fill("test-access@example.test");
  await page.locator("#employeePassword").fill("Password-123");
  await page.evaluate(()=>{
    const fetch=globalThis.fetch.bind(globalThis);
    let failAuth=true;
    globalThis.fetch=(url,init)=>{
      if(String(url).includes("/functions/v1/admin-employee-auth") && failAuth){
        failAuth=false;
        return Promise.resolve(Response.json({error:"email_exists"},{status:409}));
      }
      return fetch(url,init);
    };
  });

  await page.locator("#employeeSheetSave").click();
  await expect(page.locator("#toast")).toContainText("карточка не сохранена");
  await expect(page.locator("#employeeName")).toHaveValue("Карточка с доступом");
  const cards=()=>page.evaluate(()=>globalThis.__stubDb.employees.filter(employee=>employee.full_name==="Карточка с доступом"));
  expect(await cards()).toHaveLength(0);
  expect(await calls(page,"admin_rollback_employee_creation")).toHaveLength(1);
  await page.locator("#employeeEmail").fill("corrected@example.test");
  await page.locator("#employeeSheetSave").click();
  await expect(page.locator("#f-employee-open")).toContainText("Карточка с доступом");
  expect(await cards()).toHaveLength(1);
  expect((await cards())[0].user_id).toBeTruthy();
  const writes=await calls(page,"admin_save_employee_profile_v2");
  expect(writes[0].args.p_operation_id).not.toBe(writes[1].args.p_operation_id);
});

test("a profile opened before a new link reviews the fresh assignments before saving",async({page})=>{
  await page.emulateMedia({colorScheme:"dark",reducedMotion:"reduce"});
  const source=structuredClone(ADMIN_SEED);
  source.accounts[0].email="marina@example.test";
  await openApp(page,{seed:source});
  await page.locator("#tab-manage").click();
  await settleScreen(page);
  await page.locator('[data-manage-section="employees"]').click();
  await settleScreen(page);
  await page.locator('[data-employee-id="employee-1"]').click();
  await settleScreen(page);
  await page.locator("#employeeSheetSave").click();
  await page.locator("#employeeName").fill("Марина Абрамова после правки");
  const attached=await page.evaluate(()=>globalThis.supabase.createClient().rpc("admin_attach_shift_employee",{
    p_employee_id:"employee-1",p_point_id:"point-2",p_operation_id:crypto.randomUUID()
  }));
  expect(attached).toEqual({data:"employee-1",error:null});

  await page.locator("#employeeSheetSave").click();
  await expect(page.locator("#employeeReloadPoints")).toBeVisible();
  await expect(page.locator("#employeeSheetSave")).toBeDisabled();
  await page.locator("#employeeReloadPoints").click();
  await expect(page.locator('[data-employee-point="point-2"]')).toHaveClass(/\bon\b/);
  await expect(page.locator("#employeeName")).toHaveValue("Марина Абрамова после правки");
  await page.locator("#employeeSheetSave").click();
  await expect(page.locator("#employeeSheetTitle")).toHaveText("Сотрудник");
  expect(await page.evaluate(()=>globalThis.__stubDb.employee_points.some(link=>
    link.employee_id==="employee-1" && link.point_id==="point-2" && link.active
  ))).toBe(true);
});

test("the existing proxy route carries both directory RPC POST paths",async({page})=>{
  await openApp(page);
  const seen=[];
  const rpcs="**/rest/v1/rpc/admin_*";
  await page.route(rpcs,async route=>{
    const request=route.request();
    if(!request.url().includes("admin_attach_shift_employee") &&
      !request.url().includes("admin_save_employee_profile_v2")){
      await route.fallback();
      return;
    }
    seen.push(request.url());
    await route.fulfill({
      status:200,
      headers:{"access-control-allow-origin":"*"},
      json:request.postDataJSON()
    });
  });
  const answers=await page.evaluate(async()=>{
    const {supabaseRoutes}=await import("/src/supabase.js");
    const base="https://shift-register-supabase-proxy.vercel.app/rest/v1/rpc/";
    return Promise.all(["admin_attach_shift_employee","admin_save_employee_profile_v2"].map(async name=>{
      const response=await supabaseRoutes.fetch(base+name,{
        method:"POST",
        body:JSON.stringify({p_operation_id:"route-test"})
      });
      return response.json();
    }));
  });
  expect(seen.sort()).toEqual([
    "https://shift-register-supabase-proxy.vercel.app/rest/v1/rpc/admin_attach_shift_employee",
    "https://shift-register-supabase-proxy.vercel.app/rest/v1/rpc/admin_save_employee_profile_v2"
  ]);
  expect(answers).toEqual([{p_operation_id:"route-test"},{p_operation_id:"route-test"}]);
});
