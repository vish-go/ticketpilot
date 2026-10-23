import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, createHmac, randomBytes } from "node:crypto";
import supertest from "supertest";
import { createApp } from "../server/app.js";

import { testDatabase } from "./database.js";

test("API integration: durable support workflow and negative security boundaries", async (t) => {
  process.env.NODE_ENV = "test";
  process.env.AI_PROVIDER = "local";
  process.env.EMBEDDING_PROVIDER = "disabled";
  process.env.EMAIL_PROVIDER = "disabled";
  const { db, dispose } = await testDatabase();
  const app = createApp(db);
  const owner = supertest.agent(app),
    outsider = supertest.agent(app),
    customer = supertest.agent(app);
  let ownerMe: any, outsiderMe: any, customerMe: any, ticket: any, draft: any;
  const registration = (name: string) => ({
    name,
    email: `${name.toLowerCase()}@example.com`,
    password: "Unique-test-password-2026",
    organization: `${name} workspace`,
  });
  const scoped = (
    request: any,
    identity: any,
    orgId = identity.organizations[0].id,
  ) =>
    request
      .set("X-Organization-Id", orgId)
      .set("X-CSRF-Token", identity.csrfToken);
  try {
    await t.test(
      "registration persists secure credential/session state and rejects duplicate/invalid registration",
      async () => {
        ownerMe = (
          await owner
            .post("/api/auth/register")
            .send(registration("Owner"))
            .expect(201)
        ).body;
        outsiderMe = (
          await outsider
            .post("/api/auth/register")
            .send(registration("Outsider"))
            .expect(201)
        ).body;
        customerMe = (
          await customer
            .post("/api/auth/register")
            .send(registration("Customer"))
            .expect(201)
        ).body;
        assert.equal(ownerMe.organizations[0].role, "owner");
        assert.equal(ownerMe.user.password_hash, undefined);
        const stored = (
          await db.query("SELECT password_hash FROM users WHERE id=$1", [
            ownerMe.user.id,
          ])
        ).rows[0];
        assert.match(stored.password_hash, /^\$2[aby]\$/);
        assert.notEqual(stored.password_hash, registration("Owner").password);
        const sessions = (
          await db.query("SELECT token_hash FROM sessions WHERE user_id=$1", [
            ownerMe.user.id,
          ])
        ).rows;
        assert.match(sessions[0].token_hash, /^[a-f0-9]{64}$/);
        await supertest(app)
          .post("/api/auth/register")
          .send(registration("Owner"))
          .expect(409);
        await supertest(app)
          .post("/api/auth/register")
          .send({ ...registration("Invalid"), password: "short" })
          .expect(400);
        await supertest(app)
          .post("/api/auth/register")
          .send({ ...registration("Unicode"), password: "界".repeat(25) })
          .expect(400);
      },
    );
    await t.test(
      "unauthenticated, CSRF, and foreign-origin requests are rejected",
      async () => {
        await supertest(app).get("/api/tickets").expect(401);
        await owner
          .post("/api/tickets")
          .set("X-Organization-Id", ownerMe.organizations[0].id)
          .send({})
          .expect(403);
        await scoped(owner.post("/api/tickets"), ownerMe)
          .set("Origin", "https://attacker.example")
          .send({})
          .expect(403);
        await scoped(
          owner.get("/api/tickets"),
          ownerMe,
          outsiderMe.organizations[0].id,
        ).expect(403);
      },
    );
    await t.test(
      "create, assign, reopen connection, reply, and resolve a stored ticket",
      async () => {
        ticket = (
          await scoped(owner.post("/api/tickets"), ownerMe)
            .send({
              subject: "Delayed delivery",
              body: "Where is my delivery order? It is delayed.",
              customerEmail: "buyer@example.com",
              category: "delivery",
            })
            .expect(201)
        ).body;
        assert.equal(ticket.version, 1);
        ticket = (
          await scoped(owner.patch(`/api/tickets/${ticket.id}`), ownerMe)
            .send({
              version: ticket.version,
              assigneeId: ownerMe.user.id,
              status: "in_progress",
            })
            .expect(200)
        ).body;
        const login = supertest.agent(app);
        const me = (
          await login
            .post("/api/auth/login")
            .send({
              email: registration("Owner").email,
              password: registration("Owner").password,
            })
            .expect(200)
        ).body;
        const reopened = (
          await scoped(login.get(`/api/tickets/${ticket.id}`), me).expect(200)
        ).body;
        assert.equal(reopened.ticket.id, ticket.id);
        assert.equal(reopened.ticket.assignee_id, me.user.id);
        await scoped(owner.post(`/api/tickets/${ticket.id}/messages`), ownerMe)
          .send({
            version: ticket.version,
            body: "Our shipping team is checking your order.",
            internal: false,
          })
          .expect(201);
        ticket = (
          await scoped(owner.get(`/api/tickets/${ticket.id}`), ownerMe).expect(
            200,
          )
        ).body.ticket;
        assert.ok(ticket.first_response_at);
        assert.equal(
          (
            await db.query("SELECT * FROM outbox WHERE ticket_id=$1", [
              ticket.id,
            ])
          ).rows.length,
          1,
        );
        ticket = (
          await scoped(owner.patch(`/api/tickets/${ticket.id}`), ownerMe)
            .send({ version: ticket.version, status: "resolved" })
            .expect(200)
        ).body;
        assert.ok(ticket.resolved_at);
        await scoped(owner.post(`/api/tickets/${ticket.id}/messages`), ownerMe)
          .send({ version: ticket.version, body: "Must reopen first." })
          .expect(409);
        ticket = (
          await scoped(owner.patch(`/api/tickets/${ticket.id}`), ownerMe)
            .send({ version: ticket.version, status: "open" })
            .expect(200)
        ).body;
        assert.equal(ticket.resolved_at, null);
      },
    );
    await t.test(
      "optimistic versions reject stale updates and cross-workspace assignees",
      async () => {
        const current = ticket.version;
        await scoped(owner.patch(`/api/tickets/${ticket.id}`), ownerMe)
          .send({ version: current - 1, priority: "urgent" })
          .expect(409);
        await scoped(owner.patch(`/api/tickets/${ticket.id}`), ownerMe)
          .send({ version: current, assigneeId: outsiderMe.user.id })
          .expect(400);
        const unchanged = (
          await scoped(owner.get(`/api/tickets/${ticket.id}`), ownerMe).expect(
            200,
          )
        ).body.ticket;
        assert.equal(unchanged.version, current);
        assert.equal(unchanged.priority, "normal");
      },
    );
    await t.test(
      "ticket reads, updates, messages, and analytics never cross tenants",
      async () => {
        await scoped(
          outsider.get(`/api/tickets/${ticket.id}`),
          outsiderMe,
        ).expect(404);
        await scoped(outsider.patch(`/api/tickets/${ticket.id}`), outsiderMe)
          .send({ version: ticket.version, priority: "urgent" })
          .expect(404);
        await scoped(
          outsider.post(`/api/tickets/${ticket.id}/messages`),
          outsiderMe,
        )
          .send({ version: ticket.version, body: "Injected reply" })
          .expect(404);
        const listing = (
          await scoped(outsider.get("/api/tickets"), outsiderMe).expect(200)
        ).body;
        assert.equal(listing.total, 0);
        const metrics = (
          await scoped(outsider.get("/api/analytics"), outsiderMe).expect(200)
        ).body;
        assert.equal(metrics.total, 0);
        assert.equal(metrics.slaCompliance, null);
        assert.equal(
          (await scoped(owner.get("/api/analytics"), ownerMe).expect(200)).body
            .total,
          1,
        );
      },
    );
    await t.test(
      "customer invitations bind email, grant scoped membership, and cannot be reused",
      async () => {
        const invite = (
          await scoped(owner.post("/api/invitations"), ownerMe)
            .send({ email: customerMe.user.email, role: "customer" })
            .expect(201)
        ).body;
        await scoped(outsider.post("/api/invitations/accept"), outsiderMe)
          .send({ token: invite.token })
          .expect(400);
        await scoped(customer.post("/api/invitations/accept"), customerMe)
          .send({ token: invite.token })
          .expect(200);
        await scoped(customer.post("/api/invitations/accept"), customerMe)
          .send({ token: invite.token })
          .expect(400);
        customerMe = (await customer.get("/api/auth/me").expect(200)).body;
        const membership = customerMe.organizations.find(
          (o: any) => o.id === ownerMe.organizations[0].id,
        );
        assert.equal(membership.role, "customer");
      },
    );
    await t.test(
      "customers only see their own tickets and cannot view internal notes or administer",
      async () => {
        const org = ownerMe.organizations[0].id;
        const created = (
          await scoped(customer.post("/api/tickets"), customerMe, org)
            .send({
              subject: "Customer question",
              body: "Delivery order question",
              customerEmail: "spoof@example.com",
            })
            .expect(201)
        ).body;
        assert.equal(created.customer_email, customerMe.user.email);
        await scoped(owner.post(`/api/tickets/${created.id}/messages`), ownerMe)
          .send({
            version: created.version,
            body: "Secret internal operations note",
            internal: true,
          })
          .expect(201);
        const view = (
          await scoped(
            customer.get(`/api/tickets/${created.id}`),
            customerMe,
            org,
          ).expect(200)
        ).body;
        assert.equal(
          view.messages.some((m: any) => m.internal),
          false,
        );
        assert.deepEqual(view.activities, []);
        assert.deepEqual(view.drafts, []);
        await scoped(
          customer.get(`/api/tickets/${ticket.id}`),
          customerMe,
          org,
        ).expect(404);
        await scoped(customer.get("/api/members"), customerMe, org).expect(403);
        await scoped(customer.get("/api/documents"), customerMe, org).expect(
          403,
        );
        await scoped(customer.get("/api/analytics"), customerMe, org).expect(
          403,
        );
        await scoped(
          customer.patch(`/api/tickets/${created.id}`),
          customerMe,
          org,
        )
          .send({ version: view.ticket.version, status: "resolved" })
          .expect(403);
        await scoped(
          customer.post(`/api/tickets/${created.id}/messages`),
          customerMe,
          org,
        )
          .send({
            version: view.ticket.version,
            body: "Not permitted",
            internal: true,
          })
          .expect(403);
      },
    );
    await t.test(
      "document CRUD and AI retrieval remain tenant-scoped with approval/rejection",
      async () => {
        const doc = (
          await scoped(owner.post("/api/documents"), ownerMe)
            .send({
              title: "Delivery policy",
              content:
                "Delivery orders arrive within five business days. Delayed delivery orders are investigated by our shipping team.",
            })
            .expect(201)
        ).body;
        const secret = (
          await scoped(outsider.post("/api/documents"), outsiderMe)
            .send({
              title: "Private overseas delivery",
              content:
                "Delivery confidential tenant-two-code-99 is private and must never appear outside this organization.",
            })
            .expect(201)
        ).body;
        await scoped(outsider.patch(`/api/documents/${doc.id}`), outsiderMe)
          .send({
            title: "Changed policy",
            content: "Attacker-controlled changed policy.",
          })
          .expect(404);
        await scoped(
          outsider.delete(`/api/documents/${doc.id}`),
          outsiderMe,
        ).expect(404);
        const ai = (
          await scoped(owner.post(`/api/tickets/${ticket.id}/ai`), ownerMe)
            .send({})
            .expect(201)
        ).body;
        draft = ai.draft;
        assert.ok(draft.citations.some((c: any) => c.id === doc.id));
        assert.equal(
          draft.citations.some((c: any) => c.id === secret.id),
          false,
        );
        assert.equal(draft.body.includes("tenant-two-code-99"), false);
        await scoped(
          outsider.post(`/api/drafts/${draft.id}/reject`),
          outsiderMe,
        )
          .send({})
          .expect(404);
        await scoped(owner.post(`/api/tickets/${ticket.id}/messages`), ownerMe)
          .send({
            version: ticket.version,
            body: draft.body,
            draftId: draft.id,
          })
          .expect(201);
        const view = (
          await scoped(owner.get(`/api/tickets/${ticket.id}`), ownerMe).expect(
            200,
          )
        ).body;
        ticket = view.ticket;
        assert.equal(
          view.drafts.find((d: any) => d.id === draft.id).status,
          "accepted",
        );
        await scoped(owner.post(`/api/tickets/${ticket.id}/messages`), ownerMe)
          .send({
            version: ticket.version,
            body: draft.body,
            draftId: draft.id,
          })
          .expect(409);
        const regenerated = (
          await scoped(owner.post(`/api/tickets/${ticket.id}/ai`), ownerMe)
            .send({})
            .expect(201)
        ).body.draft;
        await scoped(
          owner.post(`/api/drafts/${regenerated.id}/reject`),
          ownerMe,
        )
          .send({})
          .expect(200);
        await scoped(
          owner.post(`/api/drafts/${regenerated.id}/reject`),
          ownerMe,
        )
          .send({})
          .expect(404);
        await scoped(owner.delete(`/api/documents/${doc.id}`), ownerMe).expect(
          200,
        );
        assert.equal(
          (await scoped(owner.get("/api/documents"), ownerMe).expect(200)).body
            .length,
          0,
        );
      },
    );
    await t.test(
      "AI outage leaves ordinary support operations available",
      async () => {
        process.env.AI_PROVIDER = "disabled";
        await scoped(owner.post(`/api/tickets/${ticket.id}/ai`), ownerMe)
          .send({})
          .expect(503);
        await scoped(owner.post(`/api/tickets/${ticket.id}/messages`), ownerMe)
          .send({
            version: ticket.version,
            body: "A human can still respond during provider outages.",
          })
          .expect(201);
        ticket = (
          await scoped(owner.get(`/api/tickets/${ticket.id}`), ownerMe).expect(
            200,
          )
        ).body.ticket;
        process.env.AI_PROVIDER = "local";
      },
    );
    await t.test(
      "signed inbound events are idempotent, reject forgery, and preserve scoped threading",
      async () => {
        process.env.INBOUND_WEBHOOK_SECRET = "integration-test-webhook-secret";
        const event = {
          eventId: "event-1",
          organizationId: ownerMe.organizations[0].id,
          ticketId: ticket.id,
          from: "buyer@example.com",
          subject: "Re: Delayed delivery",
          text: "Still waiting on delivery.",
        };
        const raw = JSON.stringify(event),
          timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac(
          "sha256",
          process.env.INBOUND_WEBHOOK_SECRET,
        )
          .update(`${timestamp}.`)
          .update(raw)
          .digest("hex");
        await supertest(app)
          .post("/api/webhooks/inbound")
          .set("Content-Type", "application/json")
          .set("X-Timestamp", timestamp)
          .set("X-Signature", "bad")
          .send(raw)
          .expect(401);
        for (let i = 0; i < 2; i++)
          await supertest(app)
            .post("/api/webhooks/inbound")
            .set("Content-Type", "application/json")
            .set("X-Timestamp", timestamp)
            .set("X-Signature", signature)
            .send(raw)
            .expect(200);
        assert.equal(
          (
            await db.query(
              "SELECT * FROM messages WHERE ticket_id=$1 AND body=$2",
              [ticket.id, event.text],
            )
          ).rows.length,
          1,
        );
        assert.equal(
          (
            await db.query("SELECT * FROM inbound_events WHERE event_id=$1", [
              event.eventId,
            ])
          ).rows.length,
          1,
        );
      },
    );
    await t.test(
      "owners administer memberships without permitting self/owner changes and revocation removes access",
      async () => {
        const org = ownerMe.organizations[0].id;
        await scoped(owner.patch(`/api/members/${ownerMe.user.id}`), ownerMe)
          .send({ role: "agent" })
          .expect(403);
        await scoped(
          owner.delete(`/api/members/${ownerMe.user.id}`),
          ownerMe,
        ).expect(403);
        await scoped(
          outsider.patch(`/api/members/${customerMe.user.id}`),
          outsiderMe,
        )
          .send({ role: "agent" })
          .expect(404);
        await scoped(
          customer.patch(`/api/members/${ownerMe.user.id}`),
          customerMe,
          org,
        )
          .send({ role: "agent" })
          .expect(403);
        await scoped(owner.patch(`/api/members/${customerMe.user.id}`), ownerMe)
          .send({ role: "agent" })
          .expect(200);
        const current = (
          await scoped(owner.get(`/api/tickets/${ticket.id}`), ownerMe).expect(
            200,
          )
        ).body.ticket;
        ticket = (
          await scoped(owner.patch(`/api/tickets/${ticket.id}`), ownerMe)
            .send({ version: current.version, assigneeId: customerMe.user.id })
            .expect(200)
        ).body;
        await scoped(
          owner.delete(`/api/members/${customerMe.user.id}`),
          ownerMe,
        ).expect(200);
        await scoped(customer.get("/api/tickets"), customerMe, org).expect(403);
        ticket = (
          await scoped(owner.get(`/api/tickets/${ticket.id}`), ownerMe).expect(
            200,
          )
        ).body.ticket;
        assert.equal(ticket.assignee_id, null);
        const audit = (
          await scoped(owner.get("/api/audit"), ownerMe).expect(200)
        ).body;
        assert.ok(
          audit.some((entry: any) => entry.action === "member.removed"),
        );
      },
    );
    await t.test(
      "password reset consumes one-time token, revokes sessions, and logout revokes session",
      async () => {
        const raw = randomBytes(32).toString("hex");
        const older = randomBytes(32).toString("hex");
        await db.query(
          "INSERT INTO password_resets VALUES($1,$2,now()+interval '30 minutes')",
          [
            createHash("sha256").update(older).digest("hex"),
            outsiderMe.user.id,
          ],
        );
        await db.query(
          "INSERT INTO password_resets VALUES($1,$2,now()+interval '30 minutes')",
          [createHash("sha256").update(raw).digest("hex"), outsiderMe.user.id],
        );
        await supertest(app)
          .post("/api/auth/reset-password")
          .send({ token: raw, password: "Changed-password-2026" })
          .expect(200);
        await outsider.get("/api/auth/me").expect(401);
        assert.equal(
          (
            await db.query("SELECT * FROM password_resets WHERE user_id=$1", [
              outsiderMe.user.id,
            ])
          ).rows.length,
          0,
        );
        await supertest(app)
          .post("/api/auth/reset-password")
          .send({ token: older, password: "Another-password-2026" })
          .expect(400);
        await supertest(app)
          .post("/api/auth/reset-password")
          .send({ token: raw, password: "Another-password-2026" })
          .expect(400);
        const signedIn = supertest.agent(app);
        const me = (
          await signedIn
            .post("/api/auth/login")
            .send({
              email: outsiderMe.user.email,
              password: "Changed-password-2026",
            })
            .expect(200)
        ).body;
        await scoped(signedIn.post("/api/auth/logout"), me)
          .send({})
          .expect(200);
        await signedIn.get("/api/auth/me").expect(401);
      },
    );
  } finally {
    await dispose();
    delete process.env.INBOUND_WEBHOOK_SECRET;
  }
});
