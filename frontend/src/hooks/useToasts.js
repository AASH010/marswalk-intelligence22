import { useCallback, useEffect, useRef, useState } from "react";

const DURATION_MS = { info: 5000, success: 4000, warning: 7000, critical: 9000 };

/**
 * Transient notifications. Important errors are always shown inline as well;
 * a toast is never the only place a critical state is reported (handoff §9.2).
 */
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone, message) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-2), { id, tone, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION_MS[tone] ?? DURATION_MS.info)
      );
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const active = timers.current;
    return () => {
      active.forEach((timer) => clearTimeout(timer));
      active.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}
