alter table public.employee_payouts
  drop constraint if exists employee_payouts_employee_id_fkey;

alter table public.employee_payouts
  add constraint employee_payouts_employee_id_fkey
  foreign key (employee_id)
  references public.employees(id)
  on delete cascade;

create or replace function public.admin_delete_point(
  p_point_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if p_point_id is null or not exists (
    select 1
    from public.points p
    where p.id = p_point_id
  ) then
    raise exception 'point_not_found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.shifts s
    where s.point_id = p_point_id
  ) then
    raise exception 'point_has_history'
      using errcode = '23503';
  end if;

  delete from public.points
  where id = p_point_id;

  return p_point_id;
end;
$$;

revoke all on function public.admin_delete_point(uuid)
  from public, anon;

grant execute on function public.admin_delete_point(uuid)
  to authenticated;
