import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {shiftRateForDate} from '../src/team-domain.js';

const source=(await readFile(new URL('../src/api/read.js',import.meta.url),'utf8'))
  .replace(/import\s*\{[^}]*\}\s*from\s*"[^"]+";/g,'')
  .replace(/export /g,'');

function clientFor(tables,cap,onPage=()=>{}){
  const calls=[];
  return {calls,client:{
    rpc:async()=>({data:[],error:null}),
    from(table){
      let offset=0,end=Infinity;
      const orders=[];
      const builder={
        select(){return builder;},
        order(column,{ascending=true}={}){orders.push({column,ascending});return builder;},
        range(from,to){offset=from;end=to+1;return builder;},
        then(resolve,reject){
          onPage(table,offset);
          const rows=[...(tables[table] || [])].sort((a,b)=>{
            for(const {column,ascending} of orders){
              const result=String(a[column]).localeCompare(String(b[column]));
              if(result)return ascending ? result : -result;
            }
            return 0;
          });
          calls.push({table,offset,orders});
          return Promise.resolve({data:rows.slice(offset,Math.min(end,offset+cap)),count:rows.length,error:null}).then(resolve,reject);
        }
      };
      return builder;
    }
  }};
}

test('admin loading reads rates beyond a capped first page and composite assignments completely',async()=>{
  const rates=Array.from({length:1001},(_,i)=>({id:`r-${String(i).padStart(4,'0')}`,
    employee_id:i===1000?'employee':'other',point_id:'point',effective_from:'2026-01-01',pricing_type:'fixed',fixed_rate:3500}));
  const assignments=Array.from({length:1001},(_,i)=>({employee_id:`e-${String(i).padStart(4,'0')}`,point_id:'point',active:true}));
  const records=Array.from({length:1001},(_,i)=>({id:`id-${String(i).padStart(4,'0')}`,name:'Same',full_name:'Same',status:'active',period_month:'2026-01-01'}));
  const {client,calls}=clientFor({employee_point_rates:rates,point_tariffs:[{id:'tariff',point_id:'point',effective_from:'2026-01-01',pricing_type:'fixed',fixed_rate:3000}],employee_points:assignments,employees:records,points:records,payroll_periods:records},100);
  const load=vm.runInNewContext(source+';loadAdminTeamData',{
    supabaseClient:client,resultData:result=>{if(result.error)throw result.error;return result.data;},
    sortPointsAlphabetically:rows=>rows,mapServerShift:row=>row
  });
  const data=await load();
  assert.equal(data.employeeRates.length,1001);
  assert.equal(data.employeePoints.length,1001);
  assert.equal(data.employees.length,1001);
  assert.equal(data.points.length,1001);
  assert.equal(data.periods.length,1001);
  assert.equal(shiftRateForDate({tariffs:data.tariffs,employeeRates:data.employeeRates,employeeId:'employee',pointId:'point',shiftDate:'2026-09-03'}).tariff.fixed_rate,3500);
  assert.deepEqual(calls.filter(x=>x.table==='employee_points').map(x=>x.offset),[0,100,200,300,400,500,600,700,800,900,1000]);
  for(const table of ['employee_point_rates','point_tariffs','employees','points','payroll_periods']){
    assert.equal(calls.find(x=>x.table===table).orders.at(-1).column,'id');
  }
});


test('a row inserted before the next page cannot hide the original last rate',async()=>{
  const rates=Array.from({length:1000},(_,i)=>({id:`r-${String(i).padStart(4,'0')}`,
    employee_id:i===999?'employee':'other',point_id:'point',effective_from:'2026-01-01',pricing_type:'fixed',fixed_rate:3500}));
  const {client}=clientFor({employee_point_rates:rates},100,(table,offset)=>{
    if(table==='employee_point_rates' && offset===100) rates.push({...rates[0],id:'a-new'});
  });
  const load=vm.runInNewContext(source+';loadAdminTeamData',{
    supabaseClient:client,resultData:result=>result.data,sortPointsAlphabetically:rows=>rows,mapServerShift:row=>row
  });
  const data=await load();
  assert.equal(data.employeeRates.length,1000);
  assert.equal(data.employeeRates.find(row=>row.employee_id==='employee')?.fixed_rate,3500);
  assert.equal(new Set(data.employeeRates.map(row=>row.id)).size,data.employeeRates.length);
});
