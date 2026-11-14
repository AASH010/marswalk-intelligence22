import { useId } from "react";

import { ROUTE_STRATEGIES } from "../../api/routes";

/**
 * Route strategy selector (handoff §4.2).
 *
 * The options are exactly the identifiers the backend accepts
 * (`mode` in backend/app/schemas/route.py). The helper text states the
 * terrain weight each mode applies in backend/app/core/routing/route_modes.py
 * and nothing beyond it, so no algorithm behaviour is implied.
 *
 * Changing the strategy does not recalculate: it marks the displayed result
 * outdated, and the user re-runs Plan terrain route.
 */
function StrategySelector({ value, onChange, disabled = false }) {
  const id = useId();

  return (
    <div className="mw-strategy">
      <span className="mw-field__label" id={id}>
        Route strategy
      </span>
      <div className="mw-strategy__options" role="radiogroup" aria-labelledby={id}>
        {ROUTE_STRATEGIES.map((strategy) => {
          const selected = strategy.id === value;
          return (
            <button
              key={strategy.id}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              className="mw-strategy__option"
              disabled={disabled}
              onClick={() => onChange(strategy.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowDown" && event.key !== "ArrowLeft" && event.key !== "ArrowUp") return;
                event.preventDefault();
                const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
                const index = ROUTE_STRATEGIES.findIndex((item) => item.id === value);
                const next = ROUTE_STRATEGIES[(index + step + ROUTE_STRATEGIES.length) % ROUTE_STRATEGIES.length];
                onChange(next.id);
                event.currentTarget.parentElement?.querySelector(`[data-strategy="${next.id}"]`)?.focus();
              }}
              data-strategy={strategy.id}
            >
              <span className="mw-strategy__mark" aria-hidden="true" />
              <span className="mw-strategy__text">
                <span className="mw-strategy__name">{strategy.label}</span>
                <span className="mw-strategy__detail">Terrain weight {strategy.terrainWeight}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default StrategySelector;
