export type Org = { id: string; name: string; role: string };
export type Session = {
  user: { id: string; name: string; email: string };
  organizations: Org[];
  csrfToken: string;
};
export type Ticket = {
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
export type Member = {
  user_id: string;
  name: string;
  email: string;
  role: string;
};
export type Doc = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  index_status?: "pending" | "indexed" | "failed";
  index_error?: string | null;
};
export type Draft = {
  id: string;
  body: string;
  citations: { id: string; title: string; excerpt: string }[];
  category?: string;
  priority?: string;
  explanation?: string;
  provider?: string;
  status?: string;
};
export type Detail = {
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
export type Metrics = {
  total: number;
  open: number;
  closed: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  slaCompliance: number | null;
  categories: { category: string; count: number }[];
  workload: { name: string; count: number }[];
};

export type Api = <T = any>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
export type Run = (fn: () => Promise<void>) => Promise<void>;
