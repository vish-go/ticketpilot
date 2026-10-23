import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";

/** Small reproducible development harness; creates a disposable organization and never deletes other data. */
if (process.env.NODE_ENV === "production")
  throw new Error("Load harness is disabled in production");
const base = new URL(process.env.LOAD_BASE_URL || "http://localhost:3000");
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
  throw new Error("Load harness only targets a local development server");
const dataset = Number(process.env.LOAD_TICKETS || 30);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 4);
if (
  !Number.isInteger(dataset) ||
  dataset < 1 ||
  dataset > 40 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 8
) {
  throw new Error(
    "LOAD_TICKETS must be 1–40; LOAD_CONCURRENCY must be 1–8 (rate-limit-safe bounded smoke load)",
  );
}
const startedAt = new Date().toISOString();
let cookie = "";
let csrf = "";
let organization = "";
type Sample = {
  operation: string;
  durationMs: number;
  status: number;
  ok: boolean;
};
const samples: Sample[] = [];
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  operation?: string,
): Promise<any> {
  const start = performance.now();
  let status = 0;
  try {
    const result = await fetch(new URL(`/api${path}`, base), {
      method,
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...(organization ? { "X-Organization-Id": organization } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    status = result.status;
    if (result.headers.get("set-cookie"))
      cookie = result.headers.get("set-cookie")!.split(";")[0];
    const data = await result.json();
    if (!result.ok) throw new Error(`HTTP ${result.status}`);
    if (operation)
      samples.push({
        operation,
        status,
        ok: true,
        durationMs: performance.now() - start,
      });
    return data;
  } catch (error) {
    if (operation)
      samples.push({
        operation,
        status,
        ok: false,
        durationMs: performance.now() - start,
      });
    throw error;
  }
}
const identity = await request("/auth/register", "POST", {
  name: "Load Test Agent",
  email: `load-${randomBytes(8).toString("hex")}@example.com`,
  password: randomBytes(24).toString("hex"),
  organization: `Load test ${startedAt}`,
});
csrf = identity.csrfToken;
organization = identity.organizations[0].id;
async function concurrent<T>(
  items: T[],
  fn: (value: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          await fn(items[index], index);
        } catch {
          /* Captured individually; never discard failed samples. */
        }
      }
    }),
  );
}
const tickets: any[] = [];
const started = performance.now();
await concurrent(Array.from({ length: dataset }), async (_, index) => {
  const ticket = await request(
    "/tickets",
    "POST",
    {
      subject: `Load delivery request ${index}`,
      body: "My delivery is delayed. Please check order tracking.",
      customerEmail: "synthetic@example.com",
    },
    "create",
  );
  tickets.push(ticket);
});
await concurrent(Array.from({ length: dataset }), async () => {
  await request("/tickets?page=1&q=Load", "GET", undefined, "list");
});
await concurrent(tickets, async (ticket) => {
  await request(
    `/tickets/${ticket.id}`,
    "PATCH",
    { version: ticket.version, status: "in_progress" },
    "update",
  );
});
const elapsedMs = performance.now() - started;
const percentile = (values: number[], fraction: number) =>
  values.length
    ? [...values].sort((a, b) => a - b)[
        Math.max(0, Math.ceil(values.length * fraction) - 1)
      ]
    : null;
const summary = (items: Sample[]) => ({
  requests: items.length,
  errors: items.filter((s) => !s.ok).length,
  errorRate: items.length
    ? items.filter((s) => !s.ok).length / items.length
    : null,
  p50Ms: percentile(
    items.map((s) => s.durationMs),
    0.5,
  ),
  p95Ms: percentile(
    items.map((s) => s.durationMs),
    0.95,
  ),
});
const report = {
  startedAt,
  completedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    cpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
    database:
      process.env.LOAD_DATABASE_DESCRIPTION ||
      "Externally configured server database; describe with LOAD_DATABASE_DESCRIPTION",
  },
  datasetRequested: dataset,
  ticketsCreated: tickets.length,
  concurrency,
  organizationId: organization,
  elapsedMs,
  measuredRequestsPerSecond: samples.length / (elapsedMs / 1000),
  overall: summary(samples),
  operations: Object.fromEntries(
    ["create", "list", "update"].map((operation) => [
      operation,
      summary(samples.filter((s) => s.operation === operation)),
    ]),
  ),
  limitations: `Small local smoke load with synthetic data. Not a scalability benchmark. No warm-up; registration excluded. All latency samples include failures. ${process.env.LOAD_EPHEMERAL === "1" ? "In-memory test database is discarded after this run. Embedded PostgreSQL serializes database operations; this does not test server pooling or multi-process lock contention." : "Test workspace remains for inspection."}`,
};
await mkdir("evaluations", { recursive: true });
await writeFile(
  "evaluations/load-results.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
if (samples.some((s) => !s.ok)) process.exitCode = 1;
