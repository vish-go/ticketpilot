# ADR 0001: A modular monolith with PostgreSQL

Status: accepted for the initial implementation.

TicketPilot needs transactional ticket updates, tenant authorization, and an understandable codebase for a student maintainer. One TypeScript API and one React client share a repository. PostgreSQL is the production database; SQL migrations version its schema. Tests and the beginner development launcher can use PGlite, an embedded PostgreSQL runtime, without requiring Docker. Development persists it in `.local-data`; production uses external PostgreSQL. This does not replace checking a real PostgreSQL deployment.

The API and worker share business modules and a database. A worker handles email delivery and periodic SLA checks outside HTTP requests. PostgreSQL-backed job state avoids a second database. Modules separate authentication, workspaces, tickets, knowledge, AI, email, analytics, and operations; these are code boundaries rather than network services.

Benefits: fewer deployments, atomic writes, one language, and reproducible setup. Trade-offs: API and worker scale together initially; tenant isolation is application enforced and must be covered by negative tests. There is no claim of database row-level security. Splitting services would be justified by measured contention or independently scaling workloads, not by the portfolio's appearance.

AI starts disabled. A local extractive baseline enables repeatable tests; an external model adapter is opt-in. Neither path sends a reply without an agent action.
