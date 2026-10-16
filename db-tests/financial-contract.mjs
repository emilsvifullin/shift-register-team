import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {after,before,describe,test} from "node:test";

import {
  createDatabase,
  jsonLiteral,
  literal
} from "./harness.mjs";

import {
  mapServerShift
} from "../src/team-domain.js";

import {
  buildPeriodEntries,
  periodFingerprint
} from "../src/payroll-period.js";

/*
  Финансовый контракт сервера — на настоящих миграциях.

  Две половины. Первая сверяет арифметику: сервер проверяет присланные
  клиентом цифры своей копией payouts(), и если копия разойдётся с
  оригиналом, проверка периода в production начнёт отказывать. Поэтому
  обе считают одни и те же случайные месяцы, и расхождение хотя бы в
  копейке валит тест.

  Вторая — правила: что сервер принимает и чему отказывает, если
  вызвать RPC напрямую, мимо интерфейса.
*/

const ADMIN="00000000-0000-4000-8000-000000000001";
const MONTH="2026-09";
const PERIOD="2026-09-01";

let db;

before(()=>{
  db=createDatabase();

  db.query(`
    insert into auth.users(id,email) values (${literal(ADMIN)},'admin@example.test');
    update public.profiles set role='admin' where id=${literal(ADMIN)};
    select 1;
  `);
});

after(()=>{
  db?.drop();
});

/* Детерминированный генератор: упавший прогон воспроизводится. */
function random(seed){
  let state=seed>>>0;

  return ()=>{
    state=(state*1664525+1013904223)>>>0;
    return state/2**32;
  };
}

function uuid(prefix,index){
  return `${prefix}-0000-4000-8000-${String(index).padStart(12,"0")}`;
}

function resetData(){
  db.query(`
    truncate public.payroll_events, public.payroll_period_entries,
      public.payroll_periods, public.employee_payouts, public.shift_bonuses,
      public.shift_penalties, public.shifts, public.employee_points,
      public.point_tariffs, public.employee_point_rates cascade;
    delete from public.employees where not is_system_substitute;
    delete from public.points;
    select 1;
  `);
}

function addPoint({id,name,advance,rate=3000}){
  db.query(`
    insert into public.points(id,name,code,pricing_type,fixed_rate,advance_enabled)
    values (${literal(id)},${literal(name)},${literal("p"+id.slice(-4))},'fixed',${rate},${advance});
    insert into public.point_tariffs(point_id,effective_from,pricing_type,fixed_rate)
    values (${literal(id)},'2026-01-01','fixed',${rate});
    select 1;
  `);
}

function addEmployee({id,name,substitute=false,points=[]}){
  db.query(`
    insert into public.employees(id,full_name,status,is_system_substitute)
    values (${literal(id)},${literal(name)},'active',${substitute});
    ${points.map(point=>`
      insert into public.employee_points(employee_id,point_id)
      values (${literal(id)},${literal(point)});
    `).join("")}
    select 1;
  `);
}

function addShift({
  id,
  employee,
  point,
  date,
  base,
  advance=null,
  bonuses=[],
  penalties=[]
}){
  const snapshot={
    version:2,
    rate:base,
    fixed:true,
    fullHours:12,
    pricingType:"fixed",
    ...(advance===null ? {} : {advanceEnabled:advance})
  };

  db.query(`
    insert into public.shifts(id,employee_id,shift_date,point_id,shift_type,partial,full_hours,base_amount,pricing_snapshot)
    values (${literal(id)},${literal(employee)},${literal(date)},${literal(point)},'main',false,12,${base},${jsonLiteral(snapshot)});
    ${bonuses.map(amount=>`
      insert into public.shift_bonuses(shift_id,amount,comment)
      values (${literal(id)},${amount},'премия');
    `).join("")}
    ${penalties.map(({amount,kind})=>`
      insert into public.shift_penalties(shift_id,amount,comment,payout_kind)
      values (${literal(id)},${amount},'штраф',${literal(kind)});
    `).join("")}
    select 1;
  `);
}

function addPayout({employee,kind,amount,month=PERIOD}){
  db.query(`
    insert into public.employee_payouts(employee_id,period_month,payout_kind,amount,paid_on)
    values (${literal(employee)},${literal(month)},${literal(kind)},${amount},'2026-09-25');
    select 1;
  `);
}

/* Смены в том виде, в каком их отдаёт PostgREST на запрос src/api/read.js. */
function readShifts(){
  return db.query(`
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,
      'employee_id',s.employee_id,
      'shift_date',s.shift_date,
      'point_id',s.point_id,
      'shift_type',s.shift_type,
      'shk',s.shk,
      'partial',s.partial,
      'hours',s.hours,
      'full_hours',s.full_hours,
      'base_amount',s.base_amount,
      'base_amount_override_reason',s.base_amount_override_reason,
      'pricing_snapshot',s.pricing_snapshot,
      'note',s.note,
      'employee',jsonb_build_object('id',e.id,'user_id',e.user_id,'full_name',e.full_name,'status',e.status),
      'point',jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'active',p.active,'advance_enabled',p.advance_enabled),
      'bonuses',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'amount',b.amount,'comment',b.comment)),'[]') from public.shift_bonuses b where b.shift_id=s.id),
      'penalties',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'amount',x.amount,'comment',x.comment,'payout_kind',x.payout_kind)),'[]') from public.shift_penalties x where x.shift_id=s.id)
    )),'[]'::jsonb)
    from public.shifts s
    join public.employees e on e.id=s.employee_id
    join public.points p on p.id=s.point_id;
  `).map(mapServerShift);
}

