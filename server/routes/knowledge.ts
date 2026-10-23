import { z } from "zod";
import { randomUUID } from "node:crypto";
import { type RouteContext, id, fail } from "../http.js";
import { rateLimit } from "express-rate-limit";
import { assist, AIError } from "../ai.js";
import { indexDocument, retrieveDocuments } from "../knowledge.js";

export function registerKnowledgeRoutes(context: RouteContext) {
  const { app, db, route, staff, admin, audit, ticket } = context;
  async function indexSaved(req: any, document: any) {
    try {
      const result = await indexDocument(db, req.orgId, document);
      await db.query(
        "UPDATE documents SET index_status='indexed',index_error=NULL WHERE org_id=$1 AND id=$2 AND content=$3",
        [req.orgId, document.id, document.content],
      );
      return { status: "indexed", ...result };
    } catch (error) {
      if (!(error instanceof AIError)) throw error;
      await db.query(
        "UPDATE documents SET index_status='failed',index_error=$1 WHERE org_id=$2 AND id=$3 AND content=$4",
        [error.message, req.orgId, document.id, document.content],
      );
      return { status: "failed", message: error.message };
    }
  }
  const docSchema = z.object({
    title: z.string().trim().min(2).max(200),
    content: z.string().trim().min(10).max(200000),
  });
  route("get", "/api/documents", async (req, res) => {
    staff(req);
    res.json(
      (
        await db.query(
          "SELECT * FROM documents WHERE org_id=$1 ORDER BY updated_at DESC",
          [req.orgId],
        )
      ).rows,
    );
  });
  route("post", "/api/documents", async (req, res) => {
    admin(req);
    const d = docSchema.parse(req.body),
      did = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO documents(id,org_id,title,content) VALUES($1,$2,$3,$4)",
        [did, req.orgId, d.title, d.content],
      );
      await audit(tx, req, "document.created", did);
    });
    const indexing = await indexSaved(req, { id: did, ...d });
    res.status(201).json({ id: did, ...d, indexing });
  });
  route("patch", "/api/documents/:id", async (req, res) => {
    admin(req);
    const d = docSchema.parse(req.body),
      did = id.parse(req.params.id);
    await db.transaction(async (tx) => {
      const result = await tx.query(
        "UPDATE documents SET title=$1,content=$2,version=version+1,updated_at=now(),index_status='pending',index_error=NULL WHERE org_id=$3 AND id=$4 RETURNING id",
        [d.title, d.content, req.orgId, did],
      );
      if (!result.rows.length) fail(404, "Document not found");
      await audit(tx, req, "document.updated", did);
    });
    const indexing = await indexSaved(req, { id: did, ...d });
    res.json({ ok: true, indexing });
  });
  route("post", "/api/documents/:id/reindex", async (req, res) => {
    admin(req);
    const d = (
      await db.query(
        "SELECT id,title,content,version FROM documents WHERE org_id=$1 AND id=$2",
        [req.orgId, id.parse(req.params.id)],
      )
    ).rows[0];
    if (!d) fail(404, "Document not found");
    res.json(await indexSaved(req, d));
  });
  route("delete", "/api/documents/:id", async (req, res) => {
    admin(req);
    const did = id.parse(req.params.id);
    await db.transaction(async (tx) => {
      const result = await tx.query(
        "DELETE FROM documents WHERE org_id=$1 AND id=$2 RETURNING id",
        [req.orgId, did],
      );
      if (!result.rows.length) fail(404, "Document not found");
      await audit(tx, req, "document.deleted", did);
    });
    res.json({ ok: true });
  });
  app.use(
    "/api/tickets/:id/ai",
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  route("post", "/api/tickets/:id/ai", async (req, res) => {
    staff(req);
    const t = await ticket(req);
    const history = (
      await db.query(
        "SELECT body FROM messages WHERE org_id=$1 AND ticket_id=$2 AND internal=false ORDER BY created_at DESC LIMIT 10",
        [req.orgId, t.id],
      )
    ).rows
      .reverse()
      .map((m) => m.body)
      .join("\n")
      .slice(-20000);
    const org = (
      await db.query("SELECT guidelines FROM organizations WHERE id=$1", [
        req.orgId,
      ])
    ).rows[0];
    const retrieved = await retrieveDocuments(
      db,
      req.orgId,
      `${t.subject} ${t.body}`,
    );
    const result = await assist({
      subject: t.subject,
      body: t.body,
      history,
      documents: [],
      retrieved,
      guidelines: org.guidelines,
    });
    const draft = { id: randomUUID(), ...result };
    await db.transaction(async (tx) => {
      const current = await ticket(req, tx, true);
      if (current.version !== t.version)
        fail(409, "Ticket changed while drafting. Generate again.");
      await tx.query(
        "INSERT INTO drafts(id,org_id,ticket_id,body,citations,category,priority,explanation,provider,ticket_version,latency_ms,usage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          draft.id,
          req.orgId,
          t.id,
          result.body,
          JSON.stringify(result.citations),
          result.category,
          result.priority,
          result.explanation,
          result.provider,
          t.version,
          result.latencyMs,
          JSON.stringify(result.usage || {}),
        ],
      );
    });
    res.status(201).json({
      draft,
      classification: {
        category: result.category,
        priority: result.priority,
        explanation: result.explanation,
      },
    });
  });
  route("post", "/api/drafts/:id/reject", async (req, res) => {
    staff(req);
    const result = await db.query(
      "UPDATE drafts SET status='rejected' WHERE org_id=$1 AND id=$2 AND status='pending' RETURNING id",
      [req.orgId, id.parse(req.params.id)],
    );
    if (!result.rows.length) fail(404, "Pending draft not found");
    res.json({ ok: true });
  });
}
