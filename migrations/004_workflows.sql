-- Sandbox records cannot invoke real payment or commerce providers.
CREATE TABLE sandbox_orders(
  id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
  customer_email text NOT NULL, amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 1 AND 50000),
  currency text NOT NULL CHECK(currency='INR'), shipment_status text NOT NULL DEFAULT 'delayed',
  refunded boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,id)
);
CREATE TABLE workflow_runs(
  id uuid PRIMARY KEY, org_id uuid NOT NULL, ticket_id uuid NOT NULL,
  order_id uuid NOT NULL, requested_by uuid NOT NULL REFERENCES users,
  idempotency_key uuid NOT NULL, mode text NOT NULL DEFAULT 'deterministic-sandbox' CHECK(mode='deterministic-sandbox'),
  state text NOT NULL DEFAULT 'CREATED' CHECK(state IN ('CREATED','TRIAGED','GATHERING_CONTEXT','PLANNING','AWAITING_APPROVAL','EXECUTING','VERIFYING','COMPLETED','FAILED','CANCELLED','TIMED_OUT','ESCALATED','RETRY_PENDING')),
  proposal jsonb, action_hash text, draft_response text, last_error text,
  tool_calls integer NOT NULL DEFAULT 0 CHECK(tool_calls BETWEEN 0 AND 12),
  usage jsonb NOT NULL DEFAULT '{"provider":"deterministic","model":null,"inputTokens":0,"outputTokens":0,"costMicros":0}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  UNIQUE(org_id,id), UNIQUE(org_id,idempotency_key),
  FOREIGN KEY(org_id,ticket_id) REFERENCES tickets(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY(org_id,order_id) REFERENCES sandbox_orders(org_id,id)
);
CREATE INDEX workflow_pending ON workflow_runs(state,updated_at);
CREATE INDEX workflow_ticket ON workflow_runs(org_id,ticket_id,created_at);
CREATE TABLE workflow_events(
  id uuid PRIMARY KEY, org_id uuid NOT NULL, run_id uuid NOT NULL, state text NOT NULL,
  capability text NOT NULL, tool text NOT NULL, summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(org_id,run_id) REFERENCES workflow_runs(org_id,id) ON DELETE CASCADE
);
CREATE TABLE workflow_approvals(
  id uuid PRIMARY KEY, org_id uuid NOT NULL, run_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users, decision text NOT NULL CHECK(decision IN ('approve','reject')),
  action_hash text NOT NULL, reason text NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,run_id),
  FOREIGN KEY(org_id,run_id) REFERENCES workflow_runs(org_id,id) ON DELETE CASCADE
);
CREATE TABLE sandbox_refunds(
  id uuid PRIMARY KEY, org_id uuid NOT NULL, run_id uuid NOT NULL, order_id uuid NOT NULL,
  amount_cents integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,run_id), UNIQUE(org_id,order_id),
  FOREIGN KEY(org_id,run_id) REFERENCES workflow_runs(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY(org_id,order_id) REFERENCES sandbox_orders(org_id,id)
);
