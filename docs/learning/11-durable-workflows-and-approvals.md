# Follow one approved synthetic refund

Start in `client/components/WorkflowConsole.tsx`. The UI passes your session-bound CSRF token and organization header through the existing API helper. `server/app.ts` verifies session and tenant membership before `server/routes/workflows.ts` accepts a command. A button being hidden does not grant or deny permission: the server rechecks the role inside the transaction.

Creating a run writes a durable record with a tenant-specific idempotency key. Read migration `004_workflows.sql`: a composite foreign key prevents a run from referencing another organization's ticket or order. Follow `advanceWorkflow` in `server/workflows.ts`. Each call locks the run and performs one transition, then commits. Restarting the process does not erase the state. The worker can continue without an open browser.

Approval is a record attached to the exact proposal. Try changing one amount after approval: the hash no longer matches and execution escalates. Try changing the ticket version instead: the hash still matches its proposal, but the current ticket snapshot no longer matches, so execution still escalates. These protect different failure modes. A model explanation cannot replace either check.

The synthetic refund insert, order update, audit record and `VERIFYING` state share one transaction. If an exception occurs, all roll back. A provider's HTTP request cannot participate in this database transaction. A future real refund therefore needs a stable provider idempotency key and a way to reconcile an unknown result after a timeout. Saying “exactly once” does not make that distributed problem disappear.

## What changed and why

- `server/workflows.ts`, `server/routes/workflows.ts` and migration 004 provide durable state, strict proposal validation, permissions, exact-action approvals and synthetic execution.
- `server/worker.ts` resumes pending steps and fixes exhausted email lease recovery.
- `tests/workflows.test.ts` covers tenant/role denial, rejection, stale/expired/tampered approval, resource changes, worker progression, duplicate/concurrent requests and rollback.
- `client/pages/`, `client/components/`, `client/lib/` and `client/types.ts` extract reusable frontend responsibilities and display the evidence.
- `tests/database.ts` shares isolated embedded/native test database setup without dropping shared application data.

## Debug it

Inspect the workflow state, timeline and approval history first. `ESCALATED` means a precondition requires a human to reconsider; start a new proposal after resolving it. `TIMED_OUT` means the pre-action deadline elapsed. A run left in `EXECUTING` after a database exception can be retried because the synthetic step is atomic. Inspect sanitized worker logs for job failures. Native PostgreSQL deadlocks abort a transaction; reproduce lock ordering with two real connections before changing SQL.

A committed refund can still be in `VERIFYING`; do not blindly issue another refund. Verification must reconcile the stored result even if the ticket has since closed. The response remains a draft and no email is queued.

## Practice

1. Run `node --import tsx --test tests/workflows.test.ts`. Read the crash-injection test and explain which writes disappear on rollback.
2. Use the UI to reject one run, approve another, and compare the timeline. Explain who can approve and why an ordinary staff agent cannot.
3. Change a test so the approval expires before execution. Predict the state and refund row count before running it.
4. Draw a sequence diagram for a real provider timeout after it accepts a refund. Design reconciliation before writing a real adapter.
5. Explain why PGlite concurrent request tests cannot establish multi-process PostgreSQL correctness. Re-run with `TEST_DATABASE_URL` against a disposable native database.
6. Review the existing `App.tsx` and identify the next coherent component to extract. It is smaller but still has substantial workspace and ticket state.

Interview boundary: you can explain durable deterministic orchestration, transactional synthetic execution and exact approvals using implemented code. Do not describe this checkpoint as ten intelligent autonomous agents, live payment automation, or a production system.
