import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 8;

/**
 * Short contextual help shown on hover and on keyboard focus.
 * The tooltip is rendered in a portal so scrolling panels never clip it.
 */
function Tooltip({ label, placement = "top", children, className = "" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const anchorRef = useRef(null);
  const bubbleRef = useRef(null);
  const timerRef = useRef(null);
  const id = useId();

  const show = useCallback((delay) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), delay);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setOpen(false);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open, hide]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !bubbleRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const bubble = bubbleRef.current.getBoundingClientRect();
    let top;
    let left;

    if (placement === "bottom") {
      top = anchor.bottom + GAP;
      left = anchor.left + anchor.width / 2 - bubble.width / 2;
    } else if (placement === "left") {
      top = anchor.top + anchor.height / 2 - bubble.height / 2;
      left = anchor.left - bubble.width - GAP;
    } else if (placement === "right") {
      top = anchor.top + anchor.height / 2 - bubble.height / 2;
      left = anchor.right + GAP;
    } else {
      top = anchor.top - bubble.height - GAP;
      left = anchor.left + anchor.width / 2 - bubble.width / 2;
    }

    if (top < 4) top = anchor.bottom + GAP;
    left = Math.min(Math.max(4, left), window.innerWidth - bubble.width - 4);
    top = Math.min(top, window.innerHeight - bubble.height - 4);
    setPosition({ top, left });
  }, [open, placement, label]);

  if (!label) return children;

  return (
    <span
      ref={anchorRef}
      className={`mw-tooltip-anchor ${className}`}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") show(350);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={() => show(0)}
      onBlur={hide}
    >
      {children}
      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            id={id}
            role="tooltip"
            className="mw-tooltip"
            style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: "hidden" }}
          >
            {label}
          </span>,
          document.body
        )}
    </span>
  );
}

export default Tooltip;
