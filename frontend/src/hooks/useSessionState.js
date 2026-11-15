import { useEffect, useState } from "react";

/**
 * useState that is kept for the current browser session (handoff §5.8:
 * layer visibility persists for the session). Storage can be unavailable or
 * hold stale shapes, so reads are validated and every access is guarded.
 */
export function useSessionState(key, initialValue, validate) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw == null) return initialValue;
      const parsed = JSON.parse(raw);
      const checked = validate ? validate(parsed) : parsed;
      return checked ?? initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable — state simply lives in memory */
    }
  }, [key, value]);

  return [value, setValue];
}
