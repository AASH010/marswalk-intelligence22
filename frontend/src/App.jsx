import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import HUD from "./components/HUD/HUD";
import MissionPanel from "./components/MissionPanel/MissionPanel";
import ControlPanel from "./components/ControlPanel/ControlPanel";
import MissionInsights from "./components/MissionInsights/MissionInsights";
import MarsMap from "./components/MarsMap/MarsMap";
import StatusBar from "./components/StatusBar/StatusBar";
import InlineMessage from "./components/ui/InlineMessage";
import ToastRegion from "./components/ui/ToastRegion";
import Button from "./components/ui/Button";
import IconButton from "./components/ui/IconButton";
import PanelResizer from "./components/ui/PanelResizer";
import WeatherDashboard from "./components/Weather/WeatherDashboard";
import TourOverlay from "./components/Tour/TourOverlay";
import { buildTourSteps } from "./components/Tour/tourSteps.jsx";
import { X } from "lucide-react";

// The 3D view pulls in three.js, so it is only loaded when it is opened.
const Terrain3D = lazy(() => import("./components/MarsMap/Terrain3D"));

import { AVAILABILITY, INITIAL_AVAILABILITY, INITIAL_LAYERS, LAYER_IDS } from "./utils/layerConfig";
import { roundCoordinate, validatePointExtent } from "./utils/coordinates";
import { createRouteSnapshot, pointsFingerprint, routeFingerprint } from "./utils/routeInput";
import { ROUTE_STATUS, badgeLabelFor, deriveRouteStatus } from "./utils/routeStatus";
import { analyzeScienceAlongRoute } from "./utils/scienceProximity";
import { buildRasterOverlay } from "./utils/rasterOverlay";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useSessionState } from "./hooks/useSessionState";
import { useToasts } from "./hooks/useToasts";

import { DEFAULT_STRATEGY_ID, ROUTE_STRATEGIES, isSupportedStrategy, planRoute } from "./api/routes";
import { CRISM_OVERLAY_URL, getScienceTargets } from "./api/science";
import { estimateEva } from "./api/mission";
import { getHeightmap } from "./api/terrain";
import { getHealth, probeImage } from "./api/system";
import { MAX_HORIZON_HOURS, getCurrentWeather, getForecast, getWeatherStatus } from "./api/weather";
import { createMissionClock, splitClock } from "./utils/missionClock";
import { selectHourBucket, useClockValue } from "./hooks/useMissionClock";
import { isServiceFailure } from "./api/client";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
import "./styles/weather.css";

const EMPTY_DRAFT = { pointType: "start", x: "", y: "" };
// Payload is the only EVA input the user sets. Distance, slope, grade and
// terrain come from the route the server plans.
const DEFAULT_EVA_INPUTS = { payloadKg: 15 };
const DEFAULT_HORIZON = { start: 0, end: 48 };
const PANEL_MIN = 260;
const PANEL_MAX = 680;
const MAP_MIN = 420;
const TOUR_KEY = "mw.tour.v1.done";

function validHorizon(value) {
  if (!value || typeof value !== "object") return null;
  const { start, end } = value;
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 168 && start < end ? { start, end } : null;
}

function validWidths(value) {
  if (!value || typeof value !== "object") return null;
  const ok = (w) => w === null || (typeof w === "number" && w >= PANEL_MIN && w <= PANEL_MAX);
  return ok(value.left ?? null) && ok(value.right ?? null) ? { left: value.left ?? null, right: value.right ?? null } : null;
}

function tourDone() {
  try {
    return window.localStorage.getItem(TOUR_KEY) === "1";
  } catch {
    return true;
  }
}

function validLayerState(value) {
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(
    LAYER_IDS.map((id) => {
      const entry = value[id];
      const enabled = typeof entry?.enabled === "boolean" ? entry.enabled : INITIAL_LAYERS[id].enabled;
      const opacity = typeof entry?.opacity === "number" && entry.opacity >= 0 && entry.opacity <= 1 ? entry.opacity : INITIAL_LAYERS[id].opacity;
      return [id, { enabled, opacity }];
    })
  );
}

