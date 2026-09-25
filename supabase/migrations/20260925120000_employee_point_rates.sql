-- Индивидуальная ставка сотрудника на пункте выдачи.
--
-- Тариф ПВЗ отвечает на вопрос «сколько стоит смена здесь». Но на одном и
-- том же ПВЗ конкретный сотрудник может работать за другие деньги: ПВЗ
-- платит 3 000 ₽, а ему — 3 300 ₽. До сих пор такую договорённость можно
-- было провести только корректировкой оклада в каждой смене руками, и
-- смена за сменой она превращалась в ручной ввод там, где есть правило.
--
-- Поэтому у пары «сотрудник + ПВЗ» появляется собственная ставка. Она
-- устроена ровно как тариф ПВЗ и специально не отличается от него ничем,
-- кроме области действия:
--
--   * та же пара видов — фиксированная ставка и ступени по ШК;
--   * та же проверка содержимого (private.validate_tariff_payload);
--   * те же версии по датам: effective_from, история, и действует та
--     запись, у которой дата не позже даты смены.
--
-- Выбор ставки при сохранении смены получает одно правило: есть
-- индивидуальная ставка на эту дату — берётся она, нет — тариф ПВЗ.
-- Никакого третьего пути и никакой особой ветки расчёта: дальше и та и
-- другая идут через один и тот же код, снимок и округление.
--
-- История прошлых смен не меняется от новых договорённостей: стоимость
-- смены заморожена снимком в момент сохранения, и снимок пересчитывается
-- только тогда, когда меняется то, от чего он зависит, либо когда
-- пересчёт запрошен явно (admin_reprice_shift). Новая ставка с датой в
-- будущем не трогает уже проведённые смены; ставка с датой в прошлом
-- тоже — пока смену не пересчитают руками.
--
-- Снимок теперь говорит, откуда взялась ставка: rateSource = 'employee'
-- или 'point', плюс идентификатор самой записи. У снимков, сделанных до
-- этой миграции, поля нет — читающий код обязан считать его 'point',
-- потому что других ставок тогда и не существовало.
begin;

create table public.employee_point_rates (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null
    references public.employees(id) on delete cascade,
  point_id uuid not null
    references public.points(id) on delete cascade,
  effective_from date not null,
  pricing_type text not null
    check (pricing_type in ('fixed', 'shk_tiers')),
  fixed_rate numeric(12,2),
  shk_tiers jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, point_id, effective_from),
  constraint employee_point_rates_payload_check
    check (
      (
        pricing_type = 'fixed'
        and fixed_rate is not null
        and fixed_rate > 0
        and shk_tiers is null
      )
      or
      (
        pricing_type = 'shk_tiers'
        and fixed_rate is null
        and shk_tiers is not null
        and jsonb_typeof(shk_tiers) = 'array'
        and jsonb_array_length(shk_tiers) > 0
      )
    )
);

comment on table public.employee_point_rates is
  'Индивидуальная ставка сотрудника на ПВЗ. Перекрывает point_tariffs на даты, начиная с effective_from.';

-- Ставку ищут по паре «сотрудник + ПВЗ» и дате — индекс повторяет запрос.
create index employee_point_rates_lookup_idx
  on public.employee_point_rates(
    employee_id,
    point_id,
    effective_from desc
  );

create index employee_point_rates_point_id_idx
  on public.employee_point_rates(point_id);

alter table public.employee_point_rates enable row level security;

create policy employee_point_rates_admin_insert
  on public.employee_point_rates
  for insert
  to authenticated
  with check ((select private.is_admin()));

create policy employee_point_rates_admin_update
  on public.employee_point_rates
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy employee_point_rates_admin_delete
  on public.employee_point_rates
  for delete
  to authenticated
  using ((select private.is_admin()));

-- Сотрудник видит свою ставку: он по ней работает.
create policy employee_point_rates_select_own_or_admin
  on public.employee_point_rates
  for select
  to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.employees e
      where e.id = employee_point_rates.employee_id
        and e.user_id = (select auth.uid())
    )
  );

create trigger employee_point_rates_set_updated_at
  before update on public.employee_point_rates
  for each row
  execute function public.set_updated_at();

create trigger employee_point_rates_audit
  after insert or update or delete on public.employee_point_rates
  for each row
  execute function public.write_audit_log();

-- Права задаются здесь же: платформенные умолчания сняты миграцией
-- 20260924190000, и новая таблица без этой строки осталась бы невидимой
-- для Data API. Записи идут через функции security definer, поэтому
-- authenticated нужен только select.
revoke all on table public.employee_point_rates
  from anon, authenticated;

grant select on table public.employee_point_rates
  to authenticated;

