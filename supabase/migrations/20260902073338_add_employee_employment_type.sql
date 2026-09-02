alter table public.employees
  add column if not exists employment_type text not null default 'staff';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_employment_type_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_employment_type_check
      check (employment_type in ('staff', 'substitute'));
  end if;
end;
$$;

comment on column public.employees.employment_type is
  'Employment category used by the UI: staff or substitute.';

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
  p_point_ids uuid[],
  p_employment_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_employment_type text := lower(trim(coalesce(p_employment_type, 'staff')));
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if v_employment_type not in ('staff', 'substitute') then
    raise exception 'invalid_employment_type'
      using errcode = '22023';
  end if;

  v_employee_id := public.admin_save_employee_profile(
    p_employee_id,
    p_full_name,
    p_status,
    p_hired_at,
    p_user_id,
    p_phone,
    p_transfer_phone,
    p_transfer_bank,
    p_transfer_recipient,
    p_point_ids
  );

  update public.employees
  set
    employment_type = v_employment_type,
    updated_by = auth.uid()
  where id = v_employee_id;

  return v_employee_id;
end;
$$;

revoke all on function public.admin_save_employee_profile(
  uuid, text, text, date, uuid, text, text, text, text, uuid[], text
) from public, anon;

grant execute on function public.admin_save_employee_profile(
  uuid, text, text, date, uuid, text, text, text, text, uuid[], text
) to authenticated;
