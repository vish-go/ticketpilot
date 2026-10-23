import { z } from "zod";
import { randomUUID } from "node:crypto";
import { type RouteContext, hash, fail } from "../http.js";

export function registerSessionRoutes(context: RouteContext) {
  const { db, route, identity } = context;
  route("get", "/api/auth/me", async (req, res) =>
    res.json(await identity(req.user, req.user.csrf_token)),
  );
  route("post", "/api/auth/logout", async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(req.cookies.tp_session),
    ]);
    res.clearCookie("tp_session", { path: "/" });
    res.json({ ok: true });
  });
  route("post", "/api/organizations", async (req, res) => {
    const d = z
      .object({ name: z.string().trim().min(2).max(100) })
      .parse(req.body);
    const oid = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
        oid,
        d.name,
      ]);
      await tx.query("INSERT INTO memberships VALUES($1,$2,'owner')", [
        oid,
        req.user.id,
      ]);
    });
    res.status(201).json({ id: oid, ...d });
  });
  route("post", "/api/invitations/accept", async (req, res) => {
    const d = z.object({ token: z.string().min(32).max(128) }).parse(req.body);
    await db.transaction(async (tx) => {
      const invite = (
        await tx.query(
          "SELECT * FROM invitations WHERE token_hash=$1 AND expires_at>now() AND accepted_at IS NULL FOR UPDATE",
          [hash(d.token)],
        )
      ).rows[0];
      if (!invite || invite.email !== req.user.email)
        fail(400, "Invitation invalid or intended for another account");
      await tx.query(
        "INSERT INTO memberships VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [invite.org_id, req.user.id, invite.role],
      );
      await tx.query("UPDATE invitations SET accepted_at=now() WHERE id=$1", [
        invite.id,
      ]);
    });
    res.json({ accepted: true });
  });
}
