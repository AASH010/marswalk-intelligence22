import { useEffect, useRef, useState } from "react";
import { MapContainer, Pane, ScaleControl, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { MarsCRS } from "../../utils/marsCRS";
import { MARS_MAP } from "../../utils/mapConfig";
import { AVAILABILITY } from "../../utils/layerConfig";
import { CTX_TILE_URL } from "../../api/terrain";
import AOILayer from "./AOILayer";
import StartGoalLayer from "./StartGoalLayer";
import RouteLayer from "./RouteLayer";
import ScienceTargetsLayer from "./ScienceTargetsLayer";
import ScienceRasterLayer from "./ScienceRasterLayer";
import TerrainRasterLayer from "./TerrainRasterLayer";
import MapToolbar from "./MapToolbar";
import MapLegend from "./MapLegend";
import { NAV_BOUNDS, CursorTracker, FocusController, InitialView, MapClickHandler, MapResizeHandler } from "./MapControls";
import { PANES } from "./mapStyle";

/**
 * CTX base imagery. Availability is reported from what Leaflet actually
 * loads: the layer is "available" once a tile arrives and "unavailable" when
 * a full load pass produces errors and no tiles.
 */
function CtxTileLayer({ opacity, onStatus }) {
  const counts = useRef({ loaded: 0, failed: 0 });

  useEffect(() => {
    counts.current = { loaded: 0, failed: 0 };
  }, []);

  return (
    <TileLayer
      url={CTX_TILE_URL}
      tileSize={256}
      minZoom={1}
      maxNativeZoom={7}
      maxZoom={7}
      updateWhenZooming={false}
      attribution="NASA / MarsWalk Intelligence"
      noWrap
      opacity={opacity}
      eventHandlers={{
        tileload: () => {
          counts.current.loaded += 1;
          if (counts.current.loaded === 1) onStatus?.(AVAILABILITY.AVAILABLE);
        },
        tileerror: () => {
          counts.current.failed += 1;
        },
        load: () => {
          if (counts.current.loaded === 0 && counts.current.failed > 0) onStatus?.(AVAILABILITY.UNAVAILABLE);
        },
      }}
    />
  );
}

/**
 * The existing Leaflet map on the custom Mars CRS. This component only
 * renders what it is given: real layers, committed points, the returned
 * route geometry and the science target records.
 */
/** Names the map container, which Leaflet makes focusable for keyboard panning. */
function useMapAccessibleName(map) {
  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();
    container.setAttribute("aria-label", "Interactive Mars terrain map. Arrow keys pan the view; plus and minus zoom.");
  }, [map]);
}

function MarsMap({
  layers,
  availability,
  onLayerStatus,
  rasters,
  ctxTint,
  start,
  goal,
  activeTool,
  onMapClick,
  route,
  routeStale,
  onRouteSelect,
  scienceTargets,
  selectedTargetId,
  onScienceSelect,
  focusRequest,
  legendOpen,
  onLegendToggle,
  onReady,
}) {
  const [map, setMap] = useState(null);
  useMapAccessibleName(map);

  const isVisible = (id) => Boolean(layers[id]?.enabled) && availability[id] === AVAILABILITY.AVAILABLE;
  // CTX is also mounted while its availability is still being checked,
  // because loading tiles is how that availability is determined.
  const ctxMounted = Boolean(layers.ctx?.enabled) && availability.ctx !== AVAILABILITY.UNAVAILABLE;

  const classes = ["mw-map", `mw-map--tool-${activeTool}`, ctxTint ? "mw-map--tint" : ""].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <MapContainer
        ref={setMap}
        crs={MarsCRS}
        center={[MARS_MAP.center.y, MARS_MAP.center.x]}
        zoom={4}
        zoomSnap={0.25}
        minZoom={1}
        maxZoom={7}
        maxBounds={NAV_BOUNDS}
        maxBoundsViscosity={1}
        zoomControl={false}
        className="mw-map__leaflet"
      >
        <InitialView onReady={onReady} />
        <MapResizeHandler />
        <MapClickHandler onMapClick={onMapClick} />
        <CursorTracker />
        <FocusController request={focusRequest} />

        {/* 1. Base imagery */}
        {ctxMounted && <CtxTileLayer opacity={layers.ctx?.opacity ?? 1} onStatus={(status) => onLayerStatus?.("ctx", status)} />}

        {/* 2. Terrain and science rasters */}
        <Pane name={PANES.raster.name} style={{ zIndex: PANES.raster.zIndex }}>
          <TerrainRasterLayer
            overlay={rasters?.elevation}
            enabled={isVisible("elevation")}
            opacity={layers.elevation?.opacity ?? 0.7}
            zIndex={1}
            alt="Elevation overlay"
          />
          <TerrainRasterLayer
            overlay={rasters?.slope}
            enabled={isVisible("slope")}
            opacity={layers.slope?.opacity ?? 0.7}
            zIndex={2}
            alt="Slope overlay"
          />
          <ScienceRasterLayer enabled={isVisible("crism")} opacity={layers.crism?.opacity ?? 0.6} />
        </Pane>

        {/* 3. AOI boundary */}
        <Pane name={PANES.aoi.name} style={{ zIndex: PANES.aoi.zIndex }}>
          {isVisible("aoi") && <AOILayer opacity={layers.aoi?.opacity ?? 1} />}
        </Pane>

        {/* 4. Route geometry */}
        <Pane name={PANES.route.name} style={{ zIndex: PANES.route.zIndex }}>
          <RouteLayer route={route} stale={routeStale} onSelect={onRouteSelect} />
        </Pane>

        {/* 5. Science targets */}
        <Pane name={PANES.science.name} style={{ zIndex: PANES.science.zIndex }}>
          <ScienceTargetsLayer
            targets={scienceTargets}
            enabled={isVisible("scienceTargets")}
            opacity={layers.scienceTargets?.opacity ?? 1}
            selectedId={selectedTargetId}
            onSelect={onScienceSelect}
          />
        </Pane>

        {/* 6. Start / Goal markers (Leaflet marker pane) */}
        <StartGoalLayer start={start} goal={goal} />

        <ScaleControl position="bottomright" imperial={false} maxWidth={110} />
      </MapContainer>

      <MapToolbar map={map} legendOpen={legendOpen} onLegendToggle={onLegendToggle} />

      {legendOpen && (
        <MapLegend
          layers={layers}
          availability={availability}
          rasters={rasters}
          hasRoute={Boolean(route)}
          routeStale={routeStale}
          onClose={onLegendToggle}
        />
      )}
    </div>
  );
}

export default MarsMap;
