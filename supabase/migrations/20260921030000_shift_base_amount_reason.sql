-- Причина корректировки оклада принадлежит самой корректировке, а не смене.
--
-- До сих пор v2 требовала заполнить общий комментарий смены, как только
-- фактическая оплата расходилась с тарифом. Из-за этого одно поле держало
-- два разных смысла: и заметку о смене, и объяснение, почему сумма другая.
-- Сменить комментарий было нельзя, не потеряв обоснование суммы.
--
-- Здесь у корректировки появляется собственное поле, а v3 требует именно
-- его. v2 остаётся рабочей: старый клиент продолжает сохранять смены, пока
-- не обновится.
begin;

alter table public.shifts
  add column if not exists base_amount_override_reason text;

comment on column public.shifts.base_amount_override_reason is
  'Причина расхождения base_amount с расчётом по тарифу. Не заменяет note.';

create or replace function public.admin_save_shift_v3(
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
  p_base_amount_override numeric,
  p_base_amount_reason text
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
  v_reason text;
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

  v_reason := nullif(trim(coalesce(p_base_amount_reason, '')), '');

  if length(coalesce(v_reason, '')) > 500 then
    raise exception 'invalid_shift_base_amount_reason'
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
    if v_reason is null then
      raise exception 'shift_base_amount_reason_required'
        using errcode = '22023';
    end if;

    v_effective_base := p_base_amount_override;
  else
    -- Оплата вернулась к тарифу: причина расхождения больше ничего не
    -- объясняет и не должна пережить корректировку.
    v_reason := null;
    v_effective_base := v_calculated_base;
  end if;

  update public.shifts
  set
    base_amount = v_effective_base,
    base_amount_override_reason = v_reason,
    updated_by = auth.uid()
  where id = v_shift_id;

  return v_shift_id;
end;
$$;

revoke all on function public.admin_save_shift_v3(uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb, numeric, text)
from public, anon;

grant execute on function public.admin_save_shift_v3(uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb, numeric, text)
to authenticated;

commit;
