-- Границы тарифа по ШК конечны.
--
-- Последняя строка тарифа обязана была быть открытой («up_to: null»), и её
-- ставка молча распространялась на любой объём выше. Менеджер задавал
-- «до 650 — 5500 ₽», а смена с 900 ШК считалась по 5500 ₽, хотя такого
-- решения никто не принимал.
--
-- Теперь каждая строка заканчивается числом. Выше последней границы ставки
-- просто нет: admin_save_shift её не найдёт и откажет (tariff_rate_not_found),
-- пока тариф не дополнят.
--
-- Изменение двустороннее, поэтому делается в два приёма в одной транзакции:
--
--   1. private.validate_tariff_payload перестаёт требовать открытый хвост и
--      принимает обе формы. Это нужно и старым записям — их читает
--      admin_save_shift при каждом сохранении смены, — и новому клиенту,
--      который присылает уже конечные границы.
--
--   2. Ограничение на таблице требует конечную последнюю границу от всякой
--      новой записи. Оно ставится NOT VALID: уже заведённые тарифы с открытым
--      хвостом остаются читаемыми и продолжают считать смены, но сохранить
--      такой тариф заново уже нельзя — границу проставляют руками, осознанно.
begin;

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

    -- Открытый хвост допустим только у последней строки и только у записей,
    -- заведённых до перехода на конечные границы.
    if
      v_index = v_count and
      (v_item ? 'up_to') and
      jsonb_typeof(v_item -> 'up_to') = 'null'
    then
      continue;
    end if;

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
  end loop;
end;
$$;

alter table public.point_tariffs
  drop constraint if exists point_tariffs_shk_tiers_bounded;

alter table public.point_tariffs
  add constraint point_tariffs_shk_tiers_bounded
  check (
    pricing_type <> 'shk_tiers'
    or shk_tiers is null
    or (
      jsonb_typeof(shk_tiers) = 'array'
      and jsonb_array_length(shk_tiers) > 0
      and coalesce(
        jsonb_typeof(
          shk_tiers -> (jsonb_array_length(shk_tiers) - 1) -> 'up_to'
        ),
        'missing'
      ) = 'number'
    )
  )
  not valid;

comment on constraint point_tariffs_shk_tiers_bounded on public.point_tariffs is
  'Последняя граница тарифа по ШК задаётся числом: ставка не действует выше неё.';

commit;
