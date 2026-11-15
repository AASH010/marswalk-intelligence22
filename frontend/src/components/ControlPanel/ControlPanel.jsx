import { Layers } from "lucide-react";

import InlineMessage from "../ui/InlineMessage";
import LayerRow from "./LayerRow";
import RasterRamp from "../ui/RasterRamp";
import { AVAILABILITY, LAYER_DEFINITIONS } from "../../utils/layerConfig";
import { DATA_SOURCES, MARS_MAP } from "../../utils/mapConfig";

/**
 * Layer Manager (handoff §4.3, §5.8).
 *
 * Each layer names its source dataset. Units and ranges are only shown when
 * the data itself supplies them (the terrain heightmap reports its units),
 * and no classification is implied for Slope or Elevation.
 */
const LAYER_META = {
  ctx: { source: DATA_SOURCES.ctxMosaic.id, note: "Base imagery, 5 m per pixel." },
  aoi: {
    source: "jezero_aoi_boundary.geojson",
    note: `Operational sector, ${MARS_MAP.grid.rows} × ${MARS_MAP.grid.cols} cells at ${MARS_MAP.grid.resolution} m.`,
  },
  slope: { source: DATA_SOURCES.ctxDem.id, note: "Derived from the processed DEM by the terrain service." },
  elevation: { source: DATA_SOURCES.ctxDem.id, note: "Processed DEM values as returned by the terrain service." },
  crism: { source: DATA_SOURCES.crism.id, note: "Browse-derived D2300 and BD1900_2 signal, not a mineral abundance map." },
  scienceTargets: { source: DATA_SOURCES.crism.id, note: "Dual-band spectral candidates returned by the science service." },
};

function ControlPanel({ layers, availability, rasters, scienceCount, onToggleLayer, onOpacityChange, layerError }) {
  const unavailable = LAYER_DEFINITIONS.filter((layer) => availability[layer.id] === AVAILABILITY.UNAVAILABLE);

  return (
    <section className="mw-panel-section" aria-labelledby="mw-layer-manager" data-tour="layers">
      <div className="mw-panel-section__head">
        <h2 className="mw-panel-section__title" id="mw-layer-manager">
          <Layers size={15} aria-hidden="true" />
          Map layers
        </h2>
      </div>

      <div className="mw-panel-section__body">
        {layerError && (
          <InlineMessage tone="warning" compact>
            {layerError}
          </InlineMessage>
        )}

        <div className="mw-layers">
          {LAYER_DEFINITIONS.map((layer) => {
            const meta = LAYER_META[layer.id];
            const state = layers[layer.id];
            const available = availability[layer.id] === AVAILABILITY.AVAILABLE;
            const showRamp = available && Boolean(state?.enabled) && (layer.id === "slope" || layer.id === "elevation");

            return (
              <LayerRow
                key={layer.id}
                layer={{
                  ...layer,
                  label: layer.id === "scienceTargets" && scienceCount != null ? `${layer.label} (${scienceCount})` : layer.label,
                }}
                state={state}
                availability={availability[layer.id]}
                onToggle={onToggleLayer}
                onOpacityChange={onOpacityChange}
              >
                <p className="mw-layer__meta">
                  <span className="mw-layer__source mw-mono">{meta.source}</span>
                  <span className="mw-layer__note">{meta.note}</span>
                </p>
                {showRamp && rasters?.[layer.id] && (
                  <div className="mw-layer__ramp">
                    <RasterRamp kind={layer.id} overlay={rasters[layer.id]} />
                    <span className="mw-helper">
                      Display range of the sampled grid ({rasters[layer.id].width} × {rasters[layer.id].height}).
                    </span>
                  </div>
                )}
              </LayerRow>
            );
          })}
        </div>

        {unavailable.length > 0 && (
          <InlineMessage tone="info" compact>
            {unavailable.length === 1 ? `${unavailable[0].label} is` : `${unavailable.length} layers are`} currently unavailable. Other
            map layers remain accessible.
          </InlineMessage>
        )}
      </div>
    </section>
  );
}

export default ControlPanel;
