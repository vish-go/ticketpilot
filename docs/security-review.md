# Security review — local engineering review

Reviewed source: Express API, PostgreSQL schema, session/password flows, role checks, tenant query boundaries, AI orchestration, email signing, and worker contract. This is a source review plus automated negative tests, not an independent penetration test or a production certification.

## Controls observed

- Random opaque session secrets are stored as SHA-256 hashes; browser cookies are HttpOnly, SameSite=Lax, and Secure in production. Sessions expire after seven days and are revoked by logout and password reset.
- Passwords use bcrypt cost 12. Registration and reset reject passwords above 72 UTF-8 bytes, avoiding bcrypt suffix truncation. Reset tokens are random, hashed, expiring, one-time, and all outstanding tokens are removed after reset.
- Authenticated writes require a session-bound CSRF header. Explicit foreign browser origins are rejected. JSON parsing limits request bodies. There is no permissive CORS middleware.
- Every tenant route derives role from the authenticated user's membership and the requested workspace. Ticket, message, document, draft, analytics, settings, and audit operations scope queries by workspace. Customer-role users are restricted to their own tickets; private notes, drafts, membership data, and analytics are withheld.
- SQL values are parameterized. Composite tenant/ticket and tenant/assignee foreign keys reinforce consistency. Transactions cover ticket/history/message/outbox writes; versions reject stale updates.
- Email webhooks use HMAC over exact bytes and a five-minute timestamp window. Event IDs prevent duplicate processing. The webhook is a custom signed integration protocol, not a claim of native verification of every email provider.
- AI retrieval receives only tenant-selected documents. Drafts require an authenticated human action to become a conversation reply. Provider disablement does not block normal support operations.
- Operational logs contain request IDs, status codes, durations, and sanitized error codes, rather than ticket content, credentials, or email bodies. Helmet supplies browser security headers. In production its CSP upgrades insecure requests; that upgrade is deliberately disabled for local HTTP development assets.

## Automated evidence

`tests/api.test.ts` runs all versioned SQL migrations in PGlite and exercises the API using HTTP requests. If `TEST_DATABASE_URL` is supplied, the same suite instead connects to that PostgreSQL service, creates a randomly named disposable schema, runs the actual migration runner, and removes only that schema afterward. The test database user needs schema-creation permission. No real-service test run is claimed merely because this option exists. It covers:

1. Registration and hashed credentials; duplicate, short, and over-byte-limit password rejection.
2. Authentication, CSRF, and foreign-origin rejection.
3. Creating, persisting, assigning, replying, resolving, and reopening a ticket across sign-ins.
4. Optimistic-edit conflicts and invalid cross-tenant assignment.
5. Cross-tenant reads, updates, messages, lists, and analytics isolation.
6. Email-bound, one-time invitation acceptance.
7. Customer ownership boundaries and internal-note privacy.
8. Tenant-scoped document and AI citation retrieval; draft acceptance/rejection and replay rejection.
9. AI disablement with continued human replies.
10. Signed inbound forgery rejection and duplicate-event idempotency.
11. Owner-only membership role changes, protected self/owner membership, tenant-scoped removal, reassignment cleanup, and access revocation.
12. Password-reset token consumption, outstanding-token invalidation, session revocation, and logout.

`tests/email.test.ts` separately checks signature replay/format handling, provider failure sanitization, outbound idempotency contracts, and worker retry/escalation behavior. `tests/ai.test.ts` checks controlled provider and retrieval behavior. Exact final suite totals belong in the release report after the full run.

## Findings fixed during review

- Password schemas initially counted characters instead of UTF-8 bytes. The API now rejects passwords that bcrypt would truncate.
- Password reset initially left other outstanding reset links active. Reset now removes all tokens for that user and revokes sessions.

## Remaining boundaries and gaps

- PGlite validates PostgreSQL statements and transactions in one process. It does not validate production PostgreSQL connection pooling, multiple connections, lock contention, service crashes, TLS, proxy headers, or Docker networking. Run integration/concurrency checks against an actual PostgreSQL service before deployment.
- Rate-limit state is process-local. A horizontally scaled deployment needs shared rate-limit storage and coordinated quotas. There is no account-specific lockout or MFA.
- Email verification at registration is not implemented. Invitations require the current account email but the account email is not independently verified; do not use the present invite flow for sensitive production teams until verified-address registration is added.
- Membership role changes and revocation exist, with owner/self protections and ticket unassignment. There is no complete organization/account erasure workflow. Ticket/document deletion exists, but audit rows, historic draft excerpts, delivery records, backups, and provider copies need an explicit retention policy and tested erasure procedure.
- Document removal does not retroactively erase excerpts already stored in previous drafts. Historic drafts preserve their generation context; disclose this retention behavior.
- Local AI retrieval uses PostgreSQL full-text search over indexed document chunks; the local response provider is extractive. Optional OpenAI embeddings with pgvector support exist but live embedding credentials and vector-backed retrieval were not verified by this review. OpenAI citation allowlists reject unknown source IDs but do not mathematically prove every generated sentence is grounded. Prompt-injection checks are a defensive layer, not a security guarantee. Keep human review and adversarial evaluations.
- Outbound provider and live inbound integration were not verified with production credentials. The shared inbound signing secret is an administrator-level integration boundary and must stay server-side. Rotating and scoping credentials per integration is future work.
- No attachment parser, antivirus scanning, PDF sandbox, or binary-file upload pipeline is implemented. Knowledge ingestion accepts bounded text/Markdown content; do not expand accepted formats without parser-specific controls.
- Current role administration protects the owner from deletion/demotion and supports member revocation. Ownership transfer and a complete account lifecycle are not implemented.
- Database constraints protect tenant consistency but PostgreSQL row-level security is not enabled. Authorization depends on application query discipline and automated regression checks.
- No external penetration testing, live backup restore drill, production monitoring alert drill, or infrastructure security audit has occurred. Production readiness is not claimed.

## Production follow-up

Prioritize verified-email ownership, actual PostgreSQL concurrency testing, HTTPS deployment and cookie checks, backup/restore and retention drills, external-provider sandbox verification, and a separate security assessment before real customer data is accepted. Re-run negative authorization tests whenever a tenant resource or role is added.
