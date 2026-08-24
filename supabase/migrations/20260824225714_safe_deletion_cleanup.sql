-- Applied to production as migration 20260824225714.
begin;

alter table public.employees
  add column if not exists deletion_pending boolean not null default false,
  add column if not exists deletion_previous_status text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_deletion_previous_status_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_deletion_previous_status_check
      check (
        deletion_previous_status is null or
        deletion_previous_status in ('active', 'inactive')
      );
  end if;
end;
$$;

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
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
    object_id := old.id;

    delete from public.audit_log a
    where a.entity_type = tg_table_name
      and a.entity_id = object_id;
  end if;

  if tg_table_name = 'employees' then
    row_old := row_old - array[
      'phone',
      'transfer_phone',
      'transfer_bank',
      'transfer_recipient'
    ]::text[];

    row_new := row_new - array[
      'phone',
      'transfer_phone',
      'transfer_bank',
      'transfer_recipient'
    ]::text[];
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

revoke all on function public.write_audit_log()
from public, anon, authenticated;

update public.audit_log
set
  old_data = old_data - array[
    'phone',
    'transfer_phone',
    'transfer_bank',
    'transfer_recipient'
  ]::text[],
  new_data = new_data - array[
    'phone',
    'transfer_phone',
    'transfer_bank',
    'transfer_recipient'
  ]::text[]
where entity_type = 'employees';

delete from public.audit_log a
where
  (
    a.entity_type = 'employees' and
    not exists (
      select 1
      from public.employees e
      where e.id = a.entity_id
    )
  ) or (
    a.entity_type = 'employee_points' and
    not exists (
      select 1
      from public.employee_points ep
      where ep.id = a.entity_id
    )
  ) or (
    a.entity_type = 'points' and
    not exists (
      select 1
      from public.points p
      where p.id = a.entity_id
    )
  ) or (
    a.entity_type = 'point_tariffs' and
    not exists (
      select 1
      from public.point_tariffs pt
      where pt.id = a.entity_id
    )
  ) or (
    a.entity_type = 'shifts' and
    not exists (
      select 1
      from public.shifts s
      where s.id = a.entity_id
    )
  ) or (
    a.entity_type = 'shift_bonuses' and
    not exists (
      select 1
      from public.shift_bonuses b
      where b.id = a.entity_id
    )
  ) or (
    a.entity_type = 'shift_penalties' and
    not exists (
      select 1
      from public.shift_penalties p
      where p.id = a.entity_id
    )
  );

create or replace function private.guard_employee_deletion_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if
    old.deletion_pending and
    new.deletion_pending and
    (
      new.status <> 'inactive' or
      (
        to_jsonb(new) - array[
          'user_id',
          'updated_at',
          'updated_by'
        ]::text[]
      ) is distinct from (
        to_jsonb(old) - array[
          'user_id',
          'updated_at',
          'updated_by'
        ]::text[]
      )
    )
  then
    raise exception 'employee_deletion_pending'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists employees_guard_deletion_update
on public.employees;

create trigger employees_guard_deletion_update
before update on public.employees
for each row
execute function private.guard_employee_deletion_update();

create or replace function private.prevent_shift_for_deleting_employee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.employees e
    where e.id = new.employee_id
      and e.deletion_pending
  ) then
    raise exception 'employee_deletion_pending'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists shifts_block_deleting_employee
on public.shifts;

create trigger shifts_block_deleting_employee
before insert or update of employee_id
on public.shifts
for each row
execute function private.prevent_shift_for_deleting_employee();

