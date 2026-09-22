/*
  Подставной Supabase для браузерных тестов.

  Тесты открывают настоящий index.html и настоящие модули приложения —
  заменяется только сеть. Раньше поведение экранов проверялось на копиях
  разметки в tests/fixtures, и эти копии расходились с приложением.
*/

export const ADMIN_SEED={
  profile:{
    id:"user-admin",
    role:"admin"
  },
  /*
    Аккаунт, которым подписан вход: у настоящего Supabase у сессии есть
    почта и метаданные профиля, и экран «Данные» показывает их.
  */
  account:{
    id:"user-admin",
    email:"admin@example.test",
    user_metadata:{
      full_name:"Эмиль Сайфуллин"
    }
  },
  employees:[
    {
      id:"employee-1",
      user_id:"user-1",
      full_name:"Марина Абрамова",
      status:"active",
      hired_at:"2026-01-10",
      is_system_substitute:false,
      phone:null,
      transfer_phone:null,
      transfer_bank:null,
      transfer_recipient:null
    },
    {
      id:"employee-2",
      user_id:null,
      full_name:"Роман Белов",
      status:"active",
      hired_at:"2026-02-01",
      is_system_substitute:false,
      phone:null,
      transfer_phone:null,
      transfer_bank:null,
      transfer_recipient:null
    },
    {
      id:"employee-3",
      user_id:null,
      full_name:"Подменный сотрудник",
      status:"active",
      hired_at:"2026-01-01",
      is_system_substitute:true,
      phone:null,
      transfer_phone:null,
      transfer_bank:null,
      transfer_recipient:null
    }
  ],
  points:[
    {
      id:"point-1",
      code:"p1",
      name:"Коммунальная 10",
      active:true,
      pricing_type:"shk_tiers",
      fixed_rate:null,
      advance_enabled:true,
      sort_order:1
    },
    {
      id:"point-2",
      code:"p2",
      name:"Корабельная 1",
      active:true,
      pricing_type:"fixed",
      fixed_rate:3000,
      advance_enabled:false,
      sort_order:2
    },
    {
      id:"point-3",
      code:"p3",
      name:"Ярцевская 6",
      active:false,
      pricing_type:"fixed",
      fixed_rate:3200,
      advance_enabled:false,
      sort_order:3
    }
  ],
  employee_points:[
    {
      employee_id:"employee-1",
      point_id:"point-1",
      active:true
    },
    {
      employee_id:"employee-2",
      point_id:"point-1",
      active:true
    },
    {
      employee_id:"employee-2",
      point_id:"point-2",
      active:true
    }
  ],
  point_tariffs:[
    {
      id:"tariff-1",
      point_id:"point-1",
      effective_from:"2026-01-01",
      pricing_type:"shk_tiers",
      fixed_rate:null,
      shk_tiers:[
        {up_to:350,rate:3000},
        {up_to:null,rate:6500}
      ],
      created_at:"2026-01-01T00:00:00Z"
    },
    {
      id:"tariff-0",
      point_id:"point-1",
      effective_from:"2025-06-01",
      pricing_type:"fixed",
      fixed_rate:2800,
      shk_tiers:null,
      created_at:"2025-06-01T00:00:00Z"
    },
    {
      id:"tariff-2",
      point_id:"point-2",
      effective_from:"2026-01-01",
      pricing_type:"fixed",
      fixed_rate:3000,
      shk_tiers:null,
      created_at:"2026-01-01T00:00:00Z"
    }
  ],
  shifts:[],
  employee_payouts:[],
  accounts:[
    {
      user_id:"user-1",
      login:"marina@example.test"
    }
  ]
};

