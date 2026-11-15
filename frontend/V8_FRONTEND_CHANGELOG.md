# MarsWalk Intelligence — V8 Frontend

V8 rebuilds the frontend on the design system, component library and UX flows
defined in *MarsWalk Intelligence — Design System, Component Library, UX Flows
& Development Handoff v1.0*.

Frontend only. The backend, data pipeline, A*, CRISM alignment, consumables
model, Mars CRS and tile scheme are unchanged, and every endpoint is consumed
exactly as the running OpenAPI contract defines it.

## Design system (handoff §02)

- `src/styles/tokens.css` is the single source of design values: the 18 colour
  tokens, the Inter / IBM Plex Mono type scale, the 4-point spacing scale,
  radius, border, elevation, focus-ring and layout tokens. Components reference
  the semantic names; no raw hex values are repeated in components.
- Inter and IBM Plex Mono are self-hosted (`@fontsource/*`) instead of being
  fetched from a third-party CDN at runtime.
- One icon family throughout (`lucide-react`), consistent stroke weight.
- Muted Text is reserved for decorative icons and disabled controls: at the
  sizes used here it does not reach 4.5:1 on the panel surfaces, so all
  informational text uses Secondary Text or above.

## Layout (handoff §03)

- Three-column shell: Route Configuration, the dominant central map, and the
  Mission Inspector. Both sidebars collapse independently and keep their
  content mounted, so scroll position and draft values survive a collapse.
- Panel transitions resize the map container; Leaflet is re-measured through a
  `ResizeObserver`, and pointer-to-coordinate conversion was verified to be
  identical before, during and after a collapse.
- Explicit pane order: base imagery, terrain and science rasters, AOI, route,
  science targets, Start/Goal markers, then map controls, panels and toasts.
- Below 1100 px the sidebars become overlay drawers; below 640 px they are
  full-width sheets and the inspector reflows to one column.

## Component library (handoff §04, Appendix A)

`src/components/ui/`: Button (primary, secondary, tertiary, destructive, icon,
loading, disabled), Status Badge, Switch, Accordion, Metric card, Inline
Message, Empty State, Skeleton, Provenance Row, Text/Select fields, Tooltip,
Toast region and a confirmation Dialog. Each one carries its default, hover,
pressed, focus, loading, disabled and error treatments.

## Data integrity

- No mock or placeholder data anywhere. The science mock fallback was removed:
  when the science service is unavailable the interface says so.
- Route responses are validated before anything is rendered — geometry type,
  finite coordinates, coordinates inside the map extent. A malformed response
  is rejected, logged and reported as unavailable rather than drawn.
- Metrics are printed only when the response contains them; anything missing
  reads "Not provided". Nothing is estimated in the frontend.
- Every result is tied to the fingerprint of the inputs that produced it.
  Changing Start, Goal or strategy marks the result Outdated: the route is
  redrawn dashed in Warning Yellow, metrics are struck through, and the EVA and
  science-proximity sections say which route they describe.
- Requests carry a request id; a response from a superseded request is ignored,
  so a late response can never overwrite a newer result. Duplicate submissions
  are blocked while a request is in flight, and a request can be cancelled.
- Layer availability is tracked separately from visibility and is reported from
  what actually loaded (CTX tile events, the heightmap payload, the CRISM
  overlay image, the science response). A layer that is not available cannot be
  switched on and is labelled Unavailable.

## Map and data work

- Slope and Elevation now render as real 2D overlays, built from the values of
  `GET /api/v1/terrain/heightmap` with the units the payload reports and a
  legend that states the display range. They were previously disabled stubs.
- The heightmap is fetched once and shared between the 2D overlays and the 3D
  terrain view, which is now lazy-loaded (three.js is no longer in the initial
  bundle: 475 kB instead of 1.41 MB).
- Map controls: zoom in, zoom out, fit AOI, legend, scale bar, locate
  Start/Goal, plus a live cursor readout in Mars projected metres.
- Science target markers are kept out of the tab order (there can be hundreds);
  every target is reachable from the keyboard through the inspector list.

## Accessibility (handoff §13, §16.4)

Audited with axe-core (WCAG 2.1 A/AA plus best-practice) on the initial state,
a calculated route with a target selected, the confirmation dialog, and the
phone layout: no violations. Status is never carried by colour alone — every
state pairs its colour with an icon and a text label.

## Files

Added: `src/styles/`, `src/hooks/`, `src/components/ui/`,
`src/utils/{mapAdapter,coordinates,routeInput,routeStatus,format,rasterOverlay,scienceProximity,cursorStore}.js`,
`src/api/{client,system,terrain}.js`, `src/components/MarsMap/{MapToolbar,MapLegend,TerrainRasterLayer,mapStyle}.jsx`,
`public/favicon.svg`.

Removed: `src/App.css`, `src/mock/`, `src/components/LayerPanel/`,
`src/components/MissionPanel/{RouteModeSelector,StartGoalSelector}.jsx`,
`src/components/MissionInsights/ScienceOpportunitySummary.jsx`.

`vite.config.mjs` additionally proxies `/health` so the readiness check reaches
the backend through the dev server.

## Open items for the backend (handoff §18.1)

- Route, science and consumables responses carry no dataset version or
  timestamp, so the Provenance section shows those rows as not provided.
- No endpoint exposes layer metadata; layer source identifiers are read from
  `data/manifest.yaml` and `data/processed/jezero/map_metadata.json` and
  mirrored in `src/utils/mapConfig.js`. If those files change, update that file.
