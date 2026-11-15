/**
 * Tiny external store for the map cursor position, so pointer movement only
 * re-renders the coordinate readout and not the whole application.
 */

let position = null;
const listeners = new Set();

export const cursorStore = {
  set(next) {
    position = next;
    listeners.forEach((listener) => listener());
  },
  get() {
    return position;
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
