# 9. Make failures useful

Unit tests isolate rules. Integration tests exercise routes, authorization, and database operations. Browser tests exercise visible user behavior. Load tests measure a particular workload in a stated environment. These layers answer different questions; one cannot substitute for all the others.

Run `npm run check`, `npm test`, and `npm run build`. Read the first failing assertion and reproduce it before editing. PGlite is embedded PostgreSQL for isolated tests; also run a staging check on PostgreSQL 16. A mocked provider contract is not a live email or model integration test.

Use request IDs to connect safe API errors to logs. Do not add full request-body logs to debug authentication or customer conversations. HTTP 409 usually means the browser has a stale version; refresh and intentionally reapply your change.

Exercise: add a regression test for an agent trying to change organization settings. Break the backend permission check temporarily and confirm the test fails, then restore it. Record an actual test result instead of documenting an expected pass.
