import { useEffect } from "react";
import { useToasts } from "../../state/selectors";
import { useAppStore } from "../../state/store";

const TOAST_TTL_MS = 4000;

export const ToastHost = () => {
  const toasts = useToasts();
  const dismissToast = useAppStore((state) => state.dismissToast);

  useEffect(() => {
    const timers = toasts.map((toast) => {
      const timer = window.setTimeout(() => {
        dismissToast(toast.id);
      }, TOAST_TTL_MS);
      return timer;
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [toasts, dismissToast]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <aside className="toast-host" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <p>{toast.message}</p>
          <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
            Close
          </button>
        </div>
      ))}
    </aside>
  );
};