function clientEntries(kind){
  return buildPeriodEntries({
    ym:MONTH,
    kind,
    employees:db.query(`select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.employees e;`),
    shifts:readShifts(),
    payoutRows:db.query(`select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.employee_payouts p;`)
  });
}

function serverEntries(kind){
  return db.query(`select private.payroll_period_entries(${literal(PERIOD)},${literal(kind)});`);
}

function serverFingerprint(kind){
  return db.query(`select to_jsonb(private.period_fingerprint(private.payroll_period_entries(${literal(PERIOD)},${literal(kind)})));`);
}

const pick=entry=>({
  employeeId:entry.employeeId,
  shifts:entry.shifts,
  base:Number(entry.base),
  bonus:Number(entry.bonus),
  fine:Number(entry.fine),
  due:Number(entry.due),
  paid:Number(entry.paid)
});

const byId=(first,second)=>first.employeeId<second.employeeId ? -1 : 1;

describe("payouts() и его серверная копия считают одинаково",()=>{
  test("случайные месяцы: аванс, перенос, премии, штрафы с адресатом и без, копейки",()=>{
    for(let round=1;round<=12;round++){
      resetData();

      const next=random(round*7919);
      const points=[
        {id:uuid("10000000",1),name:"Аванс",advance:true},
        {id:uuid("10000000",2),name:"Без аванса",advance:false}
      ];

      points.forEach(addPoint);

      const people=[1,2,3,4].map(index=>({
        id:uuid("20000000",index),
        name:`Сотрудник ${index}`
      }));

      people.forEach(person=>addEmployee({...person,points:points.map(point=>point.id)}));

      /* Подменная карточка есть в базе всегда; её смены в период не входят. */
      const substitute=db.query(`select to_jsonb(id) from public.employees where is_system_substitute;`);

      let shiftIndex=0;

      for(const person of [...people,{id:substitute}]){
        const count=Math.floor(next()*11);

        for(let index=0;index<count;index++){
          const point=points[Math.floor(next()*points.length)];
          const day=1+Math.floor(next()*30);
          const cents=next()<0.2 ? Math.floor(next()*100)/100 : 0;

          addShift({
            id:uuid("30000000",++shiftIndex),
            employee:person.id,
            point:point.id,
            date:`${MONTH}-${String(day).padStart(2,"0")}`,
            base:1500+Math.floor(next()*4)*1000+cents,
            /* Иногда снимка без флага аванса нет — как у самых старых смен. */
            advance:next()<0.15 ? null : point.advance,
            bonuses:next()<0.3 ? [100+Math.floor(next()*900)+(next()<0.3 ? 0.5 : 0)] : [],
            penalties:next()<0.4
              ? [{
                  amount:200+Math.floor(next()*5000),
                  kind:[null,"first_half","second_half"][Math.floor(next()*3)]
                }]
              : []
          });
        }

        if(next()<0.3){
          addPayout({
            employee:person.id,
            kind:next()<0.5 ? "first_half" : "second_half",
            amount:1000+Math.floor(next()*100)/100
          });
        }
      }

      for(const kind of ["first_half","second_half"]){
        const client=clientEntries(kind);
        const server=serverEntries(kind);

        assert.deepEqual(
          server.map(pick).sort(byId),
          client.map(pick).sort(byId),
          `прогон ${round}, ${kind}`
        );

        assert.equal(
          serverFingerprint(kind),
          periodFingerprint(client),
          `отпечаток, прогон ${round}, ${kind}`
        );
      }
    }
  });

  test("переход аванса в расчёт 10-го держит сотрудника во второй половине",()=>{
    resetData();

    const point=uuid("10000000",1);
    const person=uuid("20000000",1);

    addPoint({id:point,name:"Аванс",advance:true});
    addEmployee({id:person,name:"Марина",points:[point]});

    for(let day=1;day<=8;day++){
      addShift({
        id:uuid("30000000",day),
        employee:person,
        point,
        date:`${MONTH}-0${day}`,
        base:3000,
        advance:true
      });
    }

    const [entry]=serverEntries("second_half");

    assert.equal(entry.employeeId,person);
    assert.equal(entry.shifts,0);
    assert.equal(Number(entry.due),4000);
    assert.deepEqual(clientEntries("second_half").map(pick),[pick(entry)]);
  });
});

/*
  Общая сцена для правил: один ПВЗ без аванса и один с авансом, два
  сотрудника, смены в обеих половинах сентября.
*/
const POINT=uuid("10000000",1);
const ADVANCE_POINT=uuid("10000000",2);
const MARINA=uuid("20000000",1);
const ROMAN=uuid("20000000",2);

