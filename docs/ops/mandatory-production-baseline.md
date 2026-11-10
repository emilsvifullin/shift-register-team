# Обязательный baseline для зарплатных данных

Этот baseline заменяет полный 10/10 release plan для текущей эксплуатации.
Staging, физический iPhone и необязательные UX-проверки в него не входят.

## Уже закрыто в репозитории

- все административные записи идут через явные gateway RPC;
- RLS и negative-тесты для `anon`, обычного `authenticated` и admin
  выполняются в `db-tests/financial-contract.mjs`;
- устаревшие authenticated grants отозваны;
- смены защищены optimistic locking, tombstone удалений и idempotency;
- CI проверяет Node 22/24, PostgreSQL 17 и браузерный smoke;
- migration gate существует и fail-closed без project credentials;
- локальный Auth включает `password_hibp_enabled = true`;
- локальный restore drill выполнен отдельно от production.

## Обязательно сделать владельцу production

1. В production Supabase включить **Authentication → Password security →
   Leaked password protection**.
2. В production Supabase открыть **Database → Advisors → Security** и сохранить
   результат после текущего merge. Legacy grants из `security-grants.md` должны
   отсутствовать или иметь принятое владельцем риска объяснение.
3. Включить/проверить provider backup/PITR, выполнить один restore в отдельную
   базу и записать RPO/RTO. Production восстанавливать нельзя.
4. Добавить в GitHub repository secrets:

   ```text
   SUPABASE_ACCESS_TOKEN
   SUPABASE_PROJECT_REF=rxosovinouuonwrrzigs
   ```

5. Запустить `npm run check:migrations` в release runner и сохранить успешный
   вывод вместе с backup/Advisor evidence.
6. Перед первой production-публикацией снять read-only snapshot количества строк
   и контрольных сумм финансовых полей; после публикации повторить snapshot.

## Что сознательно отложено

- отдельный staging-сайт и staging race-run;
- физическая PWA-проверка на iPhone;
- полный mobile/UX release review;
- необязательные P2-функции.

Пока пункты production baseline не подтверждены артефактами, статус остаётся
**Go с ограничениями**. Код и локальные тесты при этом уже готовы к безопасному
release.