create or replace function public.admin_begin_employee_deletion(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  lock table public.shifts
  in share row exclusive mode;

  select *
  into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception 'employee_not_found'
      using errcode = 'P0002';
  end if;

  if v_employee.deletion_pending then
    return v_employee.user_id;
  end if;

  if exists (
    select 1
    from public.shifts s
    where s.employee_id = p_employee_id
  ) then
    raise exception 'employee_has_history'
      using errcode = '23503';
  end if;

  if
    v_employee.user_id is not null and
    exists (
      select 1
      from public.profiles p
      where p.id = v_employee.user_id
        and p.role = 'admin'
    )
  then
    raise exception 'admin_account_protected'
      using errcode = '55000';
  end if;

  update public.employees e
  set
    deletion_previous_status = e.status,
    deletion_pending = true,
    status = 'inactive',
    updated_by = auth.uid()
  where e.id = p_employee_id;

  return v_employee.user_id;
end;
$$;

create or replace function public.admin_cancel_employee_deletion(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select *
  into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception 'employee_not_found'
      using errcode = 'P0002';
  end if;

  if v_employee.deletion_pending then
    update public.employees e
    set
      status = coalesce(
        e.deletion_previous_status,
        'inactive'
      ),
      deletion_pending = false,
      deletion_previous_status = null,
      updated_by = auth.uid()
    where e.id = p_employee_id;
  end if;

  return p_employee_id;
end;
$$;

create or replace function public.admin_finalize_employee_deletion(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  lock table public.shifts
  in share row exclusive mode;

  select *
  into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception 'employee_not_found'
      using errcode = 'P0002';
  end if;

  if not v_employee.deletion_pending then
    raise exception 'employee_deletion_not_started'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.shifts s
    where s.employee_id = p_employee_id
  ) then
    raise exception 'employee_has_history'
      using errcode = '23503';
  end if;

  if v_employee.user_id is not null then
    raise exception 'employee_auth_cleanup_required'
      using errcode = '55000';
  end if;

  delete from public.employees e
  where e.id = p_employee_id;

  return p_employee_id;
end;
$$;

create or replace function public.admin_rollback_employee_creation(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  lock table public.shifts
  in share row exclusive mode;

  select *
  into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    return p_employee_id;
  end if;

  if
    v_employee.user_id is not null or
    v_employee.deletion_pending or
    v_employee.created_by is distinct from auth.uid() or
    exists (
      select 1
      from public.shifts s
      where s.employee_id = p_employee_id
    )
  then
    raise exception 'employee_creation_rollback_forbidden'
      using errcode = '55000';
  end if;

  delete from public.employees e
  where e.id = p_employee_id;

  return p_employee_id;
end;
$$;

create or replace function public.admin_delete_employee(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  raise exception 'employee_auth_cleanup_required'
    using errcode = '55000';
end;
$$;

revoke all on function
  private.guard_employee_deletion_update(),
  private.prevent_shift_for_deleting_employee()
from public, anon, authenticated;

revoke all on function
  public.admin_begin_employee_deletion(uuid),
  public.admin_cancel_employee_deletion(uuid),
  public.admin_finalize_employee_deletion(uuid),
  public.admin_rollback_employee_creation(uuid),
  public.admin_delete_employee(uuid)
from public, anon, authenticated;

grant execute on function
  public.admin_begin_employee_deletion(uuid),
  public.admin_cancel_employee_deletion(uuid),
  public.admin_finalize_employee_deletion(uuid),
  public.admin_rollback_employee_creation(uuid)
to authenticated;

drop policy if exists employee_points_select_own_or_admin
on public.employee_points;

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
      and e.status = 'active'
      and not e.deletion_pending
  )
);

drop policy if exists shifts_select_own_or_admin
on public.shifts;

create policy shifts_select_own_or_admin
on public.shifts
for select
to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.employees e
    where e.id = shifts.employee_id
      and e.user_id = (select auth.uid())
      and e.status = 'active'
      and not e.deletion_pending
  )
);

drop policy if exists shift_bonuses_select_own_or_admin
on public.shift_bonuses;

create policy shift_bonuses_select_own_or_admin
on public.shift_bonuses
for select
to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.shifts s
    join public.employees e
      on e.id = s.employee_id
    where s.id = shift_bonuses.shift_id
      and e.user_id = (select auth.uid())
      and e.status = 'active'
      and not e.deletion_pending
  )
);

drop policy if exists shift_penalties_select_own_or_admin
on public.shift_penalties;

create policy shift_penalties_select_own_or_admin
on public.shift_penalties
for select
to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.shifts s
    join public.employees e
      on e.id = s.employee_id
    where s.id = shift_penalties.shift_id
      and e.user_id = (select auth.uid())
      and e.status = 'active'
      and not e.deletion_pending
  )
);

commit;
