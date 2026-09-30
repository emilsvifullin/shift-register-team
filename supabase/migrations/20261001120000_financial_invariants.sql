-- Финансовые гарантии — на сервере, а не только в интерфейсе.
--
-- До этой миграции правила расчётного периода держались в двух местах
-- по-разному. Интерфейс не давал закрыть непроверенный период, записать
-- выплату сверх остатка или пропустить смену закрытого периода, а прямой
-- вызов RPC принимал всё это. Кроме того, несколько путей обходили
-- защиту закрытого периода целиком:
--
--   * удаление ПВЗ стирало его смены за любые периоды, в том числе
--     закрытые и выплаченные, без согласия и без следа в истории;
--   * импорт старых смен писал в закрытый период молча;
--   * правка смены проверяла только период по её дате, хотя деньги
--     смены переходят и в другую половину месяца: у ПВЗ с авансом
--     заработанное сверх лимита уходит в расчёт 10-го, штраф может быть
--     нацелен на другую выплату;
--   * удаление сотрудника каскадом уносило его выплаты и строки снимков
--     закрытых периодов. Защищали от этого только смены, а они
--     удаляемы — сначала смены, потом сотрудник, и факты выплат исчезали.
--
-- Правило теперь одно: всё, что меняет деньги закрытого или
-- выплаченного периода — по дате смены или по сумме, — сервер
-- отказывает по умолчанию. Одиночная правка проходит с явным согласием
-- и попадает в историю (как и было); массовые и разрушительные пути —
-- удаление ПВЗ, импорт — отказывают без исключений: сначала период
-- возвращают в работу.
--
-- Как сервер знает, сколько причитается. Расчёт — payouts() в
-- src/domain.js, и источником он остаётся: снимок закрытия собирает
-- клиент. Но проверить присланное, не умея считать, нельзя. Поэтому
-- private.payroll_period_figures повторяет ту же арифметику ровно для
-- одного ответа — сверки. Разойтись незаметно они не могут: db-tests/
-- прогоняют обе реализации на одних и тех же сменах, и расхождение
-- валит CI. А если бы разошлись в production, сервер отказал бы в
-- проверке периода, а не записал бы неверную сумму.
--
-- Деньги — копейки. Все суммы в базе numeric(12,2); выплата с третьим
-- знаком после запятой раньше тихо округлялась типом столбца, теперь
-- отклоняется. История показывает копейки, если они есть.
--
-- Уже записанные суммы, события и снимки не меняются.
begin;

-- ---------------------------------------------------------------------
-- Сколько причитается: payouts() для одного сотрудника и половины месяца
-- ---------------------------------------------------------------------

/*
  Та же арифметика, что payouts() и periodEntry() в клиенте, строка в
  строку:

  * деньги смены — base_amount, сумма премий и сумма штрафов;
  * ПВЗ с авансом — по снимку тарифа смены (advanceEnabled), а если его
    там нет — по флагу пункта, как делает mapServerShift;
  * у ПВЗ с авансом база первой половины платится 25-го не больше
    ADVANCE_CAP (20 000), остаток и все премии — 10-го;
  * штраф без адресата ложится в выплату 10-го у ПВЗ с авансом и у
    смены после 15-го, иначе — 25-го; адресованный — куда адресован, а
    штраф на 25-е сверх того, что 25-го платится, переносится на 10-е.

  Смен в строке — только те, чья дата внутри половины: деньги у
  аванса уходят в другую выплату, а рабочий день остаётся на месте.
*/
create or replace function private.payroll_period_figures(
  p_employee_id uuid,
  p_period_month date,
  p_payout_kind text
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

/*
  Строки периода — кто в нём и на какие суммы: buildPeriodEntries()
  клиента. Сотрудник попадает в период, если у него там смены, выплаты
  или хоть какие-то деньги; подменная карточка не попадает никогда.
*/
create or replace function private.payroll_period_entries(
  p_period_month date,
  p_payout_kind text
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employeeId', e.id,
        'shifts', f.shifts,
        'base', f.base,
        'bonus', f.bonus,
        'fine', f.fine,
        'due', f.due,
        'paid', round(pay.amount, 2)
      )
      order by e.id::text collate "C"
    ),
    '[]'::jsonb
  )
  from public.employees e
  cross join lateral private.payroll_period_figures(
    e.id,
    p_period_month,
    p_payout_kind
  ) f
  cross join lateral (
    select
      count(*) as records,
      coalesce(sum(ep.amount), 0) as amount
    from public.employee_payouts ep
    where ep.employee_id = e.id
      and ep.period_month = p_period_month
      and ep.payout_kind = p_payout_kind
  ) pay
  where not e.is_system_substitute
    and (
      f.shifts > 0 or
      pay.records > 0 or
      f.base <> 0 or
      f.bonus <> 0 or
      f.fine <> 0 or
      f.due <> 0
    );
