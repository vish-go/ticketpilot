import type { ReactNode } from "react";
import { label } from "../lib/presentation";

export function Field({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{title}</span>
      {children}
    </label>
  );
}
export function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value}`}>{label(value)}</span>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">◎</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
