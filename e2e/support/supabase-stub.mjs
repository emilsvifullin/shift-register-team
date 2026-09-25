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
  employee_point_rates:[],
  payroll_periods:[],
  payroll_period_entries:[],
  payroll_events:[],
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
      limit(count){
        rows=rows.slice(0,count);
        return builder;
      },
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

  /*
    Разрешение тарифа — та же логика, что в admin_save_shift на сервере:
    последний тариф ПВЗ, начавший действовать не позже даты смены; для
    тарифа по ШК — первая граница, которую объём не перешагнул.
  */
  function resolveTariff(db,{pointId,date,shk,employeeId}){
    const point=db.points.find(item=>
      item.id===pointId
    ) || {};

    /*
      Тот же порядок, что и на сервере: индивидуальная ставка сотрудника
      на этом ПВЗ, а если её нет — тариф пункта.
    */
    const employeeRate=[...(db.employee_point_rates || [])]
      .filter(item=>
        item.employee_id===employeeId &&
        item.point_id===pointId &&
        item.effective_from<=date
      )
      .sort((first,second)=>
        second.effective_from.localeCompare(
          first.effective_from
        )
      )[0];

    const tariff=employeeRate || [...(db.point_tariffs || [])]
      .filter(item=>
        item.point_id===pointId &&
        item.effective_from<=date
      )
      .sort((first,second)=>
        second.effective_from.localeCompare(
          first.effective_from
        )
      )[0];

    if(!tariff){
      throw new Error("tariff_not_found_for_date");
    }

    const fixed=tariff.pricing_type==="fixed";

    const rate=fixed
      ? Number(tariff.fixed_rate)
      : (()=>{
          const volume=Number(shk);

          if(!Number.isFinite(volume) || volume<0){
            throw new Error("invalid_shk");
          }

          const tier=(tariff.shk_tiers || []).find(item=>
            item.up_to===null ||
            volume<Number(item.up_to)
          );

          if(!tier){
            throw new Error("tariff_rate_not_found");
          }

          return Number(tier.rate);
        })();

    return {
      snapshot:{
        version:2,
        rulesVersion:"supabase-point-tariffs-v1",
        tariffId:employeeRate ? null : tariff.id,
        rateSource:employeeRate ? "employee" : "point",
        employeeRateId:employeeRate ? tariff.id : null,
        employeeId:employeeId || null,
        pointId:point.id,
        pointName:point.name,
        effectiveFrom:tariff.effective_from,
        pricingType:tariff.pricing_type,
        fixed,
        fixedRate:tariff.fixed_rate,
        shkTiers:tariff.shk_tiers,
        shk:fixed ? 0 : Number(shk) || 0,
        rate,
        fullHours:12,
        advanceEnabled:point.advance_enabled===true,
        shiftDate:date
      }
    };
  }

  function recordEvent(db,event){
    db.payroll_events=db.payroll_events || [];

    db.payroll_events.unshift({
      id:"event-"+(db.payroll_events.length+1),
      occurred_at:new Date().toISOString(),
      reason:null,
      effect:null,
      period_status:null,
      ...event
    });
  }

  function assertPeriodOpen(db,date,force){
    const month=date.slice(0,7)+"-01";

    const kind=Number(date.slice(8,10))<=15
      ? "first_half"
      : "second_half";

    const period=(db.payroll_periods || []).find(item=>
      item.period_month===month &&
      item.payout_kind===kind
    );

    if(!period || ["open","checked"].includes(period.status)){
      return;
    }

    if(!force){
      throw new Error(
        "payroll_period_closed:"+month+":"+kind+":"+period.status
      );
    }

    recordEvent(db,{
      period_month:month,
      payout_kind:kind,
      employee_id:null,
      kind:"closed_period_change",
      summary:"изменение в закрытом периоде",
      period_status:period.status
    });
  }

  function findPeriod(db,args){
    return (db.payroll_periods || []).find(item=>
      item.period_month===args.p_period_month &&
      item.payout_kind===args.p_payout_kind
    ) || null;
  }

  function ensurePeriod(db,args){
    const existing=findPeriod(db,args);

    if(existing){
      return existing;
    }

    const period={
      id:"period-"+((db.payroll_periods || []).length+1),
      period_month:args.p_period_month,
      payout_kind:args.p_payout_kind,
      status:"open",
      checked_fingerprint:null,
      checked_at:null,
      closed_at:null,
      paid_at:null
    };

    db.payroll_periods.push(period);

    return period;
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
    /*
      Карточка сотрудника: создание и правка вместе с назначениями на
      ПВЗ. Нужна тем сценариям, где сотрудника заводят за один проход —
      вместе с индивидуальной ставкой.
    */
    admin_save_employee_profile(args){
      const existing=(db.employees || []).find(item=>
        item.id===args.p_employee_id
      );

      const id=existing
        ? existing.id
        : "employee-"+((db.employees || []).length+1)+"-new";

      const record={
        id,
        user_id:args.p_user_id || null,
        full_name:args.p_full_name,
        status:args.p_status,
        hired_at:args.p_hired_at,
        is_system_substitute:false,
        phone:args.p_phone || null,
        transfer_phone:args.p_transfer_phone || null,
        transfer_bank:args.p_transfer_bank || null,
        transfer_recipient:args.p_transfer_recipient || null
      };

      if(existing){
        Object.assign(existing,record);
      }else{
        db.employees.push(record);
      }

      const wanted=new Set(args.p_point_ids || []);

      db.employee_points=(db.employee_points || [])
        .filter(link=>link.employee_id!==id);

      for(const pointId of wanted){
        db.employee_points.push({
          employee_id:id,
          point_id:pointId,
          active:true
        });
      }

      return id;
    },
    /* Расчётные периоды: те же переходы, что и на сервере. */
    admin_save_shift_v4(args){
      const existing=(db.shifts || []).find(item=>
        item.id===args.p_shift_id
      );

      if(existing && existing.shift_date!==args.p_shift_date){
        assertPeriodOpen(db,existing.shift_date,args.p_force);
      }

      assertPeriodOpen(db,args.p_shift_date,args.p_force);

      return rpc.admin_save_shift_v3(args);
    },
    admin_delete_shift_v2(args){
      const shift=(db.shifts || []).find(item=>
        item.id===args.p_shift_id
      );

      if(!shift){
        throw new Error("shift_not_found");
      }

      assertPeriodOpen(db,shift.shift_date,args.p_force);

      return rpc.admin_delete_shift(args);
    },
    admin_reprice_shift_v2(args){
      const shift=(db.shifts || []).find(item=>
        item.id===args.p_shift_id
      );

      if(!shift){
        throw new Error("shift_not_found");
      }

      assertPeriodOpen(db,shift.shift_date,args.p_force);

      return rpc.admin_reprice_shift(args);
    },
    admin_save_employee_payout_v2(args){
      const period=findPeriod(db,args);

      if(period && period.status==="paid" && !args.p_force){
        throw new Error(
          "payroll_period_closed:"+args.p_period_month+
          ":"+args.p_payout_kind+":paid"
        );
      }

      const id=rpc.admin_save_employee_payout(args);

      recordEvent(db,{
        period_month:args.p_period_month,
        payout_kind:args.p_payout_kind,
        employee_id:args.p_employee_id,
        kind:args.p_payout_id ? "payout_changed" : "payout_added",
        summary:"выплата "+args.p_amount+" ₽",
        effect:args.p_amount
      });

      return id;
    },
    admin_delete_employee_payout_v2(args){
      const payout=(db.employee_payouts || []).find(item=>
        item.id===args.p_payout_id
      );

      if(!payout){
        throw new Error("employee_payout_not_found");
      }

      const period=findPeriod(db,{
        p_period_month:payout.period_month,
        p_payout_kind:payout.payout_kind
      });

      if(
        period &&
        ["closed","paid"].includes(period.status) &&
        !args.p_force
      ){
        throw new Error(
          "payroll_period_closed:"+payout.period_month+
          ":"+payout.payout_kind+":"+period.status
        );
      }

      return rpc.admin_delete_employee_payout(args);
    },
    admin_check_payroll_period(args){
      const period=ensurePeriod(db,args);

      if(!["open","checked"].includes(period.status)){
        throw new Error("payroll_period_not_open");
      }

      period.status="checked";
      period.checked_fingerprint=args.p_fingerprint;
      period.checked_at=new Date().toISOString();

      return period.id;
    },
    admin_uncheck_payroll_period(args){
      const period=findPeriod(db,args);

      if(!period){
        throw new Error("payroll_period_not_found");
      }

      if(period.status!=="checked"){
        throw new Error("payroll_period_not_checked");
      }

      period.status="open";
      period.checked_fingerprint=null;
      period.checked_at=null;

      return period.id;
    },
    admin_close_payroll_period(args){
      const period=ensurePeriod(db,args);

      if(["closed","paid"].includes(period.status)){
        throw new Error("payroll_period_already_closed");
      }

      db.payroll_period_entries=(db.payroll_period_entries || [])
        .filter(item=>item.period_id!==period.id);

      for(const entry of args.p_entries || []){
        db.payroll_period_entries.push({
          id:"entry-"+(db.payroll_period_entries.length+1),
          period_id:period.id,
          employee_id:entry.employeeId,
          shifts:entry.shifts,
          base:entry.base,
          bonus:entry.bonus,
          fine:entry.fine,
          due:entry.due,
          paid:entry.paid,
          detail:entry.detail
        });
      }

      period.status="closed";
      period.closed_at=new Date().toISOString();

      return period.id;
    },
    admin_mark_payroll_period_paid(args){
      const period=findPeriod(db,args);

      if(!period || period.status!=="closed"){
        throw new Error("payroll_period_not_closed");
      }

      const due=(db.payroll_period_entries || [])
        .filter(item=>item.period_id===period.id)
        .reduce((sum,item)=>sum+Number(item.due || 0),0);

      const paid=(db.employee_payouts || [])
        .filter(item=>
          item.period_month===args.p_period_month &&
          item.payout_kind===args.p_payout_kind
        )
        .reduce((sum,item)=>sum+Number(item.amount || 0),0);

      if(due>0 && paid<=0){
        throw new Error("payroll_period_has_no_payouts");
      }

      period.status="paid";
      period.paid_at=new Date().toISOString();

      return period.id;
    },
    admin_reopen_payroll_period(args){
      const period=findPeriod(db,args);

      if(!period){
        throw new Error("payroll_period_not_found");
      }

      if(!["closed","paid"].includes(period.status)){
        throw new Error("payroll_period_not_closed");
      }

      period.status="open";
      period.checked_fingerprint=null;
      period.checked_at=null;

      return period.id;
    },
    admin_add_employee_rate(args){
      const assigned=(db.employee_points || []).some(link=>
        link.employee_id===args.p_employee_id &&
        link.point_id===args.p_point_id &&
        link.active!==false
      );

      if(!assigned){
        throw new Error("point_not_assigned");
      }

      const id="rate-"+
        ((db.employee_point_rates || []).length+1)+
        "-new";

      db.employee_point_rates.push({
        id,
        employee_id:args.p_employee_id,
        point_id:args.p_point_id,
        effective_from:args.p_effective_from,
        pricing_type:args.p_pricing_type,
        fixed_rate:args.p_fixed_rate,
        shk_tiers:args.p_shk_tiers,
        created_at:new Date().toISOString()
      });

      return id;
    },
    admin_update_employee_rate(args){
      const rate=(db.employee_point_rates || []).find(item=>
        item.id===args.p_rate_id
      );

      if(!rate){
        throw new Error("employee_rate_not_found");
      }

      rate.effective_from=args.p_effective_from;
      rate.pricing_type=args.p_pricing_type;
      rate.fixed_rate=args.p_fixed_rate;
      rate.shk_tiers=args.p_shk_tiers;

      return rate.id;
    },
    admin_delete_employee_rate(args){
      const before=(db.employee_point_rates || []).length;

      db.employee_point_rates=(db.employee_point_rates || []).filter(item=>
        item.id!==args.p_rate_id
      );

      if(db.employee_point_rates.length===before){
        throw new Error("employee_rate_not_found");
      }

      return null;
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
    /*
      Явный пересчёт по тарифу, действующему на дату смены сейчас. Смену
      с ручной суммой не трогает — там решение человека.
    */
    admin_reprice_shift(args){
      const shift=db.shifts.find(item=>
        item.id===args.p_shift_id
      );

      if(!shift){
        throw new Error("shift_not_found");
      }

      if(shift.base_amount_override_reason){
        throw new Error("shift_has_manual_amount");
      }

      const pricing=resolveTariff(db,{
        pointId:shift.point_id,
        date:shift.shift_date,
        shk:shift.shk,
        employeeId:shift.employee_id
      });

      shift.pricing_snapshot=pricing.snapshot;
      shift.base_amount=shift.partial
        ? Math.round(
            Number(pricing.snapshot.rate)/12*Number(shift.hours)
          )
        : Number(pricing.snapshot.rate);

      return {
        shift_id:shift.id,
        rate:pricing.snapshot.rate,
        base_amount:shift.base_amount,
        rate_source:pricing.snapshot.rateSource,
        effective_from:pricing.snapshot.effectiveFrom
      };
    },
    admin_save_shift_v3(args){
      return rpc.admin_save_shift_v2(args);
    },
    admin_save_shift_v2(args){
      db.saved_shifts.push(args);

      const previous=db.shifts.find(shift=>
        shift.id===args.p_shift_id
      );

      db.shifts=db.shifts.filter(shift=>
        shift.id!==args.p_shift_id
      );

      const employee=db.employees.find(item=>
        item.id===args.p_employee_id
      ) || {};

      const point=db.points.find(item=>
        item.id===args.p_point_id
      ) || {};

      /*
        Тариф берётся ровно так же, как на сервере: последний, начавший
        действовать не позже даты самой смены. Раньше стаб подставлял
        3000 всем сменам подряд и о тарифах не знал — из-за этого любая
        ошибка с границами тарифа и с пакетным созданием проходила через
        тесты незамеченной.
      */
      const pricing=resolveTariff(db,{
        pointId:args.p_point_id,
        date:args.p_shift_date,
        shk:args.p_shk,
        employeeId:args.p_employee_id
      });

      /*
        Снимок пересчитывается, только если изменилось то, от чего он
        зависит: сохранённая смена свой тариф не теряет.
      */
      const keepsPricing=
        previous &&
        previous.employee_id===args.p_employee_id &&
        previous.point_id===args.p_point_id &&
        previous.shift_date===args.p_shift_date &&
        (previous.shk ?? null)===(args.p_shk ?? null) &&
        previous.partial===args.p_partial &&
        (previous.hours ?? null)===
          (args.p_partial ? args.p_hours : null);

      const snapshot=keepsPricing
        ? previous.pricing_snapshot
        : pricing.snapshot;

      const rate=Number(snapshot.rate);

      const calculated=keepsPricing
        ? Number(previous.base_amount)
        : args.p_partial
          ? Math.round(rate/12*Number(args.p_hours))
          : rate;

      const override=
        args.p_base_amount_override===null ||
        args.p_base_amount_override===undefined
          ? null
          : Number(args.p_base_amount_override);

      db.shifts.push({
        id:args.p_shift_id,
        employee_id:args.p_employee_id,
        shift_date:args.p_shift_date,
        point_id:args.p_point_id,
        shift_type:args.p_shift_type,
        shk:snapshot.pricingType==="fixed" ? null : args.p_shk,
        partial:args.p_partial,
        hours:args.p_hours,
        full_hours:12,
        base_amount:
          override!==null && override!==calculated
            ? override
            : calculated,
        pricing_snapshot:snapshot,
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