/*
  Ставка, действующая для сотрудника на ПВЗ в этот день.

  Вынесена в функцию, а не скопирована в каждое место: сохранение смены и
  пересчёт смены обязаны выбирать ставку одинаково, иначе пересчёт начнёт
  менять сумму там, где ничего не менялось.
*/
create or replace function private.employee_rate_for_date(
  p_employee_id uuid,
  p_point_id uuid,
  p_date date
)
returns public.employee_point_rates
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.employee_point_rates r
  where r.employee_id = p_employee_id
    and r.point_id = p_point_id
    and r.effective_from <= p_date
  order by r.effective_from desc
  limit 1;
$$;

revoke all on function private.employee_rate_for_date(uuid, uuid, date)
  from public, anon, authenticated;

create or replace function public.admin_add_employee_rate(
  p_employee_id uuid,
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
    p_employee_id is null or
    p_point_id is null or
    p_effective_from is null
  then
    raise exception 'invalid_employee_rate_target'
      using errcode = '22023';
  end if;

  -- Ставка без назначения на ПВЗ не имеет смысла: по такому ПВЗ этот
  -- сотрудник смену завести не сможет.
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

  perform private.validate_tariff_payload(
    p_pricing_type,
    p_fixed_rate,
    p_shk_tiers
  );

  insert into public.employee_point_rates(
    employee_id,
    point_id,
    effective_from,
    pricing_type,
    fixed_rate,
    shk_tiers,
    created_by,
    updated_by
  ) values (
    p_employee_id,
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

create or replace function public.admin_update_employee_rate(
  p_rate_id uuid,
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

  if p_rate_id is null or p_effective_from is null then
    raise exception 'invalid_employee_rate_target'
      using errcode = '22023';
  end if;

  perform private.validate_tariff_payload(
    p_pricing_type,
    p_fixed_rate,
    p_shk_tiers
  );

  update public.employee_point_rates
  set
    effective_from = p_effective_from,
    pricing_type = p_pricing_type,
    fixed_rate = p_fixed_rate,
    shk_tiers = p_shk_tiers,
    updated_by = auth.uid()
  where id = p_rate_id
  returning id into v_id;

  if v_id is null then
    raise exception 'employee_rate_not_found'
      using errcode = 'P0002';
  end if;

  return v_id;
end;
$$;

/*
  Удаление ставки возвращает сотрудника на тариф ПВЗ. Последнюю запись
  снимать можно — в отличие от тарифа ПВЗ, без которого смену не
  посчитать: здесь всегда есть на что опереться.
*/
create or replace function public.admin_delete_employee_rate(
  p_rate_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  delete from public.employee_point_rates
  where id = p_rate_id;

  if not found then
    raise exception 'employee_rate_not_found'
      using errcode = 'P0002';
  end if;
end;
$$;

/*
  Сохранение смены: та же функция, что и раньше, с одним изменением —
  ставка берётся у сотрудника, если она на эту дату задана.

  Пересчёт снимка по-прежнему происходит только при изменении того, от
  чего снимок зависит. Сотрудник в этот список входил и раньше, и теперь
  это важно вдвойне: перевод смены на другого человека может поменять
  ставку, даже если ПВЗ и дата прежние.
*/
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
  v_rate_row public.employee_point_rates%rowtype;
  v_point public.points%rowtype;
  v_item jsonb;
  v_rate numeric;
  v_base numeric;
  v_full_hours numeric := 12;
  v_pricing jsonb;
  v_is_new boolean;
  v_pricing_changed boolean;
  v_source text;
  v_pricing_type text;
  v_fixed_rate numeric;
  v_shk_tiers jsonb;
  v_effective_from date;
  v_rate_id uuid;
  v_tariff_id uuid;
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
    v_rate_row := private.employee_rate_for_date(
      p_employee_id,
      p_point_id,
      p_shift_date
    );

    if v_rate_row.id is not null then
      v_source := 'employee';
      v_pricing_type := v_rate_row.pricing_type;
      v_fixed_rate := v_rate_row.fixed_rate;
      v_shk_tiers := v_rate_row.shk_tiers;
      v_effective_from := v_rate_row.effective_from;
      v_rate_id := v_rate_row.id;
      v_tariff_id := null;
    else
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

      v_source := 'point';
      v_pricing_type := v_tariff.pricing_type;
      v_fixed_rate := v_tariff.fixed_rate;
      v_shk_tiers := v_tariff.shk_tiers;
      v_effective_from := v_tariff.effective_from;
      v_rate_id := null;
      v_tariff_id := v_tariff.id;
    end if;

    perform private.validate_tariff_payload(
      v_pricing_type,
      v_fixed_rate,
      v_shk_tiers
    );

    if v_pricing_type = 'fixed' then
      v_rate := v_fixed_rate;
      p_shk := null;
    else
      if p_shk is null or p_shk < 0 or p_shk > 1000000 then
        raise exception 'invalid_shk'
          using errcode = '22023';
      end if;

      for v_item in
        select value
        from jsonb_array_elements(v_shk_tiers)
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
      'tariffId', v_tariff_id,
      'rateSource', v_source,
      'employeeRateId', v_rate_id,
      'employeeId', p_employee_id,
      'pointId', v_point.id,
      'pointName', v_point.name,
      'effectiveFrom', v_effective_from,
      'pricingType', v_pricing_type,
      'fixed', v_pricing_type = 'fixed',
      'fixedRate', v_fixed_rate,
      'shkTiers', v_shk_tiers,
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

/*
  Пересчёт смены по действующим сейчас условиям — теми же правилами, что
  и сохранение: сначала индивидуальная ставка, потом тариф ПВЗ.
*/
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
  v_rate_row public.employee_point_rates%rowtype;
  v_point public.points%rowtype;
  v_item jsonb;
  v_rate numeric;
  v_base numeric;
  v_pricing jsonb;
  v_source text;
  v_pricing_type text;
  v_fixed_rate numeric;
  v_shk_tiers jsonb;
  v_effective_from date;
  v_rate_id uuid;
  v_tariff_id uuid;
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

  v_rate_row := private.employee_rate_for_date(
    v_shift.employee_id,
    v_shift.point_id,
    v_shift.shift_date
  );

  if v_rate_row.id is not null then
    v_source := 'employee';
    v_pricing_type := v_rate_row.pricing_type;
    v_fixed_rate := v_rate_row.fixed_rate;
    v_shk_tiers := v_rate_row.shk_tiers;
    v_effective_from := v_rate_row.effective_from;
    v_rate_id := v_rate_row.id;
    v_tariff_id := null;
  else
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

    v_source := 'point';
    v_pricing_type := v_tariff.pricing_type;
    v_fixed_rate := v_tariff.fixed_rate;
    v_shk_tiers := v_tariff.shk_tiers;
    v_effective_from := v_tariff.effective_from;
    v_rate_id := null;
    v_tariff_id := v_tariff.id;
  end if;

  perform private.validate_tariff_payload(
    v_pricing_type,
    v_fixed_rate,
    v_shk_tiers
  );

  if v_pricing_type = 'fixed' then
    v_rate := v_fixed_rate;
  else
    if v_shift.shk is null then
      raise exception 'invalid_shk'
        using errcode = '22023';
    end if;

    for v_item in
      select value
      from jsonb_array_elements(v_shk_tiers)
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
    'tariffId', v_tariff_id,
    'rateSource', v_source,
    'employeeRateId', v_rate_id,
    'employeeId', v_shift.employee_id,
    'pointId', v_point.id,
    'pointName', v_point.name,
    'effectiveFrom', v_effective_from,
    'pricingType', v_pricing_type,
    'fixed', v_pricing_type = 'fixed',
    'fixedRate', v_fixed_rate,
    'shkTiers', v_shk_tiers,
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
    'rate_source', v_source,
    'effective_from', v_effective_from
  );
end;
$$;

revoke all on function public.admin_add_employee_rate(
  uuid, uuid, date, text, numeric, jsonb
) from public, anon;

revoke all on function public.admin_update_employee_rate(
  uuid, date, text, numeric, jsonb
) from public, anon;

revoke all on function public.admin_delete_employee_rate(uuid)
  from public, anon;

grant execute on function public.admin_add_employee_rate(
  uuid, uuid, date, text, numeric, jsonb
) to authenticated;

grant execute on function public.admin_update_employee_rate(
  uuid, date, text, numeric, jsonb
) to authenticated;

grant execute on function public.admin_delete_employee_rate(uuid)
  to authenticated;

-- Состояние прав проверяется здесь же, как и для остальных таблиц:
-- восстановление базы с нуля не должно тихо закончиться с лишним или
-- недостающим доступом.
do $$
declare
  v_anon text;
  v_extra text;
begin
  select string_agg(distinct privilege_type, ', ')
  into v_anon
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'employee_point_rates'
    and grantee = 'anon';

  if v_anon is not null then
    raise exception 'anon получил доступ к employee_point_rates: %', v_anon;
  end if;

  select string_agg(distinct privilege_type, ', ')
  into v_extra
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'employee_point_rates'
    and grantee = 'authenticated'
    and privilege_type <> 'SELECT';

  if v_extra is not null then
    raise exception 'у authenticated лишние права на employee_point_rates: %', v_extra;
  end if;
end;
$$;

commit;
