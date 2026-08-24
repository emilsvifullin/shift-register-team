alter table public.shifts
  add column if not exists legacy_source_id text;

create unique index if not exists shifts_employee_legacy_source_uidx
  on public.shifts(employee_id, legacy_source_id)
  where legacy_source_id is not null;

create or replace function private.validate_tariff_payload(
  p_pricing_type text,
  p_fixed_rate numeric,
  p_shk_tiers jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_index integer := 0;
  v_item jsonb;
  v_rate numeric;
  v_limit integer;
  v_previous_limit integer := 0;
begin
  if p_pricing_type = 'fixed' then
    if
      p_fixed_rate is null or
      p_fixed_rate <= 0 or
      p_fixed_rate > 10000000 or
      p_fixed_rate * 100 <> trunc(p_fixed_rate * 100) or
      p_shk_tiers is not null
    then
      raise exception 'invalid_fixed_tariff'
        using errcode = '22023';
    end if;

    return;
  end if;

  if
    p_pricing_type <> 'shk_tiers' or
    p_fixed_rate is not null or
    p_shk_tiers is null or
    jsonb_typeof(p_shk_tiers) <> 'array' or
    jsonb_array_length(p_shk_tiers) = 0
  then
    raise exception 'invalid_shk_tariff'
      using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_shk_tiers);

  for v_item in
    select value
    from jsonb_array_elements(p_shk_tiers)
  loop
    v_index := v_index + 1;

    if
      jsonb_typeof(v_item) <> 'object' or
      v_item ->> 'rate' is null
    then
      raise exception 'invalid_shk_tariff_row'
        using errcode = '22023';
    end if;

    v_rate := (v_item ->> 'rate')::numeric;

    if
      v_rate <= 0 or
      v_rate > 10000000 or
      v_rate * 100 <> trunc(v_rate * 100)
    then
      raise exception 'invalid_shk_tariff_rate'
        using errcode = '22023';
    end if;

    if v_index = v_count then
      if
        not (v_item ? 'up_to') or
        jsonb_typeof(v_item -> 'up_to') <> 'null'
      then
        raise exception 'final_shk_tier_must_be_open'
          using errcode = '22023';
      end if;
    else
      if
        not (v_item ? 'up_to') or
        jsonb_typeof(v_item -> 'up_to') <> 'number'
      then
        raise exception 'invalid_shk_tier_limit'
          using errcode = '22023';
      end if;

      v_limit := (v_item ->> 'up_to')::integer;

      if
        v_limit <= v_previous_limit or
        v_limit > 1000000
      then
        raise exception 'shk_tier_limits_not_increasing'
          using errcode = '22023';
      end if;

      v_previous_limit := v_limit;
    end if;
  end loop;
end;
$$;

create or replace function private.replace_shift_adjustments(
  p_shift_id uuid,
  p_bonuses jsonb,
  p_penalties jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_id uuid;
  v_amount numeric;
  v_comment text;
begin
  if
    jsonb_typeof(coalesce(p_bonuses, '[]'::jsonb)) <> 'array' or
    jsonb_typeof(coalesce(p_penalties, '[]'::jsonb)) <> 'array'
  then
    raise exception 'invalid_adjustments'
      using errcode = '22023';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_bonuses, '[]'::jsonb))
  loop
    if nullif(v_item ->> 'id', '') is null then
      raise exception 'bonus_id_required'
        using errcode = '22023';
    end if;

    v_id := (v_item ->> 'id')::uuid;
    v_amount := (v_item ->> 'amount')::numeric;
    v_comment := trim(coalesce(v_item ->> 'comment', ''));

    if
      v_amount <= 0 or
      v_amount > 10000000 or
      v_amount * 100 <> trunc(v_amount * 100) or
      length(v_comment) = 0
    then
      raise exception 'invalid_bonus'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.shift_bonuses b
      where b.id = v_id
        and b.shift_id <> p_shift_id
    ) then
      raise exception 'bonus_belongs_to_another_shift'
        using errcode = '23503';
    end if;

    insert into public.shift_bonuses(
      id,
      shift_id,
      amount,
      comment,
      created_by,
      updated_by
    ) values (
      v_id,
      p_shift_id,
      v_amount,
      v_comment,
      auth.uid(),
      auth.uid()
    )
    on conflict (id)
    do update set
      amount = excluded.amount,
      comment = excluded.comment,
      updated_by = auth.uid();
  end loop;

  delete from public.shift_bonuses b
  where b.shift_id = p_shift_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_bonuses, '[]'::jsonb)) item
      where nullif(item ->> 'id', '')::uuid = b.id
    );

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_penalties, '[]'::jsonb))
  loop
    if nullif(v_item ->> 'id', '') is null then
      raise exception 'penalty_id_required'
        using errcode = '22023';
    end if;

    v_id := (v_item ->> 'id')::uuid;
    v_amount := (v_item ->> 'amount')::numeric;
    v_comment := trim(coalesce(v_item ->> 'comment', ''));

    if
      v_amount <= 0 or
      v_amount > 10000000 or
      v_amount * 100 <> trunc(v_amount * 100) or
      length(v_comment) = 0
    then
      raise exception 'invalid_penalty'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.shift_penalties p
      where p.id = v_id
        and p.shift_id <> p_shift_id
    ) then
      raise exception 'penalty_belongs_to_another_shift'
        using errcode = '23503';
    end if;

    insert into public.shift_penalties(
      id,
      shift_id,
      amount,
      comment,
      created_by,
      updated_by
    ) values (
      v_id,
      p_shift_id,
      v_amount,
      v_comment,
      auth.uid(),
      auth.uid()
    )
    on conflict (id)
    do update set
      amount = excluded.amount,
      comment = excluded.comment,
      updated_by = auth.uid();
  end loop;

  delete from public.shift_penalties p
  where p.shift_id = p_shift_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_penalties, '[]'::jsonb)) item
      where nullif(item ->> 'id', '')::uuid = p.id
    );
