import Spinner from "./Spinner";

/**
 * Button (handoff §4.1).
 * variant: "primary" | "secondary" | "tertiary" | "destructive"
 * A loading button keeps its width, shows a spinner with a status label and
 * ignores further clicks so a request cannot be submitted twice.
 */
function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  loadingLabel = "Working…",
  icon = null,
  iconRight = null,
  block = false,
  disabled = false,
  className = "",
  type = "button",
  onClick,
  children,
  ...rest
}) {
  const classes = [
    "mw-button",
    `mw-button--${variant}`,
    `mw-button--${size}`,
    block ? "mw-button--block" : "",
    loading ? "is-loading" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled && !loading}
      aria-disabled={loading || disabled || undefined}
      aria-busy={loading || undefined}
      onClick={(event) => {
        if (loading || disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      <span className="mw-button__content">
        {icon}
        <span className="mw-button__label">{children}</span>
        {iconRight}
      </span>
      {loading && (
        <span className="mw-button__loading">
          <Spinner size={16} />
          <span>{loadingLabel}</span>
        </span>
      )}
    </button>
  );
}

export default Button;
