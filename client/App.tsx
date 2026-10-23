import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

type Org = { id: string; name: string; role: string };
type Session = {
  user: { id: string; name: string; email: string };
  organizations: Org[];
  csrfToken: string;
};
type Ticket = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  customer_email: string;
  assignee_id: string | null;
  version: number;
  created_at: string;
  response_due_at: string;
  resolution_due_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
};
type Member = { user_id: string; name: string; email: string; role: string };
type Doc = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  index_status?: "pending" | "indexed" | "failed";
  index_error?: string | null;
};
type Draft = {
  id: string;
  body: string;
  citations: { id: string; title: string; excerpt: string }[];
  category?: string;
  priority?: string;
  explanation?: string;
  provider?: string;
  status?: string;
};
type Detail = {
  ticket: Ticket;
  messages: {
    id: string;
    body: string;
    internal: boolean;
    created_at: string;
    author_name?: string;
  }[];
  activities: {
    id: string;
    kind: string;
    created_at: string;
    detail?: string;
  }[];
  drafts: Draft[];
};
type Metrics = {
  total: number;
  open: number;
  closed: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  slaCompliance: number | null;
  categories: { category: string; count: number }[];
  workload: { name: string; count: number }[];
};
const statuses = ["open", "in_progress", "pending", "resolved", "closed"];
const priorities = ["low", "normal", "high", "urgent"];
const categories = [
  "billing",
  "refund",
  "delivery",
  "product_complaint",
  "technical_issue",
  "general_inquiry",
];
const label = (s: string) =>
  s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const date = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const minutes = (n: number | null | undefined) =>
  n == null ? "—" : n < 60 ? `${Math.round(n)}m` : `${(n / 60).toFixed(1)}h`;

