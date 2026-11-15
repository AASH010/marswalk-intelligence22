import {
  Box,
  CalendarClock,
  ChartSpline,
  CircleHelp,
  Clock,
  CloudSun,
  Crosshair,
  Gauge,
  GripVertical,
  History,
  Layers,
  MapPinned,
  MousePointerClick,
  PanelRight,
  Play,
  Route,
  SlidersHorizontal,
  Thermometer,
} from "lucide-react";

/**
 * Steps of the guided tour. `target` is a [data-tour] selector; `onEnter`
 * prepares the interface (opens a panel or the dashboard) before the
 * spotlight moves there.
 */
export function buildTourSteps({ openLeft, openRight, show2d, openDashboard, closeDashboard }) {
  const leftPanel = () => {
    closeDashboard();
    show2d();
    openLeft();
  };
  const rightPanel = () => {
    closeDashboard();
    show2d();
    openRight();
  };

  return [
    {
      id: "welcome",
      hero: true,
      kicker: "Welcome",
      title: "Plan a safe Marswalk in Jezero crater",
      body: (
        <>
          <p>
            MarsWalk Intelligence combines two things an astronaut needs before stepping outside: a <strong>terrain-aware route</strong> across the
            crater, and a <strong>weather window</strong> in which it is safe to walk it.
          </p>
          <p>This two-minute tour shows every part of the screen. Use the arrow keys or the buttons; press Esc to leave at any time.</p>
        </>
      ),
      onEnter: () => {
        closeDashboard();
        show2d();
      },
    },
    {
      id: "view",
      target: '[data-tour="view-tabs"]',
      placement: "bottom",
      icon: Box,
      title: "2D map or 3D terrain",
      body: <p>Switch between the flat map, where you plan, and a 3D model of the crater floor built from the elevation data.</p>,
      onEnter: () => {
        closeDashboard();
        show2d();
      },
    },
    {
      id: "strategy",
      target: '[data-tour="strategy"]',
      placement: "right",
      icon: Route,
      title: "Choose a route strategy",
      body: (
        <p>
          <strong>Fastest</strong> cares mostly about distance, <strong>Conservative</strong> avoids steep ground at the cost of a longer walk, and{" "}
          <strong>Balanced</strong> sits in between.
        </p>
      ),
      onEnter: leftPanel,
    },
    {
      id: "points",
      target: '[data-tour="points"]',
      placement: "right",
      icon: MapPinned,
      title: "Set the start and the goal",
      body: (
        <p>
          Pick <strong>Set start</strong> or <strong>Set goal</strong>, then click the map. You can also type exact Mars coordinates under{" "}
          <em>Manual coordinates</em>.
        </p>
      ),
      onEnter: leftPanel,
    },
    {
      id: "map",
      target: '[data-tour="map"]',
      placement: "left",
      icon: MousePointerClick,
      title: "The map",
      body: (
        <p>
          Drag to pan. The scroll wheel zooms towards your pointer, so you can dive straight into a spot. The live position under the pointer is shown
          in the status bar.
        </p>
      ),
      onEnter: show2d,
    },
    {
      id: "toolbar",
      target: '[data-tour="map-toolbar"]',
      placement: "left",
      icon: Crosshair,
      title: "Map controls",
      body: <p>Zoom in and out around the centre of the view, jump back to the operating area, and show or hide the legend.</p>,
      onEnter: show2d,
    },
    {
      id: "plan",
      target: '[data-tour="plan"]',
      placement: "right",
      icon: Play,
      title: "Calculate the route",
      body: (
        <p>
          The route service runs A* over the slope-based terrain cost. If you change a point or the strategy afterwards, the result is marked{" "}
          <strong>Outdated</strong> until you recalculate.
        </p>
      ),
      onEnter: leftPanel,
    },
    {
      id: "layers",
      target: '[data-tour="layers"]',
      placement: "right",
      icon: Layers,
      title: "Map layers",
      body: <p>Turn on slope, elevation, the CRISM mineral signal and the science targets, and set how transparent each one is.</p>,
      onEnter: leftPanel,
    },
    {
      id: "inspector",
      target: '[data-tour="inspector"]',
      placement: "left",
      icon: PanelRight,
      title: "Mission Inspector",
      body: <p>Everything about the current plan: route metrics, strategy comparison, science targets near the route, EVA resources and the weather.</p>,
      onEnter: rightPanel,
    },
    {
      id: "mission-clock",
      target: '[data-tour="mission-clock"]',
      placement: "left",
      icon: Clock,
      title: "The mission clock",
      body: (
        <>
          <p>
            This is the <strong>"now"</strong> of the weather. It ticks in Mars time, and everything below follows it: the conditions, the EVA status
            and the forecast window.
          </p>
          <p>
            Press play and pick a speed to watch a sol go by. Drag the slider to a time of day, or choose a past sol to replay what was really measured.{" "}
            <strong>Live</strong> continues after the last measurement, at Jezero's current local time.
          </p>
        </>
      ),
      tip: "MEDA data ends at Sol 700. After that the clock keeps going, and the numbers are the model's estimates, clearly marked.",
      onEnter: rightPanel,
    },
    {
      id: "weather-now",
      target: '[data-tour="weather-now"]',
      placement: "left",
      icon: Thermometer,
      title: "Surface weather now",
      body: (
        <>
          <p>
            Air and ground temperature, pressure, daylight and the recent trend at the clock's time. While there is data these are{" "}
            <strong>measured</strong> by Perseverance's MEDA station, using only what was known up to that hour.
          </p>
          <p>
            After the last measurement the card switches to a <strong className="mw-tone--warning">model estimate</strong> for this hour, with its 80% range.
          </p>
        </>
      ),
      onEnter: rightPanel,
    },
    {
      id: "weather-forecast",
      target: '[data-tour="weather-forecast"]',
      placement: "left",
      icon: CalendarClock,
      title: "EVA weather window",
      body: (
        <>
          <p>
            Choose how far ahead to look from now, from a few hours to 7 sols. Each hour on the timeline is <strong className="mw-tone--success">GO</strong>,{" "}
            <strong className="mw-tone--warning">Caution</strong> or <strong className="mw-tone--critical">No-Go</strong>.
          </p>
          <p>After you calculate a route, its walking time is fitted into the safest GO window and the best departure time appears here.</p>
        </>
      ),
      tip: "GO means: daylight, and at least 80% probability that air and ground stay above the planning limits.",
      onEnter: rightPanel,
    },
    {
      id: "dashboard-button",
      target: '[data-tour="weather-open-dashboard"]',
      placement: "left",
      icon: CloudSun,
      title: "Open the forecast dashboard",
      body: <p>The full picture: forecast charts with their uncertainty, the probability of each hour, a seven-sol outlook and the model's track record.</p>,
      onEnter: rightPanel,
    },
    {
      id: "dashboard-fan",
      target: '[data-tour="dashboard-fan"]',
      placement: "bottom",
      icon: ChartSpline,
      kicker: "Dashboard",
      title: "Forecast with honest uncertainty",
      body: (
        <p>
          The line is the forecast; the shaded bands hold the true value 50%, 80% and 90% of the time, measured on sols the model never saw. Hover
          any chart and the others follow the same hour.
        </p>
      ),
      onEnter: openDashboard,
    },
    {
      id: "dashboard-limits",
      target: '[data-tour="dashboard-limits"]',
      placement: "bottom",
      icon: SlidersHorizontal,
      kicker: "Dashboard",
      title: "Your planning limits",
      body: <p>Set the lowest acceptable air and ground temperature and how confident a GO must be. Every probability and window updates at once.</p>,
      tip: "The default limits are placeholders until the team sets real suit values.",
      onEnter: openDashboard,
    },
    {
      id: "dashboard-replay",
      target: '[data-tour="dashboard-issue"]',
      placement: "bottom",
      icon: History,
      kicker: "Dashboard",
      title: "Replay a past sol",
      body: (
        <p>
          Issue the forecast from any earlier sol and compare it with what MEDA actually measured afterwards. The <em>Model performance</em> tab has
          the full evaluation.
        </p>
      ),
      onEnter: openDashboard,
    },
    {
      id: "resize",
      target: '[data-tour="inspector"]',
      placement: "left",
      icon: GripVertical,
      title: "Make room where you need it",
      body: (
        <p>
          Drag the edge between a side panel and the map to widen or narrow it. Double-click the edge to restore its default width. The arrow keys work
          too when the edge has focus.
        </p>
      ),
      onEnter: rightPanel,
    },
    {
      id: "status",
      target: '[data-tour="statusbar"]',
      placement: "top",
      icon: Gauge,
      title: "Status bar",
      body: <p>Coordinate system, the pointer position in Mars metres, the route distance and the next EVA departure, always visible.</p>,
      onEnter: () => closeDashboard(),
    },
    {
      id: "help",
      target: '[data-tour="help"]',
      placement: "bottom",
      icon: CircleHelp,
      title: "You are ready",
      body: <p>Set a start and a goal, calculate the route, and read the best departure in the EVA weather window. Reopen this tour from this button.</p>,
      onEnter: () => closeDashboard(),
    },
  ];
}
