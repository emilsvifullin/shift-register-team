alter policy profiles_select_own_or_admin
on public.profiles
using (
  id = (select auth.uid())
  or (select private.is_admin())
);

alter policy profiles_admin_insert
on public.profiles
with check ((select private.is_admin()));

alter policy profiles_admin_update
on public.profiles
using ((select private.is_admin()))
with check ((select private.is_admin()));

alter policy profiles_admin_delete
on public.profiles
using ((select private.is_admin()));

alter policy employees_select_own_or_admin
on public.employees
using (
  user_id = (select auth.uid())
  or (select private.is_admin())
);

alter policy employees_admin_insert
on public.employees
with check ((select private.is_admin()));

alter policy employees_admin_update
on public.employees
using ((select private.is_admin()))
with check ((select private.is_admin()));

alter policy employees_admin_delete
on public.employees
using ((select private.is_admin()));

alter policy points_admin_insert
on public.points
with check ((select private.is_admin()));

alter policy points_admin_update
on public.points
using ((select private.is_admin()))
with check ((select private.is_admin()));

alter policy points_admin_delete
on public.points
using ((select private.is_admin()));

alter policy shifts_select_own_or_admin
on public.shifts
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.employees e
    where e.id = shifts.employee_id
      and e.user_id = (select auth.uid())
  )
);

alter policy shifts_admin_insert
on public.shifts
with check ((select private.is_admin()));

alter policy shifts_admin_update
on public.shifts
using ((select private.is_admin()))
with check ((select private.is_admin()));

alter policy shifts_admin_delete
on public.shifts
using ((select private.is_admin()));

alter policy shift_bonuses_select_own_or_admin
on public.shift_bonuses
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.shifts s
    join public.employees e on e.id = s.employee_id
    where s.id = shift_bonuses.shift_id
      and e.user_id = (select auth.uid())
  )
);

alter policy shift_bonuses_admin_insert
on public.shift_bonuses
with check ((select private.is_admin()));

alter policy shift_bonuses_admin_update
on public.shift_bonuses
using ((select private.is_admin()))
with check ((select private.is_admin()));

alter policy shift_bonuses_admin_delete
on public.shift_bonuses
using ((select private.is_admin()));

alter policy shift_penalties_select_own_or_admin
on public.shift_penalties
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.shifts s
    join public.employees e on e.id = s.employee_id
    where s.id = shift_penalties.shift_id
      and e.user_id = (select auth.uid())
  )
);

alter policy shift_penalties_admin_insert
on public.shift_penalties
with check ((select private.is_admin()));

alter policy shift_penalties_admin_update
on public.shift_penalties
using ((select private.is_admin()))
with check ((select private.is_admin()));

alter policy shift_penalties_admin_delete
on public.shift_penalties
using ((select private.is_admin()));

alter policy audit_log_admin_select
on public.audit_log
using ((select private.is_admin()));

create index if not exists employees_created_by_idx on public.employees(created_by);
create index if not exists employees_updated_by_idx on public.employees(updated_by);
create index if not exists points_created_by_idx on public.points(created_by);
create index if not exists points_updated_by_idx on public.points(updated_by);
create index if not exists shift_bonuses_created_by_idx on public.shift_bonuses(created_by);
create index if not exists shift_bonuses_updated_by_idx on public.shift_bonuses(updated_by);
create index if not exists shift_penalties_created_by_idx on public.shift_penalties(created_by);
create index if not exists shift_penalties_updated_by_idx on public.shift_penalties(updated_by);
create index if not exists shifts_created_by_idx on public.shifts(created_by);
create index if not exists shifts_updated_by_idx on public.shifts(updated_by);
