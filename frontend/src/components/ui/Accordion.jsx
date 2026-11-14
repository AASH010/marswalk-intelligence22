import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Expandable section (handoff §4.11). Content stays mounted while collapsed
 * so draft values and scroll position are not lost.
 */
function Accordion({ title, icon = null, meta = null, defaultOpen = true, open: controlledOpen, onToggle, children, className = "" }) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen === undefined ? internalOpen : controlledOpen;
  const id = useId();
  const buttonId = `${id}-button`;
  const regionId = `${id}-region`;

  const toggle = () => {
    if (controlledOpen === undefined) setInternalOpen((current) => !current);
    onToggle?.(!open);
  };

  return (
    <section className={`mw-accordion ${open ? "is-open" : ""} ${className}`}>
      <h3 className="mw-accordion__heading">
        <button
          id={buttonId}
          type="button"
          className="mw-accordion__trigger"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={toggle}
        >
          {icon && <span className="mw-accordion__icon">{icon}</span>}
          <span className="mw-accordion__title">{title}</span>
          {meta && <span className="mw-accordion__meta">{meta}</span>}
          <ChevronDown className="mw-accordion__chevron" size={16} aria-hidden="true" />
        </button>
      </h3>
      <div id={regionId} role="region" aria-labelledby={buttonId} className="mw-accordion__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export default Accordion;
