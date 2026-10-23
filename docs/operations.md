# Running, deploying, and recovering TicketPilot

## Local development

Use Node.js 24. Run `npm ci`, `npm run build`, then `AI_PROVIDER=local npm run dev`. No external database is needed for this path: when `DATABASE_URL` is absent, development mode opens PGlite, automatically applies migrations, and persists data in `.local-data`. It serves the built client on port 3000. Register your own workspace. Do not delete `.local-data` unless you intend to discard its tickets.

Copy `.env.example` only when you need configuration; leave its `DATABASE_URL` empty for embedded development. Development, migrate, worker, and seed scripts load `.env` when present. Optional `LOCAL_DATA_DIR` changes the local database directory. The embedded mode is development-only and cannot run through `npm start`.

For Vite live frontend editing, run `APP_ORIGIN=http://localhost:5173 npm run dev` and `npm run dev:web` in separate terminals. Open `http://localhost:5173`. Otherwise rerun `npm run build` after frontend edits.

For external PostgreSQL 16, configure `DATABASE_URL` and run `npm run migrate`, then `npm run build`. Start the built server with `node --env-file=.env dist/server/index.js`; start scheduled work with `npm run worker`. Production requires this external PostgreSQL path and HTTPS. The seed command targets external `DATABASE_URL`; it is not a seed mechanism for `.local-data`.

## Docker Compose

1. Copy `.env.example` to `.env`; set a strong URL-safe `POSTGRES_PASSWORD` and `APP_ORIGIN`.
2. Run `docker compose build` and `docker compose up -d db`.
3. Run `docker compose run --rm app node dist/server/migrate.js`.
4. Run `docker compose up -d app worker`.
5. Inspect `docker compose logs --tail=100 app worker` and `/api/health` plus `/api/ready`.

The app binds to `127.0.0.1:3000`; the database has no host port by default. Compose sets production mode. Production sessions require HTTPS. For local HTTP-only Compose testing, use a temporary Compose override setting `NODE_ENV: development` for the app. Do not carry that override into deployment. Configure your reverse proxy and Express trust-proxy policy together; do not trust arbitrary forwarding headers.

Compose and Docker image execution must be verified on a Docker host before release. A successful TypeScript build is not evidence that a container was run.

## Suggested first deployment

A single small Linux VM with Docker Compose, PostgreSQL on a persistent volume, and Caddy or another HTTPS reverse proxy is a simple initial topology. It keeps operating concepts visible and avoids multiple managed service bills. This is a deployment approach, not a purchase or a promise about current hosting prices. A managed PostgreSQL service is a sensible alternative when operational capacity is limited.

Use a domain you control. Terminate TLS with an automatically renewed certificate and forward requests to the loopback app port. Set `APP_ORIGIN=https://your-domain.example`. Permit public traffic only on 80/443 and your restricted administration channel. Keep PostgreSQL private. Configure a least-privileged runtime database role; migration privileges should be separate in a hardened deployment. Add a provider secret through your host's secret mechanism, not source code or a Docker image layer.

Deploy the same immutable image tested in staging. Back up first, apply migrations once, then start the API and worker. Check health, readiness, login, ticket creation, and the outbox. Do not run migrations from every replica. A staging environment requires a separate database, domain, secrets, and email destination; it must not send test messages to real customers.

## Backup and restore

Schedule encrypted off-host backups and define retention explicitly. A Docker volume on the same VM is not a backup.

```sh
docker compose exec -T db pg_dump -U ticketpilot -d ticketpilot -Fc > ticketpilot-backup.dump
```

Restrict access to backups because they contain customer data. Restore only to an empty isolated database first:

```sh
docker compose exec -T db pg_restore -U ticketpilot -d ticketpilot_restore --no-owner < ticketpilot-backup.dump
```

Create `ticketpilot_restore` before running the command. Verify users, organization counts, representative tickets, and document retrieval. Record the restore duration and acceptable recovery point; neither is measured by this source package. Test restoration regularly.

## Rollback

Keep the previous image available. If a new image fails and the schema remains backward compatible, stop the new app/worker and restart the prior image. Do not blindly reverse a destructive database migration. Restore a backup into a separate database, validate it, and explicitly plan the data-loss window before switching traffic. Favor additive schema changes followed by a later cleanup release.

## Investigation

Use response request IDs to find matching structured API logs. Check database connectivity for readiness failures; do not log `DATABASE_URL`. For stale edits, inspect the latest ticket version and reload rather than overwriting another agent's update. For AI errors, check provider configuration and rate limits, then continue using manual replies. For undelivered email, inspect worker errors, provider status, and retry state. Do not assume that a message stored in TicketPilot was externally delivered.

Metrics in the dashboard describe persisted ticket data. They are not infrastructure monitoring. Add uptime probes, database/volume capacity alarms, process restart alerts, and outbox-age alerts to your hosting environment before a customer pilot. Request logs intentionally omit customer message bodies.

## Knowledge indexing

Document writes persist content before indexing. The response includes indexing state, and the document records `index_status` and an error state. A failed index must not be reported as a successful retrieval update. Owner/admin can retry with POST `/api/documents/:id/reindex`. Updated documents increment their version; retrieval joins current versions so old chunks do not remain valid evidence. Deleting a document cascades its chunks/embeddings.

Default indexing stores bounded overlapping text chunks and uses PostgreSQL full-text search. `EMBEDDING_PROVIDER=openai` additionally calls the embedding endpoint and stores 1536-dimensional vectors in pgvector. Compose includes pgvector. Apply all migrations before enabling embeddings. Set `OPENAI_API_KEY` and optionally `OPENAI_EMBEDDING_MODEL`, reindex existing documents, and verify retrieval. Changing embedding model requires reindexing; results are filtered by the configured model. External embedding requests transmit policy/query content and incur provider costs; this path has not been live-verified merely by passing local tests.

## Email and inbound adapter

`EMAIL_PROVIDER=disabled` permits the local workflow without external delivery. The configured Resend adapter needs a valid API key and verified sender. Its live behavior cannot be validated without those credentials. Inbound requests use a custom HMAC adapter; this is not an assertion of native compatibility with every email provider. Follow the server adapter's exact signature and payload contract, and translate provider webhooks in a trusted gateway if needed.

Keep inbound secrets per environment. Verify timestamps, signatures, and replay handling before connecting an inbox. Do not expose a generic unsigned endpoint. Test threading with new-message and reply events, and retry the same event to check deduplication.
