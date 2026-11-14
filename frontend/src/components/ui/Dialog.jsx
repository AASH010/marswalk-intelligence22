import { useEffect, useId, useRef } from "react";

import Button from "./Button";

/**
 * Confirmation dialog built on the native <dialog> element, which traps
 * focus, closes on Escape and returns focus to the trigger on close
 * (handoff §4.11).
 */
function Dialog({ open, title, children, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false, onConfirm, onCancel }) {
  const ref = useRef(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="mw-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel?.();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onCancel?.();
      }}
    >
      <div className="mw-dialog__panel">
        <h2 id={titleId} className="mw-dialog__title">
          {title}
        </h2>
        <div id={bodyId} className="mw-dialog__body">
          {children}
        </div>
        <div className="mw-dialog__actions">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

export default Dialog;
