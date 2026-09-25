-- Закрытый период не переписывается молча.
--
-- Закрытие фиксирует расчёт, но ошибка может обнаружиться и после него —
-- запрещать правки насовсем значит заставлять жить с неверной зарплатой.
-- Поэтому правка остаётся возможной, но перестаёт быть обычной: сервер
-- отказывает по умолчанию, а согласие приходит отдельным доводом и
-- записывается в историю.
--
-- Что считается вмешательством в закрытый период: смена с датой внутри
-- него (сохранение, пересчёт, удаление) и выплата за него. Изменение
-- тарифа или индивидуальной ставки сюда не входит — само по себе оно
-- денег периода не меняет; меняет их пересчёт смен, и он через эту
-- проверку проходит.
--
-- История здесь же: без неё «исправить можно» превращается в «исправили,
-- и никто не знает». payroll_events пишет человеческую строку, а не
-- разницу строк таблицы: другой администратор должен открыть период и
-- увидеть, что после закрытия расчёт меняли, кто и на что.
begin;

create table public.payroll_events (
  id uuid primary key default gen_random_uuid(),

  period_month date
    check (
      period_month is null or
      period_month = date_trunc('month', period_month)::date
    ),
  payout_kind text
    check (
      payout_kind is null or
      payout_kind in ('first_half', 'second_half')
    ),
  employee_id uuid
    references public.employees(id) on delete set null,

  kind text not null,
  summary text not null,
  reason text,

  -- Финансовый эффект события, если он у него есть.
  effect numeric(12,2),

  -- Состояние периода в момент действия: до закрытия или после.
  period_status text,

  details jsonb not null default '{}'::jsonb,

  occurred_at timestamptz not null default now(),
  actor uuid references auth.users(id) on delete set null
);

comment on table public.payroll_events is
  'Человекочитаемая история финансовых действий: что изменилось, когда, кем и до или после закрытия периода.';

create index payroll_events_period_idx
  on public.payroll_events(
    period_month desc,
    payout_kind,
    occurred_at desc
  );

create index payroll_events_employee_idx
  on public.payroll_events(employee_id, occurred_at desc);

alter table public.payroll_events enable row level security;

create policy payroll_events_select
  on public.payroll_events
  for select
  to authenticated
  using ((select private.is_admin()));

revoke all on table public.payroll_events
  from anon, authenticated;

grant select on table public.payroll_events
  to authenticated;

