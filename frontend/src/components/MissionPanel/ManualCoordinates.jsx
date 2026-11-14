import { useEffect, useState } from "react";
import { Check, Eraser } from "lucide-react";

import Button from "../ui/Button";
import InlineMessage from "../ui/InlineMessage";
import { SelectField, TextField } from "../ui/Field";
import { MARS_CRS_INFO } from "../../utils/mapConfig";
import {
  COORDINATE_DECIMALS,
  ROUTING_EXTENT,
  describeExtent,
  parseCoordinate,
  roundCoordinate,
  validatePointExtent,
} from "../../utils/coordinates";

const POINT_OPTIONS = [
  { value: "start", label: "Start Point" },
  { value: "goal", label: "Goal Point" },
];

const FIELD_ERRORS = {
  required: "Enter a value.",
  format: `Enter a number, for example ${ROUTING_EXTENT.minX + 1234.5}.`,
};

const EMPTY_DRAFT = { pointType: "start", x: "", y: "" };

/**
 * Manual coordinate entry (handoff §4.4, §5.4).
 *
 * Draft values live here and are only committed after validation succeeds.
 * A failed validation leaves the previous valid point exactly as it was, and
 * nothing is clamped or coerced.
 */
function ManualCoordinates({ draft, onDraftChange, onApply, hasPoint }) {
  const [errors, setErrors] = useState({});
  const [extentError, setExtentError] = useState(null);
  const [applied, setApplied] = useState(null);
  const extent = describeExtent();

  // Clear feedback whenever the draft changes.
  useEffect(() => {
    setErrors({});
    setExtentError(null);
    setApplied(null);
  }, [draft.pointType, draft.x, draft.y]);

  const label = draft.pointType === "start" ? "Start Point" : "Goal Point";

  const handleApply = () => {
    const x = parseCoordinate(draft.x);
    const y = parseCoordinate(draft.y);

    const nextErrors = {};
    if (!x.ok) nextErrors.x = FIELD_ERRORS[x.code];
    if (!y.ok) nextErrors.y = FIELD_ERRORS[y.code];

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setExtentError(null);
      return;
    }

    const point = { x: roundCoordinate(x.value), y: roundCoordinate(y.value) };
    const extentCheck = validatePointExtent(point);

    if (!extentCheck.ok) {
      const axes = [!extentCheck.xInside ? "X" : null, !extentCheck.yInside ? "Y" : null].filter(Boolean).join(" and ");
      setErrors({});
      setExtentError(
        `The ${axes} value is outside the supported map extent. The ${label.toLowerCase()} is unchanged. ` +
          `Enter X within ${extent.x} and Y within ${extent.y}, or choose a point on the map.`
      );
      return;
    }

    setErrors({});
    setExtentError(null);
    onApply(draft.pointType, point);
    setApplied(`${label} updated to X ${point.x}, Y ${point.y}.`);
  };

  return (
    <div className="mw-manual">
      <p className="mw-helper">
        {MARS_CRS_INFO.label}. {MARS_CRS_INFO.axisOrder}, in {MARS_CRS_INFO.units}.
      </p>

      <SelectField
        label="Point type"
        value={draft.pointType}
        options={POINT_OPTIONS}
        onChange={(value) => onDraftChange({ ...draft, pointType: value })}
      />

      <div className="mw-manual__pair">
        <TextField
          label="X coordinate"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={String(ROUTING_EXTENT.minX)}
          value={draft.x}
          error={errors.x}
          onChange={(value) => onDraftChange({ ...draft, x: value })}
        />
        <TextField
          label="Y coordinate"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={String(ROUTING_EXTENT.minY)}
          value={draft.y}
          error={errors.y}
          onChange={(value) => onDraftChange({ ...draft, y: value })}
        />
      </div>

      <p className="mw-helper">
        Supported extent: X {extent.x}, Y {extent.y}. Up to {COORDINATE_DECIMALS} decimal places.
      </p>

      {extentError && (
        <InlineMessage tone="critical" compact>
          {extentError}
        </InlineMessage>
      )}

      {applied && (
        <InlineMessage tone="success" compact>
          {applied}
        </InlineMessage>
      )}

      <div className="mw-manual__actions">
        <Button variant="primary" size="sm" icon={<Check size={14} aria-hidden="true" />} onClick={handleApply}>
          Apply coordinates
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Eraser size={14} aria-hidden="true" />}
          disabled={draft.x === "" && draft.y === ""}
          onClick={() => onDraftChange({ ...EMPTY_DRAFT, pointType: draft.pointType })}
        >
          Clear
        </Button>
      </div>

      <p className="mw-helper">
        Clear empties these fields only. {hasPoint ? `The committed ${label.toLowerCase()} stays on the map.` : ""}
      </p>
    </div>
  );
}

export default ManualCoordinates;
