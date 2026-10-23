# ADR 0002 — PostgreSQL owns workflow state and approval authority

Date: 2026-10-23. Status: accepted for the deterministic sandbox foundation; model orchestration selection remains provisional until evaluation.

## Context and source review

The current modular TypeScript application already has PostgreSQL transactions, a polling worker, human-reviewed drafts and tenant roles. One approved synthetic refund is a useful first safety boundary. A framework should not own merchant authorization or silently activate external services.

Current npm registry metadata was read on 23 October 2026: `@openai/agents` 0.21.0, `@langchain/langgraph` 1.5.2, `pg-boss` 12.38.0, `@opentelemetry/sdk-node` 0.300.0, `@modelcontextprotocol/sdk` 1.32.1. These are observed release tags, not installed dependencies, compatibility tests, or permanent latest-version claims. PostgreSQL's current documentation identifies 18 as current stable and 19 as development; retain the project's PostgreSQL 16 CI/deployment baseline until a deliberate upgrade is tested. pgvector's current repository was reviewed; the Compose pg16 image is not digest-pinned and its extension release was not measured locally.

| Option | Decision and reason |
| --- | --- |
| OpenAI Agents SDK / Responses API | Preferred candidate for later model-driven tool selection and structured outputs. No SDK added yet: the current flow has no need for a model call and no approved inference budget. The backend will validate every proposal and own durable approval regardless of framework. [OpenAI agents documentation](https://developers.openai.com/api/docs/guides/agents), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs). |
| LangGraph | Deferred. Checkpoint persistence is valuable for branching model workflows, but a second graph runtime does not yet justify maintaining another state model alongside simple SQL transitions. Revisit only with a concrete branching/recovery requirement. [Official persistence documentation](https://docs.langchain.com/oss/javascript/langgraph/persistence). |
| MCP | Deferred to approved remote integrations. Transport authorization is distinct from application permission checks; no arbitrary server URL, credential forwarding or privileged tool discovery is exposed. [Official authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization). |
| PostgreSQL / pgvector | Retain existing relational and optional vector paths; they preserve tenant/version filtering without a new database. Workflow foundation uses relational state only; no new retrieval quality claim. [PostgreSQL SELECT locking](https://www.postgresql.org/docs/current/sql-select.html), [pgvector project](https://github.com/pgvector/pgvector). |
| pg-boss versus custom queue | Existing short SQL state machine selected for this sandbox. pg-boss is the stronger candidate when scheduling, bounded retries, dead letters, network jobs and backpressure are added. Avoid claiming the current worker has those features. Redis is unnecessary for this checkpoint. [Official pg-boss documentation](https://pgboss.io/). |
| OpenTelemetry | Deferred exporter installation. Workflow events plus existing correlation IDs provide local inspectability, not distributed tracing. Add the OTel Node SDK and redaction tests when a collector/staging runtime exists. [JavaScript status](https://opentelemetry.io/docs/languages/js/). |

## Consequences

No framework dependency or cloud expense is introduced. The same approval tests can be run against future planner implementations. The trade-off is explicit SQL orchestration code and an intentionally narrow workflow rather than broad autonomous reasoning. Real network actions need an outbox/claim/reconciliation design instead of extending a transaction across HTTP. Integration frameworks, ten model agents, durable external retries, hybrid RAG and telemetry exports are not delivered by this decision.

Security design follows least privilege and independent tool authorization, consistent with the [OWASP GenAI Security Project](https://owasp.org/projects/top-10-for-large-language-model-applications). Documentation review is not a security certification.
