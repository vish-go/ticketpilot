import { z } from "zod";
import { randomUUID } from "node:crypto";
import { type RouteContext, id, email, text, fail } from "../http.js";
import { verifyInbound } from "../email.js";

export function registerIntegrationRoutes(context: RouteContext) {
  const { db, route } = context;
  route("post", "/api/webhooks/inbound", async (req, res) => {
    const secret = process.env.INBOUND_WEBHOOK_SECRET;
    if (
      !secret ||
      !verifyInbound(
        req.rawBody,
        req.get("x-timestamp") || "",
        req.get("x-signature") || "",
        secret,
      )
    )
      fail(401, "Invalid webhook signature");
    const d = z
      .object({
        eventId: z.string().min(1).max(200),
        organizationId: id,
        ticketId: id.optional(),
        from: email,
        subject: z.string().min(1).max(200),
        text,
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const org = (
        await tx.query("SELECT * FROM organizations WHERE id=$1", [
          d.organizationId,
        ])
      ).rows[0];
      if (!org) fail(404, "Workspace not found");
      const inserted = await tx.query(
        "INSERT INTO inbound_events(event_id,org_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id",
        [d.eventId, d.organizationId],
      );
      if (!inserted.rows.length) return;
      let tid = d.ticketId;
      if (tid) {
        const ticket = (
          await tx.query(
            "SELECT * FROM tickets WHERE org_id=$1 AND id=$2 FOR UPDATE",
            [d.organizationId, tid],
          )
        ).rows[0];
        if (!ticket || ticket.customer_email !== d.from)
          fail(404, "Conversation not found");
        await tx.query(
          "UPDATE tickets SET version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2",
          [d.organizationId, tid],
        );
      } else {
        tid = randomUUID();
        await tx.query(
          "INSERT INTO tickets(id,org_id,subject,body,customer_email,response_due_at,resolution_due_at) VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 minute',now()+$7*interval '1 minute')",
          [
            tid,
            d.organizationId,
            d.subject,
            d.text,
            d.from,
            org.response_minutes,
            org.resolution_minutes,
          ],
        );
      }
      await tx.query(
        "INSERT INTO messages(id,org_id,ticket_id,author_name,body) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), d.organizationId, tid, d.from, d.text],
      );
    });
    res.json({ ok: true });
  });
}