function scene(){
  resetData();

  addPoint({id:POINT,name:"Корабельная 1",advance:false});
  addPoint({id:ADVANCE_POINT,name:"Коммунальная 10",advance:true});
  addEmployee({id:MARINA,name:"Марина",points:[POINT,ADVANCE_POINT]});
  addEmployee({id:ROMAN,name:"Роман",points:[POINT]});

  addShift({id:uuid("30000000",1),employee:MARINA,point:POINT,date:"2026-09-03",base:3000,advance:false});
  addShift({id:uuid("30000000",2),employee:MARINA,point:POINT,date:"2026-09-20",base:3000,advance:false});
  addShift({id:uuid("30000000",3),employee:ROMAN,point:POINT,date:"2026-09-05",base:3000,advance:false});
}

function check(kind){
  return db.rpc(ADMIN,"admin_check_payroll_period",{
    p_period_month:literal(PERIOD),
    p_payout_kind:literal(kind),
    p_fingerprint:literal(periodFingerprint(clientEntries(kind)))
  });
}

function close(kind,entries=clientEntries(kind)){
  return db.rpc(ADMIN,"admin_close_payroll_period",{
    p_period_month:literal(PERIOD),
    p_payout_kind:literal(kind),
    p_entries:jsonLiteral(entries)
  });
}

function closePeriod(kind){
  assert.equal(check(kind).error,null);
  assert.equal(close(kind).error,null);
}

function payout(employee,kind,amount,extra={}){
  return db.rpc(ADMIN,"admin_save_employee_payout_v2",{
    p_payout_id:"null",
    p_employee_id:literal(employee),
    p_period_month:literal(PERIOD),
    p_payout_kind:literal(kind),
    p_amount:String(amount),
    p_paid_on:literal("2026-09-25"),
    p_comment:"null",
    p_force:String(extra.force===true),
    p_reason:"null",
    ...(extra.isAdvance!==undefined ? {p_is_advance:String(extra.isAdvance)} : {})
  });
}

function status(kind){
  return db.query(`select to_jsonb(status) from public.payroll_periods where period_month=${literal(PERIOD)} and payout_kind=${literal(kind)};`);
}

describe("переходы периода",()=>{
  test("закрыть можно только проверенный период",()=>{
    scene();

    assert.match(close("first_half").error,/payroll_period_not_checked/);
    assert.equal(check("first_half").error,null);
    assert.equal(close("first_half").error,null);
    assert.equal(status("first_half"),"closed");
  });

  test("проверка принимает только те цифры, что есть сейчас",()=>{
    scene();

    const result=db.rpc(ADMIN,"admin_check_payroll_period",{
      p_period_month:literal(PERIOD),
      p_payout_kind:literal("first_half"),
      p_fingerprint:literal("подделка")
    });

    assert.match(result.error,/payroll_period_figures_mismatch/);
  });

  test("после изменения данных проверенный период не закрывается",()=>{
    scene();

    assert.equal(check("first_half").error,null);

    addShift({id:uuid("30000000",9),employee:ROMAN,point:POINT,date:"2026-09-06",base:3000,advance:false});

    assert.match(close("first_half").error,/payroll_period_changed_since_check/);
  });

  test("снимок с чужими суммами не записывается",()=>{
    scene();

    assert.equal(check("first_half").error,null);

    const forged=clientEntries("first_half").map(entry=>({
      ...entry,
      due:entry.due+1000
    }));

    assert.match(close("first_half",forged).error,/payroll_period_figures_mismatch/);
  });

  test("выплаченным период становится, только когда выплаты записаны",()=>{
    scene();
    closePeriod("first_half");

    const paid=()=>db.rpc(ADMIN,"admin_mark_payroll_period_paid",{
      p_period_month:literal(PERIOD),
      p_payout_kind:literal("first_half")
    });

    assert.match(paid().error,/payroll_period_has_no_payouts/);
    assert.equal(payout(MARINA,"first_half",3000).error,null);
    assert.equal(paid().error,null);
    assert.equal(status("first_half"),"paid");
  });
});

/* Отдельные настоящие соединения держат блокировки, как два менеджера. */
function databaseSession(name,sql,{keepOpen=false}={}){
  const child=spawn("psql",["-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d",db.name],{
    env:{...process.env,PGAPPNAME:name,PGOPTIONS:"--client-min-messages=warning"},
    stdio:["pipe","pipe","pipe"]
  });
  let output="";
  let error="";
  child.stdout.on("data",chunk=>{output+=chunk;});
  child.stderr.on("data",chunk=>{error+=chunk;});
  const result=new Promise((resolve,reject)=>{
    child.once("error",reject);
    child.once("close",code=>resolve({code,output,error}));
  });
  child.stdin.write(sql+"\n");
  if(!keepOpen) child.stdin.end();
  return {child,result};
}

async function waitForDatabase(predicate){
  const deadline=Date.now()+5000;
  while(!predicate()){
    assert.ok(Date.now()<deadline,"Ожидалась подтверждённая блокировка PostgreSQL");
    await new Promise(resolve=>setTimeout(resolve,20));
  }
}

