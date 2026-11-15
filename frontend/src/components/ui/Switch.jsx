/** Toggle switch with switch semantics (handoff §4.3). */
function Switch({ checked, onChange, label, labelledBy, disabled = false, id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      className="mw-switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
    >
      <span className="mw-switch__thumb" aria-hidden="true" />
    </button>
  );
}

export default Switch;
