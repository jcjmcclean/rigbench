import "./Toast.css";

export interface ToastItem {
  id: number;
  message: string;
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
        <div key={t.id} className="toast" role="alert">
          <span className="toast__dot" aria-hidden />
          <span className="toast__msg">{t.message}</span>
          <button className="toast__close" onClick={() => onDismiss(t.id)} aria-label="Dismiss notification">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
