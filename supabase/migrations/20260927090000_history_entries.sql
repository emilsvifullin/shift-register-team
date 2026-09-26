-- История периода как лента действий, а не технический лог.
--
-- Две правки.
--
-- Первая: строка события повторяла сумму дважды. Приложение показывает
-- финансовый эффект крупно и цветом («+ 4 500 ₽»), а под ним шла
-- серверная фраза «выплата 4500 ₽ от 26.09.2026» — то же число ещё раз,
-- да ещё другим почерком. Теперь сервер пишет только то, чего в шапке
-- нет: дату выплаты, дату смены, прежнюю и новую стоимость. Название
-- действия и сумму рисует приложение.
--
-- Вторая: индивидуальная ставка сотрудника не оставляла следа вовсе.
-- Она прямо определяет стоимость смен, и без неё вопрос «почему у этого
-- человека смены подорожали» не имел ответа. Заведение, изменение и
-- удаление ставки теперь записываются, причём удаление говорит и о
-- последствии — расчёт возвращается к тарифу ПВЗ.
--
-- Уже записанные факты выплат не переписываются: события только
-- добавляются, ни одно существующее не меняется.
begin;

-- Ставка для человеческой строки: фиксированная сумма или ступени по ШК.
create or replace function private.rate_text(
  p_pricing_type text,
  p_fixed_rate numeric,
  p_shk_tiers jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_pricing_type = 'fixed'
      then private.money_text(p_fixed_rate) || ' ₽'
    else 'ставки по объёму'
  end;
$$;

revoke all on function private.rate_text(text, numeric, jsonb)
  from public, anon, authenticated;

/*
  Событие об индивидуальной ставке.

  Период выбирается по дате, с которой ставка действует: именно там
  человек и спросит, почему изменилась стоимость смен.
*/
create or replace function private.record_rate_event(
  p_employee_id uuid,
  p_point_id uuid,
  p_effective_from date,
  p_kind text,
  p_summary text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_payroll_event(
    date_trunc('month', p_effective_from)::date,
    private.period_kind_for_date(p_effective_from),
    p_employee_id,
    p_kind,
    p_summary,
    null,
    null,
    (
      select status
      from public.payroll_periods
      where period_month = date_trunc('month', p_effective_from)::date
        and payout_kind = private.period_kind_for_date(p_effective_from)
    ),
    jsonb_build_object(
      'pointId', p_point_id,
      'effectiveFrom', p_effective_from
    )
  );
end;
$$;

revoke all on function private.record_rate_event(uuid, uuid, date, text, text)
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
  v_point text;
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

  select name into v_point from public.points where id = p_point_id;

  perform private.record_rate_event(
    p_employee_id,
    p_point_id,
    p_effective_from,
    'rate_added',
    coalesce(v_point, 'ПВЗ') || ' · ' ||
      private.rate_text(p_pricing_type, p_fixed_rate, p_shk_tiers) ||
      ' с ' || to_char(p_effective_from, 'DD.MM.YYYY')
  );

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
  v_rate public.employee_point_rates%rowtype;
  v_point text;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if p_effective_from is null then
    raise exception 'invalid_employee_rate_target'
      using errcode = '22023';
  end if;

  perform private.validate_tariff_payload(
    p_pricing_type,
    p_fixed_rate,
    p_shk_tiers
  );

  select * into v_rate
  from public.employee_point_rates
  where id = p_rate_id;

  if not found then
    raise exception 'employee_rate_not_found'
      using errcode = 'P0002';
  end if;

  update public.employee_point_rates
  set
    effective_from = p_effective_from,
    pricing_type = p_pricing_type,
    fixed_rate = p_fixed_rate,
    shk_tiers = p_shk_tiers,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_rate_id;

  select name into v_point from public.points where id = v_rate.point_id;

  perform private.record_rate_event(
    v_rate.employee_id,
    v_rate.point_id,
    p_effective_from,
    'rate_changed',
    coalesce(v_point, 'ПВЗ') || ' · ' ||
      private.rate_text(
        v_rate.pricing_type, v_rate.fixed_rate, v_rate.shk_tiers
      ) ||
      ' → ' ||
      private.rate_text(p_pricing_type, p_fixed_rate, p_shk_tiers)
  );

  return p_rate_id;
end;
$$;

create or replace function public.admin_delete_employee_rate(
  p_rate_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate public.employee_point_rates%rowtype;
  v_point text;
  v_left integer;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select * into v_rate
  from public.employee_point_rates
  where id = p_rate_id;

  if not found then
    raise exception 'employee_rate_not_found'
      using errcode = 'P0002';
  end if;

  delete from public.employee_point_rates
  where id = p_rate_id;

  select name into v_point from public.points where id = v_rate.point_id;

  -- Если своих ставок на этом ПВЗ больше не осталось, расчёт вернётся к
  -- тарифу ПВЗ — и это главное последствие удаления.
  select count(*) into v_left
  from public.employee_point_rates
  where employee_id = v_rate.employee_id
    and point_id = v_rate.point_id;

  perform private.record_rate_event(
    v_rate.employee_id,
    v_rate.point_id,
    v_rate.effective_from,
    'rate_removed',
    coalesce(v_point, 'ПВЗ') || ' · ' ||
      private.rate_text(
        v_rate.pricing_type, v_rate.fixed_rate, v_rate.shk_tiers
      ) ||
      case
        when v_left = 0 then ' · дальше по тарифу ПВЗ'
        else ' · остальные свои ставки действуют'
      end
  );
end;
$$;

-- Строки событий: только то, чего нет в шапке записи.
create or replace function public.admin_save_employee_payout_v2(
  p_payout_id uuid,
  p_employee_id uuid,
  p_period_month date,
  p_payout_kind text,
  p_amount numeric,
  p_paid_on date,
  p_comment text default null,
  p_force boolean default false,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select status
  into v_status
  from public.payroll_periods
  where period_month = p_period_month
    and payout_kind = p_payout_kind;

  if v_status = 'paid' and not coalesce(p_force, false) then
    raise exception 'payroll_period_closed:%:%:%', p_period_month, p_payout_kind, v_status
      using errcode = '22023';
  end if;

  v_id := public.admin_save_employee_payout(
    p_payout_id,
    p_employee_id,
    p_period_month,
    p_payout_kind,
    p_amount,
    p_paid_on,
    p_comment
  );

  perform private.record_payroll_event(
    p_period_month,
    p_payout_kind,
    p_employee_id,
    case when p_payout_id is null then 'payout_added' else 'payout_changed' end,
    'от ' || to_char(p_paid_on, 'DD.MM.YYYY') ||
      coalesce(' · ' || nullif(trim(coalesce(p_comment, '')), ''), ''),
    p_reason,
    p_amount,
    v_status,
    jsonb_build_object('payoutId', v_id)
  );

  return v_id;
end;
$$;

create or replace function public.admin_delete_employee_payout_v2(
  p_payout_id uuid,
  p_force boolean default false,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout public.employee_payouts%rowtype;
  v_status text;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select *
  into v_payout
  from public.employee_payouts
  where id = p_payout_id;

  if not found then
    raise exception 'employee_payout_not_found'
      using errcode = 'P0002';
  end if;

  select status
  into v_status
  from public.payroll_periods
  where period_month = v_payout.period_month
    and payout_kind = v_payout.payout_kind;

  if v_status in ('closed', 'paid') and not coalesce(p_force, false) then
    raise exception 'payroll_period_closed:%:%:%', v_payout.period_month, v_payout.payout_kind, v_status
      using errcode = '22023';
  end if;

  perform public.admin_delete_employee_payout(p_payout_id);

  perform private.record_payroll_event(
    v_payout.period_month,
    v_payout.payout_kind,
    v_payout.employee_id,
    'payout_deleted',
    'от ' || to_char(v_payout.paid_on, 'DD.MM.YYYY'),
    p_reason,
    -v_payout.amount,
    v_status,
    jsonb_build_object('payoutId', p_payout_id)
  );
end;
$$;

create or replace function public.admin_reprice_shift_v2(
  p_shift_id uuid,
  p_force boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_result jsonb;
  v_month date;
  v_kind text;
  v_status text;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select *
  into v_shift
  from public.shifts
  where id = p_shift_id;

  if not found then
    raise exception 'shift_not_found'
      using errcode = 'P0002';
  end if;

  perform private.assert_period_open(
    v_shift.shift_date,
    p_force,
    'смена пересчитана',
    v_shift.employee_id,
    p_reason,
    null
  );

  v_month := date_trunc('month', v_shift.shift_date)::date;
  v_kind := private.period_kind_for_date(v_shift.shift_date);

  select status
  into v_status
  from public.payroll_periods
  where period_month = v_month
    and payout_kind = v_kind;

  v_result := public.admin_reprice_shift(p_shift_id);

  perform private.record_payroll_event(
    v_month,
    v_kind,
    v_shift.employee_id,
    'shift_repriced',
    to_char(v_shift.shift_date, 'DD.MM.YYYY') || ' · ' ||
      private.money_text(v_shift.base_amount) || ' → ' ||
      private.money_text((v_result ->> 'base_amount')::numeric) || ' ₽',
    p_reason,
    (v_result ->> 'base_amount')::numeric - v_shift.base_amount,
    coalesce(v_status, 'open'),
    v_result
  );

  return v_result;
end;
$$;

commit;
