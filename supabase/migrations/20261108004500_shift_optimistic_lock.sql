begin;

alter table public.shifts
  add column if not exists version integer not null default 1;

alter table public.shifts
  drop constraint if exists shifts_version_positive;

alter table public.shifts
  add constraint shifts_version_positive check (version > 0);

create table if not exists private.shift_write_operations (
  actor_id uuid not null,
  operation_id uuid not null,
  operation_kind text not null check (operation_kind in ('create', 'update', 'delete')),
  target_id uuid,
  request_hash text not null,
  result_id uuid,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation_id)
);

revoke all on table private.shift_write_operations from public, anon, authenticated;

create index if not exists shift_write_operations_target_idx
  on private.shift_write_operations (target_id);

create table if not exists private.shift_tombstones (
  shift_id uuid primary key,
  version integer not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid,
  reason text
);

revoke all on table private.shift_tombstones from public, anon, authenticated;

create or replace function private.capture_shift_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.shift_tombstones(shift_id, version, deleted_by)
  values (old.id, old.version, auth.uid())
  on conflict (shift_id) do update set
    version = excluded.version,
    deleted_at = now(),
    deleted_by = excluded.deleted_by;
  return old;
end;
$$;

revoke all on function private.capture_shift_tombstone() from public, anon, authenticated;

drop trigger if exists shifts_capture_tombstone on public.shifts;
create trigger shifts_capture_tombstone
after delete on public.shifts
for each row execute function private.capture_shift_tombstone();

create or replace function private.bump_shift_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version = old.version + 1;
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.bump_shift_version() from public, anon, authenticated;

drop trigger if exists shifts_bump_version on public.shifts;
create trigger shifts_bump_version
before update on public.shifts
for each row execute function private.bump_shift_version();

