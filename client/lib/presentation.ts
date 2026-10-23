export const statuses = [
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
];
export const priorities = ["low", "normal", "high", "urgent"];
export const categories = [
  "billing",
  "refund",
  "delivery",
  "product_complaint",
  "technical_issue",
  "general_inquiry",
];
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const date = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const minutes = (n: number | null | undefined) =>
  n == null ? "—" : n < 60 ? `${Math.round(n)}m` : `${(n / 60).toFixed(1)}h`;
