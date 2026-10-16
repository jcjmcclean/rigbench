import { useEffect, useRef, useState } from "react";
import "./Toast.css";

export interface ToastItem {
  id: number;
  message: string;
}

// A toast stays up long enough to read: 6 s, plus a bit for every character
// (a preset that half-loaded can list two or three problems with file names),
// up to 20 s. Its clock stops while the pointer is over it or it has focus.
export const TOAST_MIN_MS = 6000;
export const TOAST_PER_CHAR_MS = 60;
export const TOAST_MAX_MS = 20_000;

function toastDuration(message: string): number {
  return Math.min(TOAST_MAX_MS, TOAST_MIN_MS + TOAST_PER_CHAR_MS * message.length);
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const remaining = useRef(toastDuration(item.message));

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, item.id, onDismiss]);

  return (
    <div
      className="toast"
      role="alert"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
    >
      <span className="toast__dot" aria-hidden />
      <span className="toast__msg">{item.message}</span>
      <button className="toast__close" onClick={() => onDismiss(item.id)} aria-label="Dismiss notification">
        ✕
      </button>
    </div>
  );
}

export function Toasts({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {items.map((t) => (
        <Toast key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
