import Tooltip from "./Tooltip";

/**
 * Icon-only button. `label` is required: it is the accessible name and the
 * tooltip text (handoff §2.6).
 */
function IconButton({
  label,
  children,
  pressed,
  size = "md",
  variant = "ghost",
  tooltipPlacement = "bottom",
  className = "",
  disabled = false,
  ...rest
}) {
  const classes = ["mw-icon-button", `mw-icon-button--${variant}`, `mw-icon-button--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <Tooltip label={label} placement={tooltipPlacement}>
      <button
        {...rest}
        type="button"
        className={classes}
        aria-label={label}
        aria-pressed={pressed === undefined ? undefined : pressed}
        disabled={disabled}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export default IconButton;
