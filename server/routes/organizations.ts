import { z } from "zod";
import { randomUUID } from "node:crypto";
import { type RouteContext, hash, token, id, email, fail } from "../http.js";

export function registerOrganizationRoutes(context: RouteContext) {
  const { db, route, staff, admin, audit } = context;
  route("get", "/api/members", async (req, res) => {
    staff(req);
    res.json(
      (
        await db.query(
          "SELECT u.id AS user_id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 ORDER BY u.name",
          [req.orgId],
        )
      ).rows,
    );
  });
  route("patch", "/api/members/:id", async (req, res) => {
    admin(req);
    const uid = id.parse(req.params.id);
    const d = z
      .object({ role: z.enum(["admin", "agent", "customer"]) })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const member = (
        await tx.query(
          "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE",
          [req.orgId, uid],
        )
      ).rows[0];
      if (!member) fail(404, "Member not found");
      if (member.role === "owner" || uid === req.user.id)
        fail(403, "Cannot change workspace owner or your own role");
      if (
        req.role === "admin" &&
        (member.role === "admin" || d.role === "admin")
      )
        fail(403, "Only owners manage administrators");
      if (d.role === "customer")
        await tx.query(
          "UPDATE tickets SET assignee_id=NULL,version=version+1,updated_at=now() WHERE org_id=$1 AND assignee_id=$2",
          [req.orgId, uid],
        );
      await tx.query(
        "UPDATE memberships SET role=$1 WHERE org_id=$2 AND user_id=$3",
        [d.role, req.orgId, uid],
      );
      await audit(tx, req, "member.role_updated", uid);
    });
    res.json({ ok: true });
  });
  route("delete", "/api/members/:id", async (req, res) => {
    admin(req);
    const uid = id.parse(req.params.id);
    await db.transaction(async (tx) => {
      const member = (
        await tx.query(
          "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE",
          [req.orgId, uid],
        )
      ).rows[0];
      if (!member) fail(404, "Member not found");
      if (member.role === "owner" || uid === req.user.id)
        fail(403, "Cannot remove owner or yourself");
      if (req.role === "admin" && member.role === "admin")
        fail(403, "Only owners manage administrators");
      await tx.query(
        "UPDATE tickets SET assignee_id=NULL,version=version+1,updated_at=now() WHERE org_id=$1 AND assignee_id=$2",
        [req.orgId, uid],
      );
      await tx.query("DELETE FROM memberships WHERE org_id=$1 AND user_id=$2", [
        req.orgId,
        uid,
      ]);
      await audit(tx, req, "member.removed", uid);
    });
    res.json({ ok: true });
  });
  route("delete", "/api/invitations/:id", async (req, res) => {
    admin(req);
    const iid = id.parse(req.params.id);
    const result = await db.query(
      "DELETE FROM invitations WHERE org_id=$1 AND id=$2 AND accepted_at IS NULL RETURNING id",
      [req.orgId, iid],
    );
    if (!result.rows.length) fail(404, "Invitation not found");
    await audit(db, req, "invitation.revoked", iid);
    res.json({ ok: true });
  });
  route("get", "/api/settings", async (req, res) => {
    staff(req);
    res.json(
      (
        await db.query(
          "SELECT id,name,response_minutes,resolution_minutes,guidelines FROM organizations WHERE id=$1",
          [req.orgId],
        )
      ).rows[0],
    );
  });
  route("patch", "/api/settings", async (req, res) => {
    admin(req);
    const d = z
      .object({
        name: z.string().trim().min(2).max(100),
        response_minutes: z.number().int().min(1).max(525600),
        resolution_minutes: z.number().int().min(1).max(525600),
        guidelines: z.string().max(4000).optional(),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE organizations SET name=$1,response_minutes=$2,resolution_minutes=$3,guidelines=$4 WHERE id=$5",
        [
          d.name,
          d.response_minutes,
          d.resolution_minutes,
          d.guidelines || "",
          req.orgId,
        ],
      );
      await audit(tx, req, "settings.updated", req.orgId);
    });
    res.json({ ok: true });
  });
  route("get", "/api/invitations", async (req, res) => {
    admin(req);
    res.json(
      (
        await db.query(
          "SELECT id,email,role,expires_at,accepted_at FROM invitations WHERE org_id=$1 ORDER BY created_at DESC",
          [req.orgId],
        )
      ).rows,
    );
  });
  route("post", "/api/invitations", async (req, res) => {
    admin(req);
    const d = z
      .object({ email, role: z.enum(["admin", "agent", "customer"]) })
      .parse(req.body);
    if (d.role === "admin" && req.role !== "owner")
      fail(403, "Only owners invite administrators");
    const raw = token(),
      iid = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO invitations(id,org_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '2 days')",
        [iid, req.orgId, d.email, d.role, hash(raw)],
      );
      await audit(tx, req, "invitation.created", iid);
    });
    res.status(201).json({
      id: iid,
      ...d,
      token: raw,
      message: "Share this one-time token securely with the invited account.",
    });
  });
}
