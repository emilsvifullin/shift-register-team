alter table public.employees
  add column if not exists phone text,
  add column if not exists transfer_phone text,
  add column if not exists transfer_bank text,
  add column if not exists transfer_recipient text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_phone_e164_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_phone_e164_check
      check (
        phone is null or
        phone ~ '^\+[1-9][0-9]{7,14}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_transfer_phone_e164_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_transfer_phone_e164_check
      check (
        transfer_phone is null or
        transfer_phone ~ '^\+[1-9][0-9]{7,14}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_transfer_fields_length_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_transfer_fields_length_check
      check (
        length(coalesce(transfer_bank, '')) <= 100 and
        length(coalesce(transfer_recipient, '')) <= 160
      );
  end if;
end;
$$;

create unique index if not exists employees_phone_uidx
  on public.employees(phone)
  where phone is not null;

create or replace function public.admin_account_options_v2()
returns table(
  user_id uuid,
  login text,
  phone text,
  email text,
  role text,
  employee_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  return query
  select
    u.id,
    coalesce(u.phone::text, u.email::text),
    u.phone::text,
    u.email::text,
    p.role,
    e.id
  from auth.users u
  join public.profiles p
    on p.id = u.id
   and p.role = 'employee'
  left join public.employees e
    on e.user_id = u.id
  where
    u.phone is not null or
    u.email is not null
  order by lower(
    coalesce(
      u.phone::text,
      u.email::text
    )
  );
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
declare
  v_employee_id uuid;
  v_point_ids uuid[] := coalesce(p_point_ids, '{}'::uuid[]);
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_transfer_phone text := nullif(trim(coalesce(p_transfer_phone, '')), '');
  v_transfer_bank text := nullif(trim(coalesce(p_transfer_bank, '')), '');
  v_transfer_recipient text := nullif(trim(coalesce(p_transfer_recipient, '')), '');
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'full_name_required'
      using errcode = '22023';
  end if;

  if
    v_phone is null or
    v_phone !~ '^\+[1-9][0-9]{7,14}$'
  then
    raise exception 'invalid_employee_phone'
      using errcode = '22023';
  end if;

  if
    v_transfer_phone is not null and
    v_transfer_phone !~ '^\+[1-9][0-9]{7,14}$'
  then
    raise exception 'invalid_transfer_phone'
      using errcode = '22023';
  end if;

  if
    length(coalesce(v_transfer_bank, '')) > 100 or
    length(coalesce(v_transfer_recipient, '')) > 160
  then
    raise exception 'invalid_transfer_details'
      using errcode = '22023';
  end if;

  if p_status not in ('active', 'inactive') then
    raise exception 'invalid_employee_status'
      using errcode = '22023';
  end if;

  if p_user_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.role = 'employee'
  ) then
    raise exception 'employee_account_required'
      using errcode = '23503';
  end if;

  if p_user_id is not null and exists (
    select 1
    from public.employees e
    where e.user_id = p_user_id
      and e.id is distinct from p_employee_id
  ) then
    raise exception 'account_already_linked'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from unnest(v_point_ids) point_id
    left join public.points p
      on p.id = point_id
    where p.id is null
  ) then
    raise exception 'point_not_found'
      using errcode = '23503';
  end if;

  if p_employee_id is null then
    insert into public.employees(
      user_id,
      full_name,
      status,
      hired_at,
      phone,
      transfer_phone,
      transfer_bank,
      transfer_recipient,
      created_by,
      updated_by
    ) values (
      p_user_id,
      trim(p_full_name),
      p_status,
      p_hired_at,
      v_phone,
      v_transfer_phone,
      v_transfer_bank,
      v_transfer_recipient,
      auth.uid(),
      auth.uid()
    )
    returning id into v_employee_id;
  else
    update public.employees
    set
      user_id = p_user_id,
      full_name = trim(p_full_name),
      status = p_status,
      hired_at = p_hired_at,
      phone = v_phone,
      transfer_phone = v_transfer_phone,
      transfer_bank = v_transfer_bank,
      transfer_recipient = v_transfer_recipient,
      updated_by = auth.uid()
    where id = p_employee_id
    returning id into v_employee_id;

    if v_employee_id is null then
      raise exception 'employee_not_found'
        using errcode = 'P0002';
    end if;
  end if;

  update public.employee_points ep
  set
    active = false,
    updated_by = auth.uid()
  where ep.employee_id = v_employee_id
    and ep.active = true
    and not (
      ep.point_id = any(v_point_ids)
    );

  insert into public.employee_points(
    employee_id,
    point_id,
    active,
    created_by,
    updated_by
  )
  select
    v_employee_id,
    point_id,
    true,
    auth.uid(),
    auth.uid()
  from (
    select distinct unnest(v_point_ids) as point_id
  ) selected_points
  on conflict (employee_id, point_id)
  do update set
    active = true,
    updated_by = auth.uid();

  return v_employee_id;
end;
$$;

revoke all on function public.admin_account_options()
  from public, anon, authenticated;
revoke all on function public.admin_save_employee(uuid, text, text, date, uuid, uuid[])
  from public, anon, authenticated;

revoke all on function public.admin_account_options_v2()
  from public, anon;
revoke all on function public.admin_save_employee_profile(uuid, text, text, date, uuid, text, text, text, text, uuid[])
  from public, anon;

grant execute on function public.admin_account_options_v2()
  to authenticated;
grant execute on function public.admin_save_employee_profile(uuid, text, text, date, uuid, text, text, text, text, uuid[])
  to authenticated;

do $$
declare
  v_table text;
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    foreach v_table in array array[
      'employees',
      'employee_points',
      'points',
      'point_tariffs',
      'shifts',
      'shift_bonuses',
      'shift_penalties'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          v_table
        );
      end if;
    end loop;
  end if;
end;
$$;
