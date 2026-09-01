-- Applied to the linked Supabase project under this migration version.
create table public.employee_payouts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null
    references public.employees(id) on delete restrict,
  period_month date not null
    check (period_month = date_trunc('month', period_month)::date),
  payout_kind text not null
    check (payout_kind in ('first_half', 'final')),
  amount numeric(12,2) not null
    check (amount > 0),
  paid_on date not null,
  comment text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (comment is null or length(trim(comment)) <= 500)
);

create index employee_payouts_employee_period_idx
  on public.employee_payouts(
    employee_id,
    period_month desc,
    payout_kind,
    paid_on desc
  );

create index employee_payouts_created_by_idx
  on public.employee_payouts(created_by);

create index employee_payouts_updated_by_idx
  on public.employee_payouts(updated_by);

alter table public.employee_payouts enable row level security;

create policy employee_payouts_select
  on public.employee_payouts
  for select
  to authenticated
  using (
    (select private.is_admin()) or
    (
      exists (
        select 1
        from public.employees e
        where e.id = employee_payouts.employee_id
          and e.user_id = (select auth.uid())
          and e.status = 'active'
      )
    )
  );

create trigger employee_payouts_set_updated_at
  before update on public.employee_payouts
  for each row
  execute function public.set_updated_at();

create trigger employee_payouts_audit
  after insert or update or delete on public.employee_payouts
  for each row
  execute function public.write_audit_log();

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
    p_employee_id is null or
    not exists (
      select 1
      from public.employees e
      where e.id = p_employee_id
    ) or
    p_period_month is null or
    p_period_month <> date_trunc('month', p_period_month)::date or
    p_payout_kind not in ('first_half', 'final') or
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

create or replace function public.admin_delete_employee_payout(
  p_payout_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  delete from public.employee_payouts
  where id = p_payout_id;

  if not found then
    raise exception 'employee_payout_not_found'
      using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_update_point_tariff(
  p_tariff_id uuid,
  p_effective_from date,
  p_pricing_type text,
  p_fixed_rate numeric,
  p_shk_tiers jsonb
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

  if p_tariff_id is null or p_effective_from is null then
    raise exception 'invalid_tariff_point_or_date'
      using errcode = '22023';
  end if;

  perform private.validate_tariff_payload(
    p_pricing_type,
    p_fixed_rate,
    p_shk_tiers
  );

  update public.point_tariffs
  set
    effective_from = p_effective_from,
    pricing_type = p_pricing_type,
    fixed_rate = p_fixed_rate,
    shk_tiers = p_shk_tiers,
    updated_by = auth.uid()
  where id = p_tariff_id
  returning id into v_id;

  if v_id is null then
    raise exception 'tariff_not_found'
      using errcode = 'P0002';
  end if;

  return v_id;
end;
$$;

create or replace function public.admin_delete_point_tariff(
  p_tariff_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_point_id uuid;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select point_id
  into v_point_id
  from public.point_tariffs
  where id = p_tariff_id;

  if v_point_id is null then
    raise exception 'tariff_not_found'
      using errcode = 'P0002';
  end if;

  if (
    select count(*)
    from public.point_tariffs
    where point_id = v_point_id
  ) <= 1 then
    raise exception 'last_tariff_required'
      using errcode = '23514';
  end if;

  delete from public.point_tariffs
  where id = p_tariff_id;
end;
$$;

revoke all on table public.employee_payouts
  from public, anon, authenticated;
grant select on table public.employee_payouts
  to authenticated;

revoke all on function public.admin_save_employee_payout(
  uuid, uuid, date, text, numeric, date, text
) from public, anon;
revoke all on function public.admin_delete_employee_payout(uuid)
  from public, anon;
revoke all on function public.admin_update_point_tariff(
  uuid, date, text, numeric, jsonb
) from public, anon;
revoke all on function public.admin_delete_point_tariff(uuid)
  from public, anon;

grant execute on function public.admin_save_employee_payout(
  uuid, uuid, date, text, numeric, date, text
) to authenticated;
grant execute on function public.admin_delete_employee_payout(uuid)
  to authenticated;
grant execute on function public.admin_update_point_tariff(
  uuid, date, text, numeric, jsonb
) to authenticated;
grant execute on function public.admin_delete_point_tariff(uuid)
  to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'employee_payouts'
  ) then
    alter publication supabase_realtime
      add table public.employee_payouts;
  end if;
end;
$$;
