import { CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, critical: CircleX };

/** Transient, non-blocking notifications announced politely to assistive technology. */
function ToastRegion({ toasts, onDismiss }) {
  return (
    <div className="mw-toasts" role="region" aria-label="Notifications" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone] || Info;
        return (
          <div key={toast.id} className={`mw-toast mw-toast--${toast.tone}`}>
            <Icon className="mw-toast__icon" size={16} aria-hidden="true" />
            <span className="mw-toast__text">{toast.message}</span>
            <button type="button" className="mw-toast__close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default ToastRegion;
