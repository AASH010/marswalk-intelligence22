import { useId } from "react";

import Spinner from "../ui/Spinner";
import Switch from "../ui/Switch";
import Tooltip from "../ui/Tooltip";
import { AVAILABILITY } from "../../utils/layerConfig";
import { TriangleAlert } from "lucide-react";

/**
 * One layer in the Layer Manager (handoff §4.3).
 *
 * Availability is separate from visibility: a layer whose data has not
 * loaded cannot be switched on and is labelled "Unavailable", so the control
 * never claims a dataset is active when it is not.
 */
function LayerRow({ layer, state, availability, onToggle, onOpacityChange, children }) {
  const id = useId();
  const unavailable = availability === AVAILABILITY.UNAVAILABLE;
  const checking = availability === AVAILABILITY.CHECKING;
  const enabled = Boolean(state?.enabled);
  const visible = enabled && availability === AVAILABILITY.AVAILABLE;
  const opacity = state?.opacity ?? 1;

  return (
    <div className={`mw-layer ${unavailable ? "is-unavailable" : ""}`}>
      <div className="mw-layer__head">
        <span className="mw-layer__label" id={id}>
          {layer.label}
        </span>

        {checking && (
          <span className="mw-layer__state">
            <Spinner size={12} />
            Loading
          </span>
        )}

        {unavailable && (
          <Tooltip label="This dataset is currently unavailable. Other map layers remain accessible.">
            <span className="mw-layer__state mw-layer__state--unavailable">
              <TriangleAlert size={12} aria-hidden="true" />
              Unavailable
            </span>
          </Tooltip>
        )}

        <Switch checked={visible} disabled={unavailable || checking} labelledBy={id} onChange={(next) => onToggle(layer.id, next)} />
      </div>

      {children}

      {visible && (
        <div className="mw-layer__opacity">
          <label className="mw-visually-hidden" htmlFor={`${id}-opacity`}>
            {layer.label} opacity
          </label>
          <span className="mw-layer__opacity-label">Opacity</span>
          <input
            id={`${id}-opacity`}
            className="mw-range"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(event) => onOpacityChange(layer.id, Number(event.target.value))}
          />
          <span className="mw-layer__opacity-value mw-mono">{Math.round(opacity * 100)}%</span>
        </div>
      )}
    </div>
  );
}

export default LayerRow;
