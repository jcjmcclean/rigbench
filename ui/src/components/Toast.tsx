import { useEffect } from "react";
import "./Toast.css";

export interface ToastItem {
  id: number;
  message: string;
}

const AUTO_DISMISS_MS = 6000;

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, onDismiss]);

  return (
    <div className="toast" role="alert">
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