/*
  Модуль превращается в классический скрипт: браузер получает его вместо
  supabase-js, поэтому здесь нельзя пользоваться экспортом.
*/
export function stubScript(seed){
  return `
(()=>{
  const db=${JSON.stringify(seed)};

  db.saved_shifts=[];

  globalThis.__stubDb=db;
  globalThis.__stubCalls=[];

  const ok=data=>Promise.resolve({data,error:null});

  const fail=message=>Promise.resolve({
    data:null,
    error:new Error(message)
  });

  function query(table){
    let rows=[...(db[table] || [])];

    const builder={
      select(){return builder;},
      order(){return builder;},
      eq(column,value){
        rows=rows.filter(row=>
          String(row[column])===String(value)
        );
        return builder;
      },
      maybeSingle(){
        return ok(rows[0] || null);
      },
      single(){
        return rows[0]
          ? ok(rows[0])
          : fail("not_found");
      },
      then(resolve,reject){
        return ok(rows).then(resolve,reject);
      }
    };

    return builder;
  }

  const rpc={
    admin_account_options_v2(){
      return db.accounts;
    },
    admin_save_point(args){
      const existing=db.points.find(point=>
        point.id===args.p_point_id
      );

      if(existing){
        existing.name=args.p_name;
        existing.active=args.p_active;
        existing.advance_enabled=
          args.p_advance_enabled;
        return existing.id;
      }

      const id="point-"+(db.points.length+1);

      db.points.push({
        id,
        code:id,
        name:args.p_name,
        active:args.p_active,
        pricing_type:args.p_pricing_type,
        fixed_rate:args.p_fixed_rate,
        advance_enabled:args.p_advance_enabled,
        sort_order:args.p_sort_order
      });

      if(args.p_effective_from){
        db.point_tariffs.push({
          id:"tariff-"+(db.point_tariffs.length+1),
          point_id:id,
          effective_from:args.p_effective_from,
          pricing_type:args.p_pricing_type,
          fixed_rate:args.p_fixed_rate,
          shk_tiers:args.p_shk_tiers,
          created_at:new Date().toISOString()
        });
      }

      return id;
    },
    /*
      Удаление ПВЗ повторяет порядок настоящей базы: сперва смены с их
      премиями и штрафами, затем сам ПВЗ с назначениями и тарифами.
      Записи о выплатах и журнал удаление переживают.
    */
    admin_delete_point_cascade(args){
      const point=db.points.find(item=>
        item.id===args.p_point_id
      );

      if(!point){
        throw new Error("point_not_found");
      }

      const named=value=>
        String(value || "").trim().toLowerCase();

      if(named(args.p_point_name)!==named(point.name)){
        throw new Error("point_name_mismatch");
      }

      const doomed=db.shifts.filter(shift=>
        shift.point_id===args.p_point_id
      );

      const shiftIds=new Set(
        doomed.map(shift=>shift.id)
      );

      const summary={
        point_id:point.id,
        name:point.name,
        shifts:doomed.length,
        bonuses:doomed.reduce(
          (sum,shift)=>sum+(shift.bonuses?.length || 0),
          0
        ),
        penalties:doomed.reduce(
          (sum,shift)=>sum+(shift.penalties?.length || 0),
          0
        ),
        employee_points:(db.employee_points || []).filter(
          link=>link.point_id===args.p_point_id
        ).length,
        tariffs:db.point_tariffs.filter(
          tariff=>tariff.point_id===args.p_point_id
        ).length
      };

      db.shifts=db.shifts.filter(shift=>
        !shiftIds.has(shift.id)
      );

      db.points=db.points.filter(item=>
        item.id!==args.p_point_id
      );

      db.point_tariffs=db.point_tariffs.filter(
        tariff=>
          tariff.point_id!==args.p_point_id
      );

      db.employee_points=(db.employee_points || []).filter(
        link=>link.point_id!==args.p_point_id
      );

      return summary;
    },
    admin_add_point_tariff(args){
      const id="tariff-"+
        (db.point_tariffs.length+1)+
        "-new";

      db.point_tariffs.push({
        id,
        point_id:args.p_point_id,
        effective_from:args.p_effective_from,
        pricing_type:args.p_pricing_type,
        fixed_rate:args.p_fixed_rate,
        shk_tiers:args.p_shk_tiers,
        created_at:new Date().toISOString()
      });

      return id;
    },
    admin_update_point_tariff(args){
      const tariff=db.point_tariffs.find(item=>
        item.id===args.p_tariff_id
      );

      if(!tariff){
        throw new Error("tariff_not_found");
      }

      tariff.effective_from=args.p_effective_from;
      tariff.pricing_type=args.p_pricing_type;
      tariff.fixed_rate=args.p_fixed_rate;
      tariff.shk_tiers=args.p_shk_tiers;

      return tariff.id;
    },
    admin_delete_shift(args){
      const before=db.shifts.length;

      db.shifts=db.shifts.filter(shift=>
        shift.id!==args.p_shift_id
      );

      if(db.shifts.length===before){
        throw new Error("shift_not_found");
      }

      return args.p_shift_id;
    },
    admin_save_shift_v3(args){
      return rpc.admin_save_shift_v2(args);
    },
    admin_save_shift_v2(args){
      db.saved_shifts.push(args);
      db.shifts=db.shifts.filter(shift=>
        shift.id!==args.p_shift_id
      );

      const employee=db.employees.find(item=>
        item.id===args.p_employee_id
      ) || {};

      const point=db.points.find(item=>
        item.id===args.p_point_id
      ) || {};

      db.shifts.push({
        id:args.p_shift_id,
        employee_id:args.p_employee_id,
        shift_date:args.p_shift_date,
        point_id:args.p_point_id,
        shift_type:args.p_shift_type,
        shk:args.p_shk,
        partial:args.p_partial,
        hours:args.p_hours,
        full_hours:12,
        base_amount:args.p_base_amount_override ?? 3000,
        pricing_snapshot:{
          version:2,
          fixed:true,
          pricingType:"fixed",
          rate:3000,
          fullHours:12
        },
        note:args.p_note,
        base_amount_override_reason:
          args.p_base_amount_reason ?? null,
        employee:{
          id:employee.id,
          user_id:employee.user_id,
          full_name:employee.full_name,
          status:employee.status
        },
        point:{
          id:point.id,
          code:point.code,
          name:point.name,
          active:point.active,
          advance_enabled:point.advance_enabled
        },
        bonuses:args.p_bonuses || [],
        penalties:args.p_penalties || []
      });

      return args.p_shift_id;
    },
    admin_delete_point_tariff(args){
      db.point_tariffs=db.point_tariffs.filter(
        tariff=>tariff.id!==args.p_tariff_id
      );

      return true;
    }
  };

  const client={
    auth:{
      getSession(){
        return ok({
          session:{
            access_token:"stub-token",
            user:db.account || {id:db.profile.id}
          }
        });
      },
      refreshSession(){
        return ok({
          session:{
            access_token:"stub-token",
            user:db.account || {id:db.profile.id}
          }
        });
      },
      onAuthStateChange(){
        return {
          data:{
            subscription:{unsubscribe(){}}
          }
        };
      },
      signOut(){return ok(null);}
    },
    from(table){
      if(table==="profiles"){
        return {
          select(){return this;},
          eq(){return this;},
          single(){return ok(db.profile);},
          maybeSingle(){return ok(db.profile);}
        };
      }

      return query(table);
    },
    rpc(name,args){
      globalThis.__stubCalls.push({name,args});

      const handler=rpc[name];

      if(!handler){
        return fail("unknown_rpc:"+name);
      }

      try{
        return ok(handler(args));
      }catch(error){
        return fail(error.message);
      }
    },
    realtime:{
      setAuth(){return Promise.resolve();}
    },
    channel(){
      const channel={
        on(){return channel;},
        subscribe(callback){
          callback?.("SUBSCRIBED");
          return channel;
        }
      };

      return channel;
    },
    removeChannel(){
      return Promise.resolve();
    }
  };

  /*
    Удаление и заведение аккаунта сотрудника идут не через RPC, а обычным
    fetch в Edge-функцию (src/supabase.js). Здесь она отвечает так же, как
    настоящая: те же коды и те же тексты ошибок.
  */
  const employeeAuth=async body=>{
    const employee=db.employees.find(item=>
      item.id===body.employeeId
    );

    if(!employee){
      return {status:404,payload:{error:"employee_not_found"}};
    }

    if(body.action==="delete"){
      const hasHistory=db.shifts.some(shift=>
        shift.employee_id===employee.id
      );

      if(hasHistory){
        return {status:409,payload:{error:"employee_has_history"}};
      }

      db.employees=db.employees.filter(item=>
        item.id!==employee.id
      );

      db.employee_points=db.employee_points.filter(item=>
        item.employee_id!==employee.id
      );

      db.accounts=db.accounts.filter(item=>
        item.user_id!==employee.user_id
      );

      return {status:200,payload:{deleted:true}};
    }

    const login=String(body.email || "")
      .trim()
      .toLowerCase();

    if(!login){
      return {
        status:400,
        payload:{error:"invalid_employee_auth_payload"}
      };
    }

    const userId=employee.user_id ||
      "user-"+(db.employees.indexOf(employee)+10);

    employee.user_id=userId;

    if(!db.accounts.some(item=>item.user_id===userId)){
      db.accounts.push({user_id:userId,login});
    }

    return {status:200,payload:{userId}};
  };

  const originalFetch=globalThis.fetch.bind(globalThis);

  globalThis.fetch=async(input,init)=>{
    const url=String(
      typeof input==="string" ? input : input?.url || ""
    );

    if(!url.includes("/functions/v1/admin-employee-auth")){
      return originalFetch(input,init);
    }

    globalThis.__stubCalls.push({
      name:"admin-employee-auth",
      args:JSON.parse(init?.body || "{}")
    });

    const {status,payload}=await employeeAuth(
      JSON.parse(init?.body || "{}")
    );

    return new Response(
      JSON.stringify(payload),
      {
        status,
        headers:{"content-type":"application/json"}
      }
    );
  };

  globalThis.supabase={
    createClient(){return client;}
  };
})();
`;
}