$$;

/*
  Число в отпечатке — так, как его пишет String() в JavaScript после
  округления до копейки: 1500, 1500.5, 0.1, -100.5, и ноль без знака.
*/
create or replace function private.fingerprint_number(p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when round(coalesce(p_value, 0), 2) = 0 then '0'
    else trim_scale(round(p_value, 2))::text
  end;
$$;

/*
  Отпечаток периода — periodFingerprint() клиента: строки по сотруднику
  в порядке идентификатора, поля через двоеточие, строки через черту.
*/
create or replace function private.period_fingerprint(p_entries jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    string_agg(
      concat_ws(
        ':',
        item ->> 'employeeId',
        coalesce((item ->> 'shifts')::integer, 0)::text,
        private.fingerprint_number((item ->> 'base')::numeric),
        private.fingerprint_number((item ->> 'bonus')::numeric),
        private.fingerprint_number((item ->> 'fine')::numeric),
        private.fingerprint_number((item ->> 'due')::numeric),
        private.fingerprint_number((item ->> 'paid')::numeric)
      ),
      '|'
      order by (item ->> 'employeeId') collate "C"
    ),
    ''
  )
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) item;
$$;

/*
  Деньги сотрудника за месяц по обеим половинам — чтобы сравнить до и
  после изменения.
*/
create or replace function private.month_figures(
  p_employee_id uuid,
  p_period_month date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_object_agg(
    kind,
    (
      select jsonb_build_object(
        'base', f.base,
        'bonus', f.bonus,
        'fine', f.fine,
        'due', f.due
      )
      from private.payroll_period_figures(
        p_employee_id,
        p_period_month,
        kind
      ) f
    )
  )
  from unnest(array['first_half', 'second_half']) kind;
$$;

/*
  Изменение, задевшее деньги закрытого периода не по дате, а по сумме.

  Смена 10-го числа на ПВЗ с авансом меняет и выплату 10-го следующего
  месяца: если тот период закрыт, правка переписывает его деньги, хотя
  дата смены лежит в открытом. Период, уже проверенный по дате,
  пропускается (p_skip_kinds): согласие на него уже спрошено и
  записано.
*/
create or replace function private.assert_month_effect(
  p_before jsonb,
  p_employee_id uuid,
  p_period_month date,
  p_skip_kinds text[],
  p_force boolean,
  p_what text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_after jsonb := private.month_figures(p_employee_id, p_period_month);
  v_kind text;
  v_status text;
begin
  foreach v_kind in array array['first_half', 'second_half']
  loop
    if
      v_kind = any(coalesce(p_skip_kinds, '{}'::text[])) or
      (p_before -> v_kind) = (v_after -> v_kind)
    then
      continue;
    end if;

    select status
    into v_status
    from public.payroll_periods
    where period_month = p_period_month
      and payout_kind = v_kind;

    if v_status is null or v_status in ('open', 'checked') then
      continue;
    end if;

    if not coalesce(p_force, false) then
      raise exception 'payroll_period_closed:%:%:%', p_period_month, v_kind, v_status
        using errcode = '22023';
    end if;

    perform private.record_payroll_event(
      p_period_month,
      v_kind,
      p_employee_id,
      'closed_period_change',
      p_what,
      p_reason,
      (v_after -> v_kind ->> 'due')::numeric -
        (p_before -> v_kind ->> 'due')::numeric,
      v_status,
      '{}'::jsonb
    );
  end loop;
end;
$$;

revoke all on function private.payroll_period_figures(uuid, date, text)
  from public, anon, authenticated;
revoke all on function private.payroll_period_entries(date, text)
  from public, anon, authenticated;
revoke all on function private.fingerprint_number(numeric)
  from public, anon, authenticated;
revoke all on function private.period_fingerprint(jsonb)
  from public, anon, authenticated;
revoke all on function private.month_figures(uuid, date)
  from public, anon, authenticated;
revoke all on function private.assert_month_effect(jsonb, uuid, date, text[], boolean, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Переходы периода
-- ---------------------------------------------------------------------

/*
  «Проверено» — это утверждение о цифрах. Клиент присылает отпечаток
  того, что видел человек; сервер принимает его, только если это и есть
  цифры периода сейчас.
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

  if
    p_fingerprint is distinct from private.period_fingerprint(
      private.payroll_period_entries(p_period_month, p_payout_kind)
    )
  then
    raise exception 'payroll_period_figures_mismatch'
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
  Закрыть можно только проверенный период и только на те цифры, что
  проверяли: если после проверки что-то изменилось, период сначала
  проверяют заново. Снимок записывается тот, что прислан, — с разбивкой
  и именами для показа, — но его суммы обязаны совпасть с серверными.
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

  select *
  into v_period
  from public.payroll_periods
  where id = v_period.id
  for update;

  if v_period.status in ('closed', 'paid') then
    raise exception 'payroll_period_already_closed'
      using errcode = '22023';
  end if;

  if v_period.status <> 'checked' then
    raise exception 'payroll_period_not_checked'
      using errcode = '22023';
  end if;

  if
    v_period.checked_fingerprint is distinct from private.period_fingerprint(
      private.payroll_period_entries(p_period_month, p_payout_kind)
    )
  then
    raise exception 'payroll_period_changed_since_check'
      using errcode = '22023';
  end if;

  if
    v_period.checked_fingerprint is distinct from
      private.period_fingerprint(p_entries)
  then
    raise exception 'payroll_period_figures_mismatch'
      using errcode = '22023';
  end if;

  delete from public.payroll_period_entries
  where period_id = v_period.id;

  for v_entry in
    select value
    from jsonb_array_elements(p_entries)
  loop
    v_employee := (v_entry ->> 'employeeId')::uuid;

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

-- ---------------------------------------------------------------------
-- Выплаты
-- ---------------------------------------------------------------------

/*
  Выплата — факт перевода денег, и сервер принимает только такой,
  который мог случиться:

  * сумма больше нуля, в копейках, не больше 10 000 000;
  * дата — настоящая, а не 1900 или 2999 год;
  * вместе с уже записанными выплатами за эту половину месяца она не
    превышает причитающегося. Переплата остаётся возможной как
    следствие — если расчёт уменьшили после выплаты, — но не как
    действие: записать её нельзя, а уже возникшую — только уменьшить.

  Выплату в выплаченный период по-прежнему пропускает только согласие.
*/
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
  v_due numeric;
  v_other numeric;
  v_previous numeric := 0;
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

  select status
  into v_status
  from public.payroll_periods
  where period_month = p_period_month
    and payout_kind = p_payout_kind;

  if v_status = 'paid' and not coalesce(p_force, false) then
    raise exception 'payroll_period_closed:%:%:%', p_period_month, p_payout_kind, v_status
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
    select amount
    into v_previous
    from public.employee_payouts
    where id = p_payout_id;

    v_previous := coalesce(v_previous, 0);
  end if;

  if v_other + p_amount > greatest(v_due, v_other + v_previous) then
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

-- ---------------------------------------------------------------------
-- Смены: деньги соседней половины месяца
-- ---------------------------------------------------------------------

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
  v_found boolean;
  v_new_month date := date_trunc('month', p_shift_date)::date;
  v_old_month date;
  v_skip_new text[];
  v_skip_old text[];
  v_before_new jsonb;
  v_before_old jsonb;
  v_id uuid;
  v_what text;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if p_shift_date is null then
    raise exception 'invalid_shift_date'
      using errcode = '22023';
  end if;

  select *
  into v_existing
  from public.shifts
  where id = p_shift_id;

  v_found := found;

  v_what := case
    when v_found then 'смена изменена'
    else 'смена добавлена'
  end;

  /*
    Периоды, согласие на которые уже спрашивает проверка по дате: новый
    день смены и, если смену переносят, прежний. Деньги в них сверять
    второй раз незачем — остальные половины месяца сверяются по сумме.
  */
  v_skip_new := array[private.period_kind_for_date(p_shift_date)];

  if v_found then
    v_old_month := date_trunc('month', v_existing.shift_date)::date;

    v_skip_old := case
      when v_existing.shift_date is distinct from p_shift_date
        then array[private.period_kind_for_date(v_existing.shift_date)]
      else '{}'::text[]
    end;

    if v_old_month = v_new_month then
      v_skip_new := v_skip_new || v_skip_old;
      v_skip_old := v_skip_new;
    end if;

    v_before_old := private.month_figures(
      v_existing.employee_id,
      v_old_month
    );
  end if;

  if p_employee_id is not null then
    v_before_new := private.month_figures(p_employee_id, v_new_month);
  end if;

  if v_found and v_existing.shift_date is distinct from p_shift_date then
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
    v_what,
    p_employee_id,
    p_reason,
    null
  );

  v_id := public.admin_save_shift_v3(
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

  if v_before_new is not null then
    perform private.assert_month_effect(
      v_before_new,
      p_employee_id,
      v_new_month,
      v_skip_new,
      p_force,
      v_what,
      p_reason
    );
  end if;

  if
    v_found and
    (
      v_existing.employee_id is distinct from p_employee_id or
      v_old_month <> v_new_month
    )
  then
    perform private.assert_month_effect(
      v_before_old,
      v_existing.employee_id,
      v_old_month,
      v_skip_old,
      p_force,
      v_what,
      p_reason
    );
  end if;

  return v_id;
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
  v_month date;
  v_before jsonb;
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

  v_month := date_trunc('month', v_shift.shift_date)::date;
  v_before := private.month_figures(v_shift.employee_id, v_month);

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

  perform private.assert_month_effect(
    v_before,
    v_shift.employee_id,
    v_month,
    array[private.period_kind_for_date(v_shift.shift_date)],
    p_force,
    'смена удалена',
    p_reason
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
  v_before jsonb;
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

  v_month := date_trunc('month', v_shift.shift_date)::date;
  v_kind := private.period_kind_for_date(v_shift.shift_date);
  v_before := private.month_figures(v_shift.employee_id, v_month);

  perform private.assert_period_open(
    v_shift.shift_date,
    p_force,
    'смена пересчитана',
    v_shift.employee_id,
    p_reason,
    null
  );

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

  perform private.assert_month_effect(
    v_before,
    v_shift.employee_id,
    v_month,
    array[v_kind],
    p_force,
    'смена пересчитана',
    p_reason
  );

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- Импорт и удаление ПВЗ: без исключений для закрытых периодов
-- ---------------------------------------------------------------------

/*
  Импорт переносит старые записи — это не исправление ошибки, ради
  которого закрытый период можно открыть согласием. Закрытый период он
  не трогает вовсе: ни днём смены, ни деньгами соседней половины.
*/
create or replace function public.admin_import_legacy_shift(
  p_legacy_source_id text,
  p_employee_id uuid,
  p_point_id uuid,
  p_shift_date date,
  p_shift_type text,
  p_shk integer,
  p_partial boolean,
  p_hours numeric,
  p_full_hours numeric,
  p_base_amount numeric,
  p_pricing_snapshot jsonb,
  p_bonuses jsonb,
  p_penalties jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_rate numeric;
  v_expected_base numeric;
  v_month date;
  v_before jsonb;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if
    p_legacy_source_id is null or
    length(trim(p_legacy_source_id)) = 0 or
    length(p_legacy_source_id) > 200 or
    p_shift_date is null or
    p_shift_type not in ('main', 'extra') or
    p_full_hours <> 12 or
    jsonb_typeof(p_pricing_snapshot) <> 'object'
  then
    raise exception 'invalid_legacy_shift'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
  ) or not exists (
    select 1
    from public.points p
    where p.id = p_point_id
  ) then
    raise exception 'legacy_reference_not_found'
      using errcode = '23503';
  end if;

  if p_partial then
    if
      p_hours is null or
      p_hours < 0.5 or
      p_hours >= 12 or
      p_hours * 2 <> trunc(p_hours * 2)
    then
      raise exception 'invalid_partial_hours'
        using errcode = '22023';
    end if;
  end if;

  v_rate := (p_pricing_snapshot ->> 'rate')::numeric;
  v_expected_base := case
    when p_partial then round(v_rate / 12 * p_hours)
    else v_rate
  end;

  if
    v_rate < 0 or
    v_rate > 10000000 or
    p_base_amount is distinct from v_expected_base
  then
    raise exception 'legacy_pricing_mismatch'
      using errcode = '22023';
  end if;

  select s.id
  into v_id
  from public.shifts s
  where s.employee_id = p_employee_id
    and s.legacy_source_id = p_legacy_source_id;

  if v_id is not null then
    return v_id;
  end if;

  perform private.assert_period_open(
    p_shift_date,
    false,
    'импорт смены',
    p_employee_id,
    null,
    null
  );

  v_month := date_trunc('month', p_shift_date)::date;
  v_before := private.month_figures(p_employee_id, v_month);

  v_id := gen_random_uuid();

  insert into public.shifts(
    id,
    employee_id,
    shift_date,
    point_id,
    shift_type,
    shk,
    partial,
    hours,
    full_hours,
    base_amount,
    pricing_snapshot,
    legacy_source_id,
    created_by,
    updated_by
  ) values (
    v_id,
    p_employee_id,
    p_shift_date,
    p_point_id,
    p_shift_type,
    p_shk,
    p_partial,
    case when p_partial then p_hours else null end,
    p_full_hours,
    p_base_amount,
    p_pricing_snapshot || jsonb_build_object('legacy', true),
    p_legacy_source_id,
    auth.uid(),
    auth.uid()
  );

  perform private.replace_shift_adjustments(
    v_id,
    p_bonuses,
    p_penalties
  );

  perform private.assert_month_effect(
    v_before,
    p_employee_id,
    v_month,
    '{}'::text[],
    false,
    'импорт смены',
    null
  );

  return v_id;
end;
$$;

/*
  Удаление ПВЗ уносит его смены. Пока период открыт, это решение
  администратора, подтверждённое вводом названия. Закрытый или
  выплаченный период так не переписывается: удаление отказывает, пока
  такие периоды не вернут в работу, — и когда смены там лежат по дате,
  и когда от них зависят деньги соседней половины месяца.
*/
create or replace function public.admin_delete_point_cascade(
  p_point_id uuid,
  p_point_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_point public.points%rowtype;
  v_shifts integer;
  v_bonuses integer;
  v_penalties integer;
  v_links integer;
  v_tariffs integer;
  v_closed record;
  v_pair record;
  v_before jsonb := '{}'::jsonb;
  v_key text;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select *
  into v_point
  from public.points
  where id = p_point_id
  for update;

  if not found then
    raise exception 'point_not_found'
      using errcode = 'P0002';
  end if;

  if
    lower(btrim(coalesce(p_point_name, ''))) is distinct from
    lower(btrim(v_point.name))
  then
    raise exception 'point_name_mismatch'
      using errcode = '22023';
  end if;

  select
    pp.period_month,
    pp.payout_kind,
    pp.status
  into v_closed
  from public.shifts s
  join public.payroll_periods pp
    on pp.period_month = date_trunc('month', s.shift_date)::date
   and pp.payout_kind = private.period_kind_for_date(s.shift_date)
  where s.point_id = p_point_id
    and pp.status in ('closed', 'paid')
  order by pp.period_month, pp.payout_kind
  limit 1;

  if found then
    raise exception 'point_has_closed_period:%:%:%',
      v_closed.period_month,
      v_closed.payout_kind,
      v_closed.status
      using errcode = '22023';
  end if;

  for v_pair in
    select distinct
      s.employee_id,
      date_trunc('month', s.shift_date)::date as period_month
    from public.shifts s
    where s.point_id = p_point_id
  loop
    v_before := v_before || jsonb_build_object(
      v_pair.employee_id::text || '|' || v_pair.period_month::text,
      private.month_figures(v_pair.employee_id, v_pair.period_month)
    );
  end loop;

  select count(*)
  into v_shifts
  from public.shifts
  where point_id = p_point_id;

  select count(*)
  into v_bonuses
  from public.shift_bonuses b
  join public.shifts s on s.id = b.shift_id
  where s.point_id = p_point_id;

  select count(*)
  into v_penalties
  from public.shift_penalties p
  join public.shifts s on s.id = p.shift_id
  where s.point_id = p_point_id;

  select count(*)
  into v_links
  from public.employee_points
  where point_id = p_point_id;

  select count(*)
  into v_tariffs
  from public.point_tariffs
  where point_id = p_point_id;

  -- Смены первыми: связь points <- shifts стоит на restrict. Премии и
  -- штрафы уходят каскадом от самих смен.
  delete from public.shifts
  where point_id = p_point_id;

  for v_key in
    select jsonb_object_keys(v_before)
  loop
    perform private.assert_month_effect(
      v_before -> v_key,
      split_part(v_key, '|', 1)::uuid,
      split_part(v_key, '|', 2)::date,
      '{}'::text[],
      false,
      'удаление ПВЗ',
      null
    );
  end loop;

  -- Назначения сотрудников и история тарифов уходят каскадом отсюда.
  delete from public.points
  where id = p_point_id;

  return jsonb_build_object(
    'point_id', p_point_id,
    'name', v_point.name,
    'shifts', v_shifts,
    'bonuses', v_bonuses,
    'penalties', v_penalties,
    'employee_points', v_links,
    'tariffs', v_tariffs
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Сотрудник с финансовой историей не удаляется
-- ---------------------------------------------------------------------

/*
  Каскад employee_payouts и payroll_period_entries от сотрудника уносил
  факты выплат и строки снимков закрытых периодов. Теперь их удаление
  через сотрудника невозможно на уровне ключа, а функции удаления
  отвечают тем же отказом, что и на смены, — раньше, чем до ключа
  дойдёт дело.
*/
alter table public.employee_payouts
  drop constraint employee_payouts_employee_id_fkey,
  add constraint employee_payouts_employee_id_fkey
    foreign key (employee_id)
    references public.employees(id)
    on delete restrict;

alter table public.payroll_period_entries
  drop constraint payroll_period_entries_employee_id_fkey,
  add constraint payroll_period_entries_employee_id_fkey
    foreign key (employee_id)
    references public.employees(id)
    on delete restrict;

/*
  Финансовая история сотрудника: смены, выплаты, строки снимков и
  события расчёта. События об индивидуальной ставке сюда не входят —
  ставка без смен денег не двигала.
*/
create or replace function private.employee_has_financial_history(
  p_employee_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    exists (
      select 1 from public.shifts where employee_id = p_employee_id
    ) or
    exists (
      select 1 from public.employee_payouts where employee_id = p_employee_id
    ) or
    exists (
      select 1 from public.payroll_period_entries where employee_id = p_employee_id
    ) or
    exists (
      select 1
      from public.payroll_events
      where employee_id = p_employee_id
        and kind not like 'rate\_%'
    );
$$;

revoke all on function private.employee_has_financial_history(uuid)
  from public, anon, authenticated;

create or replace function public.admin_begin_employee_deletion(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  lock table public.shifts
  in share row exclusive mode;

  lock table public.employee_payouts
  in share row exclusive mode;

  select *
  into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception 'employee_not_found'
      using errcode = 'P0002';
  end if;

  if v_employee.deletion_pending then
    return v_employee.user_id;
  end if;

  if private.employee_has_financial_history(p_employee_id) then
    raise exception 'employee_has_history'
      using errcode = '23503';
  end if;

  if
    v_employee.user_id is not null and
    exists (
      select 1
      from public.profiles p
      where p.id = v_employee.user_id
        and p.role = 'admin'
    )
  then
    raise exception 'admin_account_protected'
      using errcode = '55000';
  end if;

  update public.employees e
  set
    deletion_previous_status = e.status,
    deletion_pending = true,
    status = 'inactive',
    updated_by = auth.uid()
  where e.id = p_employee_id;

  return v_employee.user_id;
end;
$$;

create or replace function public.admin_finalize_employee_deletion(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  lock table public.shifts
  in share row exclusive mode;

  lock table public.employee_payouts
  in share row exclusive mode;

  select *
  into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception 'employee_not_found'
      using errcode = 'P0002';
  end if;

  if not v_employee.deletion_pending then
    raise exception 'employee_deletion_not_started'
      using errcode = '55000';
  end if;

  if private.employee_has_financial_history(p_employee_id) then
    raise exception 'employee_has_history'
      using errcode = '23503';
  end if;

  if v_employee.user_id is not null then
    raise exception 'employee_auth_cleanup_required'
      using errcode = '55000';
  end if;

  delete from public.employees e
  where e.id = p_employee_id;

  return p_employee_id;
end;
$$;

create or replace function public.admin_rollback_employee_creation(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  lock table public.shifts
  in share row exclusive mode;

  select *
  into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    return p_employee_id;
  end if;

  if
    v_employee.user_id is not null or
    v_employee.deletion_pending or
    v_employee.created_by is distinct from auth.uid() or
    private.employee_has_financial_history(p_employee_id)
  then
    raise exception 'employee_creation_rollback_forbidden'
      using errcode = '55000';
  end if;

  delete from public.employees e
  where e.id = p_employee_id;

  return p_employee_id;
end;
$$;

-- ---------------------------------------------------------------------
-- История показывает копейки
-- ---------------------------------------------------------------------

/*
  Сумма в строке истории: 1 500 — целая, 1 500,50 — с копейками. Раньше
  копейки округлялись до рубля, и строка пересчёта «1 500 → 1 501 ₽»
  расходилась с суммой рядом с ней.
*/
create or replace function private.money_text(p_amount numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    replace(
      replace(
        to_char(round(coalesce(p_amount, 0), 2), 'FM9,999,999,990.00'),
        ',',
        U&'\00A0'
      ),
      '.',
      ','
    ),
    ',00$',
    ''
  );
$$;

commit;
