import { useEffect, useId, useRef, type ReactNode } from "react";
import "./Modal.css";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;   // for content with labelled rows (Settings)
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Callers pass an inline onClose, so its identity changes on every parent
  // render (30 Hz while meters stream). Read it through a ref so the mount-only
  // effect below doesn't re-run — re-running would yank focus back to the first
  // input on every tick.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    // Remember the trigger so focus can be restored when the dialog closes.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Move focus into the dialog on open (first autofocus target, else the dialog).
    const initial = dialogRef.current?.querySelector<HTMLElement>("[autofocus], input, button");
    (initial ?? dialogRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        const items = focusable();
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const activeIsInside = dialogRef.current?.contains(document.activeElement);
        if (e.shiftKey) {
          if (!activeIsInside || document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else if (!activeIsInside || document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="modal__scrim" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={`modal${wide ? " modal--wide" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal__title eyebrow" id={titleId}>{title}</div>
        {children}
      </div>
    </div>
  );
}
