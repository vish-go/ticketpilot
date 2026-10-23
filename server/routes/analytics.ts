import { type RouteContext } from "../http.js";

export function registerAnalyticsRoutes(context: RouteContext) {
  const { db, route, staff, admin } = context;
  route("get", "/api/analytics", async (req, res) => {
    staff(req);
    const result = (
      await db.query(
        `SELECT count(*)::int AS total,count(*) FILTER(WHERE status NOT IN ('resolved','closed'))::int AS open,count(*) FILTER(WHERE status IN ('resolved','closed'))::int AS closed,avg(EXTRACT(EPOCH FROM(first_response_at-created_at))/60) AS "avgFirstResponseMinutes",avg(EXTRACT(EPOCH FROM(resolved_at-created_at))/60) AS "avgResolutionMinutes",CASE WHEN count(*)=0 THEN NULL ELSE 100.0*count(*) FILTER(WHERE (first_response_at IS NOT NULL AND first_response_at<=response_due_at OR first_response_at IS NULL AND now()<=response_due_at) AND (resolved_at IS NOT NULL AND resolved_at<=resolution_due_at OR resolved_at IS NULL AND now()<=resolution_due_at))/count(*) END AS "slaCompliance" FROM tickets WHERE org_id=$1`,
        [req.orgId],
      )
    ).rows[0];
    const categories = (
      await db.query(
        "SELECT category,count(*)::int AS count FROM tickets WHERE org_id=$1 GROUP BY category ORDER BY count DESC",
        [req.orgId],
      )
    ).rows;
    const workload = (
      await db.query(
        "SELECT u.name,count(t.id)::int AS count FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN tickets t ON t.org_id=m.org_id AND t.assignee_id=m.user_id AND t.status NOT IN ('resolved','closed') WHERE m.org_id=$1 AND m.role<>'customer' GROUP BY u.id,u.name ORDER BY count DESC",
        [req.orgId],
      )
    ).rows;
    res.json({ ...result, categories, workload });
  });
  route("get", "/api/audit", async (req, res) => {
    admin(req);
    res.json(
      (
        await db.query(
          "SELECT * FROM audit_logs WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100",
          [req.orgId],
        )
      ).rows,
    );
  });
}
