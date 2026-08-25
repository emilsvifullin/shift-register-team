-- Keep the tariff snapshot intact while allowing an administrator to set the
-- actual base payment of one shift. The existing RPC remains available during
-- the frontend rollout; the v2 RPC delegates all pricing and integrity checks
-- to it, then applies the explicit amount in the same transaction.
begin;

create or replace function public.admin_save_shift_v2(
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
  p_penalties jsonb,
  p_base_amount_override numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift_id uuid;
  v_shift public.shifts%rowtype;
  v_rate numeric;
  v_calculated_base numeric;
  v_effective_base numeric;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if
    p_base_amount_override is not null and
    (
      p_base_amount_override < 0 or
      p_base_amount_override > 10000000 or
      p_base_amount_override <> round(p_base_amount_override, 2)
    )
  then
    raise exception 'invalid_shift_base_amount'
      using errcode = '22023';
  end if;

  v_shift_id := public.admin_save_shift(
    p_shift_id,
    p_employee_id,
    p_shift_date,
    p_point_id,
    p_shift_type,
    p_shk,
    p_partial,
    p_hours,
    p_note,
    p_bonuses,
    p_penalties
  );

  select *
  into strict v_shift
  from public.shifts s
  where s.id = v_shift_id;

  v_rate := (v_shift.pricing_snapshot ->> 'rate')::numeric;

  if v_rate is null then
    raise exception 'tariff_rate_not_found'
      using errcode = 'P0002';
  end if;

  v_calculated_base := case
    when v_shift.partial then
      round(v_rate / v_shift.full_hours * v_shift.hours)
    else v_rate
  end;

  if
    p_base_amount_override is not null and
    p_base_amount_override is distinct from v_calculated_base
  then
    if nullif(trim(coalesce(p_note, '')), '') is null then
      raise exception 'shift_base_amount_comment_required'
        using errcode = '22023';
    end if;

    v_effective_base := p_base_amount_override;
  else
    v_effective_base := v_calculated_base;
  end if;

  update public.shifts
  set
    base_amount = v_effective_base,
    updated_by = auth.uid()
  where id = v_shift_id;

  return v_shift_id;
end;
$$;

revoke all on function public.admin_save_shift_v2(uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb, numeric)
from public, anon;

grant execute on function public.admin_save_shift_v2(uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb, numeric)
to authenticated;

commit;
