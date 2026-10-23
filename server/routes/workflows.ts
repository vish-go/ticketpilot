import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type RouteContext, id, fail } from "../http.js";
import {
  advanceWorkflow,
  workflowEvent,
  requireWorkflowRole,
  actionHash,
  proposalSchema,
} from "../workflows.js";

export function registerWorkflowRoutes(context: RouteContext) {
  const { db, route, staff, admin, ticket, audit } = context;
  const getRun = async (req: any, tx = db, lock = false) => {
    const run = (
      await tx.query(
        `SELECT * FROM workflow_runs WHERE org_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
        [req.orgId, id.parse(req.params.id)],
      )
    ).rows[0];
    if (!run) fail(404, "Workflow not found");
    return run;
  };
  route("post", "/api/sandbox/orders", async (req, res) => {
    admin(req);
    const d = z.object({ ticketId: id }).strict().parse(req.body);
    const result = await db.transaction(async (tx) => {
      await requireWorkflowRole(tx, req.orgId, req.user.id, ["owner", "admin"]);
      const t = await ticket({ ...req, params: { id: d.ticketId } }, tx, true);
      const order = (
        await tx.query(
          "INSERT INTO sandbox_orders(id,org_id,customer_email,amount_cents,currency) VALUES($1,$2,$3,4999,'INR') RETURNING *",
          [randomUUID(), req.orgId, t.customer_email],
        )
      ).rows[0];
      await audit(tx, req, "sandbox.order.created", order.id);
      return order;
    });
    res.status(201).json(result);
  });
  route("get", "/api/tickets/:id/workflows", async (req, res) => {
    staff(req);
    const t = await ticket(req);
    res.json(
      (
        await db.query(
          "SELECT * FROM workflow_runs WHERE org_id=$1 AND ticket_id=$2 ORDER BY created_at DESC LIMIT 50",
          [req.orgId, t.id],
        )
      ).rows,
    );
  });
  route("post", "/api/tickets/:id/workflows", async (req, res) => {
    staff(req);
    const d = z
      .object({ idempotencyKey: id, orderId: id })
      .strict()
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      // Serialize per-tenant quota/idempotency checks, including concurrent requests.
      await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        req.orgId,
      ]);
      await requireWorkflowRole(tx, req.orgId, req.user.id, [
        "owner",
        "admin",
        "agent",
      ]);
      const t = await ticket(req, tx, true);
      const prior = (
        await tx.query(
          "SELECT * FROM workflow_runs WHERE org_id=$1 AND idempotency_key=$2",
          [req.orgId, d.idempotencyKey],
        )
      ).rows[0];
      if (prior) {
        if (prior.ticket_id !== t.id || prior.order_id !== d.orderId)
          fail(409, "Idempotency key already bound to another request");
        return prior;
      }
      if (["resolved", "closed"].includes(t.status))
        fail(409, "Reopen the ticket first");
      const count = (
        await tx.query(
          "SELECT count(*)::int AS n FROM workflow_runs WHERE org_id=$1 AND state NOT IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT','ESCALATED')",
          [req.orgId],
        )
      ).rows[0].n;
      if (count >= 5)
        fail(429, "Workspace limit of five active sandbox workflows reached");
      const order = (
        await tx.query(
          "SELECT id FROM sandbox_orders WHERE org_id=$1 AND id=$2 AND lower(customer_email)=lower($3)",
          [req.orgId, d.orderId, t.customer_email],
        )
      ).rows[0];
      if (!order) fail(404, "Matching sandbox order not found");
      const run = (
        await tx.query(
          "INSERT INTO workflow_runs(id,org_id,ticket_id,order_id,requested_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            randomUUID(),
            req.orgId,
            t.id,
            d.orderId,
            req.user.id,
            d.idempotencyKey,
          ],
        )
      ).rows[0];
      await workflowEvent(
        tx,
        run,
        "CREATED",
        "orchestrator",
        "create_workflow",
        "Deterministic sandbox workflow created; zero provider tokens or external actions.",
      );
      await audit(tx, req, "workflow.created", run.id);
      return run;
    });
    res.status(201).json(result);
  });
  route("get", "/api/workflows/:id", async (req, res) => {
    staff(req);
    const run = await getRun(req);
    const events = (
      await db.query(
        "SELECT * FROM workflow_events WHERE org_id=$1 AND run_id=$2 ORDER BY created_at,id",
        [req.orgId, run.id],
      )
    ).rows;
    const approvals = (
      await db.query(
        "SELECT * FROM workflow_approvals WHERE org_id=$1 AND run_id=$2 ORDER BY created_at",
        [req.orgId, run.id],
      )
    ).rows;
    res.json({ run, events, approvals });
  });
  route("post", "/api/workflows/:id/decision", async (req, res) => {
    admin(req);
    const d = z
      .object({
        decision: z.enum(["approve", "reject"]),
        actionHash: z.string().regex(/^[a-f0-9]{64}$/),
        reason: z.string().trim().min(1).max(1000),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      const run = await getRun(req, tx, true);
      await requireWorkflowRole(tx, req.orgId, req.user.id, ["owner", "admin"]);
      if (
        run.state !== "AWAITING_APPROVAL" ||
        new Date(run.deadline_at).getTime() <= Date.now()
      )
        fail(409, "Workflow is not awaiting a valid approval");
      if (d.actionHash !== run.action_hash)
        fail(409, "Action changed; refresh the proposal");
      const proposal = proposalSchema.safeParse(run.proposal);
      if (!proposal.success || actionHash(proposal.data) !== d.actionHash)
        fail(409, "Action arguments changed; create a new proposal");
      await tx.query(
        "INSERT INTO workflow_approvals(id,org_id,run_id,actor_id,decision,action_hash,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          req.orgId,
          run.id,
          req.user.id,
          d.decision,
          d.actionHash,
          d.reason,
        ],
      );
      await workflowEvent(
        tx,
        run,
        d.decision === "approve" ? "EXECUTING" : "CANCELLED",
        "human_escalation",
        "record_decision",
        d.decision === "approve"
          ? "Human approved the exact action hash. Execution will independently revalidate it."
          : "Human rejected the proposal; no refund executed.",
      );
      await audit(tx, req, `workflow.${d.decision}`, run.id);
    });
    res.json({ ok: true });
  });
  route("post", "/api/workflows/:id/resume", async (req, res) => {
    staff(req);
    z.object({}).strict().parse(req.body);
    await advanceWorkflow(db, req.orgId, id.parse(req.params.id), req.user.id);
    res.json({ ok: true });
  });
}
