-- Расчётный период: половина месяца со своим состоянием и снимком.
--
-- До сих пор период существовал только как ключ на строке выплаты:
-- месяц и половина. Ни состояния, ни момента закрытия, ни зафиксированного
-- результата — проверить зарплату, закрыть её и потом доказать, каким был
-- расчёт, было нечем.
--
-- Период здесь — это половина месяца, ровно та, за которую платят:
--
--   first_half   — дни 1–15, выплата 25-го числа;
--   second_half  — дни 16 и дальше, окончательный расчёт 10-го числа
--                  следующего месяца.
--
-- Состояния идут по жизни денег и каждое означает факт, а не отметку:
--
--   open     — период считается, данные меняются свободно;
--   checked  — администратор сверил расчёт; вместе со статусом
--              запоминается отпечаток данных, по которому видно, что
--              после проверки что-то изменилось;
--   closed   — расчёт зафиксирован снимком: с этого момента известно,
--              каким он был, даже если рабочие данные потом поменяются;
--   paid     — выплаты за период записаны.
--
-- Про снимок отдельно. Все правила расчёта — аванс с потолком, перенос
-- остатка, раскладка премий и штрафов по половинам — живут в одной
-- функции payouts() в src/domain.js. Повторять их на SQL значило бы
-- завести вторую финансовую модель, которая рано или поздно разойдётся с
-- первой. Поэтому снимок считает клиент той же функцией, что рисует
-- «Итоги», а сервер его хранит, подписывает временем и автором и дальше
-- не пересчитывает. Приложение админское: сервер и так доверяет
-- администратору суммы (ручная оплата смены), а две реализации одних и
-- тех же правил доверия не добавляют.
begin;

create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  period_month date not null
    check (period_month = date_trunc('month', period_month)::date),
  payout_kind text not null
    check (payout_kind in ('first_half', 'second_half')),
  status text not null default 'open'
    check (status in ('open', 'checked', 'closed', 'paid')),

  -- Отпечаток данных на момент проверки: считает клиент, сравнивает клиент.
  checked_fingerprint text,

  checked_at timestamptz,
  checked_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(period_month, payout_kind)
);

comment on table public.payroll_periods is
  'Расчётный период — половина месяца. Состояние отражает жизнь денег: посчитано, проверено, закрыто, выплачено.';

create index payroll_periods_month_idx
  on public.payroll_periods(period_month desc, payout_kind);

/*
  Снимок закрытия: по строке на сотрудника.

  Хранит и итоги, и разбивку целиком — detail содержит то, из чего
  сложилась сумма, вплоть до списка смен. Этого достаточно, чтобы позже
  показать расчёт таким, каким он был закрыт, ничего не пересчитывая.
*/
create table public.payroll_period_entries (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null
    references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null
    references public.employees(id) on delete cascade,

  shifts integer not null default 0,
  base numeric(12,2) not null default 0,
  bonus numeric(12,2) not null default 0,
  fine numeric(12,2) not null default 0,
  due numeric(12,2) not null default 0,
  paid numeric(12,2) not null default 0,

  detail jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  unique(period_id, employee_id)
);

create index payroll_period_entries_employee_idx
  on public.payroll_period_entries(employee_id);

alter table public.payroll_periods enable row level security;
alter table public.payroll_period_entries enable row level security;

create policy payroll_periods_select
  on public.payroll_periods
  for select
  to authenticated
  using ((select private.is_admin()));

create policy payroll_period_entries_select
  on public.payroll_period_entries
  for select
  to authenticated
  using ((select private.is_admin()));

create trigger payroll_periods_set_updated_at
  before update on public.payroll_periods
  for each row
  execute function public.set_updated_at();

create trigger payroll_periods_audit
  after insert or update or delete on public.payroll_periods
  for each row
  execute function public.write_audit_log();

create trigger payroll_period_entries_audit
  after insert or update or delete on public.payroll_period_entries
  for each row
  execute function public.write_audit_log();

revoke all on table public.payroll_periods
  from anon, authenticated;
revoke all on table public.payroll_period_entries
  from anon, authenticated;

grant select on table public.payroll_periods
  to authenticated;
grant select on table public.payroll_period_entries
  to authenticated;

/*
  Период на месте — заводится по первому обращению.

  Строка появляется только когда с периодом что-то делают: пустой период
  ничем не отличается от отсутствующего, и плодить их на каждый месяц
  истории незачем.
*/
create or replace function private.ensure_payroll_period(
  p_period_month date,
  p_payout_kind text
)
returns public.payroll_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.payroll_periods%rowtype;
begin
  if
    p_period_month is null or
    p_period_month <> date_trunc('month', p_period_month)::date or
    p_payout_kind not in ('first_half', 'second_half')
  then
    raise exception 'invalid_payroll_period'
      using errcode = '22023';
  end if;

  select *
  into v_period
  from public.payroll_periods
  where period_month = p_period_month
    and payout_kind = p_payout_kind;

  if found then
    return v_period;
  end if;

  insert into public.payroll_periods(
    period_month,
    payout_kind
  ) values (
    p_period_month,
    p_payout_kind
  )
  on conflict (period_month, payout_kind) do update
    set updated_at = now()
  returning * into v_period;

  return v_period;
end;
$$;

