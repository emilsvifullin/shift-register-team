-- Деньги в истории периода написаны двумя почерками.
--
-- Строка события показывает сумму дважды: крупно — эффект, который
-- форматирует приложение («+ 4 500 ₽»), и рядом человеческую строку от
-- сервера («выплата 4500 ₽ от 26.09.2026»). Одно и то же число, два
-- разных написания, в одной строке. Разряды разделяет то же узкое
-- неразрывное пространство, что и везде в приложении.
begin;

create or replace function private.money_text(p_amount numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(
    to_char(round(coalesce(p_amount, 0)), 'FM9,999,999,999'),
    ',',
    U&'\00A0'
  );
$$;

comment on function private.money_text(numeric) is
  'Сумма для человеческой строки истории: разряды разделены неразрывным пробелом, как в интерфейсе.';

revoke all on function private.money_text(numeric)
  from public, anon, authenticated;

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
    'смена ' ||
      to_char(v_shift.shift_date, 'DD.MM.YYYY') ||
      ' пересчитана: ' ||
      private.money_text(v_shift.base_amount) ||
      ' → ' ||
      private.money_text((v_result ->> 'base_amount')::numeric) ||
      ' ₽',
    p_reason,
    (v_result ->> 'base_amount')::numeric - v_shift.base_amount,
    coalesce(v_status, 'open'),
    v_result
  );

  return v_result;
end;
$$;


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

  -- Выплата — это то, ради чего период закрывают, поэтому закрытый
  -- период её принимает. Согласия требует только выплаченный: он уже
  -- объявлен завершённым.
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
    'выплата ' ||
      private.money_text(p_amount) ||
      ' ₽ от ' ||
      to_char(p_paid_on, 'DD.MM.YYYY'),
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

  if
    v_status in ('closed', 'paid') and
    not coalesce(p_force, false)
  then
    raise exception 'payroll_period_closed:%:%:%', v_payout.period_month, v_payout.payout_kind, v_status
      using errcode = '22023';
  end if;

  perform public.admin_delete_employee_payout(p_payout_id);

  perform private.record_payroll_event(
    v_payout.period_month,
    v_payout.payout_kind,
    v_payout.employee_id,
    'payout_deleted',
    'выплата ' ||
      private.money_text(v_payout.amount) ||
      ' ₽ от ' ||
      to_char(v_payout.paid_on, 'DD.MM.YYYY') ||
      ' удалена',
    p_reason,
    -v_payout.amount,
    v_status,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.admin_save_shift_v4(
  uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb, numeric, text, boolean, text
) from public, anon;
revoke all on function public.admin_delete_shift_v2(uuid, boolean, text)
  from public, anon;
revoke all on function public.admin_reprice_shift_v2(uuid, boolean, text)
  from public, anon;

commit;
