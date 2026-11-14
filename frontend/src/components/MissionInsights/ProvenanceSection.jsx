import ProvenanceRow from "../ui/ProvenanceRow";
import { DATA_SOURCES, MARS_CRS_INFO, MARS_MAP } from "../../utils/mapConfig";

/**
 * Data provenance (handoff §4.11, §7.4).
 *
 * Identifiers come from the project's own data manifest and map metadata.
 * The route, science and consumables responses carry no version or timestamp
 * field, so those rows read "Not provided" rather than showing a guess.
 */
function ProvenanceSection({ result }) {
  return (
    <div className="mw-stack">
      <dl className="mw-provenance">
        <ProvenanceRow label="Base imagery" value={DATA_SOURCES.ctxMosaic.id} detail="CTX orthomosaic, 5 m per pixel" />
        <ProvenanceRow
          label="Terrain"
          value={DATA_SOURCES.ctxDem.id}
          detail={`Processed DEM, ${MARS_MAP.grid.resolution} m, ${MARS_MAP.grid.rows} × ${MARS_MAP.grid.cols} cells`}
        />
        <ProvenanceRow label="Science" value={DATA_SOURCES.crism.id} detail="CRISM browse product, D2300 and BD1900_2" />
        <ProvenanceRow label="CRS" value={MARS_CRS_INFO.id} detail={`${MARS_CRS_INFO.detail} · ${MARS_CRS_INFO.axisOrder}`} />
        <ProvenanceRow
          label="Extent"
          value={`X ${MARS_MAP.bounds.minX}–${MARS_MAP.bounds.maxX}, Y ${MARS_MAP.bounds.minY}–${MARS_MAP.bounds.maxY}`}
          detail={`Units: ${MARS_CRS_INFO.units}`}
        />
        <ProvenanceRow label="Route model" value={result ? "A* terrain search" : null} detail="Terrain and navigation criteria only" />
        <ProvenanceRow label="Dataset version" value={null} detail="Not returned by the current services." />
      </dl>

      <p className="mw-helper">
        Science analysis is evaluated after the route is returned. It does not change the terrain cost or the route search. CRISM
        D2300 is a browse-derived signal, not a quantitative mineral abundance map or a mineral confirmation.
      </p>
    </div>
  );
}

export default ProvenanceSection;
