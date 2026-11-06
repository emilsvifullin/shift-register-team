-- Receipts live outside the Data API. Keep them after deletion so replaying
-- a successful create cannot resurrect a deleted or rolled-back employee.
create table private.shift_employee_operations (
  actor_id uuid not null,
  operation_id uuid not null,
  kind text not null check (kind in ('attach', 'create')),
  employee_id uuid not null,
  point_id uuid not null,
  protects_assignment boolean not null,
  primary key (actor_id, operation_id)
);

revoke all on table private.shift_employee_operations from public, anon, authenticated;

create index shift_employee_operations_assignment_idx
  on private.shift_employee_operations (employee_id, point_id)
  where protects_assignment;

create function private.require_shift_employee_point(p_point_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.points
    where id = p_point_id and active
    for share;
  if not found then
    raise exception 'shift_employee_point_unavailable' using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.require_shift_employee_point(uuid) from public, anon, authenticated;

create function public.admin_attach_shift_employee(
  p_employee_id uuid,
  p_point_id uuid,
  p_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_receipt private.shift_employee_operations%rowtype;
  v_changed boolean;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_operation_id is null then
    raise exception 'shift_employee_operation_required' using errcode = '22023';
  end if;

  perform private.lock_financial_write();

  select * into v_receipt from private.shift_employee_operations
    where actor_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_receipt.kind <> 'attach'
      or v_receipt.point_id is distinct from p_point_id
      or v_receipt.employee_id is distinct from p_employee_id then
      raise exception 'shift_employee_operation_conflict' using errcode = '22023';
    end if;
    return v_receipt.employee_id;
  end if;

  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found then
    raise exception 'employee_not_found' using errcode = 'P0002';
  end if;
  if v_employee.deletion_pending then
    raise exception 'employee_deletion_pending' using errcode = '55000';
  end if;
  if v_employee.status <> 'active' or v_employee.is_system_substitute then
    raise exception 'employee_inactive' using errcode = '22023';
  end if;
  perform private.require_shift_employee_point(p_point_id);

  insert into public.employee_points (employee_id, point_id, active, created_by, updated_by)
    values (p_employee_id, p_point_id, true, auth.uid(), auth.uid())
    on conflict (employee_id, point_id) do update
      set active = true, updated_by = auth.uid()
      where not employee_points.active;
  v_changed := found;

  insert into private.shift_employee_operations
    (actor_id, operation_id, kind, employee_id, point_id, protects_assignment)
    values (auth.uid(), p_operation_id, 'attach', p_employee_id, p_point_id, v_changed);

  return p_employee_id;
end;
$$;

-- The first ten arguments are the existing profile contract. A current
-- editor supplies its original active assignments, including an empty set.
-- Older clients can still save profiles, but cannot drop a shift assignment
-- they might never have seen.
create function public.admin_save_employee_profile_v2(
  p_employee_id uuid,
  p_full_name text,
  p_status text,
  p_hired_at date,
  p_user_id uuid,
  p_phone text,
  p_transfer_phone text,
  p_transfer_bank text,
  p_transfer_recipient text,
  p_point_ids uuid[],
  p_employment_type text,
  p_expected_point_ids uuid[],
  p_shift_point_id uuid,
  p_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_receipt private.shift_employee_operations%rowtype;
  v_employment_type text := lower(trim(coalesce(p_employment_type, 'staff')));
  v_current_points uuid[];
  v_expected_points uuid[];
  v_deletion_pending boolean;
  v_new_point_id uuid;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.lock_financial_write();

  if p_employee_id is null then
    if p_operation_id is null or p_shift_point_id is null or p_expected_point_ids is not null then
      raise exception 'shift_employee_operation_required' using errcode = '22023';
    end if;

    select * into v_receipt from private.shift_employee_operations
      where actor_id = auth.uid() and operation_id = p_operation_id;
    if found then
      if v_receipt.kind <> 'create' or v_receipt.point_id <> p_shift_point_id then
        raise exception 'shift_employee_operation_conflict' using errcode = '22023';
      end if;
      if not exists (select 1 from public.employees where id = v_receipt.employee_id) then
        raise exception 'shift_employee_creation_removed' using errcode = 'P0002';
      end if;
      return v_receipt.employee_id;
    end if;

    if p_status is distinct from 'active' or p_user_id is not null
      or not coalesce(p_shift_point_id = any(p_point_ids), false) then
      raise exception 'shift_employee_assignment_required' using errcode = '22023';
    end if;
    v_current_points := '{}'::uuid[];
  else
    if p_expected_point_ids is null or p_operation_id is not null or p_shift_point_id is not null then
      raise exception 'shift_employee_operation_required' using errcode = '22023';
    end if;
    select deletion_pending into v_deletion_pending
      from public.employees where id = p_employee_id for update;
    if not found then
      raise exception 'employee_not_found' using errcode = 'P0002';
    end if;
    if v_deletion_pending then
      raise exception 'employee_deletion_pending' using errcode = '55000';
    end if;

    select coalesce(array_agg(point_id order by point_id), '{}'::uuid[]) into v_current_points
      from public.employee_points where employee_id = p_employee_id and active;
    select array(select distinct id from unnest(p_expected_point_ids) as ids(id) order by id)
      into v_expected_points;
    if v_current_points <> v_expected_points then
      raise exception 'employee_points_changed' using errcode = 'SR001';
    end if;
  end if;

  for v_new_point_id in
    select distinct id from unnest(p_point_ids) as ids(id)
      where not (id = any(v_current_points)) order by id
  loop
    perform private.require_shift_employee_point(v_new_point_id);
  end loop;

  -- Use the existing validated, atomic profile writer. The legacy wrapper
  -- below protects older editors, while v2 has an explicit snapshot check.
  if v_employment_type not in ('staff', 'substitute') then
    raise exception 'invalid_employment_type' using errcode = '22023';
  end if;
  v_employee_id := private.admin_save_employee_profile(
    p_employee_id, p_full_name, p_status, p_hired_at, p_user_id, p_phone,
    p_transfer_phone, p_transfer_bank, p_transfer_recipient, p_point_ids
  );
  update public.employees set employment_type = v_employment_type, updated_by = auth.uid()
    where id = v_employee_id;

  if p_employee_id is null then
    insert into private.shift_employee_operations
      (actor_id, operation_id, kind, employee_id, point_id, protects_assignment)
      values (auth.uid(), p_operation_id, 'create', v_employee_id, p_shift_point_id, true);
  end if;
  return v_employee_id;
end;
$$;

create or replace function public.admin_save_employee_profile(
  p_employee_id uuid,
  p_full_name text,
  p_status text,
  p_hired_at date,
  p_user_id uuid,
  p_phone text,
  p_transfer_phone text,
  p_transfer_bank text,
  p_transfer_recipient text,
  p_point_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.lock_financial_write();
  if exists (
    select 1 from public.employee_points ep
    where ep.employee_id = p_employee_id and ep.active
      and not exists (select 1 from unnest(p_point_ids) as ids(id) where id = ep.point_id)
      and exists (
        select 1 from private.shift_employee_operations op
        where op.employee_id = ep.employee_id and op.point_id = ep.point_id and op.protects_assignment
      )
  ) then
    raise exception 'employee_points_changed' using errcode = 'SR001';
  end if;
  return private.admin_save_employee_profile(
    p_employee_id, p_full_name, p_status, p_hired_at, p_user_id, p_phone,
    p_transfer_phone, p_transfer_bank, p_transfer_recipient, p_point_ids
  );
end;
$$;

revoke all on function public.admin_attach_shift_employee(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_attach_shift_employee(uuid, uuid, uuid) to authenticated;

revoke all on function public.admin_save_employee_profile_v2(
  uuid, text, text, date, uuid, text, text, text, text, uuid[], text, uuid[], uuid, uuid
) from public, anon, authenticated;
grant execute on function public.admin_save_employee_profile_v2(
  uuid, text, text, date, uuid, text, text, text, text, uuid[], text, uuid[], uuid, uuid
) to authenticated;
