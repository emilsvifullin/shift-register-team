# Authentication hardening status

The local Supabase configuration enables `password_hibp_enabled = true`.
Local Auth uses the real GoTrue service and the manual review account is
generated with a unique password stored outside the repository.

The following staging checks are required before a production setting change:

1. signup and password change with a known compromised test password;
2. password reset and account-existence privacy responses;
3. rate limiting and old-session revocation;
4. admin sign-in and MFA policy review.

The repository does not claim these remote checks are complete without staging
credentials. Production Auth configuration is therefore intentionally left
unchanged.
