create or replace function public.admin_account_options()
returns table(
  user_id uuid,
  email text,
  role text,
  employee_id uuid
)
language plpgsql
security definer
set search_path to 'public', 'private', 'auth', 'pg_temp'
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  return query
  select
    u.id,
    u.email::text,
    coalesce(p.role, 'employee'::text),
    e.id
  from auth.users u
  left join public.profiles p
    on p.id = u.id
  left join public.employees e
    on e.user_id = u.id
  where u.email is not null
  order by lower(u.email);
end;
$$;

revoke all on function public.admin_account_options() from public;
revoke all on function public.admin_account_options() from anon;
grant execute on function public.admin_account_options() to authenticated;

create or replace function public.admin_save_employee(
  p_employee_id uuid,
  p_full_name text,
  p_status text,
  p_hired_at date,
  p_user_id uuid,
  p_point_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'private', 'auth', 'pg_temp'
as $$
declare
  v_employee_id uuid;
  v_point_ids uuid[] := coalesce(p_point_ids, '{}'::uuid[]);
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'full_name_required'
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
  ) then
    raise exception 'account_profile_not_found'
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
      created_by,
      updated_by
    ) values (
      p_user_id,
      trim(p_full_name),
      p_status,
      p_hired_at,
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

revoke all on function public.admin_save_employee(uuid, text, text, date, uuid, uuid[]) from public;
revoke all on function public.admin_save_employee(uuid, text, text, date, uuid, uuid[]) from anon;
grant execute on function public.admin_save_employee(uuid, text, text, date, uuid, uuid[]) to authenticated;
