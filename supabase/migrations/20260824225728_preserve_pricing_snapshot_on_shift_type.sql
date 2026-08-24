-- Applied to production as migration 20260824225728.
begin;

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


revoke all on function public.admin_save_shift(uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb)
from public, anon;

grant execute on function public.admin_save_shift(uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb)
to authenticated;

commit;
