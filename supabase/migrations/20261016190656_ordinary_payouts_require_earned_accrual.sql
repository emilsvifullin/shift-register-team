-- Ordinary payouts can spend only accrued shifts, never the month forecast.
-- Exclude future shifts before applying existing cap, carry, bonus and fine
-- allocation. Explicit advances and old ordinary-payout reduction keep their
-- existing rules. No business rows or closing snapshots are rewritten.
begin;

create or replace function private.payroll_period_figures(
  p_employee_id uuid,
  p_period_month date,
  p_payout_kind text,
  p_through_date date
)
returns table(
  shifts integer,
  base numeric,
  bonus numeric,
  fine numeric,
  due numeric
)
language plpgsql
stable
set search_path = ''
as $$
declare
  c_advance_cap constant numeric := 20000;

  v_row record;
  v_first boolean;
  v_advance boolean;
  v_default_second boolean;

  v_shifts_first integer := 0;
  v_shifts_second integer := 0;

  v_special_first_base numeric := 0;
  v_special_second_base numeric := 0;
  v_special_bonus numeric := 0;

  v_regular_first_base numeric := 0;
  v_regular_second_base numeric := 0;
  v_regular_first_bonus numeric := 0;
  v_regular_second_bonus numeric := 0;

  v_default_fine25 numeric := 0;
  v_default_fine10 numeric := 0;
  v_targeted_fine25 numeric := 0;
  v_targeted_fine10 numeric := 0;

  v_advance_paid numeric;
  v_carry numeric;
  v_bonus25 numeric;
  v_bonus10 numeric;
  v_gross25 numeric;
  v_gross10 numeric;
  v_targeted25_applied numeric;
  v_targeted25_carry numeric;
  v_fine25 numeric;
  v_fine10 numeric;
begin
  for v_row in
    select
      s.shift_date,
      s.base_amount,
      s.pricing_snapshot,
      pt.advance_enabled as point_advance,
      coalesce((
        select sum(b.amount)
        from public.shift_bonuses b
        where b.shift_id = s.id
      ), 0) as bonus,
      coalesce((
        select sum(p.amount)
        from public.shift_penalties p
        where p.shift_id = s.id
          and p.payout_kind is null
      ), 0) as fine_default,
      coalesce((
        select sum(p.amount)
        from public.shift_penalties p
        where p.shift_id = s.id
          and p.payout_kind = 'first_half'
      ), 0) as fine_first,
      coalesce((
        select sum(p.amount)
        from public.shift_penalties p
        where p.shift_id = s.id
          and p.payout_kind = 'second_half'
      ), 0) as fine_second
    from public.shifts s
    left join public.points pt on pt.id = s.point_id
    where s.employee_id = p_employee_id
      and s.shift_date >= p_period_month
      and s.shift_date < (p_period_month + interval '1 month')::date
      and (p_through_date is null or s.shift_date <= p_through_date)
  loop
    v_first := extract(day from v_row.shift_date) <= 15;

    v_advance := case
      when jsonb_typeof(v_row.pricing_snapshot -> 'advanceEnabled') = 'boolean'
        then (v_row.pricing_snapshot ->> 'advanceEnabled')::boolean
      when v_row.pricing_snapshot -> 'advanceEnabled' is null
        or jsonb_typeof(v_row.pricing_snapshot -> 'advanceEnabled') = 'null'
        then coalesce(v_row.point_advance, false)
      else false
    end;

    if v_first then
      v_shifts_first := v_shifts_first + 1;
    else
      v_shifts_second := v_shifts_second + 1;
    end if;

    v_default_second := v_advance or not v_first;

    if v_default_second then
      v_default_fine10 := v_default_fine10 + v_row.fine_default;
    else
      v_default_fine25 := v_default_fine25 + v_row.fine_default;
    end if;

    v_targeted_fine25 := v_targeted_fine25 + v_row.fine_first;
    v_targeted_fine10 := v_targeted_fine10 + v_row.fine_second;

    if v_advance then
      if v_first then
        v_special_first_base := v_special_first_base + v_row.base_amount;
      else
        v_special_second_base := v_special_second_base + v_row.base_amount;
      end if;

      v_special_bonus := v_special_bonus + v_row.bonus;
    elsif v_first then
      v_regular_first_base := v_regular_first_base + v_row.base_amount;
      v_regular_first_bonus := v_regular_first_bonus + v_row.bonus;
    else
      v_regular_second_base := v_regular_second_base + v_row.base_amount;
      v_regular_second_bonus := v_regular_second_bonus + v_row.bonus;
    end if;
  end loop;

  v_advance_paid := least(v_special_first_base, c_advance_cap);
  v_carry := greatest(v_special_first_base - v_advance_paid, 0);

  v_bonus25 := v_regular_first_bonus;
  v_bonus10 := v_special_bonus + v_regular_second_bonus;

  v_gross25 := v_advance_paid + v_regular_first_base + v_bonus25;
  v_gross10 := v_carry + v_special_second_base + v_regular_second_base + v_bonus10;

  v_targeted25_applied := least(
    v_targeted_fine25,
    greatest(v_gross25 - v_default_fine25, 0)
  );

  v_targeted25_carry := greatest(v_targeted_fine25 - v_targeted25_applied, 0);

  v_fine25 := v_default_fine25 + v_targeted25_applied;
  v_fine10 := v_default_fine10 + v_targeted_fine10 + v_targeted25_carry;

  if p_payout_kind = 'first_half' then
    return query select
      v_shifts_first,
      round(v_advance_paid + v_regular_first_base, 2),
      round(v_bonus25, 2),
      round(v_fine25, 2),
      round(v_gross25 - v_fine25, 2);
  else
    return query select
      v_shifts_second,
      round(v_carry + v_special_second_base + v_regular_second_base, 2),
      round(v_bonus10, 2),
      round(v_fine10, 2),
      round(v_gross10 - v_fine10, 2);
  end if;
end;
$$;

-- The three-argument calculation intentionally remains a full-month forecast:
-- period checks, frozen closing snapshots and historical reports are unchanged.
create or replace function private.payroll_period_figures(
  p_employee_id uuid,
  p_period_month date,
  p_payout_kind text
)
returns table(shifts integer, base numeric, bonus numeric, fine numeric, due numeric)
language sql
stable
set search_path = ''
as $$
  select * from private.payroll_period_figures(
    p_employee_id, p_period_month, p_payout_kind, null::date
  );
$$;

revoke all on function private.payroll_period_figures(uuid,date,text,date)
  from public, anon, authenticated;
revoke all on function private.payroll_period_figures(uuid,date,text)
  from public, anon, authenticated;

create or replace function private.admin_save_employee_payout_v2(
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
    p_payout_kind,
    (now() at time zone 'Europe/Moscow')::date
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

revoke all on function private.admin_save_employee_payout_v2(
  uuid,uuid,date,text,numeric,date,text,boolean,text,boolean
) from public, anon, authenticated;

-- The public role-checking, serialized write gateway is deliberately unchanged.
commit;