end;
$$;

create or replace function public.admin_save_shift(
  p_shift_id uuid,
  p_employee_id uuid,
  p_shift_date date,
  p_point_id uuid,
  p_shift_type text,
  p_shk integer,
  p_partial boolean,
  p_hours numeric,
  p_note text,
  p_bonuses jsonb,
  p_penalties jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift_id uuid := coalesce(p_shift_id, gen_random_uuid());
  v_existing public.shifts%rowtype;
  v_tariff public.point_tariffs%rowtype;
  v_point public.points%rowtype;
  v_item jsonb;
  v_rate numeric;
  v_base numeric;
  v_full_hours numeric := 12;
  v_pricing jsonb;
  v_is_new boolean;
  v_pricing_changed boolean;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if p_shift_date is null then
    raise exception 'shift_date_required'
      using errcode = '22023';
  end if;

  if p_shift_type not in ('main', 'extra') then
    raise exception 'invalid_shift_type'
      using errcode = '22023';
  end if;

  if p_partial then
    if
      p_hours is null or
      p_hours < 0.5 or
      p_hours >= 12 or
      p_hours * 2 <> trunc(p_hours * 2)
    then
      raise exception 'invalid_partial_hours'
        using errcode = '22023';
    end if;
  elsif p_hours is not null and p_hours <> 12 then
    raise exception 'full_shift_must_be_12_hours'
      using errcode = '22023';
  end if;

  select *
  into v_existing
  from public.shifts s
  where s.id = v_shift_id;

  v_is_new := not found;

  if not exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
  ) then
    raise exception 'employee_not_found'
      using errcode = '23503';
  end if;

  select *
  into v_point
  from public.points p
  where p.id = p_point_id;

  if not found then
    raise exception 'point_not_found'
      using errcode = '23503';
  end if;

  if
    v_is_new or
    v_existing.employee_id is distinct from p_employee_id or
    v_existing.point_id is distinct from p_point_id
  then
    if not exists (
      select 1
      from public.employees e
      where e.id = p_employee_id
        and e.status = 'active'
    ) then
      raise exception 'employee_inactive'
        using errcode = '22023';
    end if;

    if not v_point.active then
      raise exception 'point_inactive'
        using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.employee_points ep
      where ep.employee_id = p_employee_id
        and ep.point_id = p_point_id
        and ep.active = true
    ) then
      raise exception 'point_not_assigned'
        using errcode = '22023';
    end if;
  end if;

  v_pricing_changed :=
    v_is_new or
    v_existing.employee_id is distinct from p_employee_id or
    v_existing.point_id is distinct from p_point_id or
    v_existing.shift_date is distinct from p_shift_date or
    v_existing.shift_type is distinct from p_shift_type or
    v_existing.shk is distinct from p_shk or
    v_existing.partial is distinct from p_partial or
    v_existing.hours is distinct from (
      case when p_partial then p_hours else null end
    );

  if v_pricing_changed then
    select *
    into v_tariff
    from public.point_tariffs t
    where t.point_id = p_point_id
      and t.effective_from <= p_shift_date
    order by t.effective_from desc
    limit 1;

    if not found then
      raise exception 'tariff_not_found_for_date'
        using errcode = 'P0002';
    end if;

    perform private.validate_tariff_payload(
      v_tariff.pricing_type,
      v_tariff.fixed_rate,
      v_tariff.shk_tiers
    );

    if v_tariff.pricing_type = 'fixed' then
      v_rate := v_tariff.fixed_rate;
      p_shk := null;
    else
      if p_shk is null or p_shk < 0 or p_shk > 1000000 then
        raise exception 'invalid_shk'
          using errcode = '22023';
      end if;

      for v_item in
        select value
        from jsonb_array_elements(v_tariff.shk_tiers)
      loop
        if
          jsonb_typeof(v_item -> 'up_to') = 'null' or
          p_shk < (v_item ->> 'up_to')::integer
        then
          v_rate := (v_item ->> 'rate')::numeric;
          exit;
        end if;
      end loop;
    end if;

    if v_rate is null then
      raise exception 'tariff_rate_not_found'
        using errcode = 'P0002';
    end if;

    v_base := case
      when p_partial then round(v_rate / 12 * p_hours)
      else v_rate
    end;

    v_pricing := jsonb_build_object(
      'version', 2,
      'rulesVersion', 'supabase-point-tariffs-v1',
      'tariffId', v_tariff.id,
      'pointId', v_point.id,
      'pointName', v_point.name,
      'effectiveFrom', v_tariff.effective_from,
      'pricingType', v_tariff.pricing_type,
      'fixed', v_tariff.pricing_type = 'fixed',
      'fixedRate', v_tariff.fixed_rate,
      'shkTiers', v_tariff.shk_tiers,
      'shk', coalesce(p_shk, 0),
      'rate', v_rate,
      'fullHours', 12,
      'advanceEnabled', v_point.advance_enabled,
      'shiftDate', p_shift_date
    );
  else
    v_rate := (v_existing.pricing_snapshot ->> 'rate')::numeric;
    v_base := v_existing.base_amount;
    v_full_hours := v_existing.full_hours;
    v_pricing := v_existing.pricing_snapshot;
  end if;

  insert into public.shifts(
    id,
    employee_id,
    shift_date,
    point_id,
    shift_type,
    shk,
    partial,
    hours,
    full_hours,
    base_amount,
    pricing_snapshot,
    note,
    created_by,
    updated_by
  ) values (
    v_shift_id,
    p_employee_id,
    p_shift_date,
    p_point_id,
    p_shift_type,
    case when v_pricing ->> 'pricingType' = 'fixed' then null else p_shk end,
    p_partial,
    case when p_partial then p_hours else null end,
    v_full_hours,
    v_base,
    v_pricing,
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid(),
    auth.uid()
  )
  on conflict (id)
  do update set
    employee_id = excluded.employee_id,
    shift_date = excluded.shift_date,
    point_id = excluded.point_id,
    shift_type = excluded.shift_type,
    shk = excluded.shk,
    partial = excluded.partial,
    hours = excluded.hours,
    full_hours = excluded.full_hours,
    base_amount = excluded.base_amount,
    pricing_snapshot = excluded.pricing_snapshot,
    note = excluded.note,
    updated_by = auth.uid();

  perform private.replace_shift_adjustments(
    v_shift_id,
    p_bonuses,
    p_penalties
  );

  return v_shift_id;
