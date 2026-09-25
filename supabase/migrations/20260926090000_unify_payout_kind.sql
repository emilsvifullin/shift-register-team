-- Одно имя у половин месяца.
--
-- Месяц в Shift Register выплачивается двумя платежами: 25-го числа за
-- первую половину и 10-го числа следующего месяца — окончательный
-- расчёт. Одна и та же пара названа в базе двумя разными способами:
--
--   employee_payouts.payout_kind ∈ ('first_half', 'final')
--   shift_penalties.payout_kind ∈ ('first_half', 'second_half')
--
-- Совпадения не требовалось, потому что таблицы нигде не соединяются, и
-- клиент просто переводил одно в другое. Но дальше на этих же ключах
-- строится закрытие расчётного периода, история финансовых изменений и
-- отчёты, а они читают и то и другое. Держать в одной системе два слова
-- для одного и того же — значит в каждом новом запросе выбирать, на
-- каком языке он написан, и рано или поздно выбрать неправильно.
--
-- Остаётся симметричная пара first_half / second_half: она называет то,
-- за что платят (половину месяца), а не когда платят. Когда именно —
-- видно в самой выплате по paid_on и в подписях интерфейса.
--
-- Выплат в базе сейчас нет ни одной, поэтому перенос данных здесь —
-- страховка для восстановления с нуля, а не работа над живыми записями.
begin;

alter table public.employee_payouts
  drop constraint if exists employee_payouts_payout_kind_check;

update public.employee_payouts
set payout_kind = 'second_half'
where payout_kind = 'final';

alter table public.employee_payouts
  add constraint employee_payouts_payout_kind_check
  check (payout_kind in ('first_half', 'second_half'));

create or replace function public.admin_save_employee_payout(
  p_payout_id uuid,
  p_employee_id uuid,
  p_period_month date,
  p_payout_kind text,
  p_amount numeric,
  p_paid_on date,
  p_comment text default null
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
    not exists (
      select 1
      from public.employees e
      where e.id = p_employee_id
    ) or
    p_period_month is null or
    p_period_month <> date_trunc('month', p_period_month)::date or
    p_payout_kind not in ('first_half', 'second_half') or
    p_amount is null or
    p_amount <= 0 or
    p_paid_on is null or
    length(trim(coalesce(p_comment, ''))) > 500
  then
    raise exception 'invalid_employee_payout'
      using errcode = '22023';
  end if;

  if p_payout_id is null then
    insert into public.employee_payouts(
      employee_id,
      period_month,
      payout_kind,
      amount,
      paid_on,
      comment,
      created_by,
      updated_by
    ) values (
      p_employee_id,
      p_period_month,
      p_payout_kind,
      p_amount,
      p_paid_on,
      nullif(trim(coalesce(p_comment, '')), ''),
      auth.uid(),
      auth.uid()
    )
    returning id into v_id;
  else
    update public.employee_payouts
    set
      amount = p_amount,
      paid_on = p_paid_on,
      comment = nullif(trim(coalesce(p_comment, '')), ''),
      updated_by = auth.uid()
    where id = p_payout_id
      and employee_id = p_employee_id
      and period_month = p_period_month
      and payout_kind = p_payout_kind
    returning id into v_id;

    if v_id is null then
      raise exception 'employee_payout_not_found'
        using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.admin_save_employee_payout(
  uuid, uuid, date, text, numeric, date, text
) from public, anon;

grant execute on function public.admin_save_employee_payout(
  uuid, uuid, date, text, numeric, date, text
) to authenticated;

-- Проверка: старого слова не осталось ни в данных, ни в ограничениях.
do $$
declare
  v_left integer;
  v_check text;
begin
  select count(*)
  into v_left
  from public.employee_payouts
  where payout_kind not in ('first_half', 'second_half');

  if v_left > 0 then
    raise exception 'выплаты со старым payout_kind: %', v_left;
  end if;

  select pg_get_constraintdef(oid)
  into v_check
  from pg_constraint
  where conrelid = 'public.employee_payouts'::regclass
    and conname = 'employee_payouts_payout_kind_check';

  if v_check is null or v_check like '%final%' then
    raise exception 'ограничение payout_kind не обновлено: %', v_check;
  end if;
end;
$$;

commit;
