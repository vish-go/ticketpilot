# 10. Explain what you own

Use concrete examples from code and measured checks. Do not claim deployments, throughput, or model quality that you have not verified.

- **Architecture:** a modular monolith avoids network-service overhead while keeping authentication, tickets, knowledge, AI, and jobs separable.
- **Tenancy:** the session identifies the user; membership authorizes the selected organization; SQL scopes records. Negative tests try direct cross-tenant access.
- **Security:** bcrypt protects password storage, opaque sessions support revocation, CSRF protects cookie-authenticated mutations, and roles are enforced server-side.
- **Persistence:** transactions keep ticket and activity writes consistent; foreign keys protect relationships.
- **Concurrency:** a version condition detects stale edits and returns a conflict so an agent can review the latest data.
- **Jobs:** slow or retryable external delivery runs outside the request lifecycle. Persisted job state survives process restarts; exactly-once external delivery is not promised.
- **AI:** authorized policy retrieval precedes drafting; citations and abstention help human review. Structured JSON and injection filters are risk controls, not a guarantee of truth.
- **Testing:** deterministic integration tests exercise boundaries; external-provider and production-runtime checks need separate evidence.
- **Failure:** database outages affect readiness, AI outages allow manual work, and deployments can fail because of migrations, environment differences, or secrets.
- **Growth:** first measure query plans, connection saturation, response percentiles, and worker lag. Add indexes or process capacity before introducing services.

Resume wording should follow the release report. A defensible starting sentence is: "Built a TypeScript customer-support application with PostgreSQL persistence, workspace-scoped authorization, and human-reviewed AI drafting." Add counts and performance only when an actual recorded run supports them.

Exercise: demonstrate one ticket journey without reading a script. Then point to the query and test that enforce its tenant boundary. Explain one current limitation and the next experiment you would run.
