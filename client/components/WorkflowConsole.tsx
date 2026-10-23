import { useEffect, useRef, useState } from "react";
import type { Api } from "../types";
import { date, label } from "../lib/presentation";
import { Badge, Field } from "./ui";

type WorkflowRun = {
  id: string;
  state: string;
  mode: string;
  proposal: {
    orderId: string;
    amountCents: number;
    currency: string;
    orderVersion: number;
    ticketVersion: number;
    [key: string]: unknown;
  } | null;
  action_hash: string | null;
  draft_response: string | null;
  last_error: string | null;
  tool_calls: number;
};
type WorkflowDetail = {
  run: WorkflowRun;
  events: {
    state: string;
    capability?: string;
    tool?: string;
    summary: string;
    created_at: string;
  }[];
  approvals: {
    decision: string;
    reason: string;
    actor_id: string;
    created_at: string;
  }[];
};

type Props = { ticketId: string; admin: boolean; api: Api };

/** The ticket/workspace key in App isolates all local workflow state. */
export function WorkflowConsole({ ticketId, admin, api }: Props) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [orderId, setOrderId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const startKey = useRef(crypto.randomUUID());
  const apiRef = useRef(api);
  apiRef.current = api;

  async function refresh(runId?: string) {
    const items = await apiRef.current<WorkflowRun[]>(
      `/tickets/${ticketId}/workflows`,
    );
    const id = runId || items[0]?.id;
    const result = id
      ? await apiRef.current<WorkflowDetail>(`/workflows/${id}`)
      : null;
    if (mounted.current) {
      setRuns(items);
      setDetail(result);
    }
  }

  async function perform(action: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : "Workflow request failed.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void perform(() => refresh());
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = detail?.run;
  const state = run?.state.toLowerCase() || "";
  const awaitingApproval = state === "awaiting_approval";
  const terminal = [
    "completed",
    "rejected",
    "failed",
    "cancelled",
    "timed_out",
    "escalated",
  ].includes(state);

  return (
    <section className="workflow-console" aria-label="Sandbox workflow">
      <div className="workflow-heading">
        <h3>Delivery recovery workflow</h3>
        <Badge value="deterministic_sandbox" />
      </div>
      <p className="small muted">
        A simulated order and refund workflow with a durable audit trail. Each
        advance runs one step. Refunds require an owner or administrator’s
        approval of the exact action. Responses remain drafts.
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            const started = await api<WorkflowRun>(
              `/tickets/${ticketId}/workflows`,
              "POST",
              {
                idempotencyKey: startKey.current,
                orderId,
              },
            );
            await refresh(started.id);
            startKey.current = crypto.randomUUID();
            setNotice(
              "Workflow started. Review its evidence and advance one step at a time.",
            );
          });
        }}
      >
        <Field title="Sandbox order ID">
          <input
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            required
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            placeholder="Order UUID"
            disabled={busy}
          />
        </Field>
        <div className="workflow-actions">
          {admin && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const order = await api<{ id: string }>(
                    "/sandbox/orders",
                    "POST",
                    { ticketId },
                  );
                  setOrderId(order.id);
                  setNotice(
                    "Synthetic delayed order created. Start a workflow to inspect it.",
                  );
                })
              }
            >
              Create synthetic order
            </button>
          )}
          <button disabled={busy || !orderId}>Start sandbox workflow</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void perform(() => refresh(run?.id))}
          >
            Refresh workflows
          </button>
        </div>
      </form>
      {runs.length > 0 && (
        <Field title="Workflow run">
          <select
            value={run?.id || ""}
            disabled={busy}
            onChange={(event) => {
              const id = event.target.value;
              setReason("");
              void perform(() => refresh(id));
            }}
          >
            {runs.map((item) => (
              <option key={item.id} value={item.id}>
                {label(item.state.toLowerCase())} · {item.id}
              </option>
            ))}
          </select>
        </Field>
      )}
      {run && detail && (
        <div className="workflow-detail">
          <p>
            <Badge value={state} />{" "}
            <span className="small muted">
              Mode: {run.mode} · Tool calls: {run.tool_calls}
            </span>
          </p>
          {run.last_error && <p className="alert">{run.last_error}</p>}
          {run.proposal && (
            <div>
              <h4>Exact proposed action</h4>
              <pre className="workflow-evidence">
                {JSON.stringify(run.proposal, null, 2)}
              </pre>
              <p className="small">
                Action hash:{" "}
                <code className="workflow-hash">
                  {run.action_hash || "Pending"}
                </code>
              </p>
            </div>
          )}
          {awaitingApproval && (
            <div>
              <p className="small">
                Approval applies only to the proposal and hash shown above.
                Changed order or ticket versions require a new proposal.
              </p>
              {admin ? (
                <>
                  <Field title="Approval or rejection reason">
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      maxLength={1000}
                      disabled={busy}
                    />
                  </Field>
                  <div className="workflow-actions">
                    {(["approve", "reject"] as const).map((decision) => (
                      <button
                        key={decision}
                        type="button"
                        disabled={busy || !reason.trim() || !run.action_hash}
                        onClick={() =>
                          void perform(async () => {
                            await api(`/workflows/${run.id}/decision`, "POST", {
                              decision,
                              actionHash: run.action_hash,
                              reason,
                            });
                            await refresh(run.id);
                            setReason("");
                          })
                        }
                      >
                        {decision === "approve"
                          ? "Approve exact sandbox action"
                          : "Reject sandbox action"}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted">
                  An owner or administrator must review this action.
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            disabled={busy || terminal || awaitingApproval}
            onClick={() =>
              void perform(async () => {
                await api(`/workflows/${run.id}/resume`, "POST", {});
                await refresh(run.id);
              })
            }
          >
            {busy ? "Working…" : "Advance one workflow step"}
          </button>
          {run.draft_response && (
            <div>
              <h4>Draft response — review before sending</h4>
              <p className="workflow-draft">{run.draft_response}</p>
            </div>
          )}
          <details open>
            <summary>
              Workflow evidence and timeline · {detail.events.length}
            </summary>
            <ol className="workflow-timeline">
              {detail.events.map((event, index) => (
                <li key={`${event.created_at}-${index}`}>
                  <strong>{label(event.state.toLowerCase())}</strong>{" "}
                  <time>{date(event.created_at)}</time>
                  <p>{event.summary}</p>
                  {(event.capability || event.tool) && (
                    <small>
                      {event.capability} {event.tool && `· ${event.tool}`}
                    </small>
                  )}
                </li>
              ))}
            </ol>
          </details>
          {detail.approvals.length > 0 && (
            <details>
              <summary>Human decisions · {detail.approvals.length}</summary>
              {detail.approvals.map((approval, index) => (
                <p key={`${approval.created_at}-${index}`}>
                  <strong>{label(approval.decision)}</strong> ·{" "}
                  {date(approval.created_at)}
                  <br />
                  {approval.reason}
                  <br />
                  <small>Reviewer: {approval.actor_id}</small>
                </p>
              ))}
            </details>
          )}
        </div>
      )}
      {!busy && !runs.length && (
        <p className="small muted">No sandbox workflows for this ticket yet.</p>
      )}
    </section>
  );
}
