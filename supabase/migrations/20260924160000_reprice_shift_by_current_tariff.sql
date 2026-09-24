-- Пересчёт смены по тарифу, действующему на её дату сейчас.
--
-- Стоимость смены фиксируется снимком тарифа в момент сохранения и потом
-- сама не меняется: это защищает уже посчитанные выплаты от правок задним
-- числом. Но если тариф завели после смены, исправить её было нечем —
-- оставалось удалить и создать заново.
--
-- admin_save_shift пересчитывает снимок, только когда изменилось то, от
-- чего он зависит (сотрудник, ПВЗ, дата, объём, часы). Здесь пересчёт
-- запрашивается явно и отдельной кнопкой, поэтому и функция отдельная:
-- обычное сохранение по-прежнему ничего не переоценивает.
--
-- Смену с корректировкой оклада функция не трогает: там сумма назначена
-- руками, и подменять её расчётом — значит терять решение человека.
begin;

create or replace function public.admin_reprice_shift(
  p_shift_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_tariff public.point_tariffs%rowtype;
  v_point public.points%rowtype;
  v_item jsonb;
  v_rate numeric;
  v_base numeric;
  v_pricing jsonb;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select *
  into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if not found then
    raise exception 'shift_not_found'
      using errcode = 'P0002';
  end if;

  if v_shift.base_amount_override_reason is not null then
    raise exception 'shift_has_manual_amount'
      using errcode = '22023';
  end if;

  select *
  into v_point
  from public.points
  where id = v_shift.point_id;

  select *
  into v_tariff
  from public.point_tariffs t
  where t.point_id = v_shift.point_id
    and t.effective_from <= v_shift.shift_date
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
  else
    if v_shift.shk is null then
      raise exception 'invalid_shk'
        using errcode = '22023';
    end if;

    for v_item in
      select value
      from jsonb_array_elements(v_tariff.shk_tiers)
    loop
      if
        jsonb_typeof(v_item -> 'up_to') = 'null' or
        v_shift.shk < (v_item ->> 'up_to')::integer
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
    when v_shift.partial then
      round(v_rate / v_shift.full_hours * v_shift.hours)
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
    'shk', coalesce(v_shift.shk, 0),
    'rate', v_rate,
    'fullHours', v_shift.full_hours,
    'advanceEnabled', v_point.advance_enabled,
    'shiftDate', v_shift.shift_date
  );

  update public.shifts
  set
    base_amount = v_base,
    pricing_snapshot = v_pricing,
    updated_by = auth.uid()
  where id = p_shift_id;

  return jsonb_build_object(
    'shift_id', p_shift_id,
    'rate', v_rate,
    'base_amount', v_base,
    'effective_from', v_tariff.effective_from
  );
end;
$$;

revoke all on function public.admin_reprice_shift(uuid)
  from public, anon;

grant execute on function public.admin_reprice_shift(uuid)
  to authenticated;

commit;
