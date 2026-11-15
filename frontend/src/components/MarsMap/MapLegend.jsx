import { X } from "lucide-react";

import RasterRamp from "../ui/RasterRamp";
import { AVAILABILITY } from "../../utils/layerConfig";

function Symbol({ type }) {
  switch (type) {
    case "start":
      return (
        <svg width="18" height="22" viewBox="0 0 28 36" aria-hidden="true">
          <path className="mw-pin__body mw-pin__body--start" d="M14 35C14 35 3.5 22.2 3.5 13.500A10.500 10.500 0 0 1 24.5 13.500C24.5 22.2 14 35 14 35Z" />
        </svg>
      );
    case "goal":
      return (
        <svg width="18" height="22" viewBox="0 0 28 36" aria-hidden="true">
          <path className="mw-pin__body mw-pin__body--goal" d="M14 35 4.2 18.800a2.400 2.400 0 0 1 0-2.600L12 3.300a2.400 2.400 0 0 1 4 0l7.800 12.900a2.400 2.400 0 0 1 0 2.600Z" />
        </svg>
      );
    case "route":
      return <span className="mw-legend__line mw-legend__line--route" aria-hidden="true" />;
    case "route-stale":
      return <span className="mw-legend__line mw-legend__line--stale" aria-hidden="true" />;
    case "science":
      return <span className="mw-legend__dot" aria-hidden="true" />;
    case "aoi":
      return <span className="mw-legend__box" aria-hidden="true" />;
    default:
      return null;
  }
}

function Item({ type, label, detail }) {
  return (
    <li className="mw-legend__item">
      <span className="mw-legend__symbol">
        <Symbol type={type} />
      </span>
      <span className="mw-legend__label">{label}</span>
      {detail && <span className="mw-legend__detail">{detail}</span>}
    </li>
  );
}

/**
 * Map legend (handoff §4.11): explains symbols, colours and — for rasters —
 * the units and display range that came with the data.
 */
function MapLegend({ layers, availability, rasters, hasRoute, routeStale, onClose }) {
  const visible = (id) => Boolean(layers[id]?.enabled) && availability[id] === AVAILABILITY.AVAILABLE;

  return (
    <aside className="mw-legend" aria-label="Map legend">
      <div className="mw-legend__header">
        <h2 className="mw-legend__title">Legend</h2>
        <button type="button" className="mw-legend__close" aria-label="Hide legend" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <ul className="mw-legend__list">
        <Item type="start" label="Start Point" detail="S" />
        <Item type="goal" label="Goal Point" detail="G" />
        {hasRoute && !routeStale && <Item type="route" label="Calculated route" />}
        {hasRoute && routeStale && <Item type="route-stale" label="Outdated route" />}
        {visible("scienceTargets") && <Item type="science" label="Science target" />}
        {visible("aoi") && <Item type="aoi" label="AOI boundary" />}
      </ul>

      {visible("slope") && rasters?.slope && (
        <div className="mw-legend__raster">
          <span className="mw-legend__raster-title">Slope</span>
          <RasterRamp kind="slope" overlay={rasters.slope} />
        </div>
      )}

      {visible("elevation") && rasters?.elevation && (
        <div className="mw-legend__raster">
          <span className="mw-legend__raster-title">Elevation</span>
          <RasterRamp kind="elevation" overlay={rasters.elevation} />
        </div>
      )}

      {visible("crism") && (
        <div className="mw-legend__raster">
          <span className="mw-legend__raster-title">CRISM signal</span>
          <ul className="mw-legend__swatches">
            <li>
              <span className="mw-legend__swatch mw-legend__swatch--d2300" aria-hidden="true" />
              D2300
            </li>
            <li>
              <span className="mw-legend__swatch mw-legend__swatch--bd1900" aria-hidden="true" />
              BD1900_2
            </li>
            <li>
              <span className="mw-legend__swatch mw-legend__swatch--candidate" aria-hidden="true" />
              Dual-band candidate
            </li>
          </ul>
        </div>
      )}
    </aside>
  );
}

export default MapLegend;
