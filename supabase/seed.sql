-- Synthetic local-only data for manual acceptance. Never run this against production.
begin;

insert into public.points(
  id,code,name,active,pricing_type,fixed_rate,advance_enabled,sort_order
)
values
  ('10000000-0000-4000-8000-000000000001','demo-kometa','Демо ПВЗ «Комета»',true,'fixed',3000,false,1),
  ('10000000-0000-4000-8000-000000000002','demo-orbita','Демо ПВЗ «Орбита»',true,'fixed',3500,false,2),
  ('10000000-0000-4000-8000-000000000003','demo-tuman','Демо ПВЗ «Туман»',true,'fixed',3200,false,3)
on conflict (id) do update set
  code=excluded.code,
  name=excluded.name,
  active=excluded.active,
  pricing_type=excluded.pricing_type,
  fixed_rate=excluded.fixed_rate,
  advance_enabled=excluded.advance_enabled,
  sort_order=excluded.sort_order;

insert into public.point_tariffs(
  point_id,effective_from,pricing_type,fixed_rate,shk_tiers
)
values
  ('10000000-0000-4000-8000-000000000001','2026-01-01','fixed',3000,null),
  ('10000000-0000-4000-8000-000000000002','2026-01-01','fixed',3500,null),
  ('10000000-0000-4000-8000-000000000003','2026-01-01','fixed',3200,null)
on conflict (point_id,effective_from) do update set
  pricing_type=excluded.pricing_type,
  fixed_rate=excluded.fixed_rate,
  shk_tiers=excluded.shk_tiers;

insert into public.employees(
  id,full_name,status,hired_at,is_system_substitute
)
values
  ('20000000-0000-4000-8000-000000000001','Марина Соколова','active','2026-01-10',false),
  ('20000000-0000-4000-8000-000000000002','Иван Лебедев','active','2026-02-01',false),
  ('20000000-0000-4000-8000-000000000003','Ольга Ветрова','active','2026-03-01',false)
on conflict (id) do update set
  full_name=excluded.full_name,
  status=excluded.status,
  hired_at=excluded.hired_at,
  is_system_substitute=excluded.is_system_substitute;

insert into public.employee_points(employee_id,point_id,active)
values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',true),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',true)
on conflict (employee_id,point_id) do update set active=true;

insert into public.shifts(
  id,employee_id,shift_date,point_id,shift_type,partial,hours,full_hours,
  base_amount,pricing_snapshot,note
)
values(
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  current_date,
  '10000000-0000-4000-8000-000000000001',
  'main',false,null,12,3000,
  '{"version":2,"fixed":true,"pricingType":"fixed","rate":3000,"fullHours":12,"advanceEnabled":false}'::jsonb,
  'Демо смена для ручной проверки'
)
on conflict (id) do update set
  shift_date=excluded.shift_date,
  note=excluded.note;

commit;
