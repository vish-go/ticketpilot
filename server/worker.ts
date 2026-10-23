import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { EmailError, sendEmail } from "./email.js";
import { processWorkflowJobs } from "./workflows.js";

interface JobDatabase {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, any>[]; rowCount?: number | null }>;
  transaction<T>(work: (tx: JobDatabase) => Promise<T>): Promise<T>;
}

/** Claims one bounded batch. Transactions do not remain open across provider network calls. */
export async function processJobs(
  database: JobDatabase,
): Promise<{ sent: number; failed: number; escalated: number }> {
  const stats = { sent: 0, failed: 0, escalated: 0 };
  // Expired leases are recoverable after a crashed process. Resend idempotency keys limit duplicate sends.
  // The lease is longer than the provider timeout; processing status cannot be claimed by another worker.
  const jobs = await database.transaction(async (tx) => {
    await tx.query(`UPDATE outbox SET
      status=CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
      last_error=CASE WHEN attempts >= 5 THEN 'lease_expired' ELSE last_error END,
      locked_at=NULL
      WHERE status='processing' AND locked_at < now() - interval '5 minutes'`);
    const { rows } = await tx.query(`SELECT * FROM outbox
      WHERE status='pending' AND available_at <= now() AND attempts < 5
      ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`);
    const claimed = [];
    for (const row of rows) {
      const result = await tx.query(
        `UPDATE outbox SET status='processing', locked_at=now(), attempts=attempts+1
        WHERE id=$1 RETURNING *`,
        [row.id],
      );
      claimed.push(result.rows[0]);
    }
    return claimed;
  });
  for (const job of jobs) {
    try {
      const delivered = await sendEmail({
        to: job.recipient,
        subject: job.subject,
        text: job.body,
        threadId: `<ticket-${job.ticket_id}@ticketpilot.local>`,
        idempotencyKey: job.id,
      });
      await database.query(
        `UPDATE outbox SET status='sent', provider_id=$2, locked_at=NULL, last_error=NULL
        WHERE id=$1 AND status='processing'`,
        [job.id, delivered.id],
      );
      stats.sent++;
    } catch (error) {
      const code = error instanceof EmailError ? error.code : "unavailable";
      const attempts = Number(job.attempts);
      const retryAt = new Date(
        Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000,
      );
      await database.query(
        `UPDATE outbox SET status=$2, available_at=$3, locked_at=NULL, last_error=$4
        WHERE id=$1 AND status='processing'`,
        [job.id, attempts >= 5 ? "failed" : "pending", retryAt, code],
      );
      stats.failed++;
    }
  }
  stats.escalated = await database.transaction(async (tx) => {
    const { rows } =
      await tx.query(`UPDATE tickets SET priority=CASE WHEN priority='urgent' THEN 'urgent' ELSE 'high' END,
      escalated_at=now(), updated_at=now(), version=version+1
      WHERE status NOT IN ('resolved','closed') AND escalated_at IS NULL
      AND ((first_response_at IS NULL AND response_due_at < now()) OR resolution_due_at < now())
      RETURNING id, org_id`);
    for (const row of rows) {
      await tx.query(
        `INSERT INTO activities(id,org_id,ticket_id,actor_id,kind,detail)
        VALUES($1,$2,$3,NULL,'sla_escalated','SLA target exceeded; priority escalated')`,
        [randomUUID(), row.org_id, row.id],
      );
    }
    return rows.length;
  });
  return stats;
}

async function run(): Promise<void> {
  const { db } = await import("./db.js");
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopping = true;
    if (timer) clearTimeout(timer);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  while (!stopping) {
    try {
      const result = await processJobs(db);
      const workflowSteps = await processWorkflowJobs(db);
      console.log(
        JSON.stringify({ event: "jobs_processed", ...result, workflowSteps }),
      );
    } catch {
      console.error(JSON.stringify({ event: "jobs_failed" }));
    }
    if (!stopping)
      await new Promise<void>((resolve) => {
        const finish = () => {
          if (timer) clearTimeout(timer);
          process.off("SIGTERM", finish);
          process.off("SIGINT", finish);
          resolve();
        };
        process.once("SIGTERM", finish);
        process.once("SIGINT", finish);
        timer = setTimeout(finish, 30_000);
      });
  }
  await db.close();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run().catch(() => {
    console.error(JSON.stringify({ event: "worker_start_failed" }));
    process.exitCode = 1;
  });
}