revoke all on function private.ensure_payroll_period(date, text)
  from public, anon, authenticated;

/*
  Отметить период проверенным.

  Вместе со статусом запоминается отпечаток данных: он считается по тем
  же цифрам, что видит человек, и позволяет потом сказать «проверено, но
  после этого данные изменились» вместо молчаливого «проверено».
*/
create or replace function public.admin_check_payroll_period(
  p_period_month date,
  p_payout_kind text,
  p_fingerprint text
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

  v_period := private.ensure_payroll_period(
    p_period_month,
    p_payout_kind
  );

  if v_period.status not in ('open', 'checked') then
    raise exception 'payroll_period_not_open'
      using errcode = '22023';
  end if;

  update public.payroll_periods
  set
    status = 'checked',
    checked_fingerprint = p_fingerprint,
    checked_at = now(),
    checked_by = auth.uid()
  where id = v_period.id;

  return v_period.id;
end;
$$;

/*
  Снять отметку проверки — период снова в работе.
*/
create or replace function public.admin_uncheck_payroll_period(
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

  if v_period.status <> 'checked' then
    raise exception 'payroll_period_not_checked'
      using errcode = '22023';
  end if;

  update public.payroll_periods
  set
    status = 'open',
    checked_fingerprint = null,
    checked_at = null,
    checked_by = null
  where id = v_period.id;

  return v_period.id;
end;
$$;

/*
  Закрыть период и зафиксировать расчёт.

  p_entries — массив объектов на сотрудника, посчитанных клиентом той же
  функцией, что рисует «Итоги». Сервер их не пересчитывает: правила
  расчёта живут в одном месте, и второе место сделало бы их двумя.
*/
create or replace function public.admin_close_payroll_period(
  p_period_month date,
  p_payout_kind text,
  p_entries jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.payroll_periods%rowtype;
  v_entry jsonb;
  v_employee uuid;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if
    p_entries is null or
    jsonb_typeof(p_entries) <> 'array'
  then
    raise exception 'invalid_payroll_entries'
      using errcode = '22023';
  end if;

  v_period := private.ensure_payroll_period(
    p_period_month,
    p_payout_kind
  );

  if v_period.status in ('closed', 'paid') then
    raise exception 'payroll_period_already_closed'
      using errcode = '22023';
  end if;

  delete from public.payroll_period_entries
  where period_id = v_period.id;

  for v_entry in
    select value
    from jsonb_array_elements(p_entries)
  loop
    v_employee := (v_entry ->> 'employeeId')::uuid;

    if v_employee is null then
      raise exception 'invalid_payroll_entries'
        using errcode = '22023';
    end if;

    insert into public.payroll_period_entries(
      period_id,
      employee_id,
      shifts,
      base,
      bonus,
      fine,
      due,
      paid,
      detail
    ) values (
      v_period.id,
      v_employee,
      coalesce((v_entry ->> 'shifts')::integer, 0),
      coalesce((v_entry ->> 'base')::numeric, 0),
      coalesce((v_entry ->> 'bonus')::numeric, 0),
      coalesce((v_entry ->> 'fine')::numeric, 0),
      coalesce((v_entry ->> 'due')::numeric, 0),
      coalesce((v_entry ->> 'paid')::numeric, 0),
      coalesce(v_entry -> 'detail', '{}'::jsonb)
    );
  end loop;

  update public.payroll_periods
  set
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid()
  where id = v_period.id;

  return v_period.id;
end;
$$;

/*
  Отметить период выплаченным.

  Состояние означает факт, поэтому отметить можно только тогда, когда
  выплаты за период действительно записаны: иначе «Выплачено» было бы
  просто словом на экране.
*/
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

/*
  Вернуть период в работу.

  Действие осознанное и заметное: снимок закрытия остаётся на месте, а
  сам возврат виден в журнале изменений таблицы. Он нужен там, где иначе
  пришлось бы жить с неверным расчётом.
*/
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
    checked_by = null
  where id = v_period.id;

  return v_period.id;
end;
$$;

revoke all on function public.admin_check_payroll_period(date, text, text)
  from public, anon;
revoke all on function public.admin_uncheck_payroll_period(date, text)
  from public, anon;
revoke all on function public.admin_close_payroll_period(date, text, jsonb)
  from public, anon;
revoke all on function public.admin_mark_payroll_period_paid(date, text)
  from public, anon;
revoke all on function public.admin_reopen_payroll_period(date, text)
  from public, anon;

grant execute on function public.admin_check_payroll_period(date, text, text)
  to authenticated;
grant execute on function public.admin_uncheck_payroll_period(date, text)
  to authenticated;
grant execute on function public.admin_close_payroll_period(date, text, jsonb)
  to authenticated;
grant execute on function public.admin_mark_payroll_period_paid(date, text)
  to authenticated;
grant execute on function public.admin_reopen_payroll_period(date, text)
  to authenticated;

do $$
declare
  v_extra text;
begin
  select string_agg(distinct table_name || ':' || privilege_type, ', ')
  into v_extra
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('payroll_periods', 'payroll_period_entries')
    and (
      grantee = 'anon'
      or (grantee = 'authenticated' and privilege_type <> 'SELECT')
    );

  if v_extra is not null then
    raise exception 'лишние права на таблицах периодов: %', v_extra;
  end if;
end;
$$;

commit;
