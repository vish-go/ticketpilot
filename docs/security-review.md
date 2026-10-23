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

## Independent Phase 0 backend review — 23 October 2026

Source inspection covered session and tenant middleware, organization roles, ticket writes, knowledge retrieval, webhook ingestion, schema constraints, and durable email processing. This review found no obvious sequential cross-tenant ticket IDOR in the inspected routes; that is not a proof of absence or a substitute for concurrent PostgreSQL tests.

### Prioritized remediation

1. **P1, fixed: final-attempt worker crashes stranded delivery records.** `server/worker.ts` previously recovered every expired processing lease to pending, while only claiming jobs with fewer than five attempts. A crash after claim five therefore left an unclaimable pending job. Recovery now marks exhausted leases failed with the sanitized `lease_expired` reason. `tests/email.test.ts` exercises a fifth-attempt expired lease, repeated recovery, and zero external provider calls. The focused email suite passed all seven tests on 23 October 2026 using PGlite; no live email service was invoked.
2. **P1, production team onboarding blocker: account email ownership is unverified.** `server/routes/auth.ts:31` registers an arbitrary supplied address and immediately creates a session; `server/routes/session.ts:43` compares an invitation address with that unverified account address. An invitation still requires possession of its random token, but the address comparison does not prove inbox ownership. Add expiring, one-use email verification before sensitive team acceptance and test account pre-registration attacks. This was already disclosed in the earlier review and remains unresolved.
3. **P1 before tenant-configurable inbound integrations: inbound credentials are global administrative credentials.** `server/routes/integrations.ts:9` accepts one deployment-wide secret and takes the organization ID from the signed payload. A tenant-facing integration must instead resolve its tenant from a server-controlled integration credential record. Never hand the current shared signing secret to a tenant. Existing use as a trusted internal gateway is a narrower supported boundary.
4. **P2: inbound event deduplication crosses tenant namespaces.** `migrations/001_initial.sql:20` gives `event_id` a global primary key; `server/routes/integrations.ts:38` silently drops a second organization event with the same ID. Scope the key to organization and provider connection before connecting independently numbered event sources. Test same-ID delivery in two organizations as well as same-tenant replay.
5. **P2, new workflow boundary: worker acknowledgements lack lease ownership fencing.** `server/worker.ts` acknowledges by job ID and processing status. If a paused worker resumes after its lease is reclaimed, it can acknowledge another worker's attempt. Stable provider idempotency keys mitigate duplicate sends, but do not fence database state. Future consequential workflows need an unpredictable claim token or increasing lease generation, conditional acknowledgements, and provider-side idempotency; include competing-worker and pause/resume tests against native PostgreSQL.
6. **P2, future transaction composition: nested transactions use an independent connection.** `server/db.ts:19` always obtains a new pool client, including on a transaction-scoped wrapper. Current inspected route code does not nest transactions, but reusable workflow tools must not assume nested calls are atomic. Reject nesting explicitly or implement savepoints before composing transaction-owning domain helpers.

### Required safety boundary for the next workflow milestone

Persist validated action arguments and an immutable action digest with the approval; verify tenant, approver role, expiry, exact arguments, current order state, monetary limits, and workflow state again inside the execution transaction. Serialize approval/execution with row locks or compare-and-swap transitions. Allowlist tools and validate arguments server-side; bind order lookup to the authenticated customer rather than trusting identifiers in ticket text. Persist stable idempotency keys independently of worker attempts. Sandbox tools must have no path to live refund APIs or customer delivery. Test rejected/expired approvals, parameter tampering, cross-tenant identifiers, duplicate execution, concurrent approvals, crashes, and exhausted retries. Human-readable agent explanations and model verifiers are not authorization boundaries.

### Sandbox workflow implementation review

The first deterministic sandbox workflow has no payment-provider adapter and never queues a customer message. The worker now advances it independently of browser visits. Reviewer changes revalidate the current actor's membership under a shared row lock inside mutating workflow transactions, validate and recompute proposal hashes when recording decisions, and independently revalidate the approver and exact resource snapshots before the synthetic refund. After an action commits, its separate verification step reconciles the stored result even if the initiation deadline passes or the initiating staff member is removed; those changes must not misreport an executed action as never executed. Composite tenant foreign keys and unique per-order/per-run refund constraints reinforce application checks. TypeScript and the seven email regressions passed after this integration; workflow-specific acceptance evidence must come from the dedicated workflow suite.

Remaining concurrency limitation: the workflow batch currently uses one transaction for up to twenty state transitions. A database error in one selected transition rolls back the batch. Native PostgreSQL tests should exercise lock order between staff revocation (membership then ticket), action execution (run, initiator membership, ticket/order, approver membership), and concurrent workers; PostgreSQL can resolve a deadlock by aborting a transaction, but repeated contention still needs bounded retries and operational evidence. Current correctness relies on short, deterministic database-only transitions; do not move network calls into this transaction model.
