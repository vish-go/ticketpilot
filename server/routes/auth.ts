import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  type RouteContext,
  hash,
  token,
  email,
  passwordSchema,
  fail,
} from "../http.js";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { sendEmail } from "../email.js";

export function registerPublicAuth(context: RouteContext) {
  const { app, db, route, session } = context;
  const authLimit = rateLimit({
    windowMs: 900000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.use("/api/auth", authLimit);
  route("get", "/api/health", async (_req, res) => {
    res.json({ status: "ok" });
  });
  route("get", "/api/ready", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ready" });
  });
  route("post", "/api/auth/register", async (req, res) => {
    const d = z
      .object({
        name: z.string().trim().min(2).max(100),
        email,
        password: passwordSchema,
        organization: z.string().trim().min(2).max(100),
      })
      .parse(req.body);
    const uid = randomUUID(),
      oid = randomUUID(),
      password = await bcrypt.hash(d.password, 12);
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
        [uid, d.email, d.name, password],
      );
      await tx.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
        oid,
        d.organization,
      ]);
      await tx.query("INSERT INTO memberships VALUES($1,$2,'owner')", [
        oid,
        uid,
      ]);
    });
    res.status(201).json(await session(res, { id: uid, ...d }));
  });
  route("post", "/api/auth/login", async (req, res) => {
    const d = z
      .object({
        email,
        password: z
          .string()
          .min(1)
          .max(72)
          .refine(
            (s) => Buffer.byteLength(s, "utf8") <= 72,
            "Password exceeds byte limit",
          ),
      })
      .parse(req.body);
    const u = (await db.query("SELECT * FROM users WHERE email=$1", [d.email]))
      .rows[0];
    const valid = await bcrypt.compare(
      d.password,
      u?.password_hash ||
        "$2b$12$C6UzMDM.H6dfI/f/IKcEe.5E5KX3Vp8Vpxq.hI11zpsYhQrmY1vAi",
    );
    if (!u || !valid) fail(401, "Invalid email or password");
    res.json(await session(res, u));
  });
  route("post", "/api/auth/forgot-password", async (req, res) => {
    const d = z.object({ email }).parse(req.body);
    const u = (await db.query("SELECT id FROM users WHERE email=$1", [d.email]))
      .rows[0];
    if (u && process.env.EMAIL_PROVIDER === "resend") {
      const raw = token();
      await db.query(
        "INSERT INTO password_resets VALUES($1,$2,now()+interval '30 minutes')",
        [hash(raw), u.id],
      );
      try {
        await sendEmail({
          to: d.email,
          subject: "Reset your TicketPilot password",
          text: `Use this reset token in TicketPilot: ${raw}`,
        });
      } catch {
        await db.query("DELETE FROM password_resets WHERE token_hash=$1", [
          hash(raw),
        ]);
      }
    }
    res.json({
      message:
        "If delivery is configured and the account exists, a reset token will be sent.",
    });
  });
  route("post", "/api/auth/reset-password", async (req, res) => {
    const d = z
      .object({ token: z.string().min(32).max(128), password: passwordSchema })
      .parse(req.body);
    const password = await bcrypt.hash(d.password, 12);
    await db.transaction(async (tx) => {
      const reset = (
        await tx.query(
          "DELETE FROM password_resets WHERE token_hash=$1 AND expires_at>now() RETURNING user_id",
          [hash(d.token)],
        )
      ).rows[0];
      if (!reset) fail(400, "Invalid or expired reset token");
      await tx.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        password,
        reset.user_id,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [reset.user_id]);
      await tx.query("DELETE FROM password_resets WHERE user_id=$1", [
        reset.user_id,
      ]);
    });
    res.json({ ok: true });
  });
}
