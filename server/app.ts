import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./db.js";
import { AIError } from "./ai.js";
import { createContext, HttpError } from "./http.js";
import { registerPublicAuth } from "./routes/auth.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerIntegrationRoutes } from "./routes/integrations.js";
import { registerOrganizationRoutes } from "./routes/organizations.js";
import { registerTicketRoutes } from "./routes/tickets.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";

/** Middleware order is security-critical: public integrations, session, then tenant. */
export function createApp(db: Database) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
        },
      },
    }),
  );
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    const started = Date.now();
    res.on("finish", () => {
      if (process.env.NODE_ENV !== "test")
        console.log(
          JSON.stringify({
            requestId,
            method: req.method,
            status: res.statusCode,
            durationMs: Date.now() - started,
          }),
        );
    });
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(
    express.json({
      limit: "256kb",
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.path !== "/webhooks/inbound"
    ) {
      const origin = req.get("origin");
      if (
        origin &&
        origin !== (process.env.APP_ORIGIN || "http://localhost:3000")
      )
        return next(new HttpError(403, "Origin not allowed"));
    }
    next();
  });
  const context = createContext(app, db);
  registerPublicAuth(context);
  registerIntegrationRoutes(context);
  app.use("/api", context.requireSession);
  registerSessionRoutes(context);
  app.use("/api", context.requireTenant);
  registerOrganizationRoutes(context);
  registerTicketRoutes(context);
  registerKnowledgeRoutes(context);
  registerAnalyticsRoutes(context);
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
  app.use(express.static("dist/client"));
  app.get("/{*path}", (_req, res) =>
    res.sendFile("index.html", { root: "dist/client" }),
  );
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: "Invalid request",
        fields: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: err.message });
    if (err instanceof AIError)
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code });
    if (err.code === "23505")
      return res.status(409).json({ error: "Record already exists" });
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "Request too large" });
    if (err instanceof SyntaxError)
      return res.status(400).json({ error: "Invalid JSON" });
    console.error(
      JSON.stringify({ event: "request.error", code: err.code || "internal" }),
    );
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}
