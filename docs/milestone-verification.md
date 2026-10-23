# Sandbox workflow milestone verification — 2026-10-23

Final local acceptance was rerun after the workflow authorization, proposal integrity, concurrent execution, and post-execution reconciliation changes. Environment and initial baseline are recorded in [baseline-audit.md](baseline-audit.md).

## Executed checks

| Command | Final observed result |
| --- | --- |
| `npm test` | **38 passed, zero failures or skips**, 7.3 seconds. Uses embedded PostgreSQL/PGlite locally. |
| `npm run check` | TypeScript checks passed. |
| `npm run lint` | Prettier checks passed. |
| `npm run build` | Server compilation and production client build passed; 25 frontend modules. |
| `npm run evaluate` | 18 handcrafted classification examples; accuracy 0.7222, macro F1 0.7576; all five retrieval/extraction/abstention smoke checks passed. No larger dataset or live model claim. |
| `E2E_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e` | Full authenticated browser acceptance passed, 11.6 seconds including build/start. Google Chrome with isolated temporary PGlite data. |

The production npm advisory check also passed earlier in this session with zero reported vulnerabilities. No dependency changes were made after that check. The baseline HTTP smoke load and its limitations are recorded separately; it was not used as a workflow concurrency benchmark.

## Browser acceptance

The test registers a real synthetic workspace through the UI, imports a Markdown policy, creates and assigns a ticket, and exercises both human decision paths:

1. Create a synthetic order and start a persisted workflow.
2. Advance through triage, context gathering and planning to `AWAITING_APPROVAL`.
3. Reject the first exact proposal, verify persisted `CANCELLED` state and recorded rejection.
4. Create a second synthetic order/run, review its proposal and approve the exact action hash with a reason.
5. Advance to `VERIFYING` and then `COMPLETED`, verify the recorded approval matches the action hash and the execution tool appears in the event trail.
6. Verify the response remains a draft, no message POST occurs, and the ticket's stored messages remain unchanged.
7. Continue the ordinary cited local AI reply, human send, resolution, reload persistence, logout and login workflow.
8. Confirm another tenant receives 404 when reading the workflow and ticket, and 403 when impersonating the owning workspace.

The screenshot below is captured directly by Playwright from the tested application with synthetic data. It shows the drawer scrolled to the retained draft; upper workflow controls and the longer timeline require normal drawer scrolling. The draft and action hash are readable with no horizontal clipping at the 1280×720 test viewport. This is desktop evidence, not a complete accessibility or mobile audit.

![Completed synthetic refund draft in the actual application](screenshots/sandbox-workflow.png)

## Database and reliability assertions

The workflow integration suite verifies tenant-scoped lookup, start idempotency, role boundaries, exact approval hashes, persisted worker progression, a single synthetic refund, zero queued customer email, changed ticket/order context, proposal tampering, approval expiry, approver removal, monetary/tool budgets, workflow deadlines, ambiguous customer context, concurrent approvals/resumes, and rollback of refund/state on simulated failure. Post-execution verification still reconciles a committed synthetic refund when the deadline passes or the ticket closes.

The email regression verifies that a crash during the final delivery attempt becomes a terminal failure after its lease expires rather than remaining stranded indefinitely.

## Verification boundary

- All actions and refunds are synthetic database operations. No real payment, customer email, external AI request, embedding request or paid provider was triggered.
- Locally observed concurrency uses PGlite, which serializes database transactions. It verifies application idempotency and invariants under concurrent requests, not native PostgreSQL connection-pool contention or multi-process row locks.
- Native PostgreSQL was unavailable locally. The subsequent successful GitHub Actions run below validates native migrations/API/workflow tests and browser acceptance on the pgvector/PostgreSQL service. It does not establish broader vector retrieval quality, multi-process worker crash recovery, Docker application deployment or production performance.
- No live/staging deployment, restore drill, representative model evaluation, multilingual assessment or production capacity claim follows from these checks.

## Native CI defect and remediation

The [first branch run](https://github.com/vish-go/ticketpilot/actions/runs/39939744845) on `5cef961` failed in native migrations: parallel isolated API/workflow schemas could observe an already installed pgvector extension whose `vector` type lived in the other suite's schema. Native extension objects are database-wide; the embedded runtime did not exercise this path. The test setup now provisions the optional extension in `public` under the same advisory lock before running schema-isolated application migrations. No test was disabled, serialized away, or relaxed. Local API/workflow regressions and TypeScript were rerun; the subsequent GitHub run provides native validation. [Draft PR #1](https://github.com/vish-go/ticketpilot/pull/1) preserves the existing default branch.

## Native CI success and delivery

[GitHub Actions run 39939999105](https://github.com/vish-go/ticketpilot/actions/runs/39939999105) **passed** on code commit `16d7e793f32888f63a8938cda5f4886a5c58364b`: reproducible `npm ci`, formatting, typecheck, all 38 tests (API and workflow suites use native PostgreSQL), evaluation, production build, online production dependency audit and full Chromium acceptance. The job's pgvector/PostgreSQL 16 service initialized successfully, migrations ran across parallel isolated schemas, and the new concurrent approval/resume test passed with a real connection pool. Those assertions do not cover all native worker-contention scenarios.

[Draft PR #1](https://github.com/vish-go/ticketpilot/pull/1) contains the implementation and evidence. No merge was performed. A final documentation/comment-only commit records this observed code result; it changes no executable behavior. Native test setup requires a dedicated test database: application fixtures are disposable schemas, but optional pgvector is installed once in `public` and intentionally retained. An extension already installed in another schema is not automatically moved or dropped.
