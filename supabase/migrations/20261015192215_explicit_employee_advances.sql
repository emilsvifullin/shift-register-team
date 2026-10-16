-- Явный аванс хранит фактически выданные деньги в выбранной половине
-- месяца. Обычные выплаты по-прежнему не превышают остаток начисления.
-- Остаток аванса не переносится между периодами автоматически.
alter table public.employee_payouts
  add column is_advance boolean not null default false;

-- Удаляем старую сигнатуру: один RPC с default-параметром поддерживает
-- старые вызовы и не создаёт неоднозначный overload в PostgREST.
drop function public.admin_save_employee_payout_v2(uuid, uuid, date, text, numeric, date, text, boolean, text);

create or replace function public.admin_save_employee_payout_v2(
  p_payout_id uuid,
  p_employee_id uuid,
  p_period_month date,
  p_payout_kind text,
  p_amount numeric,
  p_paid_on date,
  p_comment text default null,
  p_force boolean default false,
  p_reason text default null,
  p_is_advance boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_id uuid;
  v_due numeric;
  v_other numeric;
  v_previous numeric := 0;
  v_existing public.employee_payouts%rowtype;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if
    p_amount is null or
    p_amount <= 0 or
    p_amount > 10000000 or
    p_amount <> round(p_amount, 2) or
    p_paid_on is null or
    p_paid_on < date '2000-01-01' or
    p_paid_on > current_date + 366 or
    p_period_month is null or
    p_period_month <> date_trunc('month', p_period_month)::date or
    p_payout_kind is null or
    p_payout_kind not in ('first_half', 'second_half')
  then
    raise exception 'invalid_employee_payout'
      using errcode = '22023';
  end if;

  -- Две выплаты одному человеку за одну половину не проверяются
  -- параллельно: иначе обе увидели бы один и тот же остаток.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'payout:' || p_employee_id::text || ':' ||
        p_period_month::text || ':' || p_payout_kind,
      0
    )
  );

  -- После ожидания остатка берём тот же row lock периода, что и
  -- закрытие. Статус читается заново под блокировкой: закрытие не может
  -- пройти между проверкой и записью, в том числе у нового периода.
  -- Порядок: payout advisory → period row → payout row. Закрытие берёт
  -- только period row и не ждёт payout advisory/row, поэтому цикла нет.
  perform private.ensure_payroll_period(p_period_month, p_payout_kind);

  select status
  into v_status
  from public.payroll_periods
  where period_month = p_period_month
    and payout_kind = p_payout_kind
  for update;

  if (v_status = 'paid' or (v_status = 'closed' and p_payout_id is not null))
    and not coalesce(p_force, false) then
    raise exception 'payroll_period_closed:%:%:%', p_period_month, p_payout_kind, v_status
      using errcode = '22023';
  end if;

  select f.due
  into v_due
  from private.payroll_period_figures(
    p_employee_id,
    p_period_month,
    p_payout_kind
  ) f;

  select coalesce(sum(amount), 0)
  into v_other
  from public.employee_payouts
  where employee_id = p_employee_id
    and period_month = p_period_month
    and payout_kind = p_payout_kind
    and id is distinct from p_payout_id;

  if p_payout_id is not null then
    select * into v_existing
    from public.employee_payouts
    where id = p_payout_id
      and employee_id = p_employee_id
      and period_month = p_period_month
      and payout_kind = p_payout_kind
    for update;

    if not found then
      raise exception 'employee_payout_not_found' using errcode = 'P0002';
    end if;

    -- Снижение старой непреднамеренной переплаты остаётся доступным.
    -- Снять признак аванса можно только в пределах обычного остатка.
    v_previous := case when v_existing.is_advance then 0 else v_existing.amount end;
  end if;

  if not coalesce(p_is_advance, false)
    and v_other + p_amount > greatest(v_due, v_other + v_previous) then
    raise exception 'payout_exceeds_due:%', greatest(v_due - v_other, 0)
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

  update public.employee_payouts
  set is_advance = coalesce(p_is_advance, false)
  where id = v_id;

  perform private.record_payroll_event(
    p_period_month,
    p_payout_kind,
    p_employee_id,
    case when p_payout_id is null then 'payout_added' else 'payout_changed' end,
    coalesce(nullif(trim(coalesce(p_comment, '')), ''), ''),
    p_reason,
    p_amount,
    v_status,
    jsonb_build_object('payoutId', v_id, 'date', p_paid_on, 'isAdvance', coalesce(p_is_advance, false))
  );

  return v_id;
end;
$$;

revoke all on function public.admin_save_employee_payout_v2(
  uuid, uuid, date, text, numeric, date, text, boolean, text, boolean
) from public, anon;
grant execute on function public.admin_save_employee_payout_v2(
  uuid, uuid, date, text, numeric, date, text, boolean, text, boolean
) to authenticated;
