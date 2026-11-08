# Security grants and negative-test matrix

The application keeps only explicit `authenticated` gateway functions in the
`public` schema. Their bodies run with an empty `search_path` and perform the
admin check before touching financial data. Internal implementations live in
`private` and are not executable by `anon` or `authenticated`.

The legacy client entry points `admin_save_shift_v4`,
`admin_delete_shift_v2`, and `admin_delete_point(uuid)` are revoked. The
versioned shift gateways are `admin_save_shift_v5` and
`admin_delete_shift_v3`.

The database contract checks the grant matrix under real PostgreSQL roles:

- `anon`: no application table writes and no administrative RPC execution;
- ordinary `authenticated`: RLS limits reads to owned records and RPCs still
  reject non-admin users;
- admin `authenticated`: only the explicit gateway set is executable;
- `private`: implementation functions are unreachable from Data API roles.

The negative scenarios are in `db-tests/financial-contract.mjs` and run in CI
against PostgreSQL 17. The local audit can inspect the same matrix with:

```sh
PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres \
  PGDATABASE=postgres npm run test:db
```

Production Security Advisor re-check remains a release gate because it requires
the production Supabase project credentials. No production settings are changed
by the repository migrations.
