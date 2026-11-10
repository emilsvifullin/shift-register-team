# Release-gate checklist для 10/10

Этот документ описывает только действия, которые требуют доступа к staging,
production, провайдерскому backup/PITR или физическому iPhone. Локальная база и
production не смешиваются.

## 1. Staging Auth: leaked-password protection

В staging Supabase Dashboard открыть **Authentication → Password security** и
включить **Leaked password protection**. После сохранения выполнить на staging:

```sh
STAGING_CONFIRM=1 \
STAGING_SUPABASE_URL=https://<staging-url> \
STAGING_SUPABASE_ANON_KEY=<staging-anon-key> \
STAGING_ADMIN_EMAIL=<staging-admin-email> \
STAGING_ADMIN_PASSWORD=<staging-admin-password> \
npx playwright test e2e/staging-race.spec.mjs
```

Отдельно проверить регистрацию/смену пароля с тестовым скомпрометированным
паролем из HIBP test fixture: запрос должен быть отклонён, а случайный тестовый
пароль — принят. Проверить reset-password, privacy ответа для несуществующей
почты, rate-limit и отзыв старой сессии. Сохранить настройки Auth и вывод теста
в release record. Production Auth до этого шага не менять.

## 2. Migration-state gate

Изолированный release runner запускает gate до deploy:

```sh
export SUPABASE_ACCESS_TOKEN=<token>
export SUPABASE_PROJECT_REF=<staging-or-production-ref>
npm run check:migrations
```

Ожидаемый результат: `Supabase migration state is up to date.`. Любая ошибка,
отсутствие проекта или неприменённая миграция блокируют release.

## 3. Security Advisor

После применения миграций в целевом проекте открыть **Database → Advisors →
Security** и сохранить результат с датой и project ref. Проверить, что старые
authenticated grants для `admin_save_shift_v4`, `admin_delete_shift_v2` и
`admin_delete_point(uuid)` отсутствуют. Любое оставшееся предупреждение нужно
разобрать по конкретной функции и либо исправить отдельным PR, либо явно
принять с владельцем риска.

## 4. Provider restore drill и RPO/RTO

1. Создать synthetic marker в staging и записать его commit timestamp.
2. Зафиксировать время создания backup/PITR restore point.
3. Восстановить копию в отдельный staging project/database, никогда не в
   production.
4. Запустить `npm run test:db` с URL восстановленной базы и read-only SQL audit.
5. Записать `restore_started_at`, `restore_healthy_at`, `marker_committed_at` и
   `marker_visible_at`.
6. Посчитать `RTO = restore_healthy_at - restore_started_at` и
   `RPO = marker_committed_at - marker_visible_at`.

В release record приложить provider restore log, значения RPO/RTO и результат
контрактных тестов. Локальный drill из `restore-drill-2026-11-08.md` не заменяет
этот шаг.

## 5. Physical iPhone PWA

На iPhone открыть staging URL в Safari, выбрать **Поделиться → На экран
«Домой»**, запустить установленную PWA и войти staging-аккаунтом. Проверить:

- Смены: открыть/создать/отменить смену;
- Итоги: открыть период и карточку выплаты;
- Управление: сотрудник, ПВЗ, назначение сотрудника;
- Данные: статус синхронизации и выход;
- светлую/тёмную тему, поворот, клавиатуру, safe-area и возврат из background;
- offline/read-only поведение без сохранения финансовой операции.

Сохранить модель iPhone, iOS, дату, staging build и минимум четыре скриншота.

## 6. Production smoke и сохранность данных

Для полного плана после утверждения release и прохождения пунктов 1–5 добавить
токен Supabase с правом `database_migrations_read` в секрет
`SUPABASE_ACCESS_TOKEN` окружения `github-pages`, дождаться зелёного CI и только
затем разрешить production deploy job. Перед deploy снять read-only snapshot
количеств строк и контрольных сумм старых финансовых полей. После deploy
повторить snapshot, войти администратором и проверить чтение смен, итогов,
справочника и Realtime. При расхождении snapshot или красном smoke deploy
остановить и выполнить rollback на предыдущий commit.

Критерий 10/10: все шесть пунктов имеют приложенные доказательства, ни один
release gate не остаётся `pending`, а production smoke и restore drill успешны.
