-- Две неточности в истории периода.
--
-- Первая: пересчёт смены писал событие без состояния периода. Колонка
-- period_status заведена ровно для одного вопроса — произошло изменение
-- до закрытия или после, — и у пересчёта, самого денежного из
-- изменений задним числом, ответа на него не было. Остальные события
-- его пишут, пересчёт передавал null.
--
-- Вторая: возврат периода в работу снимал отметки проверки, но оставлял
-- closed_at, closed_by, paid_at и paid_by. Открытый период продолжал
-- утверждать, что он закрыт и выплачен. Когда это случилось — помнит
-- payroll_events, и именно там этому место; строка периода описывает
-- его нынешнее состояние, а не прошлые.
begin;

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

  -- Состояние читается до пересчёта: событие описывает тот период, в
  -- котором действие произошло.
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
    'смена ' ||
      to_char(v_shift.shift_date, 'DD.MM.YYYY') ||
      ' пересчитана: ' ||
      to_char(v_shift.base_amount, 'FM999999990') ||
      ' → ' ||
      to_char((v_result ->> 'base_amount')::numeric, 'FM999999990') ||
      ' ₽',
    p_reason,
    (v_result ->> 'base_amount')::numeric - v_shift.base_amount,
    coalesce(v_status, 'open'),
    v_result
  );

  return v_result;
end;
$$;

create or replace function public.admin_reopen_payroll_period(
  p_period_month date,
  p_payout_kind text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.payroll_periods%rowtype;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select *
  into v_period
  from public.payroll_periods
  where period_month = p_period_month
    and payout_kind = p_payout_kind;

  if not found then
    raise exception 'payroll_period_not_found'
      using errcode = 'P0002';
  end if;

  if v_period.status not in ('closed', 'paid') then
    raise exception 'payroll_period_not_closed'
      using errcode = '22023';
  end if;

  update public.payroll_periods
  set
    status = 'open',
    checked_fingerprint = null,
    checked_at = null,
    checked_by = null,
    closed_at = null,
    closed_by = null,
    paid_at = null,
    paid_by = null
  where id = v_period.id;

  return v_period.id;
end;
$$;

-- Отметки закрытия у периодов, которые уже вернули в работу прежней
-- версией функции.
update public.payroll_periods
set
  closed_at = null,
  closed_by = null,
  paid_at = null,
  paid_by = null
where status = 'open'
  and (closed_at is not null or paid_at is not null);

commit;
