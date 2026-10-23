import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { EmailError, sendEmail, verifyInbound } from "../server/email.js";
import { processJobs } from "../server/worker.js";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const originalFetch = globalThis.fetch;
const environment = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ["EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM"]) {
    if (environment[key] === undefined) delete process.env[key];
    else process.env[key] = environment[key];
  }
});

test("inbound signature verifies exact raw bytes with fresh timestamp", () => {
  const raw = Buffer.from('{"hello":"world"}');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", "test-secret")
    .update(`${timestamp}.`)
    .update(raw)
    .digest("hex");
  assert.equal(verifyInbound(raw, timestamp, signature, "test-secret"), true);
  assert.equal(
    verifyInbound(raw, timestamp, `sha256=${signature}`, "test-secret"),
    true,
  );
  assert.equal(
    verifyInbound(
      Buffer.from('{ "hello":"world"}'),
      timestamp,
      signature,
      "test-secret",
    ),
    false,
  );
  assert.equal(verifyInbound(raw, timestamp, signature, "other-secret"), false);
});

test("signature rejects stale and future replays, malformed input and empty secret", () => {
  const raw = Buffer.from("event");
  for (const delta of [-301, 301]) {
    const timestamp = String(Math.floor(Date.now() / 1000) + delta);
    const signature = createHmac("sha256", "secret")
      .update(`${timestamp}.`)
      .update(raw)
      .digest("hex");
    assert.equal(verifyInbound(raw, timestamp, signature, "secret"), false);
  }
  assert.equal(verifyInbound(raw, "NaN", "f".repeat(64), "secret"), false);
  assert.equal(
    verifyInbound(raw, String(Math.floor(Date.now() / 1000)), "00", "secret"),
    false,
  );
  assert.equal(
    verifyInbound(
      raw,
      String(Math.floor(Date.now() / 1000)),
      "z".repeat(64),
      "secret",
    ),
    false,
  );
  assert.equal(
    verifyInbound(
      raw,
      String(Math.floor(Date.now() / 1000)),
      "f".repeat(64),
      "",
    ),
    false,
  );
});

test("disabled delivery produces explicit failure rather than fake success", async () => {
  process.env.EMAIL_PROVIDER = "disabled";
  await assert.rejects(
    sendEmail({ to: "test@example.com", subject: "Test", text: "hello" }),
    (error: unknown) =>
      error instanceof EmailError && error.code === "disabled",
  );
});

