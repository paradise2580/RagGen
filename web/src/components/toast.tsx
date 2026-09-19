import React from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { ToastContext, type ToastInput, type ToastTone } from "./toast-context";
import "./toast.css";

interface Toast extends ToastInput {
  id: number;
}

const ICONS: Record<ToastTone, IconName> = {
  info: "info",
  success: "check-circle",
  error: "alert",
};

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timers = React.useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = React.useCallback(
    (toast: ToastInput) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { ...toast, id }]);
      const timer = setTimeout(() => dismiss(id), 5000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  React.useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const value = React.useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-region" role="region" aria-label="Notifications">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast toast--${toast.tone}`}
              role={toast.tone === "error" ? "alert" : "status"}
              aria-live={toast.tone === "error" ? "assertive" : "polite"}
            >
              <span className="toast__icon" aria-hidden="true">
                <Icon name={ICONS[toast.tone]} size={18} />
              </span>
              <div className="toast__text">
                <strong>{toast.title}</strong>
                {toast.description ? <span>{toast.description}</span> : null}
              </div>
              <button
                type="button"
                className="toast__close"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
