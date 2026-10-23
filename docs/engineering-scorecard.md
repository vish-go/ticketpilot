# Engineering scorecard — 23 October 2026

Scope: incremental deterministic sandbox milestone. Scores are reviewer judgments against the requested customer-pilot target, not certifications or mathematical measurements. No 10/10 claim. Local evidence is in `baseline-audit.md` and `milestone-verification.md`; native branch [CI passed on `16d7e79`](https://github.com/vish-go/ticketpilot/actions/runs/39939999105). Native migrations and concurrent approval/resume contracts are covered; competing workers, process crashes and representative load are still unmeasured.

| Area | Score / 10 | Evidence | Main weakness / remediation |
| --- | --- | --- | --- |
| Correctness | 7 | API support regressions, exact-action workflow/rollback tests, real Chrome approve/reject flow | Native cross-process races and poison-job failure modes |
| Code quality | 6 | Shared frontend modules, strict proposal schema, typecheck/format/build | App still 1,231 lines; legacy any-based DB/request types; semantic lint absent |
| Architecture | 7 | Tenant foreign keys, modular routes, SQL-owned orchestration, ADR | Network execution boundary and bounded retry engine still needed |
| Security | 5 | Transactional roles, digest/snapshot/expiry checks, negative tenant tests, separate review fixes | Verified email, per-integration credentials, retention and independent penetration review |
| Reliability | 5 | Atomic synthetic actions, durable worker steps, email final-lease recovery | Native contention, lease fencing, batch poison isolation, restore drills |
| Performance | 3 | Reproducible 90-request embedded smoke, five-run tenant cap, indexed run state | No representative native load, fairness or query plan evidence |
| Agentic AI quality | 3 | Deterministic lifecycle/control boundary and existing extractive baseline | No model-driven specialist workflow, tiny evaluation set, no new RAG grounding benchmark |
| Test coverage | 7 | Browser happy/reject journey, authorization, rollback, expiry, duplicate/concurrent requests | Real provider, process-crash, native worker races and broader accessibility coverage |
| Operational maturity | 3 | Existing containers/CI/health/runbook, sanitized events | No deployed staging, container/restore/alert drill, OTel export |
| Documentation / learning | 7 | Reconciled progress, architecture/ADR, evidence and practical exercises | Full mission milestones and hands-on deployment exercises remain |

## Prioritized remediation backlog

Each ID is a local remediation issue, not a claim that a GitHub issue was opened. Related independent findings are detailed in `security-review.md`.

| ID | Priority / release impact | Acceptance evidence |
| --- | --- | --- |
| TP-001 | P1 pilot blocker — verified email before sensitive invites | Expiring single-use verification, preregistration/ownership regression, provider sandbox test |
| TP-002 | P1 real-action blocker — durable provider execution | Scoped adapter, external idempotency, unknown-result reconciliation, bounded retry/dead-letter and crash tests |
| TP-003 | P1 operational blocker — native concurrency and restore | Competing processes, demotion/approval race, lock-order tests, successful backup restore, Docker/staging smoke |
| TP-004 | P1 AI gate — grounded workflow with evaluated planner | Versioned tenant policy evidence, ambiguity escalation, reviewed 200-case corpus, retrieval/grounding/unsafe-action metrics |
| TP-005 | P1 data lifecycle blocker — retention and erasure | Explicit policy, dry-run/jobs, account/org erasure, historical excerpt and backup/provider procedures |
| TP-006 | P1 integration boundary — per-tenant credentials | Credential-resolved org, rotation/revocation, same-event-ID cross-tenant tests, signed webhook contract |
| TP-007 | P2 reliability — lease fencing and transaction composition | Claim-token acknowledgements, paused worker regression, nested transaction behavior tested |
| TP-008 | P2 maintainability — semantic lint and remaining App extraction | Static semantic rules, coherent ticket/team/settings modules, browser regressions unchanged |
| TP-009 | P2 performance — representative native workload | Synthetic 100/1,000-org datasets, query plans, throughput/latency/errors with hardware/duration caveats |
| TP-010 | P2 observability — redacted telemetry and alerts | Collector export, correlated workflow spans, failure/budget alerts, PII redaction tests |
| TP-011 | P2 product — configurable policy and approval revision | Exact new approval after changes, expired proposal recovery, user-friendly evidence and amount rendering |
| TP-012 | P3 polish — broader keyboard/accessibility checks | Measured keyboard journey and automated/manual accessibility findings |

Release decision: suitable for a synthetic engineering demonstration; not ready for real customer data or financial automation.