function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{title}</span>
      {children}
    </label>
  );
}
function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value}`}>{label(value)}</span>;
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-symbol">◎</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [orgId, setOrgId] = useState("");
  const [page, setPage] = useState("inbox");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [listPage, setListPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [settings, setSettings] = useState({
    name: "",
    response_minutes: 60,
    resolution_minutes: 1440,
    guidelines: "",
  });
  const [invitations, setInvitations] = useState<
    {
      id: string;
      email: string;
      role: string;
      token?: string;
      expires_at?: string;
      accepted_at?: string | null;
    }[]
  >([]);
  const [newTicket, setNewTicket] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Doc | null>(null);
  const [showDocForm, setShowDocForm] = useState(false);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const organization = session?.organizations.find((o) => o.id === orgId);
  const admin = ["owner", "admin"].includes(organization?.role || "");
  const staff = organization?.role !== "customer";

  async function api<T = any>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(orgId ? { "X-Organization-Id": orgId } : {}),
        ...(session?.csrfToken ? { "X-CSRF-Token": session.csrfToken } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith("/auth/"))
        setSession(null);
      throw new Error(
        data.error?.message ||
          data.error ||
          data.message ||
          `Request failed (${response.status})`,
      );
    }
    return data;
  }
  function applySession(s: Session) {
    setSession(s);
    setOrgId((old) =>
      s.organizations.some((o) => o.id === old)
        ? old
        : s.organizations[0]?.id || "",
    );
  }
  useEffect(() => {
    api<Session>("/auth/me")
      .then(applySession)
      .catch(() => {})
      .finally(() => setBooting(false));
  }, []);
  async function run(fn: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshList() {
    setLoading(true);
    try {
      const result = await api<{ items: Ticket[]; total: number }>(
        `/tickets?${new URLSearchParams({ q, ...(status ? { status } : {}), ...(priority ? { priority } : {}), page: String(listPage), sort })}`,
      );
      setTickets(result.items);
      setTotal(result.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function loadPage() {
    setLoading(true);
    setError("");
    try {
      if (page === "inbox") await refreshList();
      if (page === "knowledge") setDocuments(await api("/documents"));
      if (page === "analytics") setMetrics(await api("/analytics"));
      if (page === "team") {
        setMembers(await api("/members"));
        if (admin) setInvitations(await api("/invitations"));
      }
      if (page === "settings") setSettings(await api("/settings"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (session && orgId) {
      setSelected(null);
      setDraft(null);
      if (organization?.role === "customer" && page !== "inbox")
        setPage("inbox");
      else loadPage();
    }
  }, [orgId, page, session?.user.id]);
  useEffect(() => {
    if (session && orgId && page === "inbox") {
      const timer = setTimeout(refreshList, 250);
      return () => clearTimeout(timer);
    }
  }, [q, status, priority, listPage, sort]);
  async function openTicket(id: string) {
    setDraft(null);
    setReply("");
    setInternal(false);
    await run(async () => {
      const detail = await api<Detail>(`/tickets/${id}`);
      setSelected(detail);
      if (staff) setMembers(await api("/members"));
      else setMembers([]);
    });
  }
  async function updateTicket(changes: Record<string, unknown>) {
    if (!selected) return;
    await run(async () => {
      await api(`/tickets/${selected.ticket.id}`, "PATCH", {
        version: selected.ticket.version,
        ...changes,
      });
      setSelected(await api(`/tickets/${selected.ticket.id}`));
      setDraft(null);
      await refreshList();
    });
  }
  async function auth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    await run(async () => {
      applySession(await api<Session>(`/auth/${authMode}`, "POST", values));
    });
  }

  if (booting)
    return (
      <main className="boot">
        <div className="brandmark">
          T<span>↗</span>
        </div>
        <p>Opening your workspace…</p>
      </main>
    );
  if (!session)
    return (
      <main className="auth-layout">
        <section className="auth-story">
          <div className="brand">
            <div className="brandmark">
              T<span>↗</span>
            </div>
            TicketPilot <small>AI</small>
          </div>
          <div>
            <div className="eyebrow light">
              A LITTLE CLARITY GOES A LONG WAY
            </div>
            <h1>
              Great support.
              <br />
              Less turbulence.
            </h1>
            <p>
              One workspace for your conversations, your team, and the knowledge
              that moves every ticket forward.
            </p>
            <div className="auth-pills">
              <span>Human-led AI</span>
              <span>Connected conversations</span>
              <span>Separate workspaces</span>
            </div>
          </div>
          <div className="auth-footer">
            Built around people. Assisted by intelligence.
          </div>
        </section>
        <section className="auth-panel">
          <div className="auth-card">
            <div className="eyebrow">YOUR SUPPORT, IN SYNC</div>
            <h2>
              {authMode === "login"
                ? "Welcome back."
                : authMode === "register"
                  ? "Make room for better support."
                  : "Reset your password"}
            </h2>
            <p className="muted">
              {authMode === "login"
                ? "Sign in to pick up where your team left off."
                : "Create your account and your first workspace."}
            </p>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="notice" role="status">
                {notice}
              </div>
            )}
            <form onSubmit={auth}>
              {authMode === "register" && (
                <>
                  <Field title="Your name">
                    <input
                      name="name"
                      required
                      autoComplete="name"
                      minLength={2}
                      maxLength={100}
                    />
                  </Field>
                  <Field title="Workspace name">
                    <input
                      name="organization"
                      required
                      minLength={2}
                      maxLength={100}
                      placeholder="e.g. Acme Support"
                    />
                  </Field>
                </>
              )}
              <Field title="Email address">
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                />
              </Field>
              <Field title="Password">
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  autoComplete={
                    authMode === "register"
                      ? "new-password"
                      : "current-password"
                  }
                  maxLength={72}
                  placeholder={
                    authMode === "register"
                      ? "At least 12 characters"
                      : "Your password"
                  }
                />
              </Field>
              <button className="primary full" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : authMode === "login"
                    ? "Sign in →"
                    : "Create workspace →"}
              </button>
            </form>
            <button
              className="text-button full"
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setError("");
              }}
            >
              {authMode === "login"
                ? "New here? Create your workspace"
                : "Already have an account? Sign in"}
            </button>
            <details className="reset-help">
              <summary>Forgot your password?</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const email = new FormData(e.currentTarget).get("email");
                  run(async () => {
                    await api("/auth/forgot-password", "POST", { email });
                    setNotice(
                      "If this account exists, reset instructions will be sent through the configured email provider.",
                    );
                  });
                }}
              >
                <Field title="Account email">
                  <input type="email" name="email" required />
                </Field>
                <button disabled={busy}>Request reset</button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const values = Object.fromEntries(
                    new FormData(e.currentTarget),
                  );
                  run(async () => {
                    await api("/auth/reset-password", "POST", values);
                    setNotice("Password updated. You can now sign in.");
                  });
                }}
              >
                <Field title="Reset token from email">
                  <input name="token" required />
                </Field>
                <Field title="New password">
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    required
                  />
                </Field>
                <button disabled={busy}>Update password</button>
              </form>
            </details>
          </div>
        </section>
      </main>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">
            T<span>↗</span>
          </div>
          TicketPilot <small>AI</small>
        </div>
        <label className="workspace-select">
          <span className="eyebrow">WORKSPACE</span>
          <select
            aria-label="Workspace"
            value={orgId}
            onChange={(e) => {
              setOrgId(e.target.value);
              setListPage(1);
            }}
          >
            {session.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Main navigation">
          {[
            ["inbox", "▤", "Ticket inbox"],
            ["knowledge", "▧", "Knowledge base"],
            ["analytics", "◴", "Insights"],
            ["team", "♧", "Your team"],
            ["settings", "⚙", "Workspace settings"],
          ]
            .filter(([id]) => staff || id === "inbox")
            .map(([id, icon, title]) => (
              <button
                key={id}
                onClick={() => setPage(id)}
                className={page === id ? "nav-item active" : "nav-item"}
              >
                <span aria-hidden="true">{icon}</span>
                {title}
                {id === "inbox" && <small>{total}</small>}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="assist-card">
            <span className="sparkle">✦</span>
            <strong>Intelligence. With oversight.</strong>
            <p>
              AI drafts stay in your hands. Review every response before
              sending.
            </p>
          </div>
          <div className="profile">
            <span className="avatar">
              {session.user.name[0]?.toUpperCase()}
            </span>
            <div>
              <strong>{session.user.name}</strong>
              <small>{label(organization?.role || "member")}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() =>
                run(async () => {
                  await api("/auth/logout", "POST");
                  setSession(null);
                })
              }
            >
              ↪
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>{page === "inbox" ? "Ticket inbox" : label(page)}</strong>
          </div>
          <span className="workspace-tag">
            <span /> {organization?.name || "Choose a workspace"}
          </span>
        </header>
        <main className="main-content">
          {error && (
            <div className="alert" role="alert">
              {error}
              <button className="text-button" onClick={() => setError("")}>
                Dismiss
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button className="text-button" onClick={() => setNotice("")}>
                Dismiss
              </button>
            </div>
          )}
          {!orgId ? (
            <section className="panel">
              <h1>Create your workspace</h1>
              <WorkspaceForm
                onCreate={(name) =>
                  run(async () => {
                    await api("/organizations", "POST", { name });
                    applySession(await api("/auth/me"));
                  })
                }
                busy={busy}
              />
            </section>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {page === "inbox"
                      ? "EVERY CONVERSATION COUNTS"
                      : "YOUR SUPPORT WORKSPACE"}
                  </div>
                  <h1>
                    {
                      {
                        inbox: "Ticket inbox",
                        knowledge: "A source of answers.",
                        analytics: "The bigger picture.",
                        team: "Good support is a team sport.",
                        settings: "Your workspace. Your rules.",
                      }[page]
                    }
                  </h1>
                  <p className="muted">
                    {
                      {
                        inbox:
                          "Keep things moving. Give every customer a clear next step.",
                        knowledge:
                          "Your policies and guides, ready when your team needs them.",
                        analytics:
                          "Real workspace activity, measured from your support conversations.",
                        team: "Bring the right people into every conversation.",
                        settings:
                          "Set your team’s service targets and workspace details.",
                      }[page]
                    }
                  </p>
                </div>
                {page === "inbox" && (
                  <button
                    className="primary"
                    onClick={() => setNewTicket(true)}
                  >
                    ＋ New ticket
                  </button>
                )}
                {page === "knowledge" && admin && (
                  <button
                    className="primary"
                    onClick={() => {
                      setEditingDoc(null);
                      setShowDocForm(true);
                    }}
                  >
                    ＋ Add document
                  </button>
                )}
              </div>
              {page === "inbox" && (
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
                        {sort === "newest"
                          ? "Most recent first"
                          : "Oldest first"}
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
                            {t.customer_email} <span>·</span>{" "}
                            {label(t.category)}
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
                              new Date(t.response_due_at).getTime() <
                                Date.now() &&
                              !t.first_response_at &&
                              !["resolved", "closed"].includes(t.status)
                                ? "overdue"
                                : ""
                            }
                          >
                            {!t.first_response_at &&
                            !["resolved", "closed"].includes(t.status)
                              ? new Date(t.response_due_at).getTime() <
                                Date.now()
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
                    <span>✦</span> Thoughtful responses begin with the right
                    context.
                  </div>
                </>
              )}
              {page === "knowledge" && (
                <>
                  <div className="info-banner">
                    <span>▧</span>
                    <p>
                      <strong>Keep your answers grounded.</strong> Add plain
                      text or Markdown policies. AI can cite matching passages,
                      and an agent reviews the final response.
                    </p>
                  </div>
                  {loading ? (
                    <p role="status">Loading documents…</p>
                  ) : (
                    <div className="document-grid">
                      {documents.map((d) => (
                        <article className="panel document-card" key={d.id}>
                          <span className="document-icon">▤</span>
                          <h3>{d.title}</h3>
                          <p>
                            {d.content?.slice(0, 200) || "Workspace document"}
                          </p>
                          <div className="index-state">
                            <Badge value={d.index_status || "pending"} />
                            {d.index_error && (
                              <p className="small danger-text">
                                {d.index_error}
                              </p>
                            )}
                            {admin && d.index_status !== "indexed" && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    const result = await api(
                                      `/documents/${d.id}/reindex`,
                                      "POST",
                                      {},
                                    );
                                    setNotice(
                                      result.status === "indexed"
                                        ? "Document indexed and ready for retrieval."
                                        : `Document saved, indexing failed: ${result.message || "Please check provider configuration and retry."}`,
                                    );
                                    await loadPage();
                                  })
                                }
                              >
                                Retry indexing
                              </button>
                            )}
                          </div>
                          <div className="document-footer">
                            <span>{date(d.created_at)}</span>
                            {admin && (
                              <div>
                                <button
                                  onClick={() => {
                                    setEditingDoc(d);
                                    setShowDocForm(true);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="danger-text"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        "Delete this document and its retrieval passages?",
                                      )
                                    )
                                      run(async () => {
                                        await api(
                                          `/documents/${d.id}`,
                                          "DELETE",
                                        );
                                        await loadPage();
                                      });
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                      {!documents.length && (
                        <section className="panel">
                          <Empty title="Your knowledge belongs here">
                            Add a support policy to make answers easier to find.
                          </Empty>
                        </section>
                      )}
                    </div>
                  )}
                </>
              )}
              {page === "analytics" &&
                (loading ? (
                  <p role="status">Calculating insights…</p>
                ) : metrics ? (
                  <>
                    <div className="metric-grid">
                      {[
                        [
                          "Total tickets",
                          metrics.total,
                          "Across this workspace",
                        ],
                        ["Open tickets", metrics.open, "Active conversations"],
                        [
                          "Closed / resolved",
                          metrics.closed,
                          "Completed conversations",
                        ],
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
                          <strong>
                            {minutes(metrics.avgFirstResponseMinutes)}
                          </strong>
                        </div>
                        <div className="time-metric">
                          <span>Average resolution</span>
                          <strong>
                            {minutes(metrics.avgResolutionMinutes)}
                          </strong>
                        </div>
                        <p className="muted small">
                          Measured from ticket creation to the first public
                          agent response and resolution. Tickets without the
                          relevant timestamp are excluded.
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
                ) : null)}
              {page === "team" && (
                <>
                  <section className="panel team-list">
                    <div className="list-heading">
                      <strong>Workspace members</strong>
                      <span className="count">{members.length}</span>
                    </div>
                    {members.map((m) => (
                      <div className="member-row" key={m.user_id}>
                        <span className="avatar">{m.name[0]}</span>
                        <div>
                          <strong>{m.name}</strong>
                          <small>{m.email}</small>
                        </div>
                        {admin &&
                        m.role !== "owner" &&
                        m.user_id !== session.user.id &&
                        (organization?.role === "owner" ||
                          m.role !== "admin") ? (
                          <div className="member-actions">
                            <select
                              aria-label={`Role for ${m.name}`}
                              value={m.role}
                              disabled={busy}
                              onChange={(e) =>
                                run(async () => {
                                  await api(`/members/${m.user_id}`, "PATCH", {
                                    role: e.target.value,
                                  });
                                  setNotice("Member role updated.");
                                  await loadPage();
                                })
                              }
                            >
                              {organization?.role === "owner" && (
                                <option value="admin">Administrator</option>
                              )}
                              <option value="agent">Support agent</option>
                              <option value="customer">Customer</option>
                            </select>
                            <button
                              className="danger-text"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Remove ${m.name} from this workspace? Their tickets will be unassigned.`,
                                  )
                                )
                                  run(async () => {
                                    await api(
                                      `/members/${m.user_id}`,
                                      "DELETE",
                                    );
                                    setNotice("Member removed.");
                                    await loadPage();
                                  });
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <Badge value={m.role} />
                        )}
                      </div>
                    ))}
                  </section>
                  <div className="two-columns">
                    {admin && (
                      <section className="panel form-panel">
                        <h3>Invite a teammate</h3>
                        <p className="muted">
                          Invite links expire. Share them only with the intended
                          recipient.
                        </p>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const values = Object.fromEntries(
                              new FormData(e.currentTarget),
                            );
                            run(async () => {
                              const result = await api(
                                "/invitations",
                                "POST",
                                values,
                              );
                              setNotice(
                                result.token
                                  ? `Invitation token: ${result.token}`
                                  : "Invitation created.",
                              );
                              await loadPage();
                            });
                          }}
                        >
                          <Field title="Email">
                            <input name="email" type="email" required />
                          </Field>
                          <Field title="Role">
                            <select name="role">
                              <option value="agent">Support agent</option>
                              {organization?.role === "owner" && (
                                <option value="admin">Administrator</option>
                              )}
                              <option value="customer">Customer</option>
                            </select>
                          </Field>
                          <button className="primary" disabled={busy}>
                            Create invitation
                          </button>
                        </form>
                        {invitations.length > 0 && (
                          <div className="invitation-list">
                            <h4>Invitations</h4>
                            {invitations.map((i) => (
                              <div className="invitation-item" key={i.id}>
                                <div>
                                  <strong>{i.email}</strong>
                                  <span>
                                    <Badge value={i.role} />{" "}
                                    {i.accepted_at
                                      ? "Accepted"
                                      : i.expires_at &&
                                          new Date(i.expires_at).getTime() <
                                            Date.now()
                                        ? "Expired"
                                        : "Pending"}
                                  </span>
                                </div>
                                {!i.accepted_at && (
                                  <button
                                    className="danger-text"
                                    disabled={busy}
                                    onClick={() =>
                                      run(async () => {
                                        await api(
                                          `/invitations/${i.id}`,
                                          "DELETE",
                                        );
                                        setNotice("Invitation revoked.");
                                        await loadPage();
                                      })
                                    }
                                  >
                                    Revoke
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                    <section className="panel form-panel">
                      <h3>Join another workspace</h3>
                      <p className="muted">
                        Accept an invitation sent to your account email.
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const token = new FormData(e.currentTarget).get(
                            "token",
                          );
                          run(async () => {
                            await api("/invitations/accept", "POST", { token });
                            applySession(await api("/auth/me"));
                            setNotice(
                              "Invitation accepted. Switch workspaces in the sidebar.",
                            );
                          });
                        }}
                      >
                        <Field title="Invitation token">
                          <input name="token" required />
                        </Field>
                        <button disabled={busy}>Accept invitation</button>
                      </form>
                    </section>
                  </div>
                </>
              )}
              {page === "settings" && (
                <div className="two-columns">
                  <section className="panel form-panel">
                    <h3>Workspace & service targets</h3>
                    <p className="muted">
                      Targets apply when new tickets are created.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(async () => {
                          await api("/settings", "PATCH", settings);
                          applySession(await api("/auth/me"));
                          setNotice("Workspace settings saved.");
                        });
                      }}
                    >
                      <Field title="Workspace name">
                        <input
                          value={settings.name}
                          disabled={!admin}
                          onChange={(e) =>
                            setSettings({ ...settings, name: e.target.value })
                          }
                          required
                        />
                      </Field>
                      <Field title="First response target (minutes)">
                        <input
                          type="number"
                          min={1}
                          max={525600}
                          disabled={!admin}
                          value={settings.response_minutes}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              response_minutes: Number(e.target.value),
                            })
                          }
                          required
                        />
                      </Field>
                      <Field title="Resolution target (minutes)">
                        <input
                          type="number"
                          min={1}
                          max={525600}
                          disabled={!admin}
                          value={settings.resolution_minutes}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              resolution_minutes: Number(e.target.value),
                            })
                          }
                          required
                        />
                      </Field>
                      <Field title="Approved response guidelines">
                        <textarea
                          value={settings.guidelines || ""}
                          maxLength={4000}
                          rows={4}
                          disabled={!admin}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              guidelines: e.target.value,
                            })
                          }
                          placeholder="e.g. Use a friendly, concise tone. Do not promise refunds."
                        />
                      </Field>
                      {admin ? (
                        <button className="primary" disabled={busy}>
                          Save settings
                        </button>
                      ) : (
                        <p className="muted">
                          An owner or administrator can update settings.
                        </p>
                      )}
                    </form>
                  </section>
                  <section className="panel form-panel">
                    <h3>Create another workspace</h3>
                    <p className="muted">
                      Each workspace keeps its team, tickets and documents
                      separate.
                    </p>
                    <WorkspaceForm
                      busy={busy}
                      onCreate={(name) =>
                        run(async () => {
                          await api("/organizations", "POST", { name });
                          applySession(await api("/auth/me"));
                          setNotice("Workspace created.");
                        })
                      }
                    />
                  </section>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {newTicket && (
        <Modal title="Start a conversation" onClose={() => setNewTicket(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const values = Object.fromEntries(new FormData(e.currentTarget));
              run(async () => {
                const t = await api<Ticket>("/tickets", "POST", values);
                setNewTicket(false);
                await refreshList();
                setSelected(await api(`/tickets/${t.id}`));
                if (staff) setMembers(await api("/members"));
              });
            }}
          >
            <Field title="Subject">
              <input
                autoFocus
                name="subject"
                required
                minLength={3}
                maxLength={200}
                placeholder="What does your customer need?"
              />
            </Field>
            <Field title="Customer email">
              <input name="customerEmail" type="email" required />
            </Field>
            <div className="form-row">
              <Field title="Priority">
                <select name="priority" defaultValue="normal">
                  {priorities.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field title="Category">
                <select name="category" defaultValue="general_inquiry">
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {label(c)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field title="Message">
              <textarea
                name="body"
                required
                rows={6}
                maxLength={20000}
                placeholder="Include the details your team needs…"
              />
            </Field>
            <div className="modal-actions">
              <button type="button" onClick={() => setNewTicket(false)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Create ticket
              </button>
            </div>
          </form>
        </Modal>
      )}
      {showDocForm && (
        <Modal
          title={
            editingDoc
              ? "Edit knowledge document"
              : "Add to your knowledge base"
          }
          onClose={() => setShowDocForm(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const values = Object.fromEntries(new FormData(e.currentTarget));
              run(async () => {
                const result = await api(
                  editingDoc ? `/documents/${editingDoc.id}` : "/documents",
                  editingDoc ? "PATCH" : "POST",
                  values,
                );
                setShowDocForm(false);
                setNotice(
                  result.indexing?.status === "failed"
                    ? `Document saved, but indexing failed: ${result.indexing.message || "Check provider configuration and retry."}`
                    : "Document saved and indexed.",
                );
                await loadPage();
              });
            }}
          >
            <Field title="Document title">
              <input
                name="title"
                defaultValue={editingDoc?.title}
                required
                minLength={2}
                maxLength={200}
              />
            </Field>
            <Field title="Import .txt or .md (up to 200 KB)">
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 200000) {
                    setError("Please use a document under 200 KB.");
                    return;
                  }
                  const form = e.target.form;
                  const content = form?.elements.namedItem(
                    "content",
                  ) as HTMLTextAreaElement | null;
                  if (content) content.value = await f.text();
                }}
              />
            </Field>
            <Field title="Document content">
              <textarea
                name="content"
                defaultValue={editingDoc?.content}
                rows={12}
                required
                minLength={10}
                maxLength={200000}
                placeholder="Paste your support policy or import a text file."
              />
            </Field>
            <p className="small muted">
              Documents are treated as reference material. Do not include
              passwords, API keys or instructions to perform actions.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowDocForm(false)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Save & index
              </button>
            </div>
          </form>
        </Modal>
      )}
      {selected && (
        <TicketDialog onClose={() => setSelected(null)}>
          <section
            className="ticket-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ticket-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <span className="eyebrow">
                CONVERSATION · {selected.ticket.id.slice(0, 8)}
              </span>
              <button
                className="icon-button"
                aria-label="Close ticket"
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
            </div>
            <div className="drawer-content">
              <h2 id="ticket-title">{selected.ticket.subject}</h2>
              {staff && (
                <div className="ticket-edit-row">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      const subject = window.prompt(
                        "Edit ticket subject",
                        selected.ticket.subject,
                      );
                      if (subject?.trim())
                        updateTicket({ subject: subject.trim() });
                    }}
                  >
                    Edit subject
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        setSelected(
                          await api(`/tickets/${selected.ticket.id}`),
                        );
                        setDraft(null);
                        setNotice("Conversation refreshed.");
                      })
                    }
                  >
                    ↻ Refresh conversation
                  </button>
                </div>
              )}
              <p className="muted">
                {selected.ticket.customer_email} ·{" "}
                {date(selected.ticket.created_at)}
              </p>
              <div
                className="ticket-controls"
                style={{ display: staff ? undefined : "none" }}
              >
                <Field title="Status">
                  <select
                    aria-label="Ticket status"
                    value={selected.ticket.status}
                    onChange={(e) => updateTicket({ status: e.target.value })}
                    disabled={busy}
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field title="Priority">
                  <select
                    aria-label="Ticket priority"
                    value={selected.ticket.priority}
                    onChange={(e) => updateTicket({ priority: e.target.value })}
                    disabled={busy}
                  >
                    {priorities.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field title="Assign to">
                  <select
                    aria-label="Assigned agent"
                    value={selected.ticket.assignee_id || ""}
                    onChange={(e) =>
                      updateTicket({ assigneeId: e.target.value || null })
                    }
                    disabled={busy}
                  >
                    <option value="">Unassigned</option>
                    {members
                      .filter((m) => m.role !== "customer")
                      .map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field title="Category">
                  <select
                    aria-label="Ticket category"
                    value={selected.ticket.category}
                    onChange={(e) => updateTicket({ category: e.target.value })}
                    disabled={busy}
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {label(c)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="sla-strip">
                <span>
                  Response due{" "}
                  <strong>{date(selected.ticket.response_due_at)}</strong>
                </span>
                <span>
                  Resolution due{" "}
                  <strong>{date(selected.ticket.resolution_due_at)}</strong>
                </span>
              </div>
              <h3 className="section-title">Conversation</h3>
              <div className="messages">
                {selected.messages.map((m) => (
                  <article
                    key={m.id}
                    className={`message ${m.internal ? "internal-message" : ""}`}
                  >
                    <div className="message-heading">
                      <strong>
                        {m.author_name || selected.ticket.customer_email}
                      </strong>
                      <span>
                        {m.internal && <Badge value="internal_note" />}{" "}
                        {date(m.created_at)}
                      </span>
                    </div>
                    <p>{m.body}</p>
                  </article>
                ))}
              </div>
              <section
                className="ai-panel"
                style={{ display: staff ? undefined : "none" }}
              >
                <div className="ai-heading">
                  <div>
                    <span className="sparkle">✦</span>
                    <strong> A thoughtful starting point</strong>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await api<{ draft: Draft }>(
                          `/tickets/${selected.ticket.id}/ai`,
                          "POST",
                          {},
                        );
                        setDraft(result.draft);
                      })
                    }
                  >
                    {busy
                      ? "Working…"
                      : draft
                        ? "Regenerate"
                        : "Suggest a reply"}
                  </button>
                </div>
                <p className="small muted">
                  Grounded in your workspace knowledge. Review before using.
                </p>
                {draft && (
                  <>
                    <div className="draft-body">{draft.body}</div>
                    {draft.category && (
                      <p className="small">
                        Suggested: {label(draft.category)} ·{" "}
                        {label(draft.priority || "normal")} priority
                      </p>
                    )}
                    {draft.explanation && (
                      <p className="small muted">{draft.explanation}</p>
                    )}
                    <div className="citations">
                      {draft.citations?.map((c, i) => (
                        <details key={`${c.id}-${i}`}>
                          <summary>
                            [{i + 1}] {c.title}
                          </summary>
                          <p>{c.excerpt}</p>
                        </details>
                      ))}
                    </div>
                    <div className="draft-actions">
                      <button
                        onClick={() => {
                          setReply(draft.body);
                          setInternal(false);
                        }}
                      >
                        Edit in composer
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          run(async () => {
                            await api(`/drafts/${draft.id}/reject`, "POST", {});
                            setDraft(null);
                            setNotice("Draft rejected.");
                          })
                        }
                      >
                        Reject draft
                      </button>
                      {draft.category && (
                        <button
                          className="text-button"
                          onClick={() =>
                            updateTicket({
                              category: draft.category,
                              priority: draft.priority,
                            })
                          }
                        >
                          Apply classification
                        </button>
                      )}
                    </div>
                    <span className="small muted">
                      Provider: {draft.provider || "configured provider"}
                    </span>
                  </>
                )}
              </section>
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await api(
                      `/tickets/${selected.ticket.id}/messages`,
                      "POST",
                      {
                        body: reply,
                        internal,
                        version: selected.ticket.version,
                        ...(draft && !internal ? { draftId: draft.id } : {}),
                      },
                    );
                    setReply("");
                    setDraft(null);
                    setSelected(await api(`/tickets/${selected.ticket.id}`));
                    await refreshList();
                  });
                }}
              >
                <div className="composer-tabs">
                  <button
                    type="button"
                    className={!internal ? "selected" : ""}
                    onClick={() => setInternal(false)}
                  >
                    Public reply
                  </button>
                  <button
                    type="button"
                    hidden={!staff}
                    className={internal ? "selected" : ""}
                    onClick={() => setInternal(true)}
                  >
                    Internal note
                  </button>
                </div>
                <textarea
                  aria-label={internal ? "Internal note" : "Reply message"}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={5}
                  required
                  maxLength={20000}
                  placeholder={
                    internal
                      ? "Only your team can see this note…"
                      : "Write a clear, helpful response…"
                  }
                />
                <div className="composer-bottom">
                  <span className="small muted">
                    {["resolved", "closed"].includes(selected.ticket.status)
                      ? "Reopen this ticket before replying."
                      : internal
                        ? "Visible to your team only"
                        : "Saved to the conversation and queued for configured email delivery."}
                  </span>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !reply.trim() ||
                      ["resolved", "closed"].includes(selected.ticket.status)
                    }
                  >
                    {internal ? "Add note" : "Send response →"}
                  </button>
                </div>
              </form>
              <details className="activity">
                <summary>
                  Activity history · {selected.activities.length}
                </summary>
                {selected.activities.map((a) => (
                  <div key={a.id}>
                    <span>{label(a.kind)}</span>
                    <time>{date(a.created_at)}</time>
                  </div>
                ))}
              </details>
            </div>
          </section>
        </TicketDialog>
      )}
    </div>
  );
}

function WorkspaceForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (name: string) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(String(new FormData(e.currentTarget).get("name")));
      }}
    >
      <Field title="Workspace name">
        <input name="name" required minLength={2} maxLength={100} />
      </Field>
      <button className="primary" disabled={busy}>
        Create workspace
      </button>
    </form>
  );
}
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([hidden]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]',
        ) || [],
      ).filter((el) => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const controls = focusable();
        if (!controls.length) return;
        const first = controls[0],
          last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  return ref;
}
function TicketDialog({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useDialog(onClose);
  return (
    <div ref={ref} className="drawer-overlay" onClick={onClose}>
      {children}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useDialog(onClose);
  return (
    <div ref={ref} className="modal-overlay" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button
            aria-label="Close dialog"
            className="icon-button"
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
