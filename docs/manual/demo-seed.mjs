import {ADMIN_SEED} from "../../e2e/support/supabase-stub.mjs";

/* Демонстрационные данные для инструкции: всё вымышленное. */
const POINTS=[
  ["Тверская 12",3000,false],["Ленинский 45",3000,true],["Осенний бульвар 7",3000,false],
  ["Садовая 22",3500,false],["Профсоюзная 18",3000,true],["Мира 90",3300,false],
  ["Кутузовский 30",3500,false],["Сретенка 5",3000,false],["Пятницкая 14",3000,true],
  ["Бауманская 3",3300,false]
];
const PEOPLE=["Анна Смирнова","Дмитрий Орлов","Екатерина Волкова","Игорь Лебедев","Мария Соколова",
  "Павел Кузнецов","Ольга Морозова","Сергей Никитин","Татьяна Белова","Алексей Фролов",
  "Юлия Громова","Виктор Павлов"];

/*
  paidFirstHalf — суммы первой половины по сотрудникам (как их считает
  приложение); по ним записываются выплаты 25 сентября и период 1–15
  отмечается выплаченным.
*/
export function demoSeed({paidFirstHalf=null,firstHalfStatus=null}={}){
  const s=structuredClone(ADMIN_SEED);
  s.account={id:"user-admin",email:"admin@example.com",user_metadata:{full_name:"Елена Иванова"}};
  s.points=POINTS.map(([name,rate,adv],i)=>({id:`pt-${i}`,code:`p${i}`,name,active:true,pricing_type:"fixed",fixed_rate:rate,advance_enabled:adv,sort_order:i}));
  s.point_tariffs=s.points.map(p=>({id:`tf-${p.id}`,point_id:p.id,effective_from:"2026-01-01",pricing_type:"fixed",fixed_rate:p.fixed_rate,shk_tiers:null,created_at:"2026-01-01T00:00:00Z"}));
  s.employees=PEOPLE.map((full_name,i)=>({id:`emp-${i}`,user_id:i<8?`user-${i}`:null,full_name,status:"active",hired_at:"2026-02-01",is_system_substitute:false,phone:null,transfer_phone:null,transfer_bank:null,transfer_recipient:null}));
  const LOGINS=["a.smirnova","d.orlov","e.volkova","i.lebedev","m.sokolova","p.kuznetsov","o.morozova","s.nikitin"];
  s.accounts=s.employees.filter(e=>e.user_id).map((e,i)=>({user_id:e.user_id,login:`${LOGINS[i]}@example.com`,email:`${LOGINS[i]}@example.com`}));
  Object.assign(s.employees[0],{phone:"+79001234567",transfer_phone:"+79001234567",transfer_bank:"Сбербанк",transfer_recipient:"Анна С."});
  s.employee_points=[];
  s.points.forEach((p,i)=>{
    for(const k of [i, (i+10)%12]) s.employee_points.push({employee_id:`emp-${k%12}`,point_id:p.id,active:true});
  });
  s.shifts=[];
  s.points.forEach((p,i)=>{
    for(let d=1; d<=28; d++){
      if((d+i)%9===0) continue; // редкие пропуски
      const emp=s.employees[(d%3===0 ? (i+10)%12 : i)%12];
      const date=`2026-09-${String(d).padStart(2,"0")}`;
      s.shifts.push({id:`sh-${i}-${d}`,employee_id:emp.id,shift_date:date,point_id:p.id,shift_type:d%11===0?"extra":"main",shk:null,partial:false,hours:null,full_hours:12,base_amount:p.fixed_rate,
        pricing_snapshot:{version:2,fixed:true,pricingType:"fixed",rate:p.fixed_rate,fullHours:12,advanceEnabled:p.advance_enabled},
        note:"",employee:{id:emp.id,user_id:emp.user_id,full_name:emp.full_name,status:"active"},point:{...p},bonuses:[],penalties:[]});
    }
  });
  s.employee_payouts=paidFirstHalf
    ? Object.entries(paidFirstHalf).map(([employee_id,amount],i)=>({id:`pay-${i}`,employee_id,period_month:"2026-09-01",payout_kind:"first_half",amount,paid_on:"2026-09-25",comment:"",created_at:"2026-09-25T10:00:00Z",updated_at:"2026-09-25T10:00:00Z"}))
    : [];
  s.payroll_periods=firstHalfStatus
    ? [{id:"period-1",period_month:"2026-09-01",payout_kind:"first_half",status:firstHalfStatus,checked_fingerprint:null,checked_at:"2026-09-17T09:00:00Z",closed_at:"2026-09-17T09:10:00Z",paid_at:firstHalfStatus==="paid"?"2026-09-25T12:00:00Z":null}]
    : [];
  /*
    История периода 1–15: записанные выплаты и одна правка после
    закрытия — такой, какой её пишет сервер.
  */
  s.payroll_events=paidFirstHalf
    ? [
        {id:"ev-3",period_month:"2026-09-01",payout_kind:"first_half",employee_id:"emp-2",kind:"closed_period_change",summary:"смена удалена",reason:"Массовое удаление смен",effect:-3000,period_status:"paid",details:{date:"2026-09-08"},occurred_at:"2026-09-26T08:40:00Z"},
        {id:"ev-2",period_month:"2026-09-01",payout_kind:"first_half",employee_id:"emp-1",kind:"payout_added",summary:"",reason:null,effect:paidFirstHalf["emp-1"] ?? null,period_status:"closed",details:{date:"2026-09-25"},occurred_at:"2026-09-25T10:05:00Z"},
        {id:"ev-1",period_month:"2026-09-01",payout_kind:"first_half",employee_id:"emp-0",kind:"payout_added",summary:"аванс",reason:null,effect:paidFirstHalf["emp-0"] ?? null,period_status:"closed",details:{date:"2026-09-25"},occurred_at:"2026-09-25T10:00:00Z"}
      ]
    : [];
  return s;
}
