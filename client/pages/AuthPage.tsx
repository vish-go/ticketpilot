import type { FormEvent } from "react";
import { Field } from "../components/ui";
import type { Api, Run } from "../types";

type Props = {
  authMode: string;
  error: string;
  notice: string;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onModeChange: (mode: string) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  api: Api;
  run: Run;
};
export function AuthPage({
  authMode,
  error,
  notice,
  busy,
  onSubmit,
  onModeChange,
  onError,
  onNotice,
  api,
  run,
}: Props) {
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
          <div className="eyebrow light">A LITTLE CLARITY GOES A LONG WAY</div>
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
          <form onSubmit={onSubmit}>
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
                  authMode === "register" ? "new-password" : "current-password"
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
              onModeChange(authMode === "login" ? "register" : "login");
              onError("");
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
                  onNotice(
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
                  onNotice("Password updated. You can now sign in.");
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
}
