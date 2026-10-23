# Release readiness — 2026-10-23

## Current agentic foundation checkpoint

The original report below is preserved as historical evidence. This branch adds the durable **deterministic sandbox** workflow, exact owner/admin approval, atomic synthetic refunds, retained response drafts, independent security fixes and a refactored frontend. See [current milestone verification](milestone-verification.md), [baseline audit](baseline-audit.md), [scorecard and prioritized blockers](engineering-scorecard.md) and [workflow architecture](agentic-architecture.md). New functionality does not represent live model agents or complete Phase 3 policy-grounded automation.

Local browser acceptance now includes both approve and reject paths plus cross-tenant denial. Database tests verify no outbox is created, invalid approvals fail closed, concurrent duplicates execute once, and injected failures roll back. Native branch [CI passed on `16d7e79`](https://github.com/vish-go/ticketpilot/actions/runs/39939999105), including all 38 tests and Chromium acceptance against the pgvector/PostgreSQL service; local execution used PGlite. Docker, staging, live providers, erasure, email ownership and representative evaluations remain release gates. No real payment, customer message, paid service or default-branch merge was performed.

## Original platform evidence


**Decision: working local engineering build; not ready to accept real customer data.** The source is implemented and locally tested. A live service, independent security certification, every requested enhancement, and externally verified AI/email are not claimed.

## Delivered functionality

| Area | Implemented | Verification and limits |
| --- | --- | --- |
| Authentication | Registration with workspace, bcrypt, opaque hashed cookie sessions, expiration/logout, CSRF/origin checks, password-reset tokens and configurable delivery | API integration verifies credentials, invalid input, token consumption, session revocation; real reset email not sent |
| Tickets | Create/read/edit, assignments, five statuses, category/priority, search/filter/sort, 20-row pagination, conversations, internal notes, activity, deletion | API workflow persists across sign-ins, assigns/replies/resolves/reopens; stale edits and foreign assignees rejected |
| React workspace | Responsive authentication, inbox, filters, creation/detail/composer, assignment, knowledge, team, settings and analytics | Production bundle builds; local registration and ticket-form browser smoke test passed. Full authenticated Playwright acceptance passed in GitHub Actions; no live-deployment UX verified |
| Organizations and roles | Multiple workspaces, switching, owner/admin/agent/customer authorization, invitations, membership edits/revocation | Negative API tests cover foreign workspace/resources, customer ownership/private notes, invitation email binding, membership removal and owner protection |
| Knowledge | Text/Markdown intake, bounded content, versioned PostgreSQL chunks, full-text retrieval, updates/deletion/re-index, visible indexing failures | PostgreSQL-compatible PGlite tests cover versions, tenants, deletion and retrieval. Binary attachment/PDF/Office parsing is unsupported |
| Semantic retrieval | Optional OpenAI embedding adapter, validated 1536-dimensional vectors, optional pgvector migration/query with tenant/current-version predicates | Controlled contract test validates vectors and SQL scope. Live embeddings and native vector search not executed |
| AI drafting | Disabled, deterministic local extractive, and OpenAI adapters; structured classification/priority/explanations, citations, abstention, timeouts/retries, draft review/rejection, usage metadata | Local and controlled-provider tests pass; manual workflow works when AI disabled. No live model quality claim |
| Email | Durable outbox, Resend adapter, bounded retry/lease recovery, custom timestamped HMAC inbound gateway, deduplication/threading | Signature/provider contracts and worker SQL tested locally. No real inbox connected or external email sent. Native provider webhook translation is separate |
| SLA and analytics | Configurable deadlines, one-time overdue escalation, response/resolution timestamps, counts/category/workload/SLA calculations | API and worker tests; metrics derive from stored rows. SLA is elapsed wall-clock time, not business hours |
| Operations | Dockerfile, Compose with pgvector/PostgreSQL, health/readiness, structured logs/request IDs, CI, migrations/seed, backup/restore/rollback/staging guide | GitHub Actions passed on PostgreSQL/pgvector; Docker deployment, HTTPS deployment and restore drill not executed |
| Learning and portfolio | README, API/architecture/ADR, ten learning chapters, interview guidance, versioned evals, progress and review reports | Included in source; claims intentionally match implemented evidence |

## Verified commands

- `npm run lint`: passed. This command checks Prettier formatting; it is **not** an ESLint semantic-analysis run.
- `npm run check`: passed TypeScript checks.
- `npm test`: **28 passing tests, zero failures or skips** after route-module refactor and formatting.
- `npm run build`: compiled server and built React production assets.
- `npm audit --omit=dev --audit-level=high`: **zero production dependency vulnerabilities reported** at the time of this run; no permanent security guarantee.
- GitHub Actions on commit `5dee715`: lint, type check, 28 unit/integration tests, build, production dependency audit, and the authenticated Playwright workflow passed using PostgreSQL/pgvector. [Run details](https://github.com/vish-go/ticketpilot/actions/runs/39935712865).
- `npm run evaluate`: local keyword baseline, 18 handcrafted labeled examples, accuracy **0.7222**, macro-F1 **0.7576**; five retrieval/abstention/extraction smoke checks passed. This is a small regression dataset, not representative production evaluation. See `evaluations/results-local.json`.
- `node --import tsx scripts/load-local.ts`: disposable embedded PostgreSQL, 30 synthetic tickets, concurrency 4, 90 measured create/list/update requests, **0 errors**, overall p50 **17.13 ms**, p95 **28.15 ms**. These are one local smoke-run measurements; embedded PostgreSQL serializes database operations. This does not establish production throughput, connection-pool capacity, or multi-process locking behavior. Full environment/results: `evaluations/load-results.json`.

The PGlite engine executes PostgreSQL SQL in WASM. It is stronger than a mocked database but does not substitute for a native PostgreSQL service, extension behavior, multiple server connections, network faults, or a deployed container.

A native PostgreSQL 16.14 test runtime was investigated locally, but this executor cannot switch to the non-root OS account required by PostgreSQL. The real-service test path is provided via `TEST_DATABASE_URL`; GitHub Actions provisioned PostgreSQL/pgvector and passed the browser workflow against it. This does not verify production pooling, load, extensions beyond exercised paths, network faults, or container deployment.

## Level acceptance status

| Level | Status |
| --- | --- |
| Level 1 | Core behavior implemented and API/database-tested; authenticated browser workflow passed in CI against PostgreSQL/pgvector; production deployment remains to be verified |
| Level 2 | Tenant/role and collaboration boundaries API-tested, database analytics and worker behavior tested; live mail and production operations remain to be verified |
| Level 3 | Local extractive policy-to-draft workflow and reproducible evaluations tested; semantic provider/vector contracts implemented, external model/embedding integration and representative quality/security evaluation remain unverified |

## External deliverables and deployment limits

- Public source repository: [vish-go/ticketpilot](https://github.com/vish-go/ticketpilot), branch `feat/ticketpilot-production-platform`. CI passed on the pushed commit; no PR or merge was created.
- Provider credentials were not available. External AI/embedding/email adapter calls were tested with controlled fixtures, not real services.
- No Docker daemon or native PostgreSQL service was run locally. GitHub CI passed the Playwright workflow against PostgreSQL/pgvector; production migrations, pooling, broader vector-extension behavior, and containers still need verification on the intended host.
- Full Playwright acceptance in [`tests/e2e.spec.ts`](../tests/e2e.spec.ts) passed in CI. Local browser smoke coverage verified registration and ticket-form controls. No authenticated-workspace screenshot is claimed.
- No infrastructure, domain, paid service, billing, or customer deployment was created.

## Remaining product and security work

1. Verify email ownership before sensitive invitations; add ownership transfer, account erasure, retention jobs and provider/backup deletion procedures. Ticket/document/member deletion paths exist, but complete account/organization erasure does not.
2. Extend native PostgreSQL and browser coverage for actual lock contention, simultaneous worker claims, process crashes and backup restore. Fix failures rather than relaxing checks.
3. Test provider sandboxes, native inbound webhook translation and verified outbound threading. Add UI outbox inspection/retry and operational alerts before a customer pilot.
4. Expand AI evaluation beyond 18 examples and basic injection smoke checks: representative domain labels, semantic retrieval judgments, hallucinations, adversarial instructions, privacy leakage, token/cost budgets and recorded human feedback rates. Citation allowlists do not prove every sentence is true.
5. Add bounded cross-request AI idempotency/quotas, asynchronous large-document indexing and a representative large-dataset/query-plan test. Current document indexing is synchronous and generation retries can create additional drafts.
6. Add shared rate-limit storage if running multiple application instances, email verification/MFA where required, and a separately conducted security assessment. Current rate limits are process-local.
7. Extend custom automation/routing rules and richer team performance reporting if product evidence warrants it. Current automation is deadline escalation; the team view reports workload. Billing/subscriptions, saved replies, CSV export and broad business webhooks are not implemented.
8. Add semantic linting beyond formatting/type checking, accessibility/browser regression coverage and dependency-update automation. UI uses React state rather than a separate state framework intentionally.

## Resume claims supported by this build

- Built a TypeScript/React support platform with PostgreSQL-backed tickets, tenant-scoped roles, optimistic edit conflicts and human-reviewed AI response drafts.
- Added 28 passing local tests covering support workflows, authorization boundaries, provider failures and durable worker behavior.
- Verified the authenticated end-to-end support workflow in GitHub Actions with PostgreSQL/pgvector.
- Created reproducible AI and HTTP load smoke tests, plus Docker/CI configuration and beginner-oriented architecture documentation.

Do not claim a live production deployment, enterprise security certification, production traffic, high-scale throughput, or externally validated model performance.
