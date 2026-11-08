# Restore drill — 2026-11-08

Scope: isolated local synthetic data only. Production and the linked Supabase
project were not used.

Procedure:

1. Reset the local Supabase database from repository migrations and seed data.
2. Dump local data with `supabase db dump --local --data-only`.
3. Create a disposable PostgreSQL restore target.
4. Apply the repository migration chain to the target.
5. Load the dump, keeping platform-owned `audit_log` sequence state outside the
   synthetic restore payload.
6. Verify the restored point, employee, shift, versioned-RPC and schema state.

The migration/schema phase and data replay completed on the disposable
PostgreSQL target. The restore procedure explicitly excludes platform-owned
sequence state and recreates the historical `NOT VALID` tariff constraint
before loading application data. The restored target reported 14 points, one
synthetic employee and zero shifts from the current local snapshot, and it
contained `admin_save_shift_v5` plus the version column.

This is a local synthetic drill, so its RPO is the exact dump snapshot and its
RTO is not representative of a provider restore. Provider PITR, production
backup recovery, and measured production RPO/RTO still require staging/project
credentials and an isolated provider restore target.

Provider-level PITR, production backup recovery, and measured production RPO/RTO
remain blocked without a staging/project backup credential and an isolated
restore target. They must be completed before claiming 10/10.