describe("выплаты",()=>{
  test("полная, частичная и сверх остатка",()=>{
    scene();

    assert.equal(payout(MARINA,"first_half",1000.5).error,null);
    assert.equal(payout(MARINA,"first_half",1999.5).error,null);
    assert.match(payout(MARINA,"first_half",0.01).error,/payout_exceeds_due:0/);
  });

  test("остаток в ошибке — сколько ещё можно выплатить",()=>{
    scene();

    assert.equal(payout(MARINA,"first_half",1000).error,null);
    assert.match(payout(MARINA,"first_half",2500).error,/payout_exceeds_due:2000/);
  });

  test("копейки принимаются, доли копейки — нет",()=>{
    scene();

    assert.equal(payout(MARINA,"first_half",10.01).error,null);
    assert.match(payout(MARINA,"first_half",10.005).error,/invalid_employee_payout/);
    assert.match(payout(MARINA,"first_half",0).error,/invalid_employee_payout/);
    assert.match(payout(MARINA,"first_half",-5).error,/invalid_employee_payout/);
  });

  test("в выплаченный период — только с согласием",()=>{
    scene();
    closePeriod("first_half");
    assert.equal(payout(MARINA,"first_half",1000).error,null);
    assert.equal(db.rpc(ADMIN,"admin_mark_payroll_period_paid",{
      p_period_month:literal(PERIOD),
      p_payout_kind:literal("first_half")
    }).error,null);

    assert.match(payout(MARINA,"first_half",1000).error,/payroll_period_closed:2026-09-01:first_half:paid/);
    assert.equal(payout(MARINA,"first_half",1000,{force:true}).error,null);
  });

  test("возникшую переплату можно уменьшить, но не увеличить",()=>{
    scene();

    assert.equal(payout(MARINA,"first_half",3000).error,null);

    /* Расчёт уменьшился после выплаты: смену удалили. */
    db.query(`delete from public.shifts where id=${literal(uuid("30000000",1))}; select 1;`);

    const id=db.query(`select to_jsonb(id) from public.employee_payouts where employee_id=${literal(MARINA)};`);

    const edit=amount=>db.rpc(ADMIN,"admin_save_employee_payout_v2",{
      p_payout_id:literal(id),
      p_employee_id:literal(MARINA),
      p_period_month:literal(PERIOD),
      p_payout_kind:literal("first_half"),
      p_amount:String(amount),
      p_paid_on:literal("2026-09-25"),
      p_comment:"null",
      p_force:"false",
      p_reason:"null"
    });

    assert.match(edit(3500).error,/payout_exceeds_due/);
    assert.equal(edit(2000).error,null);
    assert.match(payout(MARINA,"first_half",1).error,/payout_exceeds_due:0/);
  });

  test("явный аванс сверх начисленного хранится, обычная выплата ограничена",()=>{
    scene();
    assert.match(payout(MARINA,"first_half",10000).error,/payout_exceeds_due:3000/);
    const saved=payout(MARINA,"first_half",10000,{isAdvance:true});
    assert.equal(saved.error,null);
    assert.equal(db.query(`select to_jsonb(is_advance) from public.employee_payouts where id=${literal(saved.data)};`),true);
    assert.equal(db.query(`select to_jsonb(details->'isAdvance') from public.payroll_events where details->>'payoutId'=${literal(saved.data)};`),true);
    assert.match(payout(MARINA,"first_half",1).error,/payout_exceeds_due:0/);
  });

  test("аванс до первой смены, редактирование и снятие признака",()=>{
    scene();
    db.query(`delete from public.shifts where employee_id=${literal(MARINA)}; select 1;`);
    assert.match(payout(MARINA,"first_half",10000).error,/payout_exceeds_due:0/);
    const saved=payout(MARINA,"first_half",10000,{isAdvance:true});
    assert.equal(saved.error,null);
    const edit=(amount,isAdvance)=>db.rpc(ADMIN,"admin_save_employee_payout_v2",{
      p_payout_id:literal(saved.data),p_employee_id:literal(MARINA),
      p_period_month:literal(PERIOD),p_payout_kind:literal("first_half"),
      p_amount:String(amount),p_paid_on:literal("2026-09-24"),p_comment:literal("Исправление аванса"),
      p_is_advance:String(isAdvance)
    });
    assert.equal(edit(12000,true).error,null);
    assert.equal(edit(9000,true).error,null);
    assert.match(edit(9000,false).error,/payout_exceeds_due:0/);
    assert.equal(db.query(`select to_jsonb(amount) from public.employee_payouts where id=${literal(saved.data)};`),9000);
    assert.equal(db.rpc(ADMIN,"admin_delete_employee_payout_v2",{p_payout_id:literal(saved.data)}).error,null);
    assert.equal(db.query("select count(*) from public.employee_payouts;"),0);
  });

  test("начисления покрывают выданный аванс без изменения факта выдачи",()=>{
    scene();
    const first=uuid("30000000",1);
    db.query(`update public.shifts set base_amount=3500 where id=${literal(first)}; select 1;`);
    const saved=payout(MARINA,"first_half",10000,{isAdvance:true});
    assert.equal(saved.error,null);
    addShift({id:uuid("30000000",4),employee:MARINA,point:POINT,date:"2026-09-10",base:8500,advance:false});
    const figures=db.query(`select to_jsonb(f) from private.payroll_period_figures(${literal(MARINA)},${literal(PERIOD)},'first_half') f;`);
    assert.equal(figures.due,12000);
    assert.equal(db.query(`select to_jsonb(sum(amount)) from public.employee_payouts where employee_id=${literal(MARINA)} and period_month=${literal(PERIOD)} and payout_kind='first_half';`),10000);
    assert.match(payout(MARINA,"first_half",2000.01).error,/payout_exceeds_due:2000/);
    assert.equal(payout(MARINA,"first_half",2000).error,null);
    assert.equal(db.query(`select to_jsonb(is_advance) from public.employee_payouts where id=${literal(saved.data)};`),true);
  });

  test("редактирование и удаление аванса из закрытого периода требуют подтверждения",()=>{
    scene();
    const saved=payout(MARINA,"first_half",10000,{isAdvance:true});
    assert.equal(saved.error,null);
    closePeriod("first_half");
    const edit=force=>db.rpc(ADMIN,"admin_save_employee_payout_v2",{
      p_payout_id:literal(saved.data),p_employee_id:literal(MARINA),
      p_period_month:literal(PERIOD),p_payout_kind:literal("first_half"),
      p_amount:"9000",p_paid_on:literal("2026-09-25"),p_is_advance:"true",p_force:String(force),p_reason:literal("Исправлена фактическая сумма")
    });
    assert.match(edit(false).error,/payroll_period_closed:2026-09-01:first_half:closed/);
    assert.equal(edit(true).error,null);
    assert.match(db.rpc(ADMIN,"admin_delete_employee_payout_v2",{p_payout_id:literal(saved.data)}).error,/payroll_period_closed/);
    assert.equal(db.rpc(ADMIN,"admin_delete_employee_payout_v2",{p_payout_id:literal(saved.data),p_force:"true",p_reason:literal("Ошибочная запись")}).error,null);
  });

  test("закрытие периода во время ожидания записи не обходит подтверждение",async()=>{
    scene();
    const saved=payout(MARINA,"first_half",10000,{isAdvance:true});
    assert.equal(saved.error,null);
    assert.equal(check("first_half").error,null);
    const lockerName=`advance-lock-${process.pid}`;
    const editorName=`advance-edit-${process.pid}`;
    const locker=databaseSession(lockerName,`begin;
      set local role authenticated;
      set local request.jwt.claim.sub=${literal(ADMIN)};
      select public.admin_close_payroll_period(${literal(PERIOD)},'first_half',${jsonLiteral(clientEntries('first_half'))});`,{keepOpen:true});
    let editing;
    try{
      await waitForDatabase(()=>db.query(`select to_jsonb(exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name=${literal(lockerName)} and l.locktype='advisory' and l.granted));`));
      editing=databaseSession(editorName,`begin;
        set local statement_timeout='10s';
        set local role authenticated;
        set local request.jwt.claim.sub=${literal(ADMIN)};
        select public.admin_save_employee_payout_v2(${literal(saved.data)},${literal(MARINA)},${literal(PERIOD)},'first_half',9000,'2026-09-25',null,false,null,true);
        commit;`);
      await waitForDatabase(()=>db.query(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${literal(editorName)} and wait_event='advisory'));`));
      locker.child.stdin.end("commit;\n");
      const result=await editing.result;
      assert.notEqual(result.code,0);
      assert.match(result.error,/payroll_period_closed:2026-09-01:first_half:closed/);
      assert.equal(db.query(`select to_jsonb(amount) from public.employee_payouts where id=${literal(saved.data)};`),10000);
      assert.equal(db.query("select count(*) from public.payroll_events where kind='payout_changed';"),0);
    }finally{
      if(!locker.child.stdin.destroyed) locker.child.stdin.end("rollback;\n");
      await locker.result;
      if(editing) await editing.result;
    }
  });

  test("аванс не обходит права и защиту выплаченного периода",()=>{
    scene();
    const user="00000000-0000-4000-8000-000000000099";
    db.query(`insert into auth.users(id,email) values (${literal(user)},'employee@example.test') on conflict do nothing; select 1;`);
    assert.match(db.rpc(user,"admin_save_employee_payout_v2",{
      p_payout_id:"null",p_employee_id:literal(MARINA),p_period_month:literal(PERIOD),
      p_payout_kind:literal("first_half"),p_amount:"10000",p_paid_on:literal("2026-09-25"),p_is_advance:"true"
    }).error,/forbidden/);
    closePeriod("first_half");
    assert.equal(payout(MARINA,"first_half",1000).error,null);
    assert.equal(db.rpc(ADMIN,"admin_mark_payroll_period_paid",{p_period_month:literal(PERIOD),p_payout_kind:literal("first_half")}).error,null);
    assert.match(payout(MARINA,"first_half",10000,{isAdvance:true}).error,/payroll_period_closed/);
    assert.equal(payout(MARINA,"first_half",10000,{isAdvance:true,force:true}).error,null);
  });

});

describe("закрытый период не меняется в обход",()=>{
  test("запись, задержанная строкой смены, не оставляет устаревший снимок закрытия",async()=>{
    scene();
    assert.equal(check("first_half").error,null);
    const shift=uuid("30000000",1);
    const rowName=`shift-row-${process.pid}`;
    const saveName=`shift-save-${process.pid}`;
    const closeName=`shift-close-${process.pid}`;
    const row=databaseSession(rowName,`begin;
      select id from public.shifts where id=${literal(shift)} for update;`,{keepOpen:true});
    let save;
    let closing;
    try{
      await waitForDatabase(()=>db.query(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${literal(rowName)} and state='idle in transaction'));`));
      save=databaseSession(saveName,`begin;
        set local statement_timeout='10s';
        set local role authenticated;
        set local request.jwt.claim.sub=${literal(ADMIN)};
        select public.admin_save_shift_v4(${literal(shift)},${literal(MARINA)},'2026-09-03',${literal(POINT)},'main',null,false,null,'изменение','[]','[]',4000,'исправление',false,null);
        commit;`);
      await waitForDatabase(()=>db.query(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${literal(saveName)} and wait_event_type='Lock'));`));
      closing=databaseSession(closeName,`begin;
        set local statement_timeout='10s';
        set local role authenticated;
        set local request.jwt.claim.sub=${literal(ADMIN)};
        select public.admin_close_payroll_period(${literal(PERIOD)},'first_half',${jsonLiteral(clientEntries('first_half'))});
        commit;`);
      await waitForDatabase(()=>db.query(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${literal(closeName)} and wait_event='advisory'));`));
      row.child.stdin.end("commit;\n");
      assert.equal((await save.result).code,0);
      const result=await closing.result;
      assert.notEqual(result.code,0);
      assert.match(result.error,/payroll_period_changed_since_check/);
      assert.equal(status("first_half"),"checked");
      assert.equal(db.query(`select to_jsonb(base_amount) from public.shifts where id=${literal(shift)};`),4000);
      assert.equal(db.query("select count(*) from public.payroll_period_entries;"),0);
      closePeriod("first_half");
      assert.equal(db.query(`select to_jsonb(base) from public.payroll_period_entries where employee_id=${literal(MARINA)};`),4000);
    }finally{
      if(!row.child.stdin.destroyed) row.child.stdin.end("rollback;\n");
      await row.result;
      if(save) await save.result;
      if(closing) await closing.result;
    }
  });

  for(const [name,statement,error] of [
    ["сохранение",()=>`public.admin_save_shift_v4('${uuid("30000000",1)}','${MARINA}','2026-09-03','${POINT}','main',null,false,null,'изменение','[]','[]',4000,'исправление',false,null)`,/payroll_period_closed/],
    ["удаление",()=>`public.admin_delete_shift_v2('${uuid("30000000",1)}',false,null)`,/payroll_period_closed/],
    ["пересчёт",()=>`public.admin_reprice_shift_v2('${uuid("30000000",1)}',false,null)`,/payroll_period_closed/],
    ["импорт",()=>`public.admin_import_legacy_shift('race-import','${MARINA}','${POINT}','2026-09-07','main',null,false,null,12,3000,'{"rate":3000,"fixed":true,"fullHours":12}','[]','[]')`,/payroll_period_closed/],
    ["каскад ПВЗ",()=>`public.admin_delete_point_cascade('${POINT}','Корабельная 1')`,/point_has_closed_period/]
  ]){
    test(`конкурентное закрытие раньше записи: ${name} видит закрытый период`,async()=>{
      scene();
      assert.equal(check("first_half").error,null);
      const closeName=`first-close-${process.pid}`;
      const writeName=`next-write-${process.pid}`;
      const closing=databaseSession(closeName,`begin;
        set local role authenticated;
        set local request.jwt.claim.sub=${literal(ADMIN)};
        select public.admin_close_payroll_period(${literal(PERIOD)},'first_half',${jsonLiteral(clientEntries('first_half'))});`,{keepOpen:true});
      let write;
      try{
        await waitForDatabase(()=>db.query(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${literal(closeName)} and state='idle in transaction'));`));
        write=databaseSession(writeName,`begin;
          set local statement_timeout='10s';
          set local role authenticated;
          set local request.jwt.claim.sub=${literal(ADMIN)};
          select ${statement()};
          commit;`);
        await waitForDatabase(()=>db.query(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${literal(writeName)} and wait_event='advisory'));`));
        closing.child.stdin.end("commit;\n");
        const result=await write.result;
        assert.notEqual(result.code,0);
        assert.match(result.error,error);
        assert.equal(status("first_half"),"closed");
        assert.equal(db.query("select count(*) from public.shifts;"),3);
        assert.equal(db.query("select sum(base_amount) from public.shifts;"),9000);
        assert.equal(db.query("select count(*) from public.payroll_events where kind='closed_period_change';"),0);
      }finally{
        if(!closing.child.stdin.destroyed) closing.child.stdin.end("rollback;\n");
        await closing.result;
        if(write) await write.result;
      }
    });
  }

  test("встречный перенос смен между месяцами не создаёт взаимную блокировку",async()=>{
    scene();
    db.query(`update public.shifts set shift_date='2026-10-05' where id='${uuid("30000000",3)}'; select 1;`);
    const lockerName=`transfer-lock-${process.pid}`;
    const locker=databaseSession(lockerName,"begin; select private.lock_financial_write();",{keepOpen:true});
    const writers=[];
    try{
      await waitForDatabase(()=>db.query(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${literal(lockerName)} and state='idle in transaction'));`));
      for(const [index,employee,date] of [[1,MARINA,"2026-10-03"],[3,ROMAN,"2026-09-05"]]){
        const name=`transfer-${index}-${process.pid}`;
        writers.push({name,...databaseSession(name,`begin;
          set local statement_timeout='10s';
          set local role authenticated;
          set local request.jwt.claim.sub=${literal(ADMIN)};
          select public.admin_save_shift_v4('${uuid("30000000",index)}','${employee}','${date}','${POINT}','main',null,false,null,'перенос','[]','[]',null,null,false,null);
          commit;`)});
      }
      for(const writer of writers){
        await waitForDatabase(()=>db.query(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${literal(writer.name)} and wait_event='advisory'));`));
      }
      locker.child.stdin.end("commit;\n");
      for(const writer of writers){
        const result=await writer.result;
        assert.equal(result.code,0,result.error);
      }
      assert.equal(db.query(`select to_jsonb(shift_date) from public.shifts where id='${uuid("30000000",1)}';`),"2026-10-03");
      assert.equal(db.query(`select to_jsonb(shift_date) from public.shifts where id='${uuid("30000000",3)}';`),"2026-09-05");
    }finally{
      if(!locker.child.stdin.destroyed) locker.child.stdin.end("rollback;\n");
      await locker.result;
      for(const writer of writers) await writer.result;
    }
  });

  test("ошибка финансовой транзакции освобождает очередь и откатывает запись",async()=>{
    scene();
    assert.equal(check("first_half").error,null);
    const editName=`rollback-edit-${process.pid}`;
    const closeName=`rollback-close-${process.pid}`;
    const editing=databaseSession(editName,`begin;
      set local role authenticated;
      set local request.jwt.claim.sub=${literal(ADMIN)};
      select public.admin_save_shift_v4('${uuid("30000000",1)}','${MARINA}','2026-09-03','${POINT}','main',null,false,null,'изменение','[]','[]',4000,'исправление',false,null);`,{keepOpen:true});
    let closing;
    try{
      await waitForDatabase(()=>db.query(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${literal(editName)} and state='idle in transaction'));`));
      closing=databaseSession(closeName,`begin;
        set local statement_timeout='10s';
        set local role authenticated;
        set local request.jwt.claim.sub=${literal(ADMIN)};
        select public.admin_close_payroll_period(${literal(PERIOD)},'first_half',${jsonLiteral(clientEntries('first_half'))});
        commit;`);
      await waitForDatabase(()=>db.query(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${literal(closeName)} and wait_event='advisory'));`));
      editing.child.stdin.end("select 1/0;\n");
      assert.notEqual((await editing.result).code,0);
      assert.equal((await closing.result).code,0);
      assert.equal(status("first_half"),"closed");
      assert.equal(db.query("select sum(base_amount) from public.shifts;"),9000);
      assert.equal(db.query("select sum(base) from public.payroll_period_entries;"),6000);
    }finally{
      if(!editing.child.stdin.destroyed) editing.child.stdin.end("rollback;\n");
      await editing.result;
      if(closing) await closing.result;
    }
  });

  test("удаление смены — только с согласием, и оно в истории",()=>{
    scene();
    closePeriod("first_half");

    const remove=force=>db.rpc(ADMIN,"admin_delete_shift_v2",{
      p_shift_id:literal(uuid("30000000",3)),
      p_force:String(force),
      p_reason:literal("ошибка ввода")
    });

    assert.match(remove(false).error,/payroll_period_closed/);
    assert.equal(remove(true).error,null);

    const events=db.query(`select jsonb_agg(kind) from public.payroll_events;`);
    assert.deepEqual(events,["closed_period_change"]);
  });

  test("смена в открытой половине, задевшая деньги закрытой, требует согласия",()=>{
    scene();

    for(let day=1;day<=7;day++){
      addShift({
        id:uuid("40000000",day),
        employee:MARINA,
        point:ADVANCE_POINT,
        date:`2026-09-0${day+1}`,
        base:3000,
        advance:true
      });
    }

    /* 21 000 за первую половину: 20 000 — 25-го, 1 000 — 10-го. */
    closePeriod("second_half");

    const remove=force=>db.rpc(ADMIN,"admin_delete_shift_v2",{
      p_shift_id:literal(uuid("40000000",1)),
      p_force:String(force),
      p_reason:"null"
    });

    assert.match(remove(false).error,/payroll_period_closed:2026-09-01:second_half:closed/);
    assert.equal(remove(true).error,null);

    const effect=db.query(`select to_jsonb(effect) from public.payroll_events where payout_kind='second_half';`);
    assert.equal(Number(effect),-1000);
  });

  test("удаление ПВЗ не стирает смены закрытого периода",()=>{
    scene();
    closePeriod("first_half");

    const result=db.rpc(ADMIN,"admin_delete_point_cascade",{
      p_point_id:literal(POINT),
      p_point_name:literal("Корабельная 1")
    });

    assert.match(result.error,/point_has_closed_period:2026-09-01:first_half:closed/);
    assert.equal(db.query(`select count(*) from public.shifts;`),3);
  });

  test("удаление ПВЗ в открытом периоде проходит и оставляет выплаты",()=>{
    scene();
    assert.equal(payout(ROMAN,"first_half",3000).error,null);

    const result=db.rpc(ADMIN,"admin_delete_point_cascade",{
      p_point_id:literal(POINT),
      p_point_name:literal("Корабельная 1")
    });

    assert.equal(result.error,null);
    assert.equal(db.query(`select count(*) from public.shifts;`),0);
    assert.equal(db.query(`select count(*) from public.employee_payouts;`),1);
  });

  test("импорт не пишет в закрытый период",()=>{
    scene();
    closePeriod("first_half");

    const result=db.rpc(ADMIN,"admin_import_legacy_shift",{
      p_legacy_source_id:literal("legacy-1"),
      p_employee_id:literal(ROMAN),
      p_point_id:literal(POINT),
      p_shift_date:literal("2026-09-07"),
      p_shift_type:literal("main"),
      p_shk:"null",
      p_partial:"false",
      p_hours:"null",
      p_full_hours:"12",
      p_base_amount:"3000",
      p_pricing_snapshot:jsonLiteral({rate:3000,fixed:true,fullHours:12}),
      p_bonuses:jsonLiteral([]),
      p_penalties:jsonLiteral([])
    });

    assert.match(result.error,/payroll_period_closed:2026-09-01:first_half:closed/);
  });
});

