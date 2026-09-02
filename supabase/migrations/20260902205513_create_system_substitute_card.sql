-- Applied to production as migration 20260902205513.
begin;

alter table public.employees
  add column if not exists is_system_substitute boolean not null default false;

create unique index if not exists employees_single_system_substitute_idx
  on public.employees(is_system_substitute)
  where is_system_substitute;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_system_substitute_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_system_substitute_check
      check (
        not is_system_substitute
        or (
          full_name = 'Подмена'
          and status = 'active'
          and user_id is null
          and hired_at is null
          and phone is null
          and transfer_phone is null
          and transfer_bank is null
          and transfer_recipient is null
          and deletion_pending = false
          and deletion_previous_status is null
        )
      );
  end if;
end;
$$;

insert into public.employees(
  full_name,
  status,
  employment_type,
  is_system_substitute
)
select
  'Подмена',
  'active',
  'staff',
  true
where not exists (
  select 1
  from public.employees e
  where e.is_system_substitute
);

insert into public.employee_points(
  employee_id,
  point_id,
  active
)
select
  e.id,
  p.id,
  true
from public.employees e
cross join public.points p
where e.is_system_substitute
on conflict (employee_id, point_id)
do update set
  active = true,
  updated_at = now();

create or replace function private.assign_system_substitute_to_point()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.employee_points(
    employee_id,
    point_id,
    active,
    created_by,
    updated_by
  )
  select
    e.id,
    new.id,
    true,
    auth.uid(),
    auth.uid()
  from public.employees e
  where e.is_system_substitute
  on conflict (employee_id, point_id)
  do update set
    active = true,
    updated_by = auth.uid(),
    updated_at = now();

  return new;
end;
$$;

revoke all on function private.assign_system_substitute_to_point()
from public, anon, authenticated;

drop trigger if exists points_assign_system_substitute
on public.points;

create trigger points_assign_system_substitute
after insert on public.points
for each row
execute function private.assign_system_substitute_to_point();

create or replace function private.protect_system_substitute()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.is_system_substitute then
    raise exception 'system_substitute_already_exists'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' and old.is_system_substitute then
    raise exception 'system_substitute_locked'
      using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' then
    if
      old.is_system_substitute
      and (
        to_jsonb(new) - array[
          'updated_at',
          'updated_by'
        ]::text[]
      ) is distinct from (
        to_jsonb(old) - array[
          'updated_at',
          'updated_by'
        ]::text[]
      )
    then
      raise exception 'system_substitute_locked'
        using errcode = '55000';
    end if;

    if
      not old.is_system_substitute
      and new.is_system_substitute
    then
      raise exception 'system_substitute_already_exists'
        using errcode = '55000';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_system_substitute()
from public, anon, authenticated;

drop trigger if exists employees_protect_system_substitute
on public.employees;

create trigger employees_protect_system_substitute
before insert or update or delete on public.employees
for each row
execute function private.protect_system_substitute();

comment on column public.employees.is_system_substitute is
  'True only for the protected system card Подмена used in the shift registry.';

commit;
