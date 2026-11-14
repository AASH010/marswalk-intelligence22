/**
 * Map layer registry (handoff §4.3). Order is the order shown in the
 * Layer Manager. `enabled` is the default visibility for a new session.
 *
 * Availability is tracked separately at runtime (see App.jsx): a layer is
 * only drawn, and only shown as enabled, when its data has actually loaded.
 */

export const LAYER_DEFINITIONS = [
  { id: "ctx", label: "CTX Orthomosaic", enabled: true, opacity: 1 },
  { id: "aoi", label: "AOI", enabled: true, opacity: 1 },
  { id: "slope", label: "Slope", enabled: false, opacity: 0.7 },
  { id: "elevation", label: "Elevation", enabled: false, opacity: 0.7 },
  { id: "crism", label: "CRISM D2300", enabled: false, opacity: 0.6 },
  { id: "scienceTargets", label: "Science Targets", enabled: true, opacity: 1 },
];

export const LAYER_IDS = LAYER_DEFINITIONS.map((layer) => layer.id);

export const INITIAL_LAYERS = Object.fromEntries(
  LAYER_DEFINITIONS.map((layer) => [layer.id, { enabled: layer.enabled, opacity: layer.opacity }])
);

/** Runtime availability states. Availability is distinct from visibility. */
export const AVAILABILITY = {
  CHECKING: "checking",
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
};

export const INITIAL_AVAILABILITY = {
  ctx: AVAILABILITY.CHECKING,
  aoi: AVAILABILITY.AVAILABLE, // bundled boundary (data/processed/jezero/map_metadata.json)
  slope: AVAILABILITY.CHECKING,
  elevation: AVAILABILITY.CHECKING,
  crism: AVAILABILITY.CHECKING,
  scienceTargets: AVAILABILITY.CHECKING,
};
