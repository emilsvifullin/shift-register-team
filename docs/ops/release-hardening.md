# Release hardening runbook

This runbook keeps destructive verification on staging and blocks a deploy when
the linked Supabase project has not applied every repository migration.

## Migration gate

Set `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`, then run:

```sh
npm run check:migrations
```

The command uses `supabase db push --dry-run --skip-vault` and never writes to
the database. It fails closed if the remote migration state is behind or the
CLI is unavailable.

## Staging race and idempotency checks

Run the staging-only Playwright scenario with an authenticated staging origin:

```sh
STAGING_CONFIRM=1 \
STAGING_SUPABASE_URL=https://staging.example.test \
STAGING_SUPABASE_ANON_KEY=... \
STAGING_ADMIN_EMAIL=... \
STAGING_ADMIN_PASSWORD=... \
npx playwright test e2e/staging-race.spec.mjs
```

The scenario must use synthetic records, then delete those records in a finally
block. It must verify `record_changed`, `record_deleted`, and that retrying the
same `p_operation_id` returns the original result without creating a second row.

## Restore drill and RPO/RTO

1. Create a timestamped staging backup or provider PITR restore point.
2. Record the last known committed synthetic row and the backup timestamp.
3. Restore into a separate staging project or database, never production.
4. Run `npm run test:db` and the read-only SQL audit against the restored target.
5. Record restore start/end timestamps. RTO is elapsed restore-to-healthy-check time;
   RPO is the age of the newest committed synthetic row that survived restore.
6. Keep the provider restore log and the measured values with the release record.

Production rollout is blocked until the staging run, restore evidence, and the
migration gate are attached to the release checklist.

## Local manual review

With Docker Desktop running, one command resets only the local Supabase
PostgreSQL 17 instance, applies every repository migration, loads the fictional
seed, creates a fresh admin password outside the repository, and serves the
site on `http://127.0.0.1:4173/login.html`:

```sh
npm run local:review
```

The generated credentials are stored at
`~/.shift-register/local-admin.txt` with mode `0600`. Stop the site and local
Supabase with `Ctrl-C`; the script runs `supabase stop`. To reset only the test
database later, run:

```sh
supabase db reset --local --yes
```

This does not touch the linked production project.
