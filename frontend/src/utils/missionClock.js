/**
 * Mission clock: a simulated Jezero clock that drives "now" in the weather
 * panels.
 *
 * MEDA data ends at one sol (700 today), so the clock can run in two places:
 *   - on a past sol (replay): conditions come from what was measured;
 *   - after the last data ("live"): sols continue from the last measured one
 *     and conditions are model estimates.
 * In live mode the local time of day follows the real Mars local solar time
 * at Jezero, so day and night are what they really are on Mars right now.
 *
 * Time is one number, t = sol * 24 + LTST hour. One LTST hour lasts
 * 3698.96 real seconds, so 1x is Mars real time.
 */

export const SOL_SECONDS = 88775.244;
export const LTST_HOUR_SECONDS = SOL_SECONDS / 24;
export const CLOCK_SPEEDS = [1, 60, 600];
const JEZERO_LONGITUDE_EAST = 77.4509;

const rad = (degrees) => (degrees * Math.PI) / 180;
const mod = (value, base) => ((value % base) + base) % base;

/** Real Mars local true solar time at Jezero, in hours (Mars24 algorithm, equation of time included). */
export function jezeroLtstHours(date = new Date()) {
  const jdUt = date.getTime() / 86400000 + 2440587.5;
  const jdTt = jdUt + 69.184 / 86400;
  const dt = jdTt - 2451545.0;
  const meanAnomaly = 19.3871 + 0.52402073 * dt;
  const fictitiousSunAngle = 270.3871 + 0.524038496 * dt;
  const equationOfCenter =
    (10.691 + 3.0e-7 * dt) * Math.sin(rad(meanAnomaly)) +
    0.623 * Math.sin(rad(2 * meanAnomaly)) +
    0.05 * Math.sin(rad(3 * meanAnomaly)) +
    0.005 * Math.sin(rad(4 * meanAnomaly)) +
    0.0005 * Math.sin(rad(5 * meanAnomaly));
  const ls = fictitiousSunAngle + equationOfCenter;
  const equationOfTime = 2.861 * Math.sin(rad(2 * ls)) - 0.071 * Math.sin(rad(4 * ls)) + 0.002 * Math.sin(rad(6 * ls)) - equationOfCenter;
  const marsSolDate = (jdTt - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const coordinatedMarsTime = 24 * mod(marsSolDate, 1);
  return mod(coordinatedMarsTime + equationOfTime / 15 + JEZERO_LONGITUDE_EAST / 15, 24);
}

/** t -> { sol, hour (0..24), hourInt (0..23) } */
export function splitClock(t) {
  const sol = Math.floor(t / 24);
  const hour = t - sol * 24;
  return { sol, hour, hourInt: Math.min(23, Math.floor(hour)) };
}

export function formatClock(t) {
  const { hour } = splitClock(t);
  const minutes = Math.floor(hour * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * External store (like cursorStore): components subscribe through
 * useSyncExternalStore with a selector, so a ticking clock only re-renders
 * what shows a value that actually changed.
 */
export function createMissionClock() {
  let state = { ready: false, t: 0, running: true, speed: 1 };
  const listeners = new Set();
  let timer = null;
  let last = 0;

  const emit = () => listeners.forEach((listener) => listener());

  function syncTimer() {
    const shouldRun = state.ready && state.running;
    if (shouldRun && !timer) {
      last = performance.now();
      timer = setInterval(tick, 250);
    } else if (!shouldRun && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function tick() {
    const now = performance.now();
    const seconds = (now - last) / 1000;
    last = now;
    state = { ...state, t: state.t + (seconds * state.speed) / LTST_HOUR_SECONDS };
    emit();
  }

  function set(patch) {
    state = { ...state, ...patch };
    emit();
    syncTimer();
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** First start: live, right after the last measured sol. */
    init(latestSol) {
      if (!state.ready) set({ ready: true, t: (latestSol + 1) * 24 + jezeroLtstHours() });
    },
    goLive(latestSol) {
      set({ ready: true, t: (latestSol + 1) * 24 + jezeroLtstHours(), running: true });
    },
    /** Jump to 00:00 of a sol; keeps playing or paused as it was. */
    startAt(sol) {
      set({ ready: true, t: sol * 24 });
    },
    /** Scrubbing the time pauses the clock. */
    scrub(sol, hour) {
      set({ t: sol * 24 + hour, running: false });
    },
    play: () => set({ running: true }),
    pause: () => set({ running: false }),
    setSpeed: (speed) => set({ speed, running: true }),
    /** Stops the ticking timer (component unmount) and starts it again (mount). */
    suspend() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    resume: syncTimer,
  };
}