end;
$$;

create or replace function public.admin_delete_shift(
  p_shift_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  delete from public.shifts s
  where s.id = p_shift_id
  returning s.id into v_id;

  if v_id is null then
    raise exception 'shift_not_found'
      using errcode = 'P0002';
  end if;

  return v_id;
end;
$$;

create or replace function public.admin_save_point(
  p_point_id uuid,
  p_name text,
  p_sort_order integer,
  p_active boolean,
  p_advance_enabled boolean,
  p_pricing_type text,
  p_fixed_rate numeric,
  p_shk_tiers jsonb,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(p_point_id, gen_random_uuid());
  v_is_new boolean;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if
    p_name is null or
    length(trim(p_name)) = 0 or
    p_sort_order is null or
    p_sort_order <= 0
  then
    raise exception 'invalid_point'
      using errcode = '22023';
  end if;

  v_is_new := not exists (
    select 1
    from public.points p
    where p.id = v_id
  );

  if v_is_new then
    if p_effective_from is null then
      raise exception 'effective_from_required'
        using errcode = '22023';
    end if;

    perform private.validate_tariff_payload(
      p_pricing_type,
      p_fixed_rate,
      p_shk_tiers
    );

    insert into public.points(
      id,
      code,
      name,
      active,
      pricing_type,
      fixed_rate,
      advance_enabled,
      sort_order,
      created_by,
      updated_by
    ) values (
      v_id,
      'point-' || replace(v_id::text, '-', ''),
      trim(p_name),
      coalesce(p_active, true),
      p_pricing_type,
      p_fixed_rate,
      coalesce(p_advance_enabled, false),
      p_sort_order,
      auth.uid(),
      auth.uid()
    );

    insert into public.point_tariffs(
      point_id,
      effective_from,
      pricing_type,
      fixed_rate,
      shk_tiers,
      created_by,
      updated_by
    ) values (
      v_id,
      p_effective_from,
      p_pricing_type,
      p_fixed_rate,
      p_shk_tiers,
      auth.uid(),
      auth.uid()
    );
  else
    update public.points
    set
      name = trim(p_name),
      active = coalesce(p_active, active),
      advance_enabled = coalesce(p_advance_enabled, advance_enabled),
      sort_order = p_sort_order,
      updated_by = auth.uid()
    where id = v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.admin_add_point_tariff(
  p_point_id uuid,
  p_effective_from date,
  p_pricing_type text,
  p_fixed_rate numeric,
  p_shk_tiers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if
    p_effective_from is null or
    not exists (
      select 1
      from public.points p
      where p.id = p_point_id
    )
  then
    raise exception 'invalid_tariff_point_or_date'
      using errcode = '22023';
  end if;

  perform private.validate_tariff_payload(
    p_pricing_type,
    p_fixed_rate,
    p_shk_tiers
  );

  insert into public.point_tariffs(
    point_id,
    effective_from,
    pricing_type,
    fixed_rate,
    shk_tiers,
    created_by,
    updated_by
  ) values (
    p_point_id,
    p_effective_from,
    p_pricing_type,
    p_fixed_rate,
    p_shk_tiers,
    auth.uid(),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_import_legacy_shift(
  p_legacy_source_id text,
  p_employee_id uuid,
  p_point_id uuid,
  p_shift_date date,
  p_shift_type text,
  p_shk integer,
  p_partial boolean,
  p_hours numeric,
  p_full_hours numeric,
  p_base_amount numeric,
  p_pricing_snapshot jsonb,
  p_bonuses jsonb,
  p_penalties jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_rate numeric;
  v_expected_base numeric;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if
    p_legacy_source_id is null or
    length(trim(p_legacy_source_id)) = 0 or
    length(p_legacy_source_id) > 200 or
    p_shift_date is null or
    p_shift_type not in ('main', 'extra') or
    p_full_hours <> 12 or
    jsonb_typeof(p_pricing_snapshot) <> 'object'
  then
    raise exception 'invalid_legacy_shift'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
  ) or not exists (
    select 1
    from public.points p
    where p.id = p_point_id
  ) then
    raise exception 'legacy_reference_not_found'
      using errcode = '23503';
  end if;

  if p_partial then
    if
      p_hours is null or
      p_hours < 0.5 or
      p_hours >= 12 or
      p_hours * 2 <> trunc(p_hours * 2)
    then
      raise exception 'invalid_partial_hours'
        using errcode = '22023';
    end if;
  end if;

  v_rate := (p_pricing_snapshot ->> 'rate')::numeric;
  v_expected_base := case
    when p_partial then round(v_rate / 12 * p_hours)
    else v_rate
  end;

  if
    v_rate < 0 or
    v_rate > 10000000 or
    p_base_amount is distinct from v_expected_base
  then
    raise exception 'legacy_pricing_mismatch'
      using errcode = '22023';
  end if;

  select s.id
  into v_id
  from public.shifts s
  where s.employee_id = p_employee_id
    and s.legacy_source_id = p_legacy_source_id;

  if v_id is not null then
    return v_id;
  end if;

  v_id := gen_random_uuid();

  insert into public.shifts(
    id,
    employee_id,
    shift_date,
    point_id,
    shift_type,
    shk,
    partial,
    hours,
    full_hours,
    base_amount,
    pricing_snapshot,
    legacy_source_id,
    created_by,
    updated_by
  ) values (
    v_id,
    p_employee_id,
    p_shift_date,
    p_point_id,
    p_shift_type,
    p_shk,
    p_partial,
    case when p_partial then p_hours else null end,
    p_full_hours,
    p_base_amount,
    p_pricing_snapshot || jsonb_build_object('legacy', true),
    p_legacy_source_id,
    auth.uid(),
    auth.uid()
  );

  perform private.replace_shift_adjustments(
    v_id,
    p_bonuses,
    p_penalties
  );

  return v_id;
end;
$$;

create or replace function public.admin_account_options()
returns table(
  user_id uuid,
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
    u.email::text,
    p.role,
    e.id
  from auth.users u
  join public.profiles p
    on p.id = u.id
   and p.role = 'employee'
  left join public.employees e
    on e.user_id = u.id
  where u.email is not null
  order by lower(u.email);
end;
$$;

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
set search_path = ''
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

create or replace function public.admin_delete_employee(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.shifts s
    where s.employee_id = p_employee_id
  ) then
    raise exception 'employee_has_history'
      using errcode = '23503';
  end if;

  delete from public.employees e
  where e.id = p_employee_id
  returning e.id into v_employee_id;

  if v_employee_id is null then
    raise exception 'employee_not_found'
      using errcode = 'P0002';
  end if;

  return v_employee_id;
end;
$$;

revoke all on table
  public.profiles,
  public.employees,
  public.employee_points,
  public.points,
  public.point_tariffs,
  public.shifts,
  public.shift_bonuses,
  public.shift_penalties,
  public.audit_log
from anon;

revoke all on table
  public.profiles,
  public.employees,
  public.employee_points,
  public.points,
  public.point_tariffs,
  public.shifts,
  public.shift_bonuses,
  public.shift_penalties,
  public.audit_log
from authenticated;

grant select on table
  public.profiles,
  public.employees,
  public.employee_points,
  public.points,
  public.point_tariffs,
  public.shifts,
  public.shift_bonuses,
  public.shift_penalties,
  public.audit_log
to authenticated;

revoke all on function private.validate_tariff_payload(text, numeric, jsonb)
  from public, anon, authenticated;
revoke all on function private.replace_shift_adjustments(uuid, jsonb, jsonb)
  from public, anon, authenticated;

revoke all on function public.admin_account_options()
  from public, anon;
revoke all on function public.admin_save_employee(uuid, text, text, date, uuid, uuid[])
  from public, anon;
revoke all on function public.admin_delete_employee(uuid)
  from public, anon;
revoke all on function public.admin_save_shift(uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb)
  from public, anon;
revoke all on function public.admin_delete_shift(uuid)
  from public, anon;
revoke all on function public.admin_save_point(uuid, text, integer, boolean, boolean, text, numeric, jsonb, date)
  from public, anon;
revoke all on function public.admin_add_point_tariff(uuid, date, text, numeric, jsonb)
  from public, anon;
revoke all on function public.admin_import_legacy_shift(text, uuid, uuid, date, text, integer, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb)
  from public, anon;

grant execute on function public.admin_account_options()
  to authenticated;
grant execute on function public.admin_save_employee(uuid, text, text, date, uuid, uuid[])
  to authenticated;
grant execute on function public.admin_delete_employee(uuid)
  to authenticated;
grant execute on function public.admin_save_shift(uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb)
  to authenticated;
grant execute on function public.admin_delete_shift(uuid)
  to authenticated;
grant execute on function public.admin_save_point(uuid, text, integer, boolean, boolean, text, numeric, jsonb, date)
  to authenticated;
grant execute on function public.admin_add_point_tariff(uuid, date, text, numeric, jsonb)
  to authenticated;
grant execute on function public.admin_import_legacy_shift(text, uuid, uuid, date, text, integer, boolean, numeric, numeric, numeric, jsonb, jsonb, jsonb)
  to authenticated;

revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;
revoke all on function public.write_audit_log()
  from public, anon, authenticated;
revoke all on function public.set_updated_at()
  from public, anon, authenticated;
revoke all on function public.rls_auto_enable()
  from public, anon, authenticated;

revoke all on function private.is_admin()
  from public, anon;
grant execute on function private.is_admin()
  to authenticated;
