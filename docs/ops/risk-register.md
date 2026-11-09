# Shift Register risk register

| Risk | Status | Evidence / owner |
| --- | --- | --- |
| Stale shift write | Closed in code | `admin_save_shift_v5`, DB race tests |
| Delete-then-save resurrection | Closed in code | shift tombstones and `record_deleted` test |
| Duplicate/retried shift write | Closed in code | operation receipts and idempotency test |
| Legacy SECURITY DEFINER aliases | Reduced | old shift/point aliases revoked; see grants matrix |
| Leaked password protection | Local complete, production pending | production Auth setting is mandatory |
| Restore drill | Local synthetic complete, production pending | provider PITR/RPO/RTO is mandatory |
| Migration drift | Gate implemented | CI deploy requires Supabase credentials |
| Physical iPhone PWA | Deferred | outside mandatory salary-data baseline |
| Production Security Advisor | Pending | mandatory read-only production check |

Until the external production Auth, Advisor, PITR/RPO/RTO and migration-gate
checks are completed, the project status remains Go with restrictions. The
physical iPhone gate is intentionally deferred for this salary-manager scope.
