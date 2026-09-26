-- Даты в истории — одним почерком.
--
-- Лента показывала три написания подряд: «От 25.09.2026» у выплаты,
-- «3 сентября» у правки закрытого периода и «03.09.2026» у пересчёта.
-- Причина в том, что одни даты сервер вклеивал в строку сам, а другие
-- клал в details, и приложение форматировало их по-своему.
--
-- Теперь дата всегда уходит в details, а пишет её приложение — теми же
-- словами, что и везде на экране. Серверная строка остаётся при том,
-- чего приложение знать не может: сумма до и после, название ПВЗ,
-- комментарий к выплате.
begin;

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
    coalesce(nullif(trim(coalesce(p_comment, '')), ''), ''),
    p_reason,
    p_amount,
    v_status,
    jsonb_build_object('payoutId', v_id, 'date', p_paid_on)
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
    coalesce(nullif(trim(coalesce(v_payout.comment, '')), ''), ''),
    p_reason,
    -v_payout.amount,
    v_status,
    jsonb_build_object('payoutId', p_payout_id, 'date', v_payout.paid_on)
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
    private.money_text(v_shift.base_amount) || ' → ' ||
      private.money_text((v_result ->> 'base_amount')::numeric) || ' ₽',
    p_reason,
    (v_result ->> 'base_amount')::numeric - v_shift.base_amount,
    coalesce(v_status, 'open'),
    v_result || jsonb_build_object('date', v_shift.shift_date)
  );

  return v_result;
end;
$$;

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
      'date', p_effective_from
    )
  );
end;
$$;

revoke all on function private.record_rate_event(uuid, uuid, date, text, text)
  from public, anon, authenticated;

commit;
