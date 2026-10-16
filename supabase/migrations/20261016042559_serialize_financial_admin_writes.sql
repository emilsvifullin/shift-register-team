/*
  Serialize administrative writes before reading financial state or locking
  any domain row. A shift can affect both halves and two different months;
  one transaction lock gives every supported writer the same lock order.
  Reads stay concurrent. This deliberately trades parallel admin writes
  for correctness; do not add a new write RPC without the same gateway.

  Existing implementations move to private with all client EXECUTE removed.
  Public signatures/defaults remain unchanged. The gateway checks the role,
  acquires the transaction lock, then invokes the original implementation.
  Transaction end (including errors/rollback) always releases the lock.
*/

create or replace function private.lock_financial_write()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(1936879986, 1);
end;
$$;
revoke all on function private.lock_financial_write() from public, anon, authenticated;

-- admin_add_employee_rate
alter function public.admin_add_employee_rate(uuid,uuid,date,text,numeric,jsonb) set schema private;
revoke all on function private.admin_add_employee_rate(uuid,uuid,date,text,numeric,jsonb) from public, anon, authenticated;

create function public.admin_add_employee_rate(
  p_employee_id uuid,
  p_point_id uuid,
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
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_add_employee_rate(p_employee_id, p_point_id, p_effective_from, p_pricing_type, p_fixed_rate, p_shk_tiers);
end;
$$;
revoke all on function public.admin_add_employee_rate(uuid,uuid,date,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.admin_add_employee_rate(uuid,uuid,date,text,numeric,jsonb) to authenticated;

-- admin_add_point_tariff
alter function public.admin_add_point_tariff(uuid,date,text,numeric,jsonb) set schema private;
revoke all on function private.admin_add_point_tariff(uuid,date,text,numeric,jsonb) from public, anon, authenticated;

create function public.admin_add_point_tariff(
  p_point_id uuid,
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
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_add_point_tariff(p_point_id, p_effective_from, p_pricing_type, p_fixed_rate, p_shk_tiers);
end;
$$;
revoke all on function public.admin_add_point_tariff(uuid,date,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.admin_add_point_tariff(uuid,date,text,numeric,jsonb) to authenticated;

-- admin_begin_employee_deletion
alter function public.admin_begin_employee_deletion(uuid) set schema private;
revoke all on function private.admin_begin_employee_deletion(uuid) from public, anon, authenticated;

create function public.admin_begin_employee_deletion(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_begin_employee_deletion(p_employee_id);
end;
$$;
revoke all on function public.admin_begin_employee_deletion(uuid) from public, anon, authenticated;
grant execute on function public.admin_begin_employee_deletion(uuid) to authenticated;

-- admin_cancel_employee_deletion
alter function public.admin_cancel_employee_deletion(uuid) set schema private;
revoke all on function private.admin_cancel_employee_deletion(uuid) from public, anon, authenticated;

create function public.admin_cancel_employee_deletion(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_cancel_employee_deletion(p_employee_id);
end;
$$;
revoke all on function public.admin_cancel_employee_deletion(uuid) from public, anon, authenticated;
grant execute on function public.admin_cancel_employee_deletion(uuid) to authenticated;

-- admin_check_payroll_period
alter function public.admin_check_payroll_period(date,text,text) set schema private;
revoke all on function private.admin_check_payroll_period(date,text,text) from public, anon, authenticated;

create function public.admin_check_payroll_period(
  p_period_month date,
  p_payout_kind text,
  p_fingerprint text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_check_payroll_period(p_period_month, p_payout_kind, p_fingerprint);
end;
$$;
revoke all on function public.admin_check_payroll_period(date,text,text) from public, anon, authenticated;
grant execute on function public.admin_check_payroll_period(date,text,text) to authenticated;

-- admin_close_payroll_period
alter function public.admin_close_payroll_period(date,text,jsonb) set schema private;
revoke all on function private.admin_close_payroll_period(date,text,jsonb) from public, anon, authenticated;

create function public.admin_close_payroll_period(
  p_period_month date,
  p_payout_kind text,
  p_entries jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_close_payroll_period(p_period_month, p_payout_kind, p_entries);
end;
$$;
revoke all on function public.admin_close_payroll_period(date,text,jsonb) from public, anon, authenticated;
grant execute on function public.admin_close_payroll_period(date,text,jsonb) to authenticated;

-- admin_delete_employee_payout_v2
alter function public.admin_delete_employee_payout_v2(uuid,boolean,text) set schema private;
revoke all on function private.admin_delete_employee_payout_v2(uuid,boolean,text) from public, anon, authenticated;

create function public.admin_delete_employee_payout_v2(
  p_payout_id uuid,
  p_force boolean DEFAULT false,
  p_reason text DEFAULT NULL::text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  perform private.admin_delete_employee_payout_v2(p_payout_id, p_force, p_reason);
end;
$$;
revoke all on function public.admin_delete_employee_payout_v2(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.admin_delete_employee_payout_v2(uuid,boolean,text) to authenticated;

-- admin_delete_employee_rate
alter function public.admin_delete_employee_rate(uuid) set schema private;
revoke all on function private.admin_delete_employee_rate(uuid) from public, anon, authenticated;

create function public.admin_delete_employee_rate(
  p_rate_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  perform private.admin_delete_employee_rate(p_rate_id);
end;
$$;
revoke all on function public.admin_delete_employee_rate(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_employee_rate(uuid) to authenticated;

-- admin_delete_point_cascade
alter function public.admin_delete_point_cascade(uuid,text) set schema private;
revoke all on function private.admin_delete_point_cascade(uuid,text) from public, anon, authenticated;

create function public.admin_delete_point_cascade(
  p_point_id uuid,
  p_point_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_delete_point_cascade(p_point_id, p_point_name);
end;
$$;
revoke all on function public.admin_delete_point_cascade(uuid,text) from public, anon, authenticated;
grant execute on function public.admin_delete_point_cascade(uuid,text) to authenticated;

-- admin_delete_point_tariff
alter function public.admin_delete_point_tariff(uuid) set schema private;
revoke all on function private.admin_delete_point_tariff(uuid) from public, anon, authenticated;

create function public.admin_delete_point_tariff(
  p_tariff_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  perform private.admin_delete_point_tariff(p_tariff_id);
end;
$$;
revoke all on function public.admin_delete_point_tariff(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_point_tariff(uuid) to authenticated;

-- admin_delete_point
alter function public.admin_delete_point(uuid) set schema private;
revoke all on function private.admin_delete_point(uuid) from public, anon, authenticated;

create function public.admin_delete_point(
  p_point_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_delete_point(p_point_id);
end;
$$;
revoke all on function public.admin_delete_point(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_point(uuid) to authenticated;

-- admin_delete_shift_v2
alter function public.admin_delete_shift_v2(uuid,boolean,text) set schema private;
revoke all on function private.admin_delete_shift_v2(uuid,boolean,text) from public, anon, authenticated;

create function public.admin_delete_shift_v2(
  p_shift_id uuid,
  p_force boolean DEFAULT false,
  p_reason text DEFAULT NULL::text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  perform private.admin_delete_shift_v2(p_shift_id, p_force, p_reason);
end;
$$;
revoke all on function public.admin_delete_shift_v2(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.admin_delete_shift_v2(uuid,boolean,text) to authenticated;

-- admin_finalize_employee_deletion
alter function public.admin_finalize_employee_deletion(uuid) set schema private;
revoke all on function private.admin_finalize_employee_deletion(uuid) from public, anon, authenticated;

create function public.admin_finalize_employee_deletion(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_finalize_employee_deletion(p_employee_id);
end;
$$;
revoke all on function public.admin_finalize_employee_deletion(uuid) from public, anon, authenticated;
grant execute on function public.admin_finalize_employee_deletion(uuid) to authenticated;

-- admin_import_legacy_shift
alter function public.admin_import_legacy_shift(text,uuid,uuid,date,text,integer,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb) set schema private;
revoke all on function private.admin_import_legacy_shift(text,uuid,uuid,date,text,integer,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb) from public, anon, authenticated;

create function public.admin_import_legacy_shift(
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
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_import_legacy_shift(p_legacy_source_id, p_employee_id, p_point_id, p_shift_date, p_shift_type, p_shk, p_partial, p_hours, p_full_hours, p_base_amount, p_pricing_snapshot, p_bonuses, p_penalties);
end;
$$;
revoke all on function public.admin_import_legacy_shift(text,uuid,uuid,date,text,integer,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.admin_import_legacy_shift(text,uuid,uuid,date,text,integer,boolean,numeric,numeric,numeric,jsonb,jsonb,jsonb) to authenticated;

-- admin_mark_payroll_period_paid
alter function public.admin_mark_payroll_period_paid(date,text) set schema private;
revoke all on function private.admin_mark_payroll_period_paid(date,text) from public, anon, authenticated;

create function public.admin_mark_payroll_period_paid(
  p_period_month date,
  p_payout_kind text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_mark_payroll_period_paid(p_period_month, p_payout_kind);
end;
$$;
revoke all on function public.admin_mark_payroll_period_paid(date,text) from public, anon, authenticated;
grant execute on function public.admin_mark_payroll_period_paid(date,text) to authenticated;

-- admin_reopen_payroll_period
alter function public.admin_reopen_payroll_period(date,text) set schema private;
revoke all on function private.admin_reopen_payroll_period(date,text) from public, anon, authenticated;

create function public.admin_reopen_payroll_period(
  p_period_month date,
  p_payout_kind text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_reopen_payroll_period(p_period_month, p_payout_kind);
end;
$$;
revoke all on function public.admin_reopen_payroll_period(date,text) from public, anon, authenticated;
grant execute on function public.admin_reopen_payroll_period(date,text) to authenticated;

-- admin_reprice_shift_v2
alter function public.admin_reprice_shift_v2(uuid,boolean,text) set schema private;
revoke all on function private.admin_reprice_shift_v2(uuid,boolean,text) from public, anon, authenticated;

create function public.admin_reprice_shift_v2(
  p_shift_id uuid,
  p_force boolean DEFAULT false,
  p_reason text DEFAULT NULL::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_reprice_shift_v2(p_shift_id, p_force, p_reason);
end;
$$;
revoke all on function public.admin_reprice_shift_v2(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.admin_reprice_shift_v2(uuid,boolean,text) to authenticated;

-- admin_rollback_employee_creation
alter function public.admin_rollback_employee_creation(uuid) set schema private;
revoke all on function private.admin_rollback_employee_creation(uuid) from public, anon, authenticated;

create function public.admin_rollback_employee_creation(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_rollback_employee_creation(p_employee_id);
end;
$$;
revoke all on function public.admin_rollback_employee_creation(uuid) from public, anon, authenticated;
grant execute on function public.admin_rollback_employee_creation(uuid) to authenticated;

-- admin_save_employee_payout_v2
alter function public.admin_save_employee_payout_v2(uuid,uuid,date,text,numeric,date,text,boolean,text,boolean) set schema private;
revoke all on function private.admin_save_employee_payout_v2(uuid,uuid,date,text,numeric,date,text,boolean,text,boolean) from public, anon, authenticated;

create function public.admin_save_employee_payout_v2(
  p_payout_id uuid,
  p_employee_id uuid,
  p_period_month date,
  p_payout_kind text,
  p_amount numeric,
  p_paid_on date,
  p_comment text DEFAULT NULL::text,
  p_force boolean DEFAULT false,
  p_reason text DEFAULT NULL::text,
  p_is_advance boolean DEFAULT false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_save_employee_payout_v2(p_payout_id, p_employee_id, p_period_month, p_payout_kind, p_amount, p_paid_on, p_comment, p_force, p_reason, p_is_advance);
end;
$$;
revoke all on function public.admin_save_employee_payout_v2(uuid,uuid,date,text,numeric,date,text,boolean,text,boolean) from public, anon, authenticated;
grant execute on function public.admin_save_employee_payout_v2(uuid,uuid,date,text,numeric,date,text,boolean,text,boolean) to authenticated;

-- admin_save_employee_profile
alter function public.admin_save_employee_profile(uuid,text,text,date,uuid,text,text,text,text,uuid[],text) set schema private;
revoke all on function private.admin_save_employee_profile(uuid,text,text,date,uuid,text,text,text,text,uuid[],text) from public, anon, authenticated;

create function public.admin_save_employee_profile(
  p_employee_id uuid,
  p_full_name text,
  p_status text,
  p_hired_at date,
  p_user_id uuid,
  p_phone text,
  p_transfer_phone text,
  p_transfer_bank text,
  p_transfer_recipient text,
  p_point_ids uuid[],
  p_employment_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_save_employee_profile(p_employee_id, p_full_name, p_status, p_hired_at, p_user_id, p_phone, p_transfer_phone, p_transfer_bank, p_transfer_recipient, p_point_ids, p_employment_type);
end;
$$;
revoke all on function public.admin_save_employee_profile(uuid,text,text,date,uuid,text,text,text,text,uuid[],text) from public, anon, authenticated;
grant execute on function public.admin_save_employee_profile(uuid,text,text,date,uuid,text,text,text,text,uuid[],text) to authenticated;

-- admin_save_employee_profile
alter function public.admin_save_employee_profile(uuid,text,text,date,uuid,text,text,text,text,uuid[]) set schema private;
revoke all on function private.admin_save_employee_profile(uuid,text,text,date,uuid,text,text,text,text,uuid[]) from public, anon, authenticated;

create function public.admin_save_employee_profile(
  p_employee_id uuid,
  p_full_name text,
  p_status text,
  p_hired_at date,
  p_user_id uuid,
  p_phone text,
  p_transfer_phone text,
  p_transfer_bank text,
  p_transfer_recipient text,
  p_point_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_save_employee_profile(p_employee_id, p_full_name, p_status, p_hired_at, p_user_id, p_phone, p_transfer_phone, p_transfer_bank, p_transfer_recipient, p_point_ids);
end;
$$;
revoke all on function public.admin_save_employee_profile(uuid,text,text,date,uuid,text,text,text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.admin_save_employee_profile(uuid,text,text,date,uuid,text,text,text,text,uuid[]) to authenticated;

-- admin_save_point
alter function public.admin_save_point(uuid,text,integer,boolean,boolean,text,numeric,jsonb,date) set schema private;
revoke all on function private.admin_save_point(uuid,text,integer,boolean,boolean,text,numeric,jsonb,date) from public, anon, authenticated;

create function public.admin_save_point(
  p_point_id uuid,
  p_name text,
  p_sort_order integer,
  p_active boolean,
  p_advance_enabled boolean,
  p_pricing_type text,
  p_fixed_rate numeric,
  p_shk_tiers jsonb,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_save_point(p_point_id, p_name, p_sort_order, p_active, p_advance_enabled, p_pricing_type, p_fixed_rate, p_shk_tiers, p_effective_from);
end;
$$;
revoke all on function public.admin_save_point(uuid,text,integer,boolean,boolean,text,numeric,jsonb,date) from public, anon, authenticated;
grant execute on function public.admin_save_point(uuid,text,integer,boolean,boolean,text,numeric,jsonb,date) to authenticated;

-- admin_save_shift_v4
alter function public.admin_save_shift_v4(uuid,uuid,date,uuid,text,integer,boolean,numeric,text,jsonb,jsonb,numeric,text,boolean,text) set schema private;
revoke all on function private.admin_save_shift_v4(uuid,uuid,date,uuid,text,integer,boolean,numeric,text,jsonb,jsonb,numeric,text,boolean,text) from public, anon, authenticated;

create function public.admin_save_shift_v4(
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
  p_force boolean DEFAULT false,
  p_reason text DEFAULT NULL::text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_save_shift_v4(p_shift_id, p_employee_id, p_shift_date, p_point_id, p_shift_type, p_shk, p_partial, p_hours, p_note, p_bonuses, p_penalties, p_base_amount_override, p_base_amount_reason, p_force, p_reason);
end;
$$;
revoke all on function public.admin_save_shift_v4(uuid,uuid,date,uuid,text,integer,boolean,numeric,text,jsonb,jsonb,numeric,text,boolean,text) from public, anon, authenticated;
grant execute on function public.admin_save_shift_v4(uuid,uuid,date,uuid,text,integer,boolean,numeric,text,jsonb,jsonb,numeric,text,boolean,text) to authenticated;

-- admin_uncheck_payroll_period
alter function public.admin_uncheck_payroll_period(date,text) set schema private;
revoke all on function private.admin_uncheck_payroll_period(date,text) from public, anon, authenticated;

create function public.admin_uncheck_payroll_period(
  p_period_month date,
  p_payout_kind text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_uncheck_payroll_period(p_period_month, p_payout_kind);
end;
$$;
revoke all on function public.admin_uncheck_payroll_period(date,text) from public, anon, authenticated;
grant execute on function public.admin_uncheck_payroll_period(date,text) to authenticated;

-- admin_update_employee_rate
alter function public.admin_update_employee_rate(uuid,date,text,numeric,jsonb) set schema private;
revoke all on function private.admin_update_employee_rate(uuid,date,text,numeric,jsonb) from public, anon, authenticated;

create function public.admin_update_employee_rate(
  p_rate_id uuid,
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
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_update_employee_rate(p_rate_id, p_effective_from, p_pricing_type, p_fixed_rate, p_shk_tiers);
end;
$$;
revoke all on function public.admin_update_employee_rate(uuid,date,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.admin_update_employee_rate(uuid,date,text,numeric,jsonb) to authenticated;

-- admin_update_point_tariff
alter function public.admin_update_point_tariff(uuid,date,text,numeric,jsonb) set schema private;
revoke all on function private.admin_update_point_tariff(uuid,date,text,numeric,jsonb) from public, anon, authenticated;

create function public.admin_update_point_tariff(
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
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.lock_financial_write();
  return private.admin_update_point_tariff(p_tariff_id, p_effective_from, p_pricing_type, p_fixed_rate, p_shk_tiers);
end;
$$;
revoke all on function public.admin_update_point_tariff(uuid,date,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.admin_update_point_tariff(uuid,date,text,numeric,jsonb) to authenticated;
