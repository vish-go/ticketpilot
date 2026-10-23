import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  type RouteContext,
  id,
  email,
  text,
  category,
  priority,
  status,
  fail,
} from "../http.js";

export function registerTicketRoutes(context: RouteContext) {
  const { db, route, staff, admin, audit, activity, ticket } = context;
  route("get", "/api/tickets", async (req, res) => {
    const d = z
      .object({
        q: z.string().max(200).default(""),
        status: status.optional(),
        priority: priority.optional(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        sort: z.enum(["newest", "oldest"]).default("newest"),
      })
      .parse(req.query);
    const params: any[] = [req.orgId, `%${d.q}%`];
    let where = "org_id=$1 AND (subject ILIKE $2 OR body ILIKE $2)";
    if (d.status) {
      params.push(d.status);
      where += ` AND status=$${params.length}`;
    }
    if (d.priority) {
      params.push(d.priority);
      where += ` AND priority=$${params.length}`;
    }
    if (req.role === "customer") {
      params.push(req.user.id);
      where += ` AND created_by=$${params.length}`;
    }
    const count = (
      await db.query(
        `SELECT count(*)::int AS total FROM tickets WHERE ${where}`,
        params,
      )
    ).rows[0].total;
    params.push((d.page - 1) * 20);
    const items = (
      await db.query(
        `SELECT * FROM tickets WHERE ${where} ORDER BY created_at ${d.sort === "oldest" ? "ASC" : "DESC"},id LIMIT 20 OFFSET $${params.length}`,
        params,
      )
    ).rows;
    res.json({ items, total: count, page: d.page, pageSize: 20 });
  });
  route("post", "/api/tickets", async (req, res) => {
    const d = z
      .object({
        subject: z.string().trim().min(3).max(200),
        body: text,
        customerEmail: email,
        priority: priority.default("normal"),
        category: category.default("general_inquiry"),
      })
      .parse(req.body);
    const tid = randomUUID();
    const t = await db.transaction(async (tx) => {
      const org = (
        await tx.query("SELECT * FROM organizations WHERE id=$1", [req.orgId])
      ).rows[0];
      const result = (
        await tx.query(
          "INSERT INTO tickets(id,org_id,created_by,subject,body,customer_email,priority,category,response_due_at,resolution_due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+$9*interval '1 minute',now()+$10*interval '1 minute') RETURNING *",
          [
            tid,
            req.orgId,
            req.user.id,
            d.subject,
            d.body,
            req.role === "customer" ? req.user.email : d.customerEmail,
            d.priority,
            d.category,
            org.response_minutes,
            org.resolution_minutes,
          ],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO messages(id,org_id,ticket_id,author_id,author_name,body) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          req.orgId,
          tid,
          req.user.id,
          req.role === "customer" ? req.user.name : d.customerEmail,
          d.body,
        ],
      );
      await activity(tx, req, tid, "created", "Ticket created");
      return result;
    });
    res.status(201).json(t);
  });
  route("get", "/api/tickets/:id", async (req, res) => {
    const t = await ticket(req);
    const messages = (
      await db.query(
        `SELECT * FROM messages WHERE org_id=$1 AND ticket_id=$2 ${req.role === "customer" ? "AND internal=false" : ""} ORDER BY created_at,id`,
        [req.orgId, t.id],
      )
    ).rows;
    const activities =
      req.role === "customer"
        ? []
        : (
            await db.query(
              "SELECT * FROM activities WHERE org_id=$1 AND ticket_id=$2 ORDER BY created_at",
              [req.orgId, t.id],
            )
          ).rows;
    const drafts =
      req.role === "customer"
        ? []
        : (
            await db.query(
              "SELECT * FROM drafts WHERE org_id=$1 AND ticket_id=$2 ORDER BY created_at DESC",
              [req.orgId, t.id],
            )
          ).rows;
    res.json({ ticket: t, messages, activities, drafts });
  });
  route("patch", "/api/tickets/:id", async (req, res) => {
    staff(req);
    const d = z
      .object({
        version: z.number().int().positive(),
        status: status.optional(),
        priority: priority.optional(),
        category: category.optional(),
        assigneeId: id.nullable().optional(),
        subject: z.string().trim().min(3).max(200).optional(),
      })
      .strict()
      .parse(req.body);
    const updated = await db.transaction(async (tx) => {
      const t = await ticket(req, tx, true);
      if (t.version !== d.version)
        fail(409, "Ticket changed. Refresh before editing.");
      if (d.assigneeId) {
        const m = (
          await tx.query(
            "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 AND role<>'customer'",
            [req.orgId, d.assigneeId],
          )
        ).rows[0];
        if (!m) fail(400, "Assignee must belong to this workspace");
      }
      const result = (
        await tx.query(
          "UPDATE tickets SET status=$1,priority=$2,category=$3,assignee_id=$4,subject=$5,version=version+1,updated_at=now(),resolved_at=CASE WHEN $1 IN ('resolved','closed') THEN COALESCE(resolved_at,now()) ELSE NULL END WHERE org_id=$6 AND id=$7 RETURNING *",
          [
            d.status ?? t.status,
            d.priority ?? t.priority,
            d.category ?? t.category,
            d.assigneeId === undefined ? t.assignee_id : d.assigneeId,
            d.subject ?? t.subject,
            req.orgId,
            t.id,
          ],
        )
      ).rows[0];
      await activity(tx, req, t.id, "updated", JSON.stringify(d));
      return result;
    });
    res.json(updated);
  });
  route("post", "/api/tickets/:id/messages", async (req, res) => {
    const d = z
      .object({
        body: text,
        internal: z.boolean().default(false),
        version: z.number().int().positive(),
        draftId: id.optional(),
      })
      .parse(req.body);
    if (req.role === "customer" && (d.internal || d.draftId))
      fail(403, "Staff access required");
    await db.transaction(async (tx) => {
      const t = await ticket(req, tx, true);
      if (t.version !== d.version)
        fail(409, "Ticket changed. Refresh before replying.");
      if (["closed", "resolved"].includes(t.status))
        fail(409, "Reopen this ticket before replying");
      if (d.draftId) {
        const draft = (
          await tx.query(
            "UPDATE drafts SET status='accepted' WHERE org_id=$1 AND ticket_id=$2 AND id=$3 AND status='pending' AND ticket_version=$4 RETURNING id",
            [req.orgId, t.id, d.draftId, t.version],
          )
        ).rows[0];
        if (!draft) fail(409, "Draft is stale or already reviewed");
      }
      await tx.query(
        "INSERT INTO messages(id,org_id,ticket_id,author_id,author_name,body,internal) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          req.orgId,
          t.id,
          req.user.id,
          req.user.name,
          d.body,
          d.internal,
        ],
      );
      await tx.query(
        "UPDATE tickets SET version=version+1,updated_at=now(),first_response_at=CASE WHEN $1 THEN COALESCE(first_response_at,now()) ELSE first_response_at END WHERE org_id=$2 AND id=$3",
        [!d.internal && req.role !== "customer", req.orgId, t.id],
      );
      if (!d.internal && req.role !== "customer")
        await tx.query(
          "INSERT INTO outbox(id,org_id,ticket_id,recipient,subject,body) VALUES($1,$2,$3,$4,$5,$6)",
          [randomUUID(), req.orgId, t.id, t.customer_email, t.subject, d.body],
        );
      await activity(
        tx,
        req,
        t.id,
        d.internal ? "note" : "reply",
        d.internal ? "Internal note added" : "Reply stored",
      );
    });
    res.status(201).json({ ok: true });
  });
  route("delete", "/api/tickets/:id", async (req, res) => {
    admin(req);
    await db.transaction(async (tx) => {
      const t = await ticket(req, tx, true);
      await tx.query("DELETE FROM tickets WHERE org_id=$1 AND id=$2", [
        req.orgId,
        t.id,
      ]);
      await audit(tx, req, "ticket.deleted", t.id);
    });
    res.json({ ok: true });
  });
}
