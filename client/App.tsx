import { useEffect, useState, type FormEvent } from "react";
import type {
  Session,
  Ticket,
  Member,
  Doc,
  Draft,
  Detail,
  Metrics,
} from "./types";
import {
  categories,
  priorities,
  statuses,
  label,
  date,
} from "./lib/presentation";
import { Field, Badge } from "./components/ui";
import { Modal, TicketDialog } from "./components/dialogs";
import { WorkspaceForm } from "./components/WorkspaceForm";
import { AuthPage } from "./pages/AuthPage";
import { InboxPage } from "./pages/InboxPage";
import { WorkflowConsole } from "./components/WorkflowConsole";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { KnowledgePage } from "./pages/KnowledgePage";

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
      <AuthPage
        authMode={authMode}
        error={error}
        notice={notice}
        busy={busy}
        onSubmit={auth}
        onModeChange={setAuthMode}
        onError={setError}
        onNotice={setNotice}
        api={api}
        run={run}
      />
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
                <InboxPage
                  q={q}
                  status={status}
                  priority={priority}
                  sort={sort}
                  listPage={listPage}
                  total={total}
                  loading={loading}
                  tickets={tickets}
                  setQ={setQ}
                  setStatus={setStatus}
                  setPriority={setPriority}
                  setSort={setSort}
                  setListPage={setListPage}
                  refreshList={refreshList}
                  openTicket={openTicket}
                />
              )}
              {page === "knowledge" && (
                <KnowledgePage
                  loading={loading}
                  documents={documents}
                  admin={admin}
                  busy={busy}
                  api={api}
                  run={run}
                  setNotice={setNotice}
                  loadPage={loadPage}
                  setEditingDoc={setEditingDoc}
                  setShowDocForm={setShowDocForm}
                />
              )}
              {page === "analytics" && (
                <AnalyticsPage loading={loading} metrics={metrics} />
              )}
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
              {staff && (
                <WorkflowConsole
                  key={`${orgId}:${selected.ticket.id}`}
                  ticketId={selected.ticket.id}
                  admin={admin}
                  api={api}
                />
              )}
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