create or replace function private.record_payroll_event(
  p_period_month date,
  p_payout_kind text,
  p_employee_id uuid,
  p_kind text,
  p_summary text,
  p_reason text default null,
  p_effect numeric default null,
  p_period_status text default null,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.payroll_events(
    period_month,
    payout_kind,
    employee_id,
    kind,
    summary,
    reason,
    effect,
    period_status,
    details,
    actor
  ) values (
    p_period_month,
    p_payout_kind,
    p_employee_id,
    p_kind,
    p_summary,
    nullif(trim(coalesce(p_reason, '')), ''),
    p_effect,
    p_period_status,
    coalesce(p_details, '{}'::jsonb),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function private.record_payroll_event(
  date, text, uuid, text, text, text, numeric, text, jsonb
) from public, anon, authenticated;

/* Половина месяца, к которой относится день. */
create or replace function private.period_kind_for_date(p_date date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when extract(day from p_date) <= 15
      then 'first_half'
    else 'second_half'
  end;
$$;

/*
  Пропустить изменение в закрытом периоде только с явного согласия.

  Без согласия — отказ с кодом, по которому клиент показывает, что
  именно будет затронуто. С согласием — запись в историю: она и есть
  разница между «исправили осознанно» и «переписали молча».
*/
create or replace function private.assert_period_open(
  p_date date,
  p_force boolean,
  p_what text,
  p_employee_id uuid default null,
  p_reason text default null,
  p_effect numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_date)::date;
  v_kind text := private.period_kind_for_date(p_date);
  v_status text;
begin
  select status
  into v_status
  from public.payroll_periods
  where period_month = v_month
    and payout_kind = v_kind;

  if v_status is null or v_status in ('open', 'checked') then
    return;
  end if;

  if not coalesce(p_force, false) then
    raise exception 'payroll_period_closed:%:%:%', v_month, v_kind, v_status
      using errcode = '22023';
  end if;

  perform private.record_payroll_event(
    v_month,
    v_kind,
    p_employee_id,
    'closed_period_change',
    p_what,
    p_reason,
    p_effect,
    v_status,
    jsonb_build_object('date', p_date)
  );
end;
$$;

revoke all on function private.assert_period_open(
  date, boolean, text, uuid, text, numeric
) from public, anon, authenticated;

/*
  Сохранение смены с учётом состояния периода.

  Проверяются оба периода: тот, куда смена переезжает, и тот, откуда она
  уходит, — перенос даты из закрытого периода меняет его так же, как
  правка внутри него.
*/
create or replace function public.admin_save_shift_v4(
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
  p_penalties jsonb,
  p_base_amount_override numeric,
  p_base_amount_reason text,
  p_force boolean default false,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.shifts%rowtype;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select *
  into v_existing
  from public.shifts
  where id = p_shift_id;

  if found and v_existing.shift_date is distinct from p_shift_date then
    perform private.assert_period_open(
      v_existing.shift_date,
      p_force,
      'смена перенесена с ' || to_char(v_existing.shift_date, 'DD.MM.YYYY'),
      v_existing.employee_id,
      p_reason,
      -v_existing.base_amount
    );
  end if;

  perform private.assert_period_open(
    p_shift_date,
    p_force,
    case
      when found then 'смена изменена'
      else 'смена добавлена'
    end,
    p_employee_id,
    p_reason,
    null
  );

  return public.admin_save_shift_v3(
    p_shift_id,
    p_employee_id,
    p_shift_date,
    p_point_id,
    p_shift_type,
    p_shk,
    p_partial,
    p_hours,
    p_note,
    p_bonuses,
    p_penalties,
    p_base_amount_override,
    p_base_amount_reason
  );
end;
$$;

create or replace function public.admin_delete_shift_v2(
  p_shift_id uuid,
  p_force boolean default false,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
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
    'смена удалена',
    v_shift.employee_id,
    p_reason,
    -v_shift.base_amount
  );

  delete from public.shifts
  where id = p_shift_id;
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

  v_result := public.admin_reprice_shift(p_shift_id);

  perform private.record_payroll_event(
    date_trunc('month', v_shift.shift_date)::date,
    private.period_kind_for_date(v_shift.shift_date),
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
    null,
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
      to_char(p_amount, 'FM999999990') ||
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
      to_char(v_payout.amount, 'FM999999990') ||
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
revoke all on function public.admin_save_employee_payout_v2(
  uuid, uuid, date, text, numeric, date, text, boolean, text
) from public, anon;
revoke all on function public.admin_delete_employee_payout_v2(uuid, boolean, text)
  from public, anon;

grant execute on function public.admin_save_shift_v4(
  uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb, numeric, text, boolean, text
) to authenticated;
grant execute on function public.admin_delete_shift_v2(uuid, boolean, text)
  to authenticated;
grant execute on function public.admin_reprice_shift_v2(uuid, boolean, text)
  to authenticated;
grant execute on function public.admin_save_employee_payout_v2(
  uuid, uuid, date, text, numeric, date, text, boolean, text
) to authenticated;
grant execute on function public.admin_delete_employee_payout_v2(uuid, boolean, text)
  to authenticated;

do $$
declare
  v_extra text;
begin
  select string_agg(distinct privilege_type, ', ')
  into v_extra
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'payroll_events'
    and (
      grantee = 'anon'
      or (grantee = 'authenticated' and privilege_type <> 'SELECT')
    );

  if v_extra is not null then
    raise exception 'лишние права на payroll_events: %', v_extra;
  end if;
end;
$$;

commit;
