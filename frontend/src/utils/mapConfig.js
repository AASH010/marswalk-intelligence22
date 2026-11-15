/**
 * Static map configuration.
 *
 * Values mirror the authoritative project files and must stay in sync with them:
 *   - AOI bounds / grid  -> data/processed/jezero/map_metadata.json
 *   - CTX mosaic extent  -> docs/pitch/FRONTEND_BACKEND_GUIDE.md §3
 *   - Source identifiers -> data/manifest.yaml
 */

export const MARS_MAP = {
  bounds: {
    minX: 4350000,
    maxX: 4360000,
    minY: 1090000,
    maxY: 1100000,
  },

  center: {
    x: 4355000,
    y: 1095000,
  },

  grid: {
    rows: 500,
    cols: 500,
    resolution: 20,
  },
};

/**
 * How far past the AOI edge the user can pan, in metres, equal on all four
 * sides. The AOI sits near the western edge of the CTX mosaic, so limiting the
 * view to the whole mosaic left ~21 km on the left and ~58 km on the right.
 * Navigation is limited to a square centred on the AOI instead.
 */
export const NAV_PADDING_M = 15000;

/** Full CTX orthomosaic extent in Mars projected metres. */
export const CTX_EXTENT = {
  minX: 4329192.1081,
  minY: 1042131.6352,
  maxX: 4418058.7893,
  maxY: 1143347.4242,
};

/**
 * Coordinate reference system used by every dataset, by route input and by
 * route output. Axis order is X (easting) then Y (northing), in metres.
 */
export const MARS_CRS_INFO = {
  id: "Mars_2000_Sphere_Equirectangular",
  label: "Mars Equirectangular (Mars 2000 sphere)",
  detail: "Standard parallel 18.4663°, central meridian 0°",
  axisOrder: "X = easting, Y = northing",
  units: "m",
};

/** Source identifiers exactly as listed in data/manifest.yaml. */
export const DATA_SOURCES = {
  ctxMosaic: {
    name: "CTX orthomosaic",
    id: "M20_JezeroCrater_CTXortho_mosaic_5m",
  },
  ctxDem: {
    name: "CTX DEM",
    id: "M20_JezeroCrater_CTXDEM_20m",
  },
  crism: {
    name: "CRISM browse product",
    id: "frt000047a3_07_brcarj_mtr3",
  },
};
