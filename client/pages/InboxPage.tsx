import type { Dispatch, SetStateAction } from "react";
import { Badge, Empty } from "../components/ui";
import { date, label, priorities, statuses } from "../lib/presentation";
import type { Ticket } from "../types";

type Props = {
  q: string;
  status: string;
  priority: string;
  sort: string;
  listPage: number;
  total: number;
  loading: boolean;
  tickets: Ticket[];
  setQ: (value: string) => void;
  setStatus: (value: string) => void;
  setPriority: (value: string) => void;
  setSort: (value: string) => void;
  setListPage: Dispatch<SetStateAction<number>>;
  refreshList: () => Promise<void>;
  openTicket: (id: string) => Promise<void>;
};
export function InboxPage({
  q,
  status,
  priority,
  sort,
  listPage,
  total,
  loading,
  tickets,
  setQ,
  setStatus,
  setPriority,
  setSort,
  setListPage,
  refreshList,
  openTicket,
}: Props) {
  return (
    <>
      <div className="inbox-toolbar">
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search tickets"
            placeholder="Search conversations…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setListPage(1);
            }}
          />
        </label>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setListPage(1);
          }}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by priority"
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value);
            setListPage(1);
          }}
        >
          <option value="">All priorities</option>
          {priorities.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Sort tickets"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setListPage(1);
          }}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <button
          className="subtle"
          onClick={refreshList}
          aria-label="Refresh tickets"
        >
          ↻
        </button>
      </div>
      <section className="panel ticket-list">
        <div className="list-heading">
          <strong>
            Conversations <span className="count">{total}</span>
          </strong>
          <span className="muted">
            {sort === "newest" ? "Most recent first" : "Oldest first"}
          </span>
        </div>
        {loading && (
          <p role="status" className="loading">
            Loading conversations…
          </p>
        )}
        {!loading && !tickets.length && (
          <Empty title="A clear inbox starts here">
            Create your first ticket or adjust your filters.
          </Empty>
        )}
        {tickets.map((t) => (
          <button
            className="ticket-row"
            key={t.id}
            onClick={() => openTicket(t.id)}
          >
            <span className={`ticket-dot dot-${t.status}`} />
            <div className="ticket-row-main">
              <div className="ticket-subject">{t.subject}</div>
              <div className="ticket-meta">
                {t.customer_email} <span>·</span> {label(t.category)}
              </div>
            </div>
            <div className="ticket-row-badges">
              <Badge value={t.priority} />
              <Badge value={t.status} />
            </div>
            <div className="ticket-date">
              {date(t.created_at)}
              <span
                className={
                  new Date(t.response_due_at).getTime() < Date.now() &&
                  !t.first_response_at &&
                  !["resolved", "closed"].includes(t.status)
                    ? "overdue"
                    : ""
                }
              >
                {!t.first_response_at &&
                !["resolved", "closed"].includes(t.status)
                  ? new Date(t.response_due_at).getTime() < Date.now()
                    ? "Response overdue"
                    : "Awaiting response"
                  : "View conversation →"}
              </span>
            </div>
          </button>
        ))}
        <div className="pagination">
          <span>
            {total
              ? `${(listPage - 1) * 20 + 1}–${Math.min(listPage * 20, total)} of ${total}`
              : "0 conversations"}
          </span>
          <div>
            <button
              disabled={listPage === 1 || loading}
              onClick={() => setListPage((p) => p - 1)}
            >
              ← Previous
            </button>
            <button
              disabled={listPage * 20 >= total || loading}
              onClick={() => setListPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      </section>
      <div className="footnote">
        <span>✦</span> Thoughtful responses begin with the right context.
      </div>
    </>
  );
}
