import { useEffect, useRef, type ReactNode } from "react";

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
export function TicketDialog({
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
export function Modal({
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
