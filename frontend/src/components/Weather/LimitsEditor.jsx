import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import Button from "../ui/Button";
import { LIMIT_FIELDS } from "../../utils/weather";

/**
 * Planning limits used to turn the forecast into GO / Caution / No-Go.
 * Values are validated before they are applied; the service re-checks them.
 */
function LimitsEditor({ limits, defaults, onChange }) {
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraft(Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, String(f.percent ? Math.round(limits[f.key] * 100) : limits[f.key])])));
  }, [limits]);

  const apply = (event) => {
    event.preventDefault();
    const next = {};
    for (const field of LIMIT_FIELDS) {
      const value = Number(draft[field.key]);
      const real = field.percent ? value / 100 : value;
      if (!Number.isFinite(value) || real < field.min || real > field.max) {
        setError(`${field.label} must be between ${field.percent ? field.min * 100 : field.min} and ${field.percent ? field.max * 100 : field.max}${field.percent ? "%" : ` ${field.unit}`}.`);
        return;
      }
      next[field.key] = real;
    }
    if (next.caution_confidence > next.go_confidence) {
      setError("The Caution confidence cannot be higher than the GO confidence.");
      return;
    }
    setError(null);
    onChange(next);
  };

  const isDefault = defaults && LIMIT_FIELDS.every((f) => Math.abs(limits[f.key] - defaults[f.key]) < 1e-9);

  return (
    <form className="mw-limits" onSubmit={apply} data-tour="dashboard-limits">
      <div className="mw-limits__fields">
        {LIMIT_FIELDS.map((field) => (
          <label key={field.key} className="mw-field">
            <span className="mw-field__label">{field.label}</span>
            <span className="mw-field__control">
              <input
                className="mw-input"
                inputMode="decimal"
                value={draft[field.key] ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
              />
              <span className="mw-field__suffix">{field.percent ? "%" : field.unit}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mw-limits__actions">
        <Button type="submit" variant="primary" size="sm">
          Apply limits
        </Button>
        <Button variant="tertiary" size="sm" icon={<RotateCcw size={13} aria-hidden="true" />} disabled={isDefault} onClick={() => defaults && onChange({ ...defaults })}>
          Defaults
        </Button>
      </div>
      {error && <p className="mw-field__error">{error}</p>}
      <p className="mw-helper">Placeholder values for planning. Replace them with the team's suit and operations limits.</p>
    </form>
  );
}

export default LimitsEditor;
