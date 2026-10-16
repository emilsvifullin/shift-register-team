import {test,expect} from "@playwright/test";
import {ADMIN_SEED,FROZEN_TODAY,openApp} from "./support/supabase-stub.mjs";

function busyDay(){
  const seed=structuredClone(ADMIN_SEED);
  const point=seed.points[0];
  const employee=seed.employees[0];
  const date="2026-09-21";
  seed.shifts=Array.from({length:22},(_,index)=>({
    id:`crowded-${index}`,
    employee_id:employee.id,
    shift_date:date,
    point_id:point.id,
    shift_type:index%3===0 ? "extra" : "main",
    shk:200,
    partial:true,
    hours:6,
    full_hours:12,
    base_amount:1500,
    pricing_snapshot:{version:2,fixed:true,pricingType:"fixed",rate:3000,fullHours:12},
    note:"",
    employee:{...employee,full_name:`Анастасия Богомолова ${index+1}`},
    point:{...point,name:"Тверская — длинное название пункта выдачи"},
    bonuses:[],penalties:[]
  }));
  return seed;
}

for(const [name,viewport] of [
  ["phone",{width:390,height:844}],
  ["desktop",{width:1440,height:940}]
]){
  test.describe(name,()=>{
    test.use({viewport});
    test("crowded day and selected days keep each shift inside its own row",async({page})=>{
      await openApp(page,{seed:busyDay()});
      await page.locator('[data-shift-view="calendar"]').click();
      await expect(page.locator(".sv-panel-list .sh")).toHaveCount(22);

      const checkRows=async()=>{
        const geometry=await page.locator(".sv-panel-list").evaluate(list=>{
          const rows=[...list.querySelectorAll(".sh")];
          return {
            overflow:list.scrollHeight>list.clientHeight,
            escapes:rows.flatMap(row=>{
              const outer=row.getBoundingClientRect();
              return [...row.querySelectorAll(".p,.meta,.tag,.amt")].filter(child=>{
                const box=child.getBoundingClientRect();
                return box.top<outer.top-1 || box.bottom>outer.bottom+1;
              }).map(child=>child.className);
            }),
            collisions:rows.slice(1).filter((row,index)=>
              rows[index].getBoundingClientRect().bottom>row.getBoundingClientRect().top+1
            ).length
          };
        });
        expect(geometry.overflow).toBe(true);
        expect(geometry.escapes).toEqual([]);
        expect(geometry.collisions).toBe(0);
        const list=page.locator(".sv-panel-list");
        await list.evaluate(node=>{node.scrollTop=node.scrollHeight;});
        const last=await list.locator(".sh").last().boundingBox();
        const bounds=await list.boundingBox();
        expect(last.y+last.height).toBeLessThanOrEqual(bounds.y+bounds.height+1);
      };
      await checkRows();

      await page.locator('[data-calendar-pick-mode]').click();
      const day=`${FROZEN_TODAY.getFullYear()}-09-21`;
      await page.locator(`[data-calendar-day="${day}"]`).click();
      await expect(page.locator(".sv-panel-list .sh")).toHaveCount(22);
      await checkRows();
    });
  });
}
