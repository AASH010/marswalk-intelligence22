import { useEffect, useRef, useState } from "react";
import { BrainCircuit, ChartSpline, CloudSun, History, Radio, X } from "lucide-react";

import IconButton from "../ui/IconButton";
import StatusBadge from "../ui/StatusBadge";
import ForecastTab from "./ForecastTab";
import PerformanceTab from "./PerformanceTab";
import MethodTab from "./MethodTab";
import { getForecast, getWeatherReport } from "../../api/weather";

const TABS = [
  { id: "forecast", label: "Forecast", icon: CloudSun },
  { id: "performance", label: "Model performance", icon: ChartSpline },
  { id: "method", label: "Method & data", icon: BrainCircuit },
];

function IssueControl({ status, issueSol, onChange }) {
  const latest = status?.latest_issue_sol;
  const first = status?.first_issue_sol;
  const [draft, setDraft] = useState(String(issueSol ?? Math.max(first ?? 0, (latest ?? 1) - 60)));
  const replay = issueSol != null;
  useEffect(() => {
    if (issueSol != null) setDraft(String(issueSol));
  }, [issueSol]);
  if (latest == null) return null;
  const commit = (value) => {
    const sol = Math.round(Number(value));
    if (Number.isFinite(sol) && sol >= first && sol < latest) onChange(sol);
  };

  return (
    <div className="mw-issue" data-tour="dashboard-issue">
      <div className="mw-segmented" role="radiogroup" aria-label="Forecast source">
        <button type="button" role="radio" aria-checked={!replay} className="mw-segmented__option" onClick={() => onChange(null)}>
          <Radio size={13} aria-hidden="true" /> Latest · Sol {latest}
        </button>
        <button type="button" role="radio" aria-checked={replay} className="mw-segmented__option" onClick={() => commit(draft)}>
          <History size={13} aria-hidden="true" /> Replay a past sol
        </button>
      </div>
      {replay && (
        <div className="mw-issue__replay">
          <input
            type="range"
            className="mw-range"
            min={first}
            max={latest - 1}
            value={Number(draft) || first}
            aria-label="Issue sol for the replay"
            onChange={(event) => setDraft(event.target.value)}
            onMouseUp={(event) => commit(event.currentTarget.value)}
            onKeyUp={(event) => commit(event.currentTarget.value)}
            onTouchEnd={(event) => commit(event.currentTarget.value)}
          />
          <input
            className="mw-input mw-issue__input"
            inputMode="numeric"
            value={draft}
            aria-label="Issue sol"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && commit(event.currentTarget.value)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Full-screen forecast dashboard: the forecast with its uncertainty and
 * probabilities, the out-of-sample evaluation of the model, and the method.
 */
function WeatherDashboard({
  open,
  onClose,
  status,
  forecastState,
  horizon,
  onHorizonChange,
  issueSol,
  onIssueSolChange,
  limits,
  onLimitsChange,
  routeHours,
  initialTab = "forecast",
}) {
  const [tab, setTab] = useState(initialTab);
  const [report, setReport] = useState(null);
  const [reportError, setReportError] = useState(null);
  const [week, setWeek] = useState(null);
  const closeRef = useRef(null);
  const panelRef = useRef(null);

  const bodyRef = useRef(null);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [tab]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape" && !document.querySelector(".mw-tour")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || report) return undefined;
    const controller = new AbortController();
    getWeatherReport({ signal: controller.signal })
      .then(setReport)
      .catch((error) => error.kind !== "aborted" && setReportError(error.message));
    return () => controller.abort();
  }, [open, report]);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    getForecast({ issueSol, startHour: 0, endHour: 168, limits }, { signal: controller.signal })
      .then(setWeek)
      .catch((error) => error.kind !== "aborted" && setWeek(null));
    return () => controller.abort();
  }, [open, issueSol, limits]);

  if (!open) return null;
  const forecast = forecastState.forecast;

  return (
    <div className="mw-dash" role="dialog" aria-modal="true" aria-labelledby="mw-dash-title">
      <div className="mw-dash__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="mw-dash__panel" ref={panelRef}>
        <header className="mw-dash__header">
          <div className="mw-dash__brand">
            <span className="mw-dash__icon" aria-hidden="true">
              <CloudSun size={20} />
            </span>
            <div>
              <h2 id="mw-dash-title" className="mw-dash__title">
                EVA Weather Intelligence
              </h2>
              <p className="mw-dash__subtitle">
                Jezero crater · MEDA surface weather · forecast issued after Sol {forecast?.issue_sol ?? status?.latest_issue_sol ?? "—"}
              </p>
            </div>
          </div>
          <IssueControl status={status} issueSol={issueSol} onChange={onIssueSolChange} />
          <div className="mw-dash__header-end">
            {forecastState.loading ? <StatusBadge status="calculating" label="Updating" /> : <StatusBadge status="calculated" label={forecast?.is_replay ? "Replay" : "Live model"} />}
            <IconButton ref={closeRef} label="Close dashboard" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </IconButton>
          </div>
        </header>

        <nav className="mw-dash__tabs" role="tablist" aria-label="Dashboard sections" data-tour="dashboard-tabs">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className="mw-dash__tab"
                onClick={() => setTab(item.id)}
              >
                <Icon size={15} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div ref={bodyRef} className="mw-dash__body mw-scroll" role="tabpanel">
          {tab === "forecast" && (
            <ForecastTab
              forecast={forecast}
              week={week}
              loading={forecastState.loading}
              error={forecastState.error}
              horizon={horizon}
              onHorizonChange={onHorizonChange}
              issueSol={forecast?.issue_sol ?? status?.latest_issue_sol}
              limits={limits}
              defaultLimits={status?.default_limits}
              onLimitsChange={onLimitsChange}
              routeHours={routeHours}
            />
          )}
          {tab === "performance" && <PerformanceTab report={report} error={reportError} />}
          {tab === "method" && <MethodTab report={report} error={reportError} status={status} />}
        </div>
      </div>
    </div>
  );
}

export default WeatherDashboard;
