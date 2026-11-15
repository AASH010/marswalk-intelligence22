import { useSyncExternalStore } from "react";

/** Subscribes to a mission clock and re-renders only when the selected value changes (the selector must return a primitive). */
export function useClockValue(clock, selector) {
  return useSyncExternalStore(clock.subscribe, () => selector(clock.get()));
}

/** The clock's whole-hour bucket: changes once per LTST hour of simulated time. */
export const selectHourBucket = (state) => (state.ready ? Math.floor(state.t) : null);
export const selectMinuteBucket = (state) => (state.ready ? Math.floor(state.t * 60) : null);
export const selectRunning = (state) => state.running;
export const selectSpeed = (state) => state.speed;
export const selectReady = (state) => state.ready;