describe("удаление сотрудника не уносит финансовую историю",()=>{
  test("сотрудник с выплатами без смен не удаляется",()=>{
    scene();
    assert.equal(payout(ROMAN,"first_half",3000).error,null);
    db.query(`delete from public.shifts where employee_id=${literal(ROMAN)}; select 1;`);

    const result=db.rpc(ADMIN,"admin_begin_employee_deletion",{
      p_employee_id:literal(ROMAN)
    });

    assert.match(result.error,/employee_has_history/);
  });

  test("строки снимка держат сотрудника даже в обход функций",()=>{
    scene();
    closePeriod("first_half");

    assert.throws(
      ()=>db.query(`
        delete from public.shifts where employee_id=${literal(ROMAN)};
        delete from public.employees where id=${literal(ROMAN)};
        select 1;
      `),
      /payroll_period_entries_employee_id_fkey/
    );
  });

  test("сотрудник без истории удаляется как прежде",()=>{
    scene();
    addEmployee({id:uuid("20000000",5),name:"Новый"});

    const result=db.rpc(ADMIN,"admin_begin_employee_deletion",{
      p_employee_id:literal(uuid("20000000",5))
    });

    assert.equal(result.error,null);
  });
});

describe("деньги и права",()=>{
  test("все доступные admin-записи проходят общую блокировку, приватные тела не имеют клиентских прав",()=>{
    const gateways=db.query(`select json_agg(json_build_object(
        'name',p.oid::regprocedure::text,
        'locked',p.prosrc like '%perform private.lock_financial_write();%',
        'admin',p.prosrc like '%if not private.is_admin()%',
        'searchPath',p.proconfig
      )) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'admin_%'
        and p.proname<>'admin_account_options_v2'
        and has_function_privilege('authenticated',p.oid,'EXECUTE');`);
    assert.equal(gateways.length,26);
    for(const gateway of gateways){
      assert.equal(gateway.locked,true,gateway.name);
      assert.equal(gateway.admin,true,gateway.name);
      assert.deepEqual(gateway.searchPath,['search_path=""'],gateway.name);
    }
    const internals=db.query(`select json_agg(json_build_object(
        'name',p.oid::regprocedure::text,
        'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
        'anon',has_function_privilege('anon',p.oid,'EXECUTE')
      )) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and (p.proname like 'admin_%' or p.proname='lock_financial_write');`);
    assert.equal(internals.length,27);
    for(const internal of internals){
      assert.equal(internal.authenticated,false,internal.name);
      assert.equal(internal.anon,false,internal.name);
    }
  });

  test("история пишет копейки, а целые — без них",()=>{
    assert.equal(db.query(`select to_jsonb(private.money_text(1500));`),"1 500");
    assert.equal(db.query(`select to_jsonb(private.money_text(1500.5));`),"1 500,50");
    assert.equal(db.query(`select to_jsonb(private.money_text(-20000.05));`),"-20 000,05");
  });

  test("служебные функции расчёта недоступны из Data API",()=>{
    for(const fn of [
      "private.payroll_period_figures(uuid,date,text)",
      "private.payroll_period_entries(date,text)",
      "private.assert_month_effect(jsonb,uuid,date,text[],boolean,text,text)"
    ]){
      assert.equal(
        db.query(`select to_jsonb(has_function_privilege('authenticated',${literal(fn)},'execute'));`),
        false,
        fn
      );
    }
  });

  test("не администратор не вызывает финансовые функции",()=>{
    const stranger="00000000-0000-4000-8000-000000000099";

    db.query(`insert into auth.users(id) values (${literal(stranger)}) on conflict do nothing; select 1;`);

    assert.match(
      db.rpc(stranger,"admin_mark_payroll_period_paid",{
        p_period_month:literal(PERIOD),
        p_payout_kind:literal("first_half")
      }).error,
      /forbidden/
    );
  });
});