create or replace function private.shift_write_request_hash(
  p_operation_kind text,
  p_shift_id uuid,
  p_expected_version integer,
  p_employee_id uuid,
  p_shift_date date,
  p_point_id uuid,
  p_shift_type text,
  p_shk integer,
  p_partial boolean,
  p_hours numeric,
  p_note text,
  p_bonuses jsonb,
  p_penalties jsonb,
  p_base_amount_override numeric,
  p_base_amount_reason text,
  p_force boolean,
  p_reason text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(concat_ws('|',
    p_operation_kind, coalesce(p_shift_id::text, ''),
    coalesce(p_expected_version::text, ''),
    coalesce(p_employee_id::text, ''), coalesce(p_shift_date::text, ''),
    coalesce(p_point_id::text, ''), coalesce(p_shift_type, ''),
    coalesce(p_shk::text, ''), coalesce(p_partial::text, ''),
    coalesce(p_hours::text, ''), coalesce(p_note, ''),
    coalesce(p_bonuses::text, ''), coalesce(p_penalties::text, ''),
    coalesce(p_base_amount_override::text, ''),
    coalesce(p_base_amount_reason, ''), coalesce(p_force::text, ''),
    coalesce(p_reason, '')
  ));
$$;

revoke all on function private.shift_write_request_hash(text,uuid,integer,uuid,date,uuid,text,integer,boolean,numeric,text,jsonb,jsonb,numeric,text,boolean,text)
from public, anon, authenticated;

create function public.admin_save_shift_v5(
  p_shift_id uuid,
  p_expected_version integer,
  p_operation_id uuid,
  p_employee_id uuid,
  p_shift_date date,
  p_point_id uuid,
  p_shift_type text,
  p_shk integer,
  p_partial boolean,
  p_hours numeric,
  p_note text,
  p_bonuses jsonb,
  p_penalties jsonb,
  p_base_amount_override numeric,
  p_base_amount_reason text,
  p_force boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_receipt private.shift_write_operations%rowtype;
  v_existing public.shifts%rowtype;
  v_id uuid;
  v_version integer;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_operation_id is null then
    raise exception 'operation_id_required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(auth.uid()::text || ':' || p_operation_id::text)
  );

  v_hash := private.shift_write_request_hash(
    case when p_shift_id is null then 'create' else 'update' end,
    p_shift_id, p_expected_version, p_employee_id, p_shift_date, p_point_id, p_shift_type,
    p_shk, p_partial, p_hours, p_note, p_bonuses, p_penalties,
    p_base_amount_override, p_base_amount_reason, p_force, p_reason
  );

  select * into v_receipt from private.shift_write_operations
  where actor_id = auth.uid() and operation_id = p_operation_id;

  if found then
    if v_receipt.request_hash <> v_hash then
      raise exception 'operation_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'saved', 'shift_id', v_receipt.result_id);
  end if;

  perform private.lock_financial_write();

  if p_shift_id is not null then
    select * into v_existing from public.shifts where id = p_shift_id for update;
    if not found then
      if exists(
        select 1
        from private.shift_tombstones
        where shift_id = p_shift_id
      ) then
        raise exception 'record_deleted' using errcode = 'P0002';
      end if;
      raise exception 'record_not_found' using errcode = 'P0002';
    end if;
    if p_expected_version is null or v_existing.version <> p_expected_version then
      raise exception 'record_changed' using errcode = 'SR002';
    end if;
  elsif p_expected_version is not null then
    raise exception 'invalid_create_version' using errcode = '22023';
  end if;

  v_id := private.admin_save_shift_v4(
    p_shift_id, p_employee_id, p_shift_date, p_point_id, p_shift_type,
    p_shk, p_partial, p_hours, p_note, p_bonuses, p_penalties,
    p_base_amount_override, p_base_amount_reason, p_force, p_reason
  );

  select version into v_version from public.shifts where id = v_id;

  insert into private.shift_write_operations
    (actor_id, operation_id, operation_kind, target_id, request_hash, result_id)
  values
    (auth.uid(), p_operation_id,
     case when p_shift_id is null then 'create' else 'update' end,
     v_id, v_hash, v_id);

  return jsonb_build_object('status', 'saved', 'shift_id', v_id, 'version', v_version);
end;
$$;

revoke all on function public.admin_save_shift_v5(uuid,integer,uuid,uuid,date,uuid,text,integer,boolean,numeric,text,jsonb,jsonb,numeric,text,boolean,text)
from public, anon;
grant execute on function public.admin_save_shift_v5(uuid,integer,uuid,uuid,date,uuid,text,integer,boolean,numeric,text,jsonb,jsonb,numeric,text,boolean,text)
to authenticated;

create function public.admin_delete_shift_v3(
  p_shift_id uuid,
  p_expected_version integer,
  p_operation_id uuid,
  p_force boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_receipt private.shift_write_operations%rowtype;
  v_existing public.shifts%rowtype;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_operation_id is null then
    raise exception 'operation_id_required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(auth.uid()::text || ':' || p_operation_id::text)
  );

  v_hash := md5(concat_ws('|', 'delete', p_shift_id::text, p_expected_version::text, p_force::text, coalesce(p_reason, '')));

  select * into v_receipt from private.shift_write_operations
  where actor_id = auth.uid() and operation_id = p_operation_id;
  if found then
    if v_receipt.request_hash <> v_hash then
      raise exception 'operation_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'deleted', 'shift_id', v_receipt.result_id);
  end if;

  perform private.lock_financial_write();

  select * into v_existing from public.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'record_deleted' using errcode = 'P0002';
  end if;
  if p_expected_version is null or v_existing.version <> p_expected_version then
    raise exception 'record_changed' using errcode = 'SR002';
  end if;

  perform private.admin_delete_shift_v2(p_shift_id, p_force, p_reason);

  insert into private.shift_write_operations
    (actor_id, operation_id, operation_kind, target_id, request_hash, result_id)
  values (auth.uid(), p_operation_id, 'delete', p_shift_id, v_hash, p_shift_id);

  return jsonb_build_object('status', 'deleted', 'shift_id', p_shift_id);
end;
$$;

revoke all on function public.admin_delete_shift_v3(uuid,integer,uuid,boolean,text)
from public, anon;
grant execute on function public.admin_delete_shift_v3(uuid,integer,uuid,boolean,text)
to authenticated;

create or replace function public.admin_save_shift_v4(
  p_shift_id uuid, p_employee_id uuid, p_shift_date date, p_point_id uuid,
  p_shift_type text, p_shk integer, p_partial boolean, p_hours numeric,
  p_note text, p_bonuses jsonb, p_penalties jsonb,
  p_base_amount_override numeric, p_base_amount_reason text,
  p_force boolean default false, p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'optimistic_lock_required' using errcode = 'SR003';
end;
$$;

revoke all on function public.admin_save_shift_v4(uuid,uuid,date,uuid,text,integer,boolean,numeric,text,jsonb,jsonb,numeric,text,boolean,text)
from public, anon, authenticated;

revoke execute on function public.admin_delete_shift_v2(uuid,boolean,text)
from authenticated;

revoke execute on function public.admin_delete_point(uuid)
from authenticated;

commit;
