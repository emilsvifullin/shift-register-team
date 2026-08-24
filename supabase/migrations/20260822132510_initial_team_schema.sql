create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'employee' check (role in ('admin','employee')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null check (length(trim(full_name)) > 0),
  status text not null default 'active' check (status in ('active','inactive')),
  hired_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create table public.points (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  shift_date date not null,
  point_id uuid not null references public.points(id) on delete restrict,
  shift_type text not null check (shift_type in ('main','extra')),
  shk integer check (shk is null or shk >= 0),
  partial boolean not null default false,
  hours numeric(5,2) check (hours is null or (hours > 0 and hours <= 24)),
  full_hours numeric(5,2) not null default 12 check (full_hours > 0 and full_hours <= 24),
  base_amount numeric(12,2) not null check (base_amount >= 0),
  pricing_snapshot jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  check (
    (partial = false and (hours is null or hours = full_hours))
    or
    (partial = true and hours is not null and hours < full_hours)
  )
);

create table public.shift_bonuses (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  comment text not null check (length(trim(comment)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create table public.shift_penalties (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  comment text not null check (length(trim(comment)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('insert','update','delete')),
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index employees_user_id_idx on public.employees(user_id);
create index shifts_employee_date_idx on public.shifts(employee_id, shift_date desc);
create index shifts_point_date_idx on public.shifts(point_id, shift_date desc);
create index shift_bonuses_shift_id_idx on public.shift_bonuses(shift_id);
create index shift_penalties_shift_id_idx on public.shift_penalties(shift_id);
create index audit_log_entity_idx on public.audit_log(entity_type, entity_id, created_at desc);
create index audit_log_actor_idx on public.audit_log(actor_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  if to_jsonb(new) ? 'updated_by' then
    new.updated_by = auth.uid();
  end if;
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger employees_set_updated_at
before update on public.employees
for each row execute function public.set_updated_at();

create trigger points_set_updated_at
before update on public.points
for each row execute function public.set_updated_at();

create trigger shifts_set_updated_at
before update on public.shifts
for each row execute function public.set_updated_at();

create trigger shift_bonuses_set_updated_at
before update on public.shift_bonuses
for each row execute function public.set_updated_at();

create trigger shift_penalties_set_updated_at
before update on public.shift_penalties
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(id, role)
  values (new.id, 'employee')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_old jsonb;
  row_new jsonb;
  object_id uuid;
begin
  if tg_op = 'INSERT' then
    row_new := to_jsonb(new);
    object_id := new.id;
  elsif tg_op = 'UPDATE' then
    row_old := to_jsonb(old);
    row_new := to_jsonb(new);
    object_id := new.id;
  elsif tg_op = 'DELETE' then
    row_old := to_jsonb(old);
    object_id := old.id;
  end if;

  insert into public.audit_log(
    actor_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data
  ) values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    object_id,
    row_old,
    row_new
  );

  return coalesce(new, old);
end;
$$;

create trigger employees_audit
  after insert or update or delete on public.employees
  for each row execute function public.write_audit_log();

create trigger points_audit
  after insert or update or delete on public.points
  for each row execute function public.write_audit_log();

create trigger shifts_audit
  after insert or update or delete on public.shifts
  for each row execute function public.write_audit_log();

create trigger shift_bonuses_audit
  after insert or update or delete on public.shift_bonuses
  for each row execute function public.write_audit_log();

create trigger shift_penalties_audit
  after insert or update or delete on public.shift_penalties
  for each row execute function public.write_audit_log();

alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.points enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_bonuses enable row level security;
alter table public.shift_penalties enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_select_own_or_admin
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

create policy profiles_admin_insert
on public.profiles
for insert
to authenticated
with check (public.is_admin());

create policy profiles_admin_update
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy profiles_admin_delete
on public.profiles
for delete
to authenticated
using (public.is_admin());

create policy employees_select_own_or_admin
on public.employees
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy employees_admin_insert
on public.employees
for insert
to authenticated
with check (public.is_admin());

create policy employees_admin_update
on public.employees
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy employees_admin_delete
on public.employees
for delete
to authenticated
using (public.is_admin());

create policy points_authenticated_select
on public.points
for select
to authenticated
using (true);

create policy points_admin_insert
on public.points
for insert
to authenticated
with check (public.is_admin());

create policy points_admin_update
on public.points
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy points_admin_delete
on public.points
for delete
to authenticated
using (public.is_admin());

create policy shifts_select_own_or_admin
on public.shifts
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.employees e
    where e.id = shifts.employee_id
      and e.user_id = auth.uid()
  )
);

create policy shifts_admin_insert
on public.shifts
for insert
to authenticated
with check (public.is_admin());

create policy shifts_admin_update
on public.shifts
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy shifts_admin_delete
on public.shifts
for delete
to authenticated
using (public.is_admin());

create policy shift_bonuses_select_own_or_admin
on public.shift_bonuses
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.shifts s
    join public.employees e on e.id = s.employee_id
    where s.id = shift_bonuses.shift_id
      and e.user_id = auth.uid()
  )
);

create policy shift_bonuses_admin_insert
on public.shift_bonuses
for insert
to authenticated
with check (public.is_admin());

create policy shift_bonuses_admin_update
on public.shift_bonuses
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy shift_bonuses_admin_delete
on public.shift_bonuses
for delete
to authenticated
using (public.is_admin());

create policy shift_penalties_select_own_or_admin
on public.shift_penalties
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.shifts s
    join public.employees e on e.id = s.employee_id
    where s.id = shift_penalties.shift_id
      and e.user_id = auth.uid()
  )
);

create policy shift_penalties_admin_insert
on public.shift_penalties
for insert
to authenticated
with check (public.is_admin());

create policy shift_penalties_admin_update
on public.shift_penalties
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy shift_penalties_admin_delete
on public.shift_penalties
for delete
to authenticated
using (public.is_admin());

create policy audit_log_admin_select
on public.audit_log
for select
to authenticated
using (public.is_admin());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.employees to authenticated;
grant select, insert, update, delete on public.points to authenticated;
grant select, insert, update, delete on public.shifts to authenticated;
grant select, insert, update, delete on public.shift_bonuses to authenticated;
grant select, insert, update, delete on public.shift_penalties to authenticated;
grant select on public.audit_log to authenticated;
grant execute on function public.is_admin() to authenticated;
