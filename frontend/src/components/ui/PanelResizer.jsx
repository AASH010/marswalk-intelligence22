import { useCallback, useRef } from "react";

/**
 * Draggable edge between a side panel and the map (pointer and keyboard).
 * side: "left" | "right". The handle reports a new width in pixels; the
 * caller clamps and stores it. Double-click restores the default width.
 */
function PanelResizer({ side, width, min, max, onResize, onResizeStart, onResizeEnd, onReset, label }) {
  const drag = useRef(null);
  const panelWidth = useCallback(() => {
    const panel = document.getElementById(side === "left" ? "mw-panel-left" : "mw-panel-right");
    return panel ? panel.getBoundingClientRect().width : width ?? min;
  }, [side, width, min]);

  const onPointerDown = useCallback(
    (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { x: event.clientX, width: panelWidth() };
      event.currentTarget.setPointerCapture(event.pointerId);
      onResizeStart?.();
    },
    [panelWidth, onResizeStart]
  );

  const onPointerMove = useCallback(
    (event) => {
      if (!drag.current) return;
      const delta = event.clientX - drag.current.x;
      onResize(drag.current.width + (side === "left" ? delta : -delta));
    },
    [side, onResize]
  );

  const finish = useCallback(
    (event) => {
      if (!drag.current) return;
      drag.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      onResizeEnd?.();
    },
    [onResizeEnd]
  );

  const onKeyDown = (event) => {
    const step = event.shiftKey ? 48 : 16;
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
    if (event.key === grow) onResize(panelWidth() + step);
    else if (event.key === shrink) onResize(panelWidth() - step);
    else if (event.key === "Home") onResize(min);
    else if (event.key === "End") onResize(max);
    else if (event.key === "Enter") onReset?.();
    else return;
    event.preventDefault();
  };

  return (
    <div
      className={`mw-resizer mw-resizer--${side}`}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width != null ? Math.round(width) : undefined}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className="mw-resizer__grip" aria-hidden="true" />
    </div>
  );
}

export default PanelResizer;
