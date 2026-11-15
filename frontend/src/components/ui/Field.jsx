import { useId } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Labelled text input. The label and any validation message are associated
 * with the input programmatically (handoff §13.1).
 */
export function TextField({ label, value, onChange, error = null, hint = null, suffix = null, className = "", ...rest }) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`mw-field ${error ? "is-invalid" : ""} ${className}`}>
      <label className="mw-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="mw-field__control">
        <input
          {...rest}
          id={id}
          className="mw-input"
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        {suffix && <span className="mw-field__suffix">{suffix}</span>}
      </div>
      {error && (
        <p id={`${id}-error`} className="mw-field__error" role="alert">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${id}-hint`} className="mw-field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SelectField({ label, value, onChange, options, className = "", ...rest }) {
  const id = useId();
  return (
    <div className={`mw-field ${className}`}>
      <label className="mw-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="mw-field__control mw-field__control--select">
        <select {...rest} id={id} className="mw-input mw-select" value={value} onChange={(event) => onChange?.(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="mw-select__chevron" size={16} aria-hidden="true" />
      </div>
    </div>
  );
}
