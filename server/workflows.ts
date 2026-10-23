import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./db.js";
import { fail } from "./http.js";

// Text from tickets/documents never changes these authorization rules.
export const SANDBOX_POLICY = "delayed-full-refund-v1";
export const proposalSchema = z
  .object({
    orderId: z.string().uuid(),
    amountCents: z.number().int().min(1).max(10000),
    currency: z.literal("INR"),
    orderVersion: z.number().int().positive(),
    ticketVersion: z.number().int().positive(),
    policyVersion: z.literal(SANDBOX_POLICY),
  })
  .strict();
export function actionHash(raw: unknown): string {
  const p = proposalSchema.parse(raw);
  // Fixed field order makes hashes independent of JSONB key ordering.
  return createHash("sha256").update(JSON.stringify(p)).digest("hex");
}
export async function workflowEvent(
  tx: Database,
  run: any,
  state: string,
  capability: string,
  tool: string,
  summary: string,
) {
  await tx.query(
    "INSERT INTO workflow_events(id,org_id,run_id,state,capability,tool,summary) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [randomUUID(), run.org_id, run.id, state, capability, tool, summary],
  );
  await tx.query(
    "UPDATE workflow_runs SET state=$3,updated_at=now() WHERE org_id=$1 AND id=$2",
    [run.org_id, run.id, state],
  );
}
async function audit(
  tx: Database,
  run: any,
  action: string,
  actor: string | null = null,
) {
  await tx.query(
    "INSERT INTO audit_logs(id,org_id,actor_id,action,resource_id) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), run.org_id, actor, action, run.id],
  );
}
export async function requireWorkflowRole(
  tx: Database,
  orgId: string,
  actorId: string,
  roles: string[],
) {
  const member = (
    await tx.query(
      "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE",
      [orgId, actorId],
    )
  ).rows[0];
  if (!member || !roles.includes(member.role))
    fail(403, "Current workspace permissions do not allow this action");
}
const active = [
  "CREATED",
  "TRIAGED",
  "GATHERING_CONTEXT",
  "PLANNING",
  "EXECUTING",
  "VERIFYING",
];

