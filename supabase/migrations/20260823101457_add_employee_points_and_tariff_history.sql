create table public.employee_points (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  point_id uuid not null references public.points(id) on delete cascade,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, point_id)
);

create index employee_points_employee_id_idx
  on public.employee_points(employee_id);

create index employee_points_point_id_idx
  on public.employee_points(point_id);

alter table public.employee_points enable row level security;

create policy employee_points_admin_insert
  on public.employee_points
  for insert
  to authenticated
  with check ((select private.is_admin()));

create policy employee_points_admin_update
  on public.employee_points
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy employee_points_admin_delete
  on public.employee_points
  for delete
  to authenticated
  using ((select private.is_admin()));

create policy employee_points_select_own_or_admin
  on public.employee_points
  for select
  to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.employees e
      where e.id = employee_points.employee_id
        and e.user_id = (select auth.uid())
    )
  );

create trigger employee_points_set_updated_at
  before update on public.employee_points
  for each row
  execute function public.set_updated_at();

create trigger employee_points_audit
  after insert or update or delete on public.employee_points
  for each row
  execute function public.write_audit_log();

create table public.point_tariffs (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references public.points(id) on delete cascade,
  effective_from date not null,
  pricing_type text not null
    check (pricing_type in ('fixed', 'shk_tiers')),
  fixed_rate numeric(12,2),
  shk_tiers jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(point_id, effective_from),
  constraint point_tariffs_pricing_payload_check
    check (
      (
        pricing_type = 'fixed'
        and fixed_rate is not null
        and fixed_rate > 0
        and shk_tiers is null
      )
      or
      (
        pricing_type = 'shk_tiers'
        and fixed_rate is null
        and shk_tiers is not null
        and jsonb_typeof(shk_tiers) = 'array'
        and jsonb_array_length(shk_tiers) > 0
      )
    )
);

create index point_tariffs_point_effective_idx
  on public.point_tariffs(point_id, effective_from desc);

alter table public.point_tariffs enable row level security;

create policy point_tariffs_admin_select
  on public.point_tariffs
  for select
  to authenticated
  using ((select private.is_admin()));

create policy point_tariffs_admin_insert
  on public.point_tariffs
  for insert
  to authenticated
  with check ((select private.is_admin()));

create policy point_tariffs_admin_update
  on public.point_tariffs
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy point_tariffs_admin_delete
  on public.point_tariffs
  for delete
  to authenticated
  using ((select private.is_admin()));

create trigger point_tariffs_set_updated_at
  before update on public.point_tariffs
  for each row
  execute function public.set_updated_at();

create trigger point_tariffs_audit
  after insert or update or delete on public.point_tariffs
  for each row
  execute function public.write_audit_log();

insert into public.point_tariffs (
  point_id,
  effective_from,
  pricing_type,
  fixed_rate,
  shk_tiers
)
select
  p.id,
  current_date,
  p.pricing_type,
  case
    when p.pricing_type = 'fixed'
      then p.fixed_rate
    else null
  end,
  case
    when p.pricing_type = 'shk_tiers'
      then jsonb_build_array(
        jsonb_build_object('up_to', 350, 'rate', 3000),
        jsonb_build_object('up_to', 450, 'rate', 3500),
        jsonb_build_object('up_to', 550, 'rate', 4500),
        jsonb_build_object('up_to', 650, 'rate', 5500),
        jsonb_build_object('up_to', null, 'rate', 6500)
      )
    else null
  end
from public.points p;
