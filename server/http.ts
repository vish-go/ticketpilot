import type { Express, Response, RequestHandler } from "express";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "./db.js";

export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export const id = z.string().uuid();
export const email = z
  .string()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
export const passwordSchema = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (s) => Buffer.byteLength(s, "utf8") <= 72,
    "Password must be at most 72 UTF-8 bytes",
  );
export const text = z.string().trim().min(1).max(20000);
export const category = z.enum([
  "billing",
  "refund",
  "delivery",
  "product_complaint",
  "technical_issue",
  "general_inquiry",
]);
export const priority = z.enum(["low", "normal", "high", "urgent"]);
export const status = z.enum([
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
]);
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(code: number, message: string): never {
  throw new HttpError(code, message);
}

/** Shared HTTP primitives; domain queries stay in their route modules. */
export function createContext(app: Express, db: Database) {
  const route = (
    method: "get" | "post" | "patch" | "delete",
    url: string,
    fn: (req: any, res: Response) => Promise<any>,
  ) =>
    app[method](url, async (req, res, next) => {
      try {
        await fn(req, res);
      } catch (e) {
        next(e);
      }
    });
  async function identity(user: any, csrfToken: string) {
    const organizations = (
      await db.query(
        "SELECT o.id,o.name,m.role FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=$1 ORDER BY o.created_at",
        [user.id],
      )
    ).rows;
    return {
      user: { id: user.id, name: user.name, email: user.email },
      organizations,
      csrfToken,
    };
  }
  async function session(res: Response, user: any) {
    const raw = token(),
      csrf = token();
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [hash(raw), user.id, csrf],
    );
    res.cookie("tp_session", raw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 604800000,
      path: "/",
    });
    return identity(user, csrf);
  }
  const staff = (req: any) => {
    if (req.role === "customer") fail(403, "Staff access required");
  };
  const admin = (req: any) => {
    if (!["owner", "admin"].includes(req.role))
      fail(403, "Administrator access required");
  };
  const audit = async (tx: Database, req: any, action: string, rid: string) => {
    await tx.query(
      "INSERT INTO audit_logs(id,org_id,actor_id,action,resource_id) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), req.orgId, req.user.id, action, rid],
    );
  };
  const activity = async (
    tx: Database,
    req: any,
    tid: string,
    kind: string,
    detail: string,
  ) => {
    await tx.query(
      "INSERT INTO activities(id,org_id,ticket_id,actor_id,kind,detail) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), req.orgId, tid, req.user.id, kind, detail],
    );
  };
  async function ticket(req: any, tx: Database = db, lock = false) {
    const tid = id.parse(req.params.id);
    const t = (
      await tx.query(
        `SELECT * FROM tickets WHERE org_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
        [req.orgId, tid],
      )
    ).rows[0];
    if (!t || (req.role === "customer" && t.created_by !== req.user.id))
      fail(404, "Ticket not found");
    return t;
  }
  const requireSession: RequestHandler = async (req: any, res, next) => {
    try {
      const raw = req.cookies.tp_session;
      if (!raw) fail(401, "Sign in required");
      const s = (
        await db.query(
          "SELECT u.id,u.name,u.email,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
          [hash(raw)],
        )
      ).rows[0];
      if (!s) fail(401, "Session expired");
      req.user = s;
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.get("x-csrf-token") !== s.csrf_token
      )
        fail(403, "Invalid CSRF token");
      next();
    } catch (e) {
      next(e);
    }
  };
  const requireTenant: RequestHandler = async (req: any, _res, next) => {
    try {
      const oid = id.parse(req.get("x-organization-id"));
      const member = (
        await db.query(
          "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2",
          [oid, req.user.id],
        )
      ).rows[0];
      if (!member) fail(403, "Workspace access denied");
      req.orgId = oid;
      req.role = member.role;
      next();
    } catch (e) {
      next(e);
    }
  };
  return {
    app,
    db,
    route,
    identity,
    session,
    staff,
    admin,
    audit,
    activity,
    ticket,
    requireSession,
    requireTenant,
  };
}
export type RouteContext = ReturnType<typeof createContext>;
