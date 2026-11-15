import L from "leaflet";
import { Marker, Tooltip } from "react-leaflet";

import { marsToLatLng } from "../../utils/mapAdapter";
import { formatCoordinate } from "../../utils/coordinates";

/**
 * Start and Goal markers (handoff §4.10). Colour is paired with a distinct
 * shape and a letter so the two are distinguishable without colour:
 *   Start Point — round pin, "S", Success Green
 *   Goal Point  — diamond pin, "G", Critical Red
 */
const PIN_SHAPES = {
  start:
    '<path class="mw-pin__body" d="M14 35C14 35 3.5 22.2 3.5 13.500A10.500 10.500 0 0 1 24.5 13.500C24.5 22.2 14 35 14 35Z"/>',
  goal: '<path class="mw-pin__body" d="M14 35 4.2 18.800a2.400 2.400 0 0 1 0-2.600L12 3.300a2.400 2.400 0 0 1 4 0l7.800 12.900a2.400 2.400 0 0 1 0 2.600Z"/>',
};

const PIN_META = {
  start: { name: "Start Point", letter: "S", textY: 18 },
  goal: { name: "Goal Point", letter: "G", textY: 20.500 },
};

function createPinIcon(type) {
  const meta = PIN_META[type];
  return L.divIcon({
    className: `mw-pin mw-pin--${type}`,
    html:
      `<svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true" focusable="false">` +
      PIN_SHAPES[type] +
      `<text class="mw-pin__letter" x="14" y="${meta.textY}" text-anchor="middle">${meta.letter}</text>` +
      `</svg><span class="mw-visually-hidden">${meta.name}</span>`,
    iconSize: [28, 36],
    iconAnchor: [14, 35],
    tooltipAnchor: [0, -34],
  });
}

const ICONS = { start: createPinIcon("start"), goal: createPinIcon("goal") };

function Point({ point, type }) {
  if (!point) return null;
  const meta = PIN_META[type];
  return (
    <Marker position={marsToLatLng(point)} icon={ICONS[type]} keyboard zIndexOffset={type === "goal" ? 200 : 100}>
      <Tooltip direction="top">
        <strong>{meta.name}</strong>
        <br />
        <span className="mw-mono">X {formatCoordinate(point.x)}</span>
        <br />
        <span className="mw-mono">Y {formatCoordinate(point.y)}</span>
      </Tooltip>
    </Marker>
  );
}

function StartGoalLayer({ start, goal }) {
  return (
    <>
      <Point point={start} type="start" />
      <Point point={goal} type="goal" />
    </>
  );
}

export default StartGoalLayer;
