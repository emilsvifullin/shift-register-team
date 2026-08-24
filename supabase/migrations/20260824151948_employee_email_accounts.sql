create or replace function public.admin_account_options_v2()
returns table(
  user_id uuid,
  login text,
  phone text,
  email text,
  role text,
  employee_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  return query
  select
    u.id,
    u.email::text,
    u.phone::text,
    u.email::text,
    p.role,
    e.id
  from auth.users u
  join public.profiles p
    on p.id = u.id
   and p.role = 'employee'
  left join public.employees e
    on e.user_id = u.id
  where u.email is not null
  order by lower(u.email::text);
end;
$$;

revoke all on function public.admin_account_options_v2()
  from public,
       anon,
       authenticated;

grant execute on function public.admin_account_options_v2()
  to authenticated;
