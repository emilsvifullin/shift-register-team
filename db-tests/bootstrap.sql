-- То немногое от Supabase, на что опираются миграции проекта.
--
-- Настоящий auth.uid() читает пользователя из JWT запроса; здесь он
-- читает ту же настройку request.jwt.claim.sub, которую тест выставляет
-- перед вызовом. Роли — те же имена, что у Data API: права на функции и
-- таблицы проверяются по-настоящему.
-- Роли общие на весь сервер: база теста не первая и не последняя.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

create publication supabase_realtime;

-- Supabase ставит эту функцию событийным триггером; миграции только
-- отзывают у неё права.
create function public.rls_auto_enable()
returns event_trigger
language plpgsql
as $$
begin
end;
$$;