test("Resend adapter includes stable idempotency and threading and checks result", async () => {
  process.env.EMAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "support@example.com";
  globalThis.fetch = (async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(
      (init?.headers as Record<string, string>)["Idempotency-Key"],
      "outbox-123",
    );
    const body = JSON.parse(String(init?.body));
    assert.equal(body.headers["In-Reply-To"], "<thread@example.com>");
    assert.equal(body.text, "hello");
    return new Response(JSON.stringify({ id: "mail-123" }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(
    await sendEmail({
      to: "test@example.com",
      subject: "Test",
      text: "hello",
      threadId: "<thread@example.com>",
      idempotencyKey: "outbox-123",
    }),
    { id: "mail-123" },
  );
});

test("provider failure sanitizes secrets and response contents", async () => {
  process.env.EMAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "secret-key";
  process.env.EMAIL_FROM = "support@example.com";
  globalThis.fetch = (async () =>
    new Response("private provider error", { status: 500 })) as typeof fetch;
  await assert.rejects(
    sendEmail({ to: "test@example.com", subject: "Test", text: "hello" }),
    (error: unknown) =>
      error instanceof EmailError &&
      error.code === "unavailable" &&
      !error.message.includes("private"),
  );
});

test("durable worker retries failures, recovers leases, and escalates each overdue ticket once", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      await readFile(
        new URL("../migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    const org = randomUUID();
    const ticket = randomUUID();
    const outbox = randomUUID();
    await pg.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
      org,
      "Worker test",
    ]);
    await pg.query(
      `INSERT INTO tickets(id,org_id,subject,body,customer_email,response_due_at,resolution_due_at)
      VALUES($1,$2,'Overdue','Question','test@example.com',now()-interval '1 hour',now()+interval '1 hour')`,
      [ticket, org],
    );
    await pg.query(
      `INSERT INTO outbox(id,org_id,ticket_id,recipient,subject,body,status,attempts,locked_at)
      VALUES($1,$2,$3,'test@example.com','Test','hello','processing',4,now()-interval '6 minutes')`,
      [outbox, org, ticket],
    );
    const wrap = (connection: any): any => ({
      query: async (sql: string, params?: unknown[]) => {
        const result = await connection.query(sql, params);
        return { rows: result.rows, rowCount: result.affectedRows ?? null };
      },
      transaction: async (work: (tx: any) => Promise<unknown>) =>
        connection.transaction((tx: any) => work(wrap(tx))),
    });
    process.env.EMAIL_PROVIDER = "disabled";
    assert.deepEqual(await processJobs(wrap(pg)), {
      sent: 0,
      failed: 1,
      escalated: 1,
    });
    const job = (
      await pg.query(
        "SELECT status,attempts,last_error,locked_at FROM outbox WHERE id=$1",
        [outbox],
      )
    ).rows[0];
    assert.deepEqual(job, {
      status: "failed",
      attempts: 5,
      last_error: "disabled",
      locked_at: null,
    });
    assert.deepEqual(await processJobs(wrap(pg)), {
      sent: 0,
      failed: 0,
      escalated: 0,
    });
    const events = await pg.query(
      "SELECT * FROM activities WHERE ticket_id=$1 AND kind='sla_escalated'",
      [ticket],
    );
    assert.equal(events.rows.length, 1);
    const updated = (
      await pg.query("SELECT priority,version FROM tickets WHERE id=$1", [
        ticket,
      ])
    ).rows[0];
    assert.deepEqual(updated, { priority: "high", version: 2 });
  } finally {
    await pg.close();
  }
});

test("a crash during the final email attempt becomes terminal after lease expiry", async () => {
  const pg = new PGlite();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    throw new Error("Expired final attempts must not call the provider");
  };
  try {
    await pg.exec(
      await readFile(
        new URL("../migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    const org = randomUUID(),
      ticket = randomUUID(),
      outbox = randomUUID();
    await pg.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
      org,
      "Crash recovery",
    ]);
    await pg.query(
      `INSERT INTO tickets(id,org_id,subject,body,customer_email,response_due_at,resolution_due_at)
       VALUES($1,$2,'Question','Question','test@example.com',now()+interval '1 hour',now()+interval '2 hours')`,
      [ticket, org],
    );
    await pg.query(
      `INSERT INTO outbox(id,org_id,ticket_id,recipient,subject,body,status,attempts,locked_at)
       VALUES($1,$2,$3,'test@example.com','Test','hello','processing',5,now()-interval '6 minutes')`,
      [outbox, org, ticket],
    );
    const wrap = (connection: any): any => ({
      query: (sql: string, params?: unknown[]) => connection.query(sql, params),
      transaction: (work: (tx: any) => Promise<unknown>) =>
        connection.transaction((tx: any) => work(wrap(tx))),
    });
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "synthetic-test-key";
    process.env.EMAIL_FROM = "test@example.com";
    await processJobs(wrap(pg));
    assert.deepEqual(
      (
        await pg.query(
          "SELECT status,attempts,last_error,locked_at FROM outbox WHERE id=$1",
          [outbox],
        )
      ).rows[0],
      {
        status: "failed",
        attempts: 5,
        last_error: "lease_expired",
        locked_at: null,
      },
    );
    await processJobs(wrap(pg));
    assert.equal(providerCalls, 0);
    assert.equal(
      (
        await pg.query<{ status: string }>(
          "SELECT status FROM outbox WHERE id=$1",
          [outbox],
        )
      ).rows[0]?.status,
      "failed",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await pg.close();
  }
});
