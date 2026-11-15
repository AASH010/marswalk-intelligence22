import { Box, Map as MapIcon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

import IconButton from "../ui/IconButton";
import Logo from "../ui/Logo";
import StatusBadge from "../ui/StatusBadge";

const VIEWS = [
  { id: "2d", label: "2D Map", icon: MapIcon },
  { id: "3d", label: "3D Terrain", icon: Box },
];

const SERVICE_BADGES = {
  checking: { tone: "muted", label: "Checking service", status: "calculating" },
  online: { tone: "success", label: "Service online", status: "calculated" },
  offline: { tone: "critical", label: "Service offline", status: "failed" },
};

/**
 * Global header: brand, the two real map views, system status and the panel
 * toggles. Only capabilities that exist in the system are offered here.
 */
function HUD({
  viewMode,
  onViewModeChange,
  serviceStatus = "checking",
  routeStatus,
  routeBadgeLabel,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
}) {
  const service = SERVICE_BADGES[serviceStatus] || SERVICE_BADGES.checking;

  return (
    <header className="mw-header">
      <div className="mw-header__start">
        <IconButton
          label={leftOpen ? "Collapse Route Configuration" : "Expand Route Configuration"}
          onClick={onToggleLeft}
          aria-expanded={leftOpen}
          aria-controls="mw-panel-left"
        >
          {leftOpen ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}
        </IconButton>

        <div className="mw-brand">
          <Logo size={34} />
          <h1 className="mw-brand__text">
            <span className="mw-brand__name">MarsWalk</span>
            <span className="mw-brand__sub">Intelligence</span>
          </h1>
        </div>

        <div className="mw-header__context" aria-label="Area of interest">
          <span>Jezero Crater</span>
          <span className="mw-header__context-divider" aria-hidden="true" />
          <span>10 × 10 km AOI</span>
        </div>
      </div>

      <nav className="mw-view-tabs" aria-label="Map view">
        {VIEWS.map((view) => {
          const Icon = view.icon;
          const active = viewMode === view.id;
          return (
            <button
              key={view.id}
              type="button"
              className="mw-view-tab"
              aria-label={view.label}
              aria-pressed={active}
              onClick={() => onViewModeChange(view.id)}
            >
              <Icon size={15} aria-hidden="true" />
              <span aria-hidden="true">{view.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mw-header__end">
        <div className="mw-header__badges">
          <StatusBadge status={service.status} tone={service.tone} label={service.label} className="mw-header__service" />
          <StatusBadge status={routeStatus} label={routeBadgeLabel} />
        </div>
        <IconButton
          label={rightOpen ? "Collapse Mission Inspector" : "Expand Mission Inspector"}
          onClick={onToggleRight}
          aria-expanded={rightOpen}
          aria-controls="mw-panel-right"
        >
          {rightOpen ? <PanelRightClose size={18} aria-hidden="true" /> : <PanelRightOpen size={18} aria-hidden="true" />}
        </IconButton>
      </div>
    </header>
  );
}

export default HUD;
