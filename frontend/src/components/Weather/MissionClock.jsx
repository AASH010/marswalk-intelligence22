import { useEffect, useId, useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Pause, Play, Radio, Sun } from "lucide-react";

import IconButton from "../ui/IconButton";
import { CLOCK_SPEEDS, formatClock, splitClock } from "../../utils/missionClock";
import { selectMinuteBucket, selectRunning, selectSpeed, useClockValue } from "../../hooks/useMissionClock";
import { STATUS_META, fmtPct } from "../../utils/weather";

/**
 * Mission clock: the "now" of the weather panels. It ticks, so the current
 * conditions and the forecast window move with time. On a past sol it replays
 * what was measured; after the last data it continues the sols and uses the
 * model's estimates.
 */
function MissionClock({ clock, latestSol, firstSol, now, nowLoading, onGoLive }) {
  const id = useId();
  useClockValue(clock, selectMinuteBucket);
  const running = useClockValue(clock, selectRunning);
  const speed = useClockValue(clock, selectSpeed);

  const { t } = clock.get();
  const { sol, hour } = splitClock(t);
  const measured = sol <= latestSol;
  const meta = now ? STATUS_META[now.status] : null;
  const daylight = now?.daylight;

  // Sol field: edited freely, applied on Enter or blur.
  const [solDraft, setSolDraft] = useState(String(sol));
  useEffect(() => setSolDraft(String(sol)), [sol]);
  const applySol = () => {
    const value = Math.round(Number(solDraft));
    if (!Number.isFinite(value)) return setSolDraft(String(sol));
    const clamped = Math.min(latestSol + 7, Math.max(firstSol, value));
    clock.scrub(clamped, hour);
    setSolDraft(String(clamped));
  };
  const stepSol = (delta) => clock.scrub(Math.min(latestSol + 7, Math.max(firstSol, sol + delta)), hour);

  return (
    <div className="mw-clock" data-tour="mission-clock">
      <div className="mw-clock__display">
        <div className="mw-clock__time" aria-live="off">
          {daylight === false ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
          <span className="mw-mono mw-clock__hhmm">{formatClock(t)}</span>
          <span className="mw-clock__unit">LTST</span>
        </div>
        <span className={`mw-chip mw-chip--static ${measured ? "" : "mw-chip--warning"}`} title={measured ? "Conditions come from MEDA measurements" : "After the last data: conditions are model estimates"}>
          {measured ? "Measured data" : "Model estimate"}
        </span>
      </div>

      <div className="mw-clock__sol">
        <IconButton label="Previous sol" size="sm" onClick={() => stepSol(-1)} disabled={sol <= firstSol}>
          <ChevronLeft size={15} aria-hidden="true" />
        </IconButton>
        <label className="mw-clock__sol-field" htmlFor={`${id}-sol`}>
          <span>Sol</span>
          <input
            id={`${id}-sol`}
            className="mw-input mw-mono"
            inputMode="numeric"
            value={solDraft}
            onChange={(event) => setSolDraft(event.target.value.replace(/[^0-9]/g, ""))}
            onBlur={applySol}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
        </label>
        <IconButton label="Next sol" size="sm" onClick={() => stepSol(1)} disabled={sol >= latestSol + 7}>
          <ChevronRight size={15} aria-hidden="true" />
        </IconButton>
        <button type="button" className="mw-chip mw-clock__live" onClick={onGoLive} title="Continue after the last measured sol, at Jezero's current local solar time">
          <Radio size={13} aria-hidden="true" /> Live
        </button>
      </div>

      <div className="mw-clock__scrub">
        <input
          type="range"
          className="mw-range"
          aria-label="Time of day (LTST)"
          min={0}
          max={23.75}
          step={0.25}
          value={Math.min(23.75, hour)}
          onChange={(event) => clock.scrub(sol, Number(event.target.value))}
        />
        <div className="mw-clock__ticks mw-mono" aria-hidden="true">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </div>

      <div className="mw-clock__controls">
        <IconButton label={running ? "Pause the clock" : "Play the clock"} variant="secondary" onClick={() => (running ? clock.pause() : clock.play())}>
          {running ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        </IconButton>
        <div className="mw-horizon__presets" role="radiogroup" aria-label="Clock speed">
          {CLOCK_SPEEDS.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={speed === value} className="mw-chip" onClick={() => clock.setSpeed(value)}>
              {value === 1 ? "Real time" : `${value}×`}
            </button>
          ))}
        </div>
      </div>

      <div className={`mw-clock__eva ${meta ? `is-${now.status.toLowerCase()}` : ""} ${nowLoading ? "is-loading" : ""}`} aria-live="polite">
        <span className="mw-clock__eva-key">EVA now</span>
        {now ? (
          <>
            <strong className="mw-mono">{meta.label}</strong>
            <span className="mw-mono">{fmtPct(now.p_go)}</span>
            <span className="mw-clock__eva-reason">{now.reason}</span>
          </>
        ) : (
          <span className="mw-clock__eva-reason">Forecast does not reach this time. Add newer MEDA data.</span>
        )}
      </div>
    </div>
  );
}

export default MissionClock;
