import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";

const PAD = 8;
const CARD_W = 372;
const GAP = 16;

function useTargetRect(selector, stepKey) {
  const [rect, setRect] = useState(null);
  useLayoutEffect(() => {
    if (!selector) {
      setRect(null);
      return undefined;
    }
    let frame = 0;
    let stopped = false;
    const measure = () => {
      const element = document.querySelector(selector);
      if (!element) {
        setRect(null);
        return;
      }
      const r = element.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        setRect(null);
        return;
      }
      setRect((current) =>
        current && Math.abs(current.top - r.top) < 0.5 && Math.abs(current.left - r.left) < 0.5 && Math.abs(current.width - r.width) < 0.5 && Math.abs(current.height - r.height) < 0.5
          ? current
          : { top: r.top, left: r.left, width: r.width, height: r.height }
      );
    };
    // Bring the target into view inside its scrolling panel, then follow it while layout settles.
    const scrollTimer = setTimeout(() => {
      document.querySelector(selector)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }, 60);
    const loop = () => {
      if (stopped) return;
      measure();
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clearTimeout(scrollTimer);
    };
  }, [selector, stepKey]);
  return rect;
}

function cardPosition(rect, placement, cardHeight) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) return { top: Math.max(24, vh / 2 - cardHeight / 2), left: vw / 2 - CARD_W / 2 };
  const spot = { top: rect.top - PAD, left: rect.left - PAD, right: rect.left + rect.width + PAD, bottom: rect.top + rect.height + PAD };
  const fits = {
    right: vw - spot.right - GAP >= CARD_W,
    left: spot.left - GAP >= CARD_W,
    bottom: vh - spot.bottom - GAP >= cardHeight,
    top: spot.top - GAP >= cardHeight,
  };
  const order = [placement, "right", "left", "bottom", "top"].filter(Boolean);
  const side = order.find((s) => fits[s]) ?? "center";
  let top;
  let left;
  if (side === "right" || side === "left") {
    left = side === "right" ? spot.right + GAP : spot.left - GAP - CARD_W;
    top = rect.top + rect.height / 2 - cardHeight / 2;
  } else if (side === "bottom" || side === "top") {
    top = side === "bottom" ? spot.bottom + GAP : spot.top - GAP - cardHeight;
    left = rect.left + rect.width / 2 - CARD_W / 2;
  } else {
    top = vh - cardHeight - 24;
    left = vw / 2 - CARD_W / 2;
  }
  return {
    top: Math.min(Math.max(12, top), vh - cardHeight - 12),
    left: Math.min(Math.max(12, left), vw - CARD_W - 12),
    side,
  };
}

/**
 * Guided tour: a spotlight that glides between parts of the interface and a
 * card that explains each one. Keyboard: ← → to move, Esc to leave.
 */
function TourOverlay({ open, steps, onClose }) {
  const [index, setIndex] = useState(0);
  const cardRef = useRef(null);
  const [cardHeight, setCardHeight] = useState(220);
  const step = steps[index];

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useEffect(() => {
    if (open && step?.onEnter) step.onEnter();
    // run when the step changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  const rect = useTargetRect(open ? step?.target : null, `${index}`);

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.getBoundingClientRect().height);
  }, [index, open, rect?.width]);

  const finish = useCallback(
    (completed) => {
      steps.at(-1)?.onLeave?.();
      onClose(completed);
    },
    [onClose, steps]
  );

  const go = useCallback(
    (next) => {
      if (next < 0) return;
      if (next >= steps.length) {
        finish(true);
        return;
      }
      steps[index]?.onLeave?.();
      setIndex(next);
    },
    [finish, index, steps]
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") finish(false);
      else if (event.key === "ArrowRight" || event.key === "Enter") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, index, go, finish]);

  useEffect(() => {
    if (open) cardRef.current?.querySelector(".mw-tour__next")?.focus();
  }, [open, index]);

  if (!open || !step) return null;
  const position = cardPosition(rect, step.placement, cardHeight);
  const Icon = step.icon;
  const last = index === steps.length - 1;

  return createPortal(
    <div className="mw-tour" role="dialog" aria-modal="true" aria-labelledby="mw-tour-title" aria-describedby="mw-tour-body">
      <div className="mw-tour__blocker" />
      <div
        className={`mw-tour__spot ${rect ? "" : "is-hidden"}`}
        style={
          rect
            ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
            : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 }
        }
        aria-hidden="true"
      >
        {rect && <span className="mw-tour__pulse" />}
      </div>

      <div ref={cardRef} className={`mw-tour__card mw-tour__card--${position.side || "center"}`} style={{ top: position.top, left: position.left, width: CARD_W }}>
        <div className="mw-tour__progress" aria-hidden="true">
          <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="mw-tour__head">
          {step.hero ? (
            <span className="mw-tour__hero" aria-hidden="true">
              <svg viewBox="0 0 64 64" width="56" height="56">
                <defs>
                  <radialGradient id="mw-tour-mars" cx="38%" cy="34%" r="70%">
                    <stop offset="0%" stopColor="var(--mw-brand-mars)" />
                    <stop offset="100%" stopColor="var(--mw-brand-mars-shade)" />
                  </radialGradient>
                </defs>
                <circle cx="32" cy="32" r="15" fill="url(#mw-tour-mars)" />
                <ellipse className="mw-tour__orbit" cx="32" cy="32" rx="28" ry="10" fill="none" stroke="var(--mw-cyan)" strokeWidth="1.5" />
                <circle className="mw-tour__moon" r="2.6" fill="var(--mw-cyan)" />
              </svg>
            </span>
          ) : (
            Icon && (
              <span className="mw-tour__icon" aria-hidden="true">
                <Icon size={18} />
              </span>
            )
          )}
          <div className="mw-tour__heading">
            <span className="mw-tour__count">
              {step.kicker || "Guided tour"} · {index + 1} / {steps.length}
            </span>
            <h2 id="mw-tour-title" className="mw-tour__title">
              {step.title}
            </h2>
          </div>
          <button type="button" className="mw-tour__close" aria-label="Close the tour" onClick={() => finish(false)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div id="mw-tour-body" className="mw-tour__body">
          {step.body}
        </div>
        {step.tip && <p className="mw-tour__tip">{step.tip}</p>}
        <div className="mw-tour__foot">
          <div className="mw-tour__dots" role="tablist" aria-label="Tour steps">
            {steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Step ${i + 1}: ${s.title}`}
                className={`mw-tour__dot ${i === index ? "is-active" : ""} ${i < index ? "is-done" : ""}`}
                onClick={() => go(i)}
              />
            ))}
          </div>
          <div className="mw-tour__actions">
            {index > 0 && (
              <button type="button" className="mw-button mw-button--tertiary mw-button--sm" onClick={() => go(index - 1)}>
                <span className="mw-button__content">
                  <ArrowLeft size={14} aria-hidden="true" /> Back
                </span>
              </button>
            )}
            <button type="button" className="mw-button mw-button--primary mw-button--sm mw-tour__next" onClick={() => go(index + 1)}>
              <span className="mw-button__content">
                {last ? (
                  <>
                    Finish <Check size={14} aria-hidden="true" />
                  </>
                ) : (
                  <>
                    {index === 0 ? "Start the tour" : "Next"} <ArrowRight size={14} aria-hidden="true" />
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
        {index === 0 && (
          <button type="button" className="mw-tour__skip" onClick={() => finish(false)}>
            Skip for now
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

export default TourOverlay;
