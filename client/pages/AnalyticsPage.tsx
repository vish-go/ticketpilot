import { label, minutes } from "../lib/presentation";
import type { Metrics } from "../types";

export function AnalyticsPage({
  loading,
  metrics,
}: {
  loading: boolean;
  metrics: Metrics | null;
}) {
  return loading ? (
    <p role="status">Calculating insights…</p>
  ) : metrics ? (
    <>
      <div className="metric-grid">
        {[
          ["Total tickets", metrics.total, "Across this workspace"],
          ["Open tickets", metrics.open, "Active conversations"],
          ["Closed / resolved", metrics.closed, "Completed conversations"],
          [
            "SLA compliance",
            metrics.slaCompliance == null
              ? "—"
              : `${Number(metrics.slaCompliance).toFixed(1)}%`,
            "All tickets against both targets",
          ],
        ].map(([title, value, sub]) => (
          <article className="panel metric" key={title}>
            <span>{title}</span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </article>
        ))}
      </div>
      <div className="insight-grid">
        <section className="panel insight">
          <h3>Response & resolution</h3>
          <div className="time-metric">
            <span>Average first response</span>
            <strong>{minutes(metrics.avgFirstResponseMinutes)}</strong>
          </div>
          <div className="time-metric">
            <span>Average resolution</span>
            <strong>{minutes(metrics.avgResolutionMinutes)}</strong>
          </div>
          <p className="muted small">
            Measured from ticket creation to the first public agent response and
            resolution. Tickets without the relevant timestamp are excluded.
          </p>
        </section>
        <section className="panel insight">
          <h3>By category</h3>
          {metrics.categories.length ? (
            metrics.categories.map((c) => (
              <div className="bar-row" key={c.category}>
                <div>
                  <span>{label(c.category)}</span>
                  <strong>{c.count}</strong>
                </div>
                <div className="bar-track">
                  <div
                    style={{
                      width: `${metrics.total ? (Number(c.count) / Number(metrics.total)) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="muted">No tickets yet.</p>
          )}
        </section>
        <section className="panel insight">
          <h3>Agent workload</h3>
          {metrics.workload.length ? (
            metrics.workload.map((m, i) => (
              <div className="time-metric" key={`${m.name}-${i}`}>
                <span>{m.name || "Unassigned"}</span>
                <strong>{m.count}</strong>
              </div>
            ))
          ) : (
            <p className="muted">No assignments yet.</p>
          )}
        </section>
      </div>
    </>
  ) : null;
}
