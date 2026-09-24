-- Права на новые таблицы в public задаёт репозиторий, а не платформа.
--
-- С 30 октября 2026 Supabase перестаёт раздавать права на новые объекты в
-- public ролям anon, authenticated и service_role: таблица, созданная
-- миграцией, окажется невидимой для Data API, пока права не выданы явно.
-- Уже существующие таблицы изменение не затрагивает.
--
-- Для Shift Register это меняет не работу приложения, а цену ошибки в
-- будущих миграциях, причём в обе стороны:
--
--   * сегодня новая таблица автоматически получает полный CRUD для anon и
--     authenticated — то есть забытый revoke молча открывает её всему
--     интернету по публичному ключу;
--   * после 30 октября та же забытая строка молча оставит таблицу
--     недоступной приложению.
--
-- Оба исхода — молчаливые, и оба зависят от того, когда именно проиграна
-- миграция. Поэтому состояние задаётся здесь явно: платформенные
-- умолчания снимаются, и каждая таблица получает ровно те права, которые
-- ей нужны, — как это уже сделано для всех существующих таблиц.
--
-- Что кому нужно на самом деле:
--
--   anon           — ничего. До входа приложение работает только с auth,
--                    ни одной таблицы не читает.
--   authenticated  — только select. Все записи идут через функции
--                    security definer, которые проверяют роль сами.
--   service_role   — select/insert/update на profiles и employees: их
--                    использует Edge-функция admin-employee-auth.
--
-- Проверка в конце — не украшение: она падает, если состояние прав
-- разошлось с ожидаемым, и восстановление базы с нуля не сможет тихо
-- закончиться с лишним или недостающим доступом.
begin;

-- Платформенные умолчания для будущих объектов в public снимаются.
--
-- Пример из письма Supabase снимает только select/insert/update/delete,
-- и новая таблица всё равно достаётся anon с правами references, trigger
-- и truncate: умолчание раздаёт все привилегии сразу. Проверено на этой
-- базе. Поэтому здесь снимается всё — читать и писать новую таблицу
-- сможет только тот, кому это выдали отдельной строкой.
alter default privileges for role postgres in schema public
  revoke all on tables
  from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences
  from anon, authenticated, service_role;

-- Существующие таблицы уже имеют явные права (initial_team_schema,
-- complete_team_workflow, add_employee_payout_tracking_and_tariff_admin).
-- Подтверждаем их здесь одним местом, чтобы итоговое состояние читалось
-- целиком и не зависело от порядка более ранних миграций.
revoke all on table
  public.profiles,
  public.employees,
  public.employee_points,
  public.points,
  public.point_tariffs,
  public.shifts,
  public.shift_bonuses,
  public.shift_penalties,
  public.employee_payouts,
  public.audit_log
from anon, authenticated;

grant select on table
  public.profiles,
  public.employees,
  public.employee_points,
  public.points,
  public.point_tariffs,
  public.shifts,
  public.shift_bonuses,
  public.shift_penalties,
  public.employee_payouts,
  public.audit_log
to authenticated;

do $$
declare
  v_anon text;
  v_extra text;
  v_missing text;
begin
  -- anon не должен видеть ни одной таблицы приложения.
  select string_agg(distinct table_name, ', ')
  into v_anon
  from information_schema.table_privileges
  where table_schema = 'public'
    and grantee = 'anon';

  if v_anon is not null then
    raise exception 'anon получил доступ к таблицам: %', v_anon;
  end if;

  -- authenticated не должен уметь ничего, кроме чтения.
  select string_agg(distinct table_name || ':' || privilege_type, ', ')
  into v_extra
  from information_schema.table_privileges
  where table_schema = 'public'
    and grantee = 'authenticated'
    and privilege_type <> 'SELECT';

  if v_extra is not null then
    raise exception 'у authenticated лишние права: %', v_extra;
  end if;

  -- И должен читать всё, что читает приложение.
  select string_agg(t.table_name, ', ')
  into v_missing
  from information_schema.tables t
  where t.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
    and not exists (
      select 1
      from information_schema.table_privileges p
      where p.table_schema = 'public'
        and p.table_name = t.table_name
        and p.grantee = 'authenticated'
        and p.privilege_type = 'SELECT'
    );

  if v_missing is not null then
    raise exception 'таблицы без доступа для authenticated: %', v_missing;
  end if;
end;
$$;

commit;
