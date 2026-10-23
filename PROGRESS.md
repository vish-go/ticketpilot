# TicketPilot engineering progress

Updated 23 October 2026. Working branch: `feat/ticketpilot-agentic-enterprise`, based on existing `0365cb0`. Existing source/history preserved; bundled history verified complete. Configured remote `https://github.com/vish-go/ticketpilot.git` inspected: its default branch is `feat/ticketpilot-production-platform` and matched the starting local commit. Earlier notes saying no source/remote existed describe a previous environment, not this workspace.

## Phase 0 — reproducible baseline

Completed source/history and handoff inspection. Baseline passed formatting, typecheck, 28 tests, build, full local authenticated Chrome acceptance, local evaluations and 90-request embedded load smoke. Online production dependency audit returned zero advisories. See `docs/baseline-audit.md`. Native PostgreSQL and Docker were absent locally. GitHub API confirmed historical CI successes for `0365cb0` and `5dee715`; historical evidence is distinct from this branch's CI.

Actual parallel specialists implemented frontend decomposition, independently reviewed security/backend logic, and verified runtime/API/browser behavior. Parent implemented workflow orchestration, migration, API tests, integration and architecture/learning documentation. Reviews found and corrected exhausted email crash recovery, permission timing, proposal hash validation at approval, and post-action verification after expiry. Specialists are responsibilities, not ten invented output labels.

## Current implementation checkpoint

- Phase 1 local workflow validation and frontend extraction complete: `App.tsx` 1,896 → 1,231 lines with shared types, helpers, four pages, reusable controls/dialogs and workflow console. Further decomposition remains useful.
- Fixed final-attempt email jobs stranded after expired leases; regression exercises repeat recovery and zero provider sends.
- Phase 2 durable deterministic workflow foundation implemented: persisted state/events, strict proposals, tenant and transactional role checks, exact digest-bound human decisions, snapshots, deadlines, step budget, five-active-run quota, stable request idempotency, worker advancement and zero-token usage metadata.
- Partial Phase 3 sandbox slice: synthetic order/shipment, deterministic refund policy, owner/admin approve/reject, atomic synthetic refund, result verification, retained response draft, ticket activity/audit and browser workflow console. No real payment or outbound message is triggered.
- Shared native/embedded test database setup; new workflow suite covers negative access, changed/expired/tampered approval, duplicate/concurrent execution, rollback and committed-result reconciliation.
- CI now runs the existing evaluation regression command. Browser harness supports isolated embedded runs and optional installed Chrome; native DB path retained.

## Gates not yet complete

Do not mark all phases complete. Native PostgreSQL/Docker/staging and restore evidence, real model/embedding/email/provider smoke tests, actual model specialist orchestration, policy retrieval within the new workflow, merchant-configurable policy, approved-response handoff, bounded poison-job retry/dead-letter handling, retention/erasure, verified email onboarding and representative 200-case reviewed evaluations remain outstanding. Existing 18-case baseline was retained rather than padded with unreviewed examples. No provider budget, live refund, customer messaging, billing, merge or infrastructure purchase was used.

## Immediate continuation

1. Resolve branch CI failures if any; native PostgreSQL tests and browser tests must pass on the exact code commit. Never merge automatically.
2. Address P1 verified email ownership before sensitive team onboarding; scope inbound integration credentials and replay IDs by tenant/provider.
3. Exercise native competing workers, approval/demotion and deadlock recovery; isolate per-run retries with bounded backoff and dead letters.
4. Complete policy retrieval/versioned evidence and customer-order ambiguity handling, add revision and approved reply handoff before calling Phase 3 complete.
5. Add a model planner behind the tested backend authority boundary only after secure project credentials and a small explicit spend budget are configured. Do not put keys in chat or commits.
6. Expand reviewed evaluation data and retrieval judgments, then approved provider smoke tests; verify Docker, backup restore and staging without real customer data.

See `docs/milestone-verification.md`, `docs/engineering-scorecard.md`, `docs/security-review.md`, `docs/agentic-architecture.md` and `docs/release-readiness.md` for evidence and unresolved gates.

## GitHub delivery

Implementation commit `5cef961` was pushed on the dedicated branch and [draft PR #1](https://github.com/vish-go/ticketpilot/pull/1) opened against the existing default branch. No merge or history rewrite was performed. Its first native CI run exposed shared pgvector extension installation inside disposable test schemas; the test setup now provisions that database-wide extension in `public` under the migration advisory lock before schema-scoped migrations. Native suites remain enabled. See the milestone verification report for subsequent CI evidence.
