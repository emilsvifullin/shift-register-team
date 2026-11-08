# Shift Register risk register

| Risk | Status | Evidence / owner |
| --- | --- | --- |
| Stale shift write | Closed in code | `admin_save_shift_v5`, DB race tests |
| Delete-then-save resurrection | Closed in code | shift tombstones and `record_deleted` test |
| Duplicate/retried shift write | Closed in code | operation receipts and idempotency test |
| Legacy SECURITY DEFINER aliases | Reduced | old shift/point aliases revoked; see grants matrix |
| Leaked password protection | Local only | staging/production Auth setting requires project access |
| Restore drill | Local synthetic complete | provider PITR/RPO/RTO still external gate |
| Migration drift | Gate implemented | CI deploy requires Supabase credentials |
| Physical iPhone PWA | Not checked | WebKit automation passed; device access required |
| Production Security Advisor | Not rechecked after changes | requires production read-only credentials |

Until the external Auth, Advisor, PITR/RPO/RTO, and physical iPhone gates are
completed, the project status remains Go with restrictions and No-Go for 10/10.
