import { Check, CircleDashed, CircleDot, Minus, TriangleAlert, X } from "lucide-react";

import Spinner from "./Spinner";

/**
 * Status badge (handoff §4.6). Each status pairs its colour with an icon and
 * a text label, so the state never depends on colour alone.
 */
export const STATUS_BADGES = {
  idle: { label: "Awaiting inputs", tone: "muted", icon: CircleDashed },
  ready: { label: "Ready", tone: "info", icon: CircleDot },
  calculating: { label: "Calculating", tone: "cyan", icon: null },
  calculated: { label: "Calculated", tone: "success", icon: Check },
  outdated: { label: "Outdated", tone: "warning", icon: TriangleAlert },
  failed: { label: "Failed", tone: "critical", icon: X },
  unavailable: { label: "Unavailable", tone: "muted", icon: Minus },
};

function StatusBadge({ status, label, tone, icon, className = "" }) {
  const preset = STATUS_BADGES[status] || {};
  const Icon = icon === undefined ? preset.icon : icon;
  const resolvedTone = tone || preset.tone || "muted";
  const text = label || preset.label || "";

  return (
    <span className={`mw-badge mw-badge--${resolvedTone} ${className}`}>
      {status === "calculating" && !icon ? <Spinner size={12} /> : Icon ? <Icon size={12} strokeWidth={2.5} aria-hidden="true" /> : null}
      <span>{text}</span>
    </span>
  );
}

export default StatusBadge;