/** One short transaction per deterministic step; a crash rolls the whole step back. No network I/O. */
async function advance(tx: Database, run: any) {
  const transition = (
    state: string,
    capability: string,
    tool: string,
    summary: string,
  ) => workflowEvent(tx, run, state, capability, tool, summary);
  if (!active.includes(run.state)) return;
  if (
    run.state !== "VERIFYING" &&
    new Date(run.deadline_at).getTime() <= Date.now()
  ) {
    await transition(
      "TIMED_OUT",
      "orchestrator",
      "deadline",
      "Workflow deadline exceeded; no action executed.",
    );
    return;
  }
  const member = (
    await tx.query(
      "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE",
      [run.org_id, run.requested_by],
    )
  ).rows[0];
  if (run.state !== "VERIFYING" && (!member || member.role === "customer")) {
    await transition(
      "ESCALATED",
      "policy",
      "permission_check",
      "Initiator no longer has staff access.",
    );
    return;
  }
  if (run.tool_calls >= 12) {
    await transition(
      "FAILED",
      "orchestrator",
      "budget_check",
      "Tool budget exhausted.",
    );
    return;
  }
  await tx.query(
    "UPDATE workflow_runs SET tool_calls=tool_calls+1 WHERE org_id=$1 AND id=$2",
    [run.org_id, run.id],
  );
  const ticket = (
    await tx.query(
      "SELECT * FROM tickets WHERE org_id=$1 AND id=$2 FOR UPDATE",
      [run.org_id, run.ticket_id],
    )
  ).rows[0];
  const order = (
    await tx.query(
      "SELECT * FROM sandbox_orders WHERE org_id=$1 AND id=$2 FOR UPDATE",
      [run.org_id, run.order_id],
    )
  ).rows[0];
  if (
    !ticket ||
    !order ||
    (run.state !== "VERIFYING" &&
      (ticket.customer_email.toLowerCase() !==
        order.customer_email.toLowerCase() ||
        ["resolved", "closed"].includes(ticket.status)))
  ) {
    await transition(
      "ESCALATED",
      "context",
      "lookup_order",
      "Ticket or customer context no longer permits this workflow.",
    );
    return;
  }
  switch (run.state) {
    case "CREATED":
      await transition(
        "TRIAGED",
        "triage",
        "get_ticket",
        "Staff selected the delayed-order sandbox workflow; no model classification is claimed.",
      );
      break;
    case "TRIAGED":
      await transition(
        "GATHERING_CONTEXT",
        "customer_context",
        "lookup_order",
        "Customer email matched a tenant-scoped synthetic order.",
      );
      break;
    case "GATHERING_CONTEXT":
      await transition(
        "PLANNING",
        "delivery",
        "lookup_shipment",
        `Synthetic shipment status: ${order.shipment_status}.`,
      );
      break;
    case "PLANNING": {
      if (
        order.shipment_status !== "delayed" ||
        order.refunded ||
        order.amount_cents > 10000
      ) {
        await transition(
          "ESCALATED",
          "refund_policy",
          "check_refund_eligibility",
          "Sandbox rule requires an unrefunded delayed order at or below INR 100.00.",
        );
        break;
      }
      const proposal = proposalSchema.parse({
        orderId: order.id,
        amountCents: order.amount_cents,
        currency: order.currency,
        orderVersion: order.version,
        ticketVersion: ticket.version,
        policyVersion: SANDBOX_POLICY,
      });
      await tx.query(
        "UPDATE workflow_runs SET proposal=$3,action_hash=$4 WHERE org_id=$1 AND id=$2",
        [run.org_id, run.id, JSON.stringify(proposal), actionHash(proposal)],
      );
      await transition(
        "AWAITING_APPROVAL",
        "human_escalation",
        "request_human_approval",
        `Policy ${SANDBOX_POLICY}: full synthetic refund proposed. Owner/admin approval required; expires one hour after decision.`,
      );
      break;
    }
    case "EXECUTING": {
      const approval = (
        await tx.query(
          "SELECT a.*,m.role FROM workflow_approvals a JOIN memberships m ON m.org_id=a.org_id AND m.user_id=a.actor_id WHERE a.org_id=$1 AND a.run_id=$2 FOR SHARE OF a,m",
          [run.org_id, run.id],
        )
      ).rows[0];
      const parsed = proposalSchema.safeParse(run.proposal);
      if (
        !parsed.success ||
        !approval ||
        approval.decision !== "approve" ||
        !["owner", "admin"].includes(approval.role) ||
        new Date(approval.expires_at).getTime() <= Date.now() ||
        approval.action_hash !== run.action_hash ||
        actionHash(parsed.data) !== run.action_hash ||
        parsed.data.orderId !== order.id ||
        parsed.data.amountCents !== order.amount_cents ||
        parsed.data.currency !== order.currency ||
        parsed.data.ticketVersion !== ticket.version ||
        parsed.data.orderVersion !== order.version ||
        order.refunded ||
        order.shipment_status !== "delayed"
      ) {
        await transition(
          "ESCALATED",
          "policy",
          "execute_approved_refund",
          "Approval expired, authorization changed, or approved resource snapshot changed. Create a new proposal for human review.",
        );
        break;
      }
      await tx.query(
        "INSERT INTO sandbox_refunds(id,org_id,run_id,order_id,amount_cents) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), run.org_id, run.id, order.id, parsed.data.amountCents],
      );
      await tx.query(
        "UPDATE sandbox_orders SET refunded=true,version=version+1 WHERE org_id=$1 AND id=$2",
        [run.org_id, order.id],
      );
      await audit(tx, run, "sandbox.refund.executed", approval.actor_id);
      await transition(
        "VERIFYING",
        "refund",
        "execute_approved_refund",
        "Synthetic refund persisted atomically with workflow state. No external payment was made.",
      );
      break;
    }
    case "VERIFYING": {
      const refund = (
        await tx.query(
          "SELECT amount_cents FROM sandbox_refunds WHERE org_id=$1 AND run_id=$2 AND order_id=$3",
          [run.org_id, run.id, order.id],
        )
      ).rows[0];
      if (!refund || !order.refunded) {
        await transition(
          "FAILED",
          "quality_verification",
          "verify_refund",
          "No matching synthetic refund result was found.",
        );
        break;
      }
      const body = `Sandbox demonstration: a synthetic refund of INR ${(refund.amount_cents / 100).toFixed(2)} was recorded for the delayed order. No real money moved. A human must review and send any customer reply.`;
      await tx.query(
        "UPDATE workflow_runs SET draft_response=$3 WHERE org_id=$1 AND id=$2",
        [run.org_id, run.id, body],
      );
      await tx.query(
        "INSERT INTO activities(id,org_id,ticket_id,actor_id,kind,detail) VALUES($1,$2,$3,NULL,'workflow_completed',$4)",
        [
          randomUUID(),
          run.org_id,
          ticket.id,
          `Sandbox workflow ${run.id} completed. Response available in workflow console; nothing sent.`,
        ],
      );
      await transition(
        "COMPLETED",
        "response_composition",
        "draft_response",
        "Response composed solely from the stored synthetic refund result; retained for human review. No message queued.",
      );
      break;
    }
  }
}
export async function advanceWorkflow(
  db: Database,
  orgId: string,
  runId: string,
  actorId?: string,
) {
  await db.transaction(async (tx) => {
    const run = (
      await tx.query(
        "SELECT * FROM workflow_runs WHERE org_id=$1 AND id=$2 FOR UPDATE",
        [orgId, runId],
      )
    ).rows[0];
    if (!run) fail(404, "Workflow not found");
    if (actorId)
      await requireWorkflowRole(tx, orgId, actorId, [
        "owner",
        "admin",
        "agent",
      ]);
    await advance(tx, run);
  });
}
/** Multiple native PostgreSQL workers skip locked runs; at most one state step per run per batch. */
export async function processWorkflowJobs(db: Database): Promise<number> {
  return db.transaction(async (tx) => {
    const runs = (
      await tx.query(
        "SELECT * FROM workflow_runs WHERE state=ANY($1::text[]) ORDER BY updated_at,id LIMIT 20 FOR UPDATE SKIP LOCKED",
        [active],
      )
    ).rows;
    for (const run of runs) await advance(tx, run);
    // Waiting runs need expiry too, even if no browser ever resumes them.
    const expired = (
      await tx.query(
        "SELECT * FROM workflow_runs WHERE state='AWAITING_APPROVAL' AND deadline_at<=now() LIMIT 20 FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const run of expired)
      await workflowEvent(
        tx,
        run,
        "TIMED_OUT",
        "orchestrator",
        "deadline",
        "Approval was not received before workflow deadline.",
      );
    return runs.length + expired.length;
  });
}
