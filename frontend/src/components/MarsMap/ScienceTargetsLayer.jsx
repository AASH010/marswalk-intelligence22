import { memo, useMemo, useRef } from "react";
import { CircleMarker, Tooltip } from "react-leaflet";

import { latLngToMars, marsToLatLng } from "../../utils/mapAdapter";
import { formatFixed } from "../../utils/format";
import { MAP_COLORS } from "./mapStyle";

function radiusFor(target) {
  const score = typeof target.science_value === "number" ? target.science_value : 0;
  return 5 + score * 2;
}

/**
 * Science target markers — one violet circle per target record returned by
 * the science service. Marker size follows the record's relative ranking.
 *
 * The marker list is memoised and its handlers are stable, so selecting a
 * target or changing the map tool does not restyle every marker.
 */
const TargetMarkers = memo(function TargetMarkers({ targets, opacity, onSelectRef }) {
  const items = useMemo(
    () =>
      targets.map((target) => ({
        target,
        center: marsToLatLng(target),
        radius: radiusFor(target),
        pathOptions: {
          color: MAP_COLORS.casing,
          weight: 1.25,
          opacity: 0.9 * opacity,
          fillColor: MAP_COLORS.science,
          fillOpacity: 0.9 * opacity,
        },
        eventHandlers: {
          click: (event) => onSelectRef.current?.(target, latLngToMars(event.latlng)),
          // Hundreds of targets would otherwise each become a tab stop between
          // the map and the inspector. The markers stay clickable, and every
          // target is reachable from the keyboard through the inspector list.
          add: (event) => event.target.getElement()?.setAttribute("tabindex", "-1"),
        },
      })),
    [targets, opacity, onSelectRef]
  );

  return items.map(({ target, center, radius, pathOptions, eventHandlers }) => (
    <CircleMarker
      key={target.id}
      center={center}
      radius={radius}
      pathOptions={pathOptions}
      bubblingMouseEvents={false}
      eventHandlers={eventHandlers}
    >
      <Tooltip direction="top" offset={[0, -6]}>
        <strong>{target.name || target.id}</strong>
        {target.science_value != null && (
          <>
            <br />
            Relative ranking {formatFixed(target.science_value, 2)}
          </>
        )}
        {target.source && (
          <>
            <br />
            Source: {target.source}
          </>
        )}
      </Tooltip>
    </CircleMarker>
  ));
});

function ScienceTargetsLayer({ targets = [], enabled = true, opacity = 1, selectedId, onSelect }) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  if (!enabled) return null;

  const selected = selectedId ? targets.find((target) => target.id === selectedId) : null;

  return (
    <>
      <TargetMarkers targets={targets} opacity={opacity} onSelectRef={onSelectRef} />
      {selected && (
        <>
          {/* Selected state: halo plus a high-contrast outline (handoff §4.10) */}
          <CircleMarker
            center={marsToLatLng(selected)}
            radius={radiusFor(selected) + 9}
            interactive={false}
            pathOptions={{ color: MAP_COLORS.science, weight: 2, opacity: 0.9, fillColor: MAP_COLORS.science, fillOpacity: 0.18 }}
          />
          <CircleMarker
            center={marsToLatLng(selected)}
            radius={radiusFor(selected) + 2}
            interactive={false}
            pathOptions={{ color: MAP_COLORS.highlight, weight: 2.5, opacity: 1, fillColor: MAP_COLORS.science, fillOpacity: 1 }}
          />
        </>
      )}
    </>
  );
}

export default ScienceTargetsLayer;