/*
  Приложение загружается ровно так, как в production: те же index.html,
  модули и стили. Заменяются только скрипт supabase-js и его SRI-хеш,
  который иначе отверг бы подставной ответ.

  Клиент Supabase лежит в самом сайте (vendor/), поэтому подменяется
  этот файл, а не адрес на CDN.
*/
/*
  «Сегодня» в тестах одно и то же. Данные сидов и ожидания привязаны к
  сентябрю 2026 года; без заморозки часов весь набор краснел бы с первого
  октября без единого изменения кода. Замораживаются только Date.now и
  new Date(): таймеры, кадры анимации и performance.now идут как обычно.
*/
export const FROZEN_TODAY=new Date(2026,8,21,12,0,0);

export async function openApp(page,{seed=ADMIN_SEED}={}){
  await page.clock.setFixedTime(FROZEN_TODAY);

  await page.route(
    "**/vendor/supabase-js-*.js",
    route=>route.fulfill({
      status:200,
      contentType:"text/javascript",
      body:stubScript(seed)
    })
  );

  await page.route(
    "**/index.html",
    async route=>{
      const response=await route.fetch();
      const html=await response.text();

      await route.fulfill({
        status:200,
        contentType:"text/html; charset=utf-8",
        body:html.replace(
          /\n\s*integrity="[^"]*"/,
          ""
        )
      });
    }
  );

  await page.goto(
    "http://127.0.0.1:4173/index.html"
  );

  await page.waitForFunction(()=>
    !document.body.classList.contains(
      "app-booting"
    )
  );
}
