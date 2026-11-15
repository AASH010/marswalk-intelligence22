import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";

const ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  critical: CircleX,
};

/**
 * Persistent inline feedback placed next to the control or content it
 * concerns (handoff §9.2). Critical messages use alert semantics.
 */
function InlineMessage({ tone = "info", title = null, children, action = null, compact = false, id, live = true }) {
  const Icon = ICONS[tone] || Info;
  const role = !live ? undefined : tone === "critical" ? "alert" : "status";

  return (
    <div id={id} className={`mw-message mw-message--${tone} ${compact ? "mw-message--compact" : ""}`} role={role}>
      <Icon className="mw-message__icon" size={16} aria-hidden="true" />
      <div className="mw-message__body">
        {title && <strong className="mw-message__title">{title}</strong>}
        {children && <div className="mw-message__text">{children}</div>}
        {action && <div className="mw-message__action">{action}</div>}
      </div>
    </div>
  );
}

export default InlineMessage;
