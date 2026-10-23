# 8. A reproducible runtime

For initial learning, `npm run build` then `npm run dev` can use persistent embedded PostgreSQL in `.local-data` without Docker. The production-style runtime uses external PostgreSQL. A Docker image bundles the application and runtime. Compose starts related processes: API, database, and worker. The database volume persists records across container restarts; deleting it destroys those records unless a backup exists. The Dockerfile builds TypeScript and React in one stage and keeps only runtime dependencies in the final stage.

CI installs the lockfile, checks types, runs tests, builds, and checks known production dependency vulnerabilities. CI passing is evidence about those checks, not proof of a secure live deployment. A health probe checks a running process; readiness should also establish whether dependencies are available.

Use separate staging secrets and data. Apply migrations once before rolling out code, and keep a previous image for rollback. TLS, off-host backups, restore drills, and alerts are deployment responsibilities.

Exercise: run Compose, create a ticket, restart the app, and verify persistence. Read the backup procedure before experimenting with volumes. Deliberately stop the database and compare health/readiness behavior.
