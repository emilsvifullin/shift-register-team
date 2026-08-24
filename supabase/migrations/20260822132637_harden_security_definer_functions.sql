create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

alter policy profiles_select_own_or_admin
on public.profiles
using (id = auth.uid() or private.is_admin());

alter policy profiles_admin_insert
on public.profiles
with check (private.is_admin());

alter policy profiles_admin_update
on public.profiles
using (private.is_admin())
with check (private.is_admin());

alter policy profiles_admin_delete
on public.profiles
using (private.is_admin());

alter policy employees_select_own_or_admin
on public.employees
using (user_id = auth.uid() or private.is_admin());

alter policy employees_admin_insert
on public.employees
with check (private.is_admin());

alter policy employees_admin_update
on public.employees
using (private.is_admin())
with check (private.is_admin());

alter policy employees_admin_delete
on public.employees
using (private.is_admin());

alter policy points_admin_insert
on public.points
with check (private.is_admin());

alter policy points_admin_update
on public.points
using (private.is_admin())
with check (private.is_admin());

alter policy points_admin_delete
on public.points
using (private.is_admin());

alter policy shifts_select_own_or_admin
on public.shifts
using (
  private.is_admin()
  or exists (
    select 1
    from public.employees e
    where e.id = shifts.employee_id
      and e.user_id = auth.uid()
  )
);

alter policy shifts_admin_insert
on public.shifts
with check (private.is_admin());

alter policy shifts_admin_update
on public.shifts
using (private.is_admin())
with check (private.is_admin());

alter policy shifts_admin_delete
on public.shifts
using (private.is_admin());

alter policy shift_bonuses_select_own_or_admin
on public.shift_bonuses
using (
  private.is_admin()
  or exists (
    select 1
    from public.shifts s
    join public.employees e on e.id = s.employee_id
    where s.id = shift_bonuses.shift_id
      and e.user_id = auth.uid()
  )
);

alter policy shift_bonuses_admin_insert
on public.shift_bonuses
with check (private.is_admin());

alter policy shift_bonuses_admin_update
on public.shift_bonuses
using (private.is_admin())
with check (private.is_admin());

alter policy shift_bonuses_admin_delete
on public.shift_bonuses
using (private.is_admin());

alter policy shift_penalties_select_own_or_admin
on public.shift_penalties
using (
  private.is_admin()
  or exists (
    select 1
    from public.shifts s
    join public.employees e on e.id = s.employee_id
    where s.id = shift_penalties.shift_id
      and e.user_id = auth.uid()
  )
);

alter policy shift_penalties_admin_insert
on public.shift_penalties
with check (private.is_admin());

alter policy shift_penalties_admin_update
on public.shift_penalties
using (private.is_admin())
with check (private.is_admin());

alter policy shift_penalties_admin_delete
on public.shift_penalties
using (private.is_admin());

alter policy audit_log_admin_select
on public.audit_log
using (private.is_admin());

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.write_audit_log() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
drop function public.is_admin();
