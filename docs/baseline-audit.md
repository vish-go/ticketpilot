# Local baseline verification — 2026-10-23

This records commands executed in this workspace, not assumptions based on previously written release reports. Initial tracked working tree was clean. Later runs overlapped the team's implementation work; final acceptance must rerun the checks after integration.

## Environment

- macOS 26.6.2, Darwin 25.6.0, arm64; Apple M2, 8 logical CPUs, 8 GiB RAM.
- Node v26.8.1, npm 11.19.0, installed repository dependencies.
- Playwright 1.64.1; no downloaded Playwright browser cache. Installed Google Chrome used via `E2E_CHROMIUM_EXECUTABLE`.
- `psql`, `pg_ctl`, `postgres`, and `docker` are absent from PATH. Homebrew has no PostgreSQL formula installed. No native PostgreSQL or Docker service was available or started.
- No external AI, embeddings, email, paid service, or customer account was used. E2E explicitly selects local AI, disabled embeddings, and disabled email.

## Reproduced checks

| Command | Observed result |
| --- | --- |
| `npm run lint` | Pass. Checks Prettier formatting, not semantic linting. |
| `npm run check` | Pass. TypeScript type checking. |
| `npm test` | Pass: 28 tests, zero failures/skips, about 5.9 seconds. PGlite database for API integration. |
| `npm run build` | Pass: server compilation and Vite client production bundle. |
| `npm run evaluate` | Pass: 18 classification examples, accuracy 0.7222, macro F1 0.7576; all five retrieval/extraction/abstention smoke checks true. Saved in `evaluations/results-local.json`. |
| `npm run load:local` | Pass: 30 tickets, concurrency 4, 90 measured requests, zero errors, overall p50 13.80 ms, p95 44.20 ms. Saved environment and operation details in `evaluations/load-results.json`. |
| `E2E_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e` | Pass: one full authenticated workflow, 18.7 seconds including server build/start. Isolated disposable PGlite data directory. |
| `npm audit --omit=dev --audit-level=high` | Pass against public npm advisory endpoint: zero reported vulnerabilities at execution time. |

Initial sandboxed `npm test` failed because Supertest could not open an ephemeral `127.0.0.1` listener (`EPERM`). The same unchanged tests passed when run with approved loopback access. Browser and HTTP load checks also required that execution permission. The initial sandboxed online audit failed DNS resolution; the approved network run succeeded. An offline audit result was not used as evidence of current advisory status.

The browser test registers a workspace, imports a Markdown policy, creates and assigns a ticket, generates a local cited draft, puts it in the composer, sends a response, resolves the ticket, verifies persistence after reload, denies another tenant's access, and signs out/in.

## Verification tooling corrections

The original Playwright configuration always ran `npm run migrate`, requiring native PostgreSQL even though `npm run dev` supports embedded local PostgreSQL. It now migrates explicitly when `DATABASE_URL` is present; otherwise the development server applies migrations to a unique temporary PGlite directory. This avoids using or modifying existing development data. An optional Chromium executable path permits testing with installed Chrome while retaining Playwright's default browser behavior in CI. Browser reports are ignored by Git.

## Limits and next checks

- PGlite executes PostgreSQL SQL in WASM. These runs do not verify networked PostgreSQL pools, multi-process locking, native pgvector extensions, Docker, deploy/restore behavior, or production capacity.
- `.github/workflows/ci.yml` provisions PostgreSQL/pgvector 16 and runs the API suite using `TEST_DATABASE_URL`, then authenticated browser acceptance using `DATABASE_URL`. This workflow was inspected, but no new GitHub Actions run or native database run was executed as part of this baseline. Existing historical CI links in release documentation are separate evidence.
- The load run is a small local regression smoke test; its measured latency is not a production throughput claim.
- Classification data is handcrafted and small; baseline scores do not establish representative model quality.
- Live external provider calls, production infrastructure, and real email delivery remain unverified.