function App() {
  /* ---------------------------------------------------------------- application */
  const [serviceStatus, setServiceStatus] = useState("checking");
  const [mapReady, setMapReady] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  /* ---------------------------------------------------------------- presentation */
  const isCompact = useMediaQuery("(max-width: 1100px)");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [viewMode, setViewMode] = useState("2d");
  const [legendOpen, setLegendOpen] = useSessionState("mw.legend", true, (value) => (typeof value === "boolean" ? value : null));
  const [focusRequest, setFocusRequest] = useState(null);

  // On narrow viewports the panels become drawers and start closed so the map
  // stays usable; they reopen when there is room for the three-column layout.
  const wasCompact = useRef(isCompact);
  useEffect(() => {
    if (isCompact !== wasCompact.current) {
      wasCompact.current = isCompact;
      setLeftOpen(!isCompact);
      setRightOpen(!isCompact);
    }
  }, [isCompact]);

  /* ---------------------------------------------------------------- layers */
  const [layers, setLayers] = useSessionState("mw.layers", INITIAL_LAYERS, validLayerState);
  const [availability, setAvailability] = useState(INITIAL_AVAILABILITY);
  const [rasters, setRasters] = useState({ slope: null, elevation: null });
  const [layerError, setLayerError] = useState(null);

  /* ---------------------------------------------------------------- committed inputs */
  const [startPoint, setStartPoint] = useState(null);
  const [goalPoint, setGoalPoint] = useState(null);
  const [strategyId, setStrategyId] = useState(DEFAULT_STRATEGY_ID);
  const [activeTool, setActiveTool] = useState("set-start");

  /* ---------------------------------------------------------------- draft input */
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  /* ---------------------------------------------------------------- request + result */
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [routeResult, setRouteResult] = useState(null);
  const [routeError, setRouteError] = useState(null);
  const requestCounter = useRef(0);
  const activeRequest = useRef({ id: 0, controller: null });

  /* ---------------------------------------------------------------- comparison */
  const [comparison, setComparison] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const comparisonRequest = useRef(0);

  /* ---------------------------------------------------------------- science */
  const [scienceTargets, setScienceTargets] = useState([]);
  const [scienceLoading, setScienceLoading] = useState(true);
  const [scienceError, setScienceError] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [scienceReload, setScienceReload] = useState(0);

  /* ---------------------------------------------------------------- EVA */
  const [eva, setEva] = useState(null);
  const [evaLoading, setEvaLoading] = useState(false);
  const [evaError, setEvaError] = useState(null);
  const [evaInputs, setEvaInputs] = useState(DEFAULT_EVA_INPUTS);

  /* ---------------------------------------------------------------- weather */
  const [weatherStatus, setWeatherStatus] = useState(null);
  const [current, setCurrent] = useState({ data: null, loading: true, error: null });
  const [forecastState, setForecastState] = useState({ forecast: null, loading: true, error: null });
  const [horizon, setHorizon] = useSessionState("mw.weather.horizon", DEFAULT_HORIZON, validHorizon);
  const [limits, setLimits] = useState(null);
  const [nowForecast, setNowForecast] = useState({ hour: null, loading: true });

  // The mission clock is the "now" of the weather panels. It ticks outside React
  // state: the app only re-renders when the simulated hour changes.
  const clock = useMemo(() => createMissionClock(), []);
  useEffect(() => {
    clock.resume();
    return () => clock.suspend();
  }, [clock]);
  const hourBucket = useClockValue(clock, selectHourBucket);
  const [weatherReload, setWeatherReload] = useState(0);
  const [dashboardOpen, setDashboardOpen] = useState(false);

  /* ---------------------------------------------------------------- panel widths and tour */
  const [panelWidths, setPanelWidths] = useSessionState("mw.panels", { left: null, right: null }, validWidths);
  const [resizing, setResizing] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [tourOpen, setTourOpen] = useState(false);

  const setLayerAvailability = useCallback((id, status) => {
    setAvailability((current) => (current[id] === status ? current : { ...current, [id]: status }));
  }, []);

  /* ================================================================ initialisation */

  // Backend reachability. Readiness is reported from the real health endpoint.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    // A free-tier host can take up to a minute to wake from idle, so retry
    // with a longer timeout before declaring the service offline, and keep
    // polling slowly afterwards so the banner clears on its own.
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    (async () => {
      for (let attempt = 0; active; attempt += 1) {
        try {
          const healthy = await getHealth({ signal: controller.signal, timeoutMs: 20000 });
          if (!active) return;
          if (healthy) {
            setServiceStatus("online");
            return;
          }
        } catch (error) {
          if (!active || error.kind === "aborted") return;
          console.error("[system] health check failed:", error);
        }
        if (attempt >= 3) setServiceStatus("offline");
        await wait(attempt < 3 ? 2000 : 10000);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  // Science targets.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setScienceLoading(true);
    setScienceError(null);
    setLayerAvailability("scienceTargets", AVAILABILITY.CHECKING);

    getScienceTargets({ signal: controller.signal })
      .then((targets) => {
        if (!active) return;
        setScienceTargets(targets);
        setLayerAvailability("scienceTargets", AVAILABILITY.AVAILABLE);
      })
      .catch((error) => {
        if (!active || error.kind === "aborted") return;
        console.error("[science] targets unavailable:", error);
        setScienceTargets([]);
        setScienceError(error.message);
        setLayerAvailability("scienceTargets", AVAILABILITY.UNAVAILABLE);
      })
      .finally(() => {
        if (active) setScienceLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [scienceReload, setLayerAvailability]);

  // Terrain heightmap: decides Slope and Elevation availability and builds
  // both overlays from the values the service returned.
  useEffect(() => {
    let active = true;
    getHeightmap()
      .then((heightmap) => {
        if (!active) return;
        const slope = buildRasterOverlay(heightmap, "slope");
        const elevation = buildRasterOverlay(heightmap, "elevation");
        setRasters({ slope, elevation });
        setLayerAvailability("slope", slope ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE);
        setLayerAvailability("elevation", elevation ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE);
      })
      .catch((error) => {
        if (!active) return;
        console.error("[terrain] heightmap unavailable:", error);
        setLayerAvailability("slope", AVAILABILITY.UNAVAILABLE);
        setLayerAvailability("elevation", AVAILABILITY.UNAVAILABLE);
        setLayerError("Terrain rasters are unavailable, so Slope and Elevation cannot be displayed.");
      });
    return () => {
      active = false;
    };
  }, [setLayerAvailability]);

  // CRISM overlay image.
  useEffect(() => {
    let active = true;
    probeImage(CRISM_OVERLAY_URL).then((ok) => {
      if (active) setLayerAvailability("crism", ok ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE);
    });
    return () => {
      active = false;
    };
  }, [setLayerAvailability]);

  // Weather model status (issue-sol range and default planning limits).
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    getWeatherStatus({ signal: controller.signal })
      .then((status) => {
        if (!active) return;
        setWeatherStatus(status);
        if (status.available && status.default_limits) {
          setLimits((currentLimits) => currentLimits ?? { ...status.default_limits });
        } else if (!status.available) {
          const message = status.message || "The weather model is not available.";
          setCurrent({ data: null, loading: false, error: message });
          setForecastState({ forecast: null, loading: false, error: message });
        }
      })
      .catch((error) => {
        if (!active || error.kind === "aborted") return;
        const message = isServiceFailure(error) ? "The weather service could not be reached." : error.message;
        setCurrent({ data: null, loading: false, error: message });
        setForecastState({ forecast: null, loading: false, error: message });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [weatherReload]);

  /* Mission clock -> what "now" means for the weather.
     The forecast is issued at the end of the sol before the clock's sol, but never
     later than the last measured sol: after that the clock runs on estimates. */
  const latestSol = weatherStatus?.latest_issue_sol ?? null;
  const firstClockSol = weatherStatus?.available ? weatherStatus.first_issue_sol + 1 : null;
  useEffect(() => {
    if (latestSol != null) clock.init(latestSol);
  }, [clock, latestSol]);
  const clockReady = hourBucket != null && latestSol != null;
  const { sol: clockSol, hourInt: clockHour } = clockReady ? splitClock(hourBucket) : { sol: null, hourInt: null };
  const issueSol = clockReady ? Math.min(latestSol, clockSol - 1) : null;
  const issueSolParam = issueSol != null && issueSol < latestSol ? issueSol : null; // null = latest
  const nowOffset = clockReady ? (clockSol - issueSol - 1) * 24 + clockHour : null; // hours since 00:00 of the first forecast sol
  const measured = clockReady && clockSol <= latestSol;
  const beyondReach = clockReady && nowOffset >= MAX_HORIZON_HOURS;

  // Measured conditions at the clock time (up to the clock hour, nothing later), or the last measured sol once the clock is past the data.
  useEffect(() => {
    if (!weatherStatus?.available || !clockReady) return undefined;
    let active = true;
    const controller = new AbortController();
    setCurrent((state) => ({ ...state, loading: true, error: null }));
    getCurrentWeather(measured ? clockSol : latestSol, { hour: measured ? clockHour : null, signal: controller.signal })
      .then((data) => active && setCurrent({ data, loading: false, error: null }))
      .catch((error) => {
        if (!active || error.kind === "aborted") return;
        setCurrent({ data: null, loading: false, error: error.message });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [weatherStatus, clockReady, measured, clockSol, clockHour, latestSol]);

  // The forecast for the clock hour itself: model estimate and EVA status "now".
  useEffect(() => {
    if (!weatherStatus?.available || !limits || !clockReady) return undefined;
    if (beyondReach) {
      setNowForecast({ hour: null, loading: false });
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    setNowForecast((state) => ({ ...state, loading: true }));
    getForecast({ issueSol: issueSolParam, startHour: nowOffset, endHour: nowOffset + 1, limits }, { signal: controller.signal })
      .then((forecast) => active && setNowForecast({ hour: forecast.hours[0] ?? null, loading: false }))
      .catch((error) => {
        if (!active || error.kind === "aborted") return;
        setNowForecast({ hour: null, loading: false });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [weatherStatus, limits, clockReady, beyondReach, issueSolParam, nowOffset, weatherReload]);

  const currentFingerprint = useMemo(
    () => routeFingerprint({ start: startPoint, goal: goalPoint, strategyId }),
    [startPoint, goalPoint, strategyId]
  );

  const routeStatus = deriveRouteStatus({
    isSubmitting,
    result: routeResult,
    error: routeError,
    currentFingerprint,
    hasStart: Boolean(startPoint),
    hasGoal: Boolean(goalPoint),
  });

  const routeStale = routeStatus === ROUTE_STATUS.OUTDATED;
  const serviceOffline = serviceStatus === "offline";
  const canPlan = Boolean(startPoint && goalPoint) && !isSubmitting && !serviceOffline;

  const proximity = useMemo(
    () => analyzeScienceAlongRoute(routeResult, scienceTargets),
    [routeResult, scienceTargets]
  );

  // The EVA duration estimated for the current route decides which GO windows are long enough.
  const routeHours =
    routeStatus === ROUTE_STATUS.CALCULATED &&
    Number.isFinite(eva?.totals?.duration_hours?.value) &&
    eva.totals.duration_hours.value > 0
      ? eva.totals.duration_hours.value
      : null;
  const weatherRoute = useMemo(() => {
    if (!routeResult) return { state: "none", hours: null };
    if (routeStatus === ROUTE_STATUS.OUTDATED) return { state: "stale", hours: null };
    if (evaLoading) return { state: "pending", hours: null };
    if (routeHours == null) return { state: "none", hours: null };
    return { state: "current", hours: routeHours };
  }, [routeResult, routeStatus, evaLoading, routeHours]);

  // Forecast for the chosen range (counted from now), limits and route duration.
  useEffect(() => {
    if (!weatherStatus?.available || !limits || !clockReady) return undefined;
    const startHour = nowOffset + horizon.start;
    const endHour = Math.min(MAX_HORIZON_HOURS, nowOffset + horizon.end);
    if (startHour >= MAX_HORIZON_HOURS || endHour <= startHour) {
      setForecastState({
        forecast: null,
        loading: false,
        error: `The model forecasts up to 7 sols after Sol ${issueSol}. The clock is past that: add newer MEDA data to look further.`,
      });
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    setForecastState((state) => ({ ...state, loading: true, error: null }));
    const timer = setTimeout(() => {
      getForecast({ issueSol: issueSolParam, startHour, endHour, routeHours, limits }, { signal: controller.signal })
        .then((forecast) => active && setForecastState({ forecast, loading: false, error: null }))
        .catch((error) => {
          if (!active || error.kind === "aborted") return;
          console.error("[weather] forecast unavailable:", error);
          setForecastState({ forecast: null, loading: false, error: isServiceFailure(error) ? "The weather service could not be reached." : error.message });
        });
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [weatherStatus, clockReady, issueSol, issueSolParam, nowOffset, horizon, routeHours, limits, weatherReload]);

  /* ================================================================ actions */

  const commitPoint = useCallback(
    (type, point, { announce = true } = {}) => {
      if (type === "start") setStartPoint(point);
      else setGoalPoint(point);
      setFocusRequest({ type: "point", point, key: Date.now() });
      if (announce) push("success", `${type === "start" ? "Start Point" : "Goal Point"} updated.`);
    },
    [push]
  );

  // Map click: resolve, validate, then commit. An invalid location leaves the
  // previous point untouched.
  const handleMapClick = useCallback(
    (point) => {
      if (activeTool === "explore") return;
      const type = activeTool === "set-start" ? "start" : "goal";
      const rounded = { x: roundCoordinate(point.x), y: roundCoordinate(point.y) };

      if (!validatePointExtent(rounded).ok) {
        push("warning", `That location is outside the supported map extent. The ${type === "start" ? "Start Point" : "Goal Point"} is unchanged.`);
        return;
      }

      commitPoint(type, rounded, { announce: false });
      // Move on to the goal once a start exists, then return to exploring.
      if (type === "start" && !goalPoint) setActiveTool("set-goal");
      else setActiveTool("explore");
    },
    [activeTool, commitPoint, goalPoint, push]
  );

  const handleApplyCoordinates = useCallback(
    (type, point) => {
      commitPoint(type, point, { announce: false });
      setActiveTool("explore");
    },
    [commitPoint]
  );

  const handlePlan = useCallback(async () => {
    if (!startPoint || !goalPoint || isSubmitting) return;

    const snapshot = createRouteSnapshot({ start: startPoint, goal: goalPoint, strategyId });
    const fingerprint = routeFingerprint(snapshot);
    const requestId = ++requestCounter.current;
    const controller = new AbortController();

    activeRequest.current = { id: requestId, controller };
    setIsSubmitting(true);
    setRouteError(null);

    try {
      const result = await planRoute(snapshot, { signal: controller.signal });

      // A response is only applied when it still belongs to the active request.
      if (activeRequest.current.id !== requestId) {
        console.warn(`[route] ignoring response for superseded request ${requestId}.`);
        return;
      }

      setRouteResult({ ...result, snapshot, fingerprint, requestId, completedAt: Date.now() });
      setRouteError(null);
      setFocusRequest({ type: "route", coordinates: result.coordinates, key: requestId });
      push("success", "Route calculation completed.");
    } catch (error) {
      if (activeRequest.current.id !== requestId) return;
      if (error.kind === "aborted") return;

      setRouteError({ kind: error.kind, message: error.message, detail: error.detail, point: error.point, fingerprint });
      push("critical", error.kind === "no_route" ? "No valid route was returned for the selected inputs." : "Route calculation failed.");
    } finally {
      if (activeRequest.current.id === requestId) {
        activeRequest.current = { id: requestId, controller: null };
        setIsSubmitting(false);
      }
    }
  }, [goalPoint, isSubmitting, push, startPoint, strategyId]);

  const handleCancel = useCallback(() => {
    activeRequest.current.controller?.abort();
    activeRequest.current = { id: activeRequest.current.id, controller: null };
    setIsSubmitting(false);
    push("info", "Route calculation cancelled. Your selected points are unchanged.");
  }, [push]);

  const handleCompare = useCallback(async () => {
    if (!startPoint || !goalPoint) return;

    const fingerprint = pointsFingerprint({ start: startPoint, goal: goalPoint });
    const run = ++comparisonRequest.current;
    setComparisonLoading(true);

    const settled = await Promise.all(
      ROUTE_STRATEGIES.map(async (strategy) => {
        const snapshot = createRouteSnapshot({ start: startPoint, goal: goalPoint, strategyId: strategy.id });
        try {
          const result = await planRoute(snapshot);
          return [strategy.id, { status: "ok", result }];
        } catch (error) {
          const message =
            error.kind === "no_route" ? "No valid route returned." : error.kind === "unavailable" ? "Service unavailable." : error.message;
          return [strategy.id, { status: "error", message }];
        }
      })
    );

    if (comparisonRequest.current !== run) return;
    setComparison({ fingerprint, entries: Object.fromEntries(settled), stale: false });
    setComparisonLoading(false);
  }, [goalPoint, startPoint]);

  // The comparison belongs to one Start / Goal pair; it is marked stale when
  // either point changes rather than being silently relabelled as current.
  useEffect(() => {
    setComparison((current) => {
      if (!current) return current;
      const stale = current.fingerprint !== pointsFingerprint({ start: startPoint, goal: goalPoint });
      return current.stale === stale ? current : { ...current, stale };
    });
  }, [startPoint, goalPoint]);

  // EVA estimate for the current result. The server re-plans the same route
  // (same start, goal, strategy and default weather time as /navigate) and
  // computes every segment itself; only the payload comes from the user.
  // Re-run when the result or the payload changes.
  useEffect(() => {
    const snapshot = routeResult?.snapshot;
    if (!snapshot?.start || !snapshot?.goal) {
      setEva(null);
      setEvaError(null);
      return undefined;
    }

    let active = true;
    const controller = new AbortController();
    setEvaLoading(true);
    setEvaError(null);

    estimateEva(
      {
        start: [snapshot.start.x, snapshot.start.y],
        goal: [snapshot.goal.x, snapshot.goal.y],
        mode: snapshot.strategyId,
        payloadKg: evaInputs.payloadKg,
      },
      { signal: controller.signal }
    )
      .then((result) => {
        if (active) setEva(result);
      })
      .catch((error) => {
        if (!active || error.kind === "aborted") return;
        console.error("[mission] EVA estimate unavailable:", error);
        setEva(null);
        setEvaError(isServiceFailure(error) ? "The EVA estimate service could not be reached." : error.message);
      })
      .finally(() => {
        if (active) setEvaLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [routeResult, evaInputs]);

  const handleSelectTarget = useCallback((target) => {
    setSelectedTarget(target);
    setFocusRequest({ type: "target", point: target, key: `${target.id}-${Date.now()}` });
  }, []);

  const handleToggleLayer = useCallback(
    (id, enabled) => setLayers((current) => ({ ...current, [id]: { ...current[id], enabled } })),
    [setLayers]
  );

  const handleOpacityChange = useCallback(
    (id, opacity) => setLayers((current) => ({ ...current, [id]: { ...current[id], opacity } })),
    [setLayers]
  );

  const handleFitAoi = useCallback(() => setFocusRequest({ type: "aoi", key: Date.now() }), []);

  const handleLocate = useCallback((point) => {
    if (point) setFocusRequest({ type: "point", point, key: Date.now() });
  }, []);

  // Clearing the configuration removes the points and the result together, so
  // no result can outlive the inputs that produced it.
  const handleClearConfiguration = useCallback(() => {
    activeRequest.current.controller?.abort();
    activeRequest.current = { id: activeRequest.current.id, controller: null };
    setIsSubmitting(false);
    setStartPoint(null);
    setGoalPoint(null);
    setRouteResult(null);
    setRouteError(null);
    setComparison(null);
    setEva(null);
    setEvaError(null);
    setDraft(EMPTY_DRAFT);
    setActiveTool("set-start");
    setFocusRequest({ type: "aoi", key: Date.now() });
    push("info", "Route configuration cleared.");
  }, [push]);

  const handleHorizonChange = useCallback(
    (next) => setHorizon((currentHorizon) => (currentHorizon.start === next.start && currentHorizon.end === next.end ? currentHorizon : { start: next.start, end: next.end })),
    [setHorizon]
  );

  const clampWidth = useCallback(
    (side, value) => {
      const other = side === "left" ? (rightOpen ? document.getElementById("mw-panel-right")?.getBoundingClientRect().width ?? 344 : 0) : leftOpen ? document.getElementById("mw-panel-left")?.getBoundingClientRect().width ?? 320 : 0;
      const max = Math.max(PANEL_MIN, Math.min(PANEL_MAX, window.innerWidth - other - MAP_MIN));
      return Math.round(Math.min(max, Math.max(PANEL_MIN, value)));
    },
    [leftOpen, rightOpen]
  );

  const resizePanel = useCallback(
    (side, value) => setPanelWidths((widths) => ({ ...widths, [side]: clampWidth(side, value) })),
    [clampWidth, setPanelWidths]
  );

  const closeTour = useCallback((completed) => {
    setTourOpen(false);
    setDashboardOpen(false);
    try {
      window.localStorage.setItem(TOUR_KEY, "1");
    } catch {
      /* storage unavailable: the tour simply shows again next time */
    }
    if (completed) push("success", "Tour complete. Reopen it any time from the help button in the header.");
  }, [push]);

  const tourSteps = useMemo(
    () =>
      buildTourSteps({
        openLeft: () => setLeftOpen(true),
        openRight: () => setRightOpen(true),
        show2d: () => setViewMode("2d"),
        openDashboard: () => setDashboardOpen(true),
        closeDashboard: () => setDashboardOpen(false),
      }),
    []
  );

  // First visit: offer the tour once the map is ready.
  useEffect(() => {
    if (!mapReady || tourDone()) return undefined;
    const timer = setTimeout(() => setTourOpen(true), 900);
    return () => clearTimeout(timer);
  }, [mapReady]);

  const closeDrawers = useCallback(() => {
    setLeftOpen(false);
    setRightOpen(false);
  }, []);

  /* ================================================================ render */

  const shellClasses = [
    "mw-shell",
    isCompact ? "mw-shell--compact" : "",
    leftOpen ? "is-left-open" : "",
    rightOpen ? "is-right-open" : "",
    resizing ? "is-resizing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Stored widths never squeeze the map below its minimum on a smaller window.
  const fitWidth = (width, otherWidth) => (width ? Math.max(PANEL_MIN, Math.min(width, viewportWidth - otherWidth - MAP_MIN)) : null);
  const leftWidth = leftOpen ? fitWidth(panelWidths.left, rightOpen ? panelWidths.right ?? 344 : 0) : null;
  const rightWidth = rightOpen ? fitWidth(panelWidths.right, leftOpen ? leftWidth ?? 320 : 0) : null;
  const shellStyle = {
    ...(leftWidth ? { "--mw-left-width": `${leftWidth}px` } : {}),
    ...(rightWidth ? { "--mw-right-width": `${rightWidth}px` } : {}),
  };

  return (
    <div className={shellClasses} style={shellStyle}>
      <a className="mw-skip-link" href="#mw-map-stage">
        Skip to map
      </a>

      <HUD
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        serviceStatus={serviceStatus}
        routeStatus={routeStatus}
        routeBadgeLabel={badgeLabelFor(routeStatus, routeError)}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen((value) => !value)}
        onToggleRight={() => setRightOpen((value) => !value)}
        onOpenWeather={() => setDashboardOpen(true)}
        onOpenTour={() => setTourOpen(true)}
        weatherBadge={forecastState.forecast}
      />

      <div className="mw-workspace">
        <aside
          id="mw-panel-left"
          className="mw-panel mw-panel--left mw-scroll"
          aria-label="Route configuration and map layers"
          aria-hidden={isCompact && !leftOpen ? true : undefined}
          inert={isCompact && !leftOpen ? true : undefined}
        >
          {isCompact && (
            <div className="mw-panel__bar">
              <span className="mw-panel__bar-title">Configuration</span>
              <IconButton size="sm" label="Close configuration panel" onClick={() => setLeftOpen(false)}>
                <X size={16} aria-hidden="true" />
              </IconButton>
            </div>
          )}

          {serviceOffline && (
            <div className="mw-panel__alert">
              <InlineMessage tone="critical" title="The route service is not reachable.">
                Route planning and science data are unavailable until the service responds. Your inputs are preserved.
                <div className="mw-message__action">
                  <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                    Reload
                  </Button>
                </div>
              </InlineMessage>
            </div>
          )}

          <MissionPanel
            start={startPoint}
            goal={goalPoint}
            activeTool={activeTool}
            onActivateTool={setActiveTool}
            onLocate={handleLocate}
            strategyId={strategyId}
            onStrategyChange={(id) => isSupportedStrategy(id) && setStrategyId(id)}
            draft={draft}
            onDraftChange={setDraft}
            onApplyCoordinates={handleApplyCoordinates}
            routeStatus={routeStatus}
            routeError={routeError}
            canPlan={canPlan}
            isSubmitting={isSubmitting}
            serviceOffline={serviceOffline}
            onPlan={handlePlan}
            onCancel={handleCancel}
            onClearConfiguration={handleClearConfiguration}
          />

          <ControlPanel
            layers={layers}
            availability={availability}
            rasters={rasters}
            scienceCount={scienceTargets.length}
            onToggleLayer={handleToggleLayer}
            onOpacityChange={handleOpacityChange}
            layerError={layerError}
          />
        </aside>

        <main id="mw-map-stage" className="mw-map-stage" aria-label="Mars terrain map" data-tour="map">
          {viewMode === "3d" ? (
            <Suspense fallback={<div className="mw-map-loading" role="status">Loading 3D terrain view…</div>}>
              <Terrain3D
                start={startPoint}
                goal={goalPoint}
                route={routeResult}
                routeStale={routeStale}
                scienceTargets={layers.scienceTargets?.enabled ? scienceTargets : []}
                selectedTargetId={selectedTarget?.id}
                onScienceSelect={handleSelectTarget}
              />
            </Suspense>
          ) : (
            <MarsMap
              layers={layers}
              availability={availability}
              onLayerStatus={setLayerAvailability}
              rasters={rasters}
              ctxTint={!layers.ctx?.enabled || availability.ctx === AVAILABILITY.UNAVAILABLE}
              start={startPoint}
              goal={goalPoint}
              activeTool={activeTool}
              onMapClick={handleMapClick}
              route={routeResult}
              routeStale={routeStale}
              onRouteSelect={() => setSelectedTarget(null)}
              scienceTargets={scienceTargets}
              selectedTargetId={selectedTarget?.id}
              onScienceSelect={handleSelectTarget}
              focusRequest={focusRequest}
              legendOpen={legendOpen}
              onLegendToggle={() => setLegendOpen((value) => !value)}
              onReady={() => setMapReady(true)}
            />
          )}

          {viewMode === "2d" && activeTool !== "explore" && (
            <div className="mw-map-hint" role="status">
              <span className={`mw-point__marker mw-point__marker--${activeTool === "set-start" ? "start" : "goal"}`} aria-hidden="true">
                {activeTool === "set-start" ? "S" : "G"}
              </span>
              <span>Click the map to set the {activeTool === "set-start" ? "Start Point" : "Goal Point"}</span>
              <Button variant="tertiary" size="sm" onClick={() => setActiveTool("explore")}>
                Cancel
              </Button>
            </div>
          )}

          {viewMode === "2d" && !mapReady && (
            <div className="mw-map-loading" role="status">
              Initializing Mars terrain map…
            </div>
          )}

          <ToastRegion toasts={toasts} onDismiss={dismiss} />
        </main>

        <aside
          id="mw-panel-right"
          className="mw-panel mw-panel--right mw-scroll"
          aria-label="Mission Inspector"
          data-tour="inspector"
          aria-hidden={isCompact && !rightOpen ? true : undefined}
          inert={isCompact && !rightOpen ? true : undefined}
        >
          {isCompact && (
            <div className="mw-panel__bar">
              <span className="mw-panel__bar-title">Mission Inspector</span>
              <IconButton size="sm" label="Close Mission Inspector" onClick={() => setRightOpen(false)}>
                <X size={16} aria-hidden="true" />
              </IconButton>
            </div>
          )}

          <MissionInsights
            routeStatus={routeStatus}
            routeResult={routeResult}
            routeError={routeError}
            isSubmitting={isSubmitting}
            strategyId={strategyId}
            comparison={comparison}
            comparisonLoading={comparisonLoading}
            canCompare={Boolean(startPoint && goalPoint) && !comparisonLoading && !serviceOffline}
            onCompare={handleCompare}
            onSelectStrategy={setStrategyId}
            scienceTargets={scienceTargets}
            scienceLoading={scienceLoading}
            scienceError={scienceError}
            onRetryScience={() => setScienceReload((value) => value + 1)}
            proximity={proximity}
            selectedTarget={selectedTarget}
            onSelectTarget={handleSelectTarget}
            onFitAoi={handleFitAoi}
            eva={eva}
            evaLoading={evaLoading}
            evaError={evaError}
            evaInputs={evaInputs}
            onEvaInputsChange={setEvaInputs}
            weather={{
              current: current.data,
              currentLoading: current.loading,
              currentError: current.error,
              forecast: forecastState.forecast,
              forecastLoading: forecastState.loading,
              forecastError: forecastState.error,
              horizon,
              onHorizonChange: handleHorizonChange,
              issueSol: forecastState.forecast?.issue_sol ?? issueSol,
              replay: issueSolParam != null,
              clock,
              latestSol,
              firstClockSol,
              clockSol,
              measured,
              nowHour: nowForecast.hour,
              nowLoading: nowForecast.loading,
              onGoLive: () => latestSol != null && clock.goLive(latestSol),
              route: weatherRoute,
              onRetry: () => setWeatherReload((value) => value + 1),
              onOpenDashboard: () => setDashboardOpen(true),
              onFitHorizon: () => setHorizon({ start: 0, end: 168 }),
            }}
          />
        </aside>

        {!isCompact && leftOpen && (
          <PanelResizer
            side="left"
            width={leftWidth}
            min={PANEL_MIN}
            max={PANEL_MAX}
            label="Resize the route configuration panel"
            onResize={(value) => resizePanel("left", value)}
            onResizeStart={() => setResizing(true)}
            onResizeEnd={() => setResizing(false)}
            onReset={() => setPanelWidths((widths) => ({ ...widths, left: null }))}
          />
        )}
        {!isCompact && rightOpen && (
          <PanelResizer
            side="right"
            width={rightWidth}
            min={PANEL_MIN}
            max={PANEL_MAX}
            label="Resize the Mission Inspector"
            onResize={(value) => resizePanel("right", value)}
            onResizeStart={() => setResizing(true)}
            onResizeEnd={() => setResizing(false)}
            onReset={() => setPanelWidths((widths) => ({ ...widths, right: null }))}
          />
        )}

        {isCompact && (leftOpen || rightOpen) && <div className="mw-scrim" onClick={closeDrawers} aria-hidden="true" />}
      </div>

      <StatusBar
        routeStatus={routeStatus}
        routeResult={routeResult}
        scienceCount={scienceTargets.length}
        viewMode={viewMode}
        departure={forecastState.forecast?.recommended_departure ?? null}
        nextWindow={forecastState.forecast?.windows?.[0] ?? null}
        weatherNow={current.data}
        weatherEstimate={nowForecast.hour}
        clock={clock}
        latestSol={latestSol}
      />

      <WeatherDashboard
        open={dashboardOpen}
        onClose={() => setDashboardOpen(false)}
        status={weatherStatus}
        forecastState={forecastState}
        horizon={horizon}
        onHorizonChange={handleHorizonChange}
        issueSol={issueSolParam}
        onIssueSolChange={(next) => (next == null ? latestSol != null && clock.goLive(latestSol) : clock.startAt(next + 1))}
        limits={limits ?? weatherStatus?.default_limits ?? {}}
        onLimitsChange={(next) => setLimits((currentLimits) => ({ ...currentLimits, ...next }))}
        routeHours={routeHours}
      />

      <TourOverlay open={tourOpen} steps={tourSteps} onClose={closeTour} />
    </div>
  );
}

export default App;
