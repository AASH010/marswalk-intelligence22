/** Explains why content is absent and what, if anything, resolves it (handoff §4.11). */
function EmptyState({ icon = null, children, action = null }) {
  return (
    <div className="mw-empty">
      {icon && <span className="mw-empty__icon">{icon}</span>}
      <p className="mw-empty__text">{children}</p>
      {action && <div className="mw-empty__action">{action}</div>}
    </div>
  );
}

export default EmptyState;
