-- «Период ещё не закрыт» про уже выплаченный период.
--
-- admin_mark_payroll_period_paid требует состояния closed и на всё
-- остальное отвечает одним доводом payroll_period_not_closed. Для
-- периода, который ещё не закрывали, это правда. Для уже выплаченного —
-- прямо наоборот: он закрыт и выплачен, а экран сообщает, что он ещё не
-- закрыт. Случай не выдуманный: кнопка пропадает после выплаты, но
-- вторая вкладка или медленная сеть оставляют её на экране, и повторное
-- нажатие показывает неправду.
--
-- Два разных состояния — два разных довода.
begin;

create or replace function public.admin_mark_payroll_period_paid(
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
  v_due numeric;
  v_paid numeric;
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

  if found and v_period.status = 'paid' then
    raise exception 'payroll_period_already_paid'
      using errcode = '22023';
  end if;

  if not found or v_period.status <> 'closed' then
    raise exception 'payroll_period_not_closed'
      using errcode = '22023';
  end if;

  select coalesce(sum(due), 0)
  into v_due
  from public.payroll_period_entries
  where period_id = v_period.id;

  select coalesce(sum(amount), 0)
  into v_paid
  from public.employee_payouts
  where period_month = p_period_month
    and payout_kind = p_payout_kind;

  if v_due > 0 and v_paid <= 0 then
    raise exception 'payroll_period_has_no_payouts'
      using errcode = '22023';
  end if;

  update public.payroll_periods
  set
    status = 'paid',
    paid_at = now(),
    paid_by = auth.uid()
  where id = v_period.id;

  return v_period.id;
end;
$$;

commit;
