"use client";

import { Badge, alertStatusLabel, alertStatusTone, deviceStatusTone, stationStatusTone, tankStatusTone, vehicleStatusTone } from "@/components/ui/feedback";

/**
 * Domain status badges. Status is always rendered as colour **plus** text so it
 * is never conveyed by colour alone (PRD §89 accessibility requirement).
 */

export function EventTypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; tone: "ok" | "warn" | "crit" | "info" | "neutral" }> = {
    refill: { label: "Refill", tone: "ok" },
    consumption: { label: "Tank outflow", tone: "info" },
    anomaly: { label: "Possible anomaly", tone: "warn" },
    delivery: { label: "Delivery", tone: "ok" },
    device_offline: { label: "Device offline", tone: "crit" },
    device_online: { label: "Device online", tone: "ok" },
  };
  const entry = map[type] ?? { label: type, tone: "neutral" as const };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function TankStatusBadge({ status }: { status: "full" | "normal" | "low" | "critical" | "offline" }) {
  const label =
    status === "full" ? "Full" : status === "normal" ? "Normal" : status === "low" ? "Low" : status === "critical" ? "Critical" : "Offline";
  return (
    <Badge tone={tankStatusTone(status)}>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        {label}
      </span>
    </Badge>
  );
}

export function StationStatusBadge({ status }: { status: "online" | "warning" | "critical" | "offline" }) {
  const label = status === "online" ? "Online" : status === "warning" ? "Warning" : status === "critical" ? "Critical" : "Offline";
  return <Badge tone={stationStatusTone(status)}>{label}</Badge>;
}

export function DeviceStatusBadge({ status }: { status: "online" | "delayed" | "offline" | "fault" | "never_connected" }) {
  const label =
    status === "online"
      ? "Online"
      : status === "delayed"
        ? "Delayed"
        : status === "offline"
          ? "Offline"
          : status === "fault"
            ? "Fault"
            : "Never connected";
  return <Badge tone={deviceStatusTone(status)}>{label}</Badge>;
}

export function VehicleStatusBadge({ status }: { status: "active" | "maintenance" | "inactive" }) {
  const label = status === "active" ? "Active" : status === "maintenance" ? "In maintenance" : "Inactive";
  return <Badge tone={vehicleStatusTone(status)}>{label}</Badge>;
}

export function AlertStatusBadge({ status }: { status: "active" | "acknowledged" | "resolved" }) {
  return <Badge tone={alertStatusTone(status)}>{alertStatusLabel(status)}</Badge>;
}

export function AlertSeverityBadge({ severity }: { severity: "critical" | "warning" | "info" }) {
  const label = severity === "critical" ? "Critical" : severity === "warning" ? "Warning" : "Info";
  return <Badge tone={severity === "critical" ? "crit" : severity === "warning" ? "warn" : "info"}>{label}</Badge>;
}

export function DataStateBadge({ state }: { state: "live" | "delayed" | "stale" | "offline" }) {
  const map = {
    live: { label: "Live", tone: "ok" as const },
    delayed: { label: "Delayed", tone: "warn" as const },
    stale: { label: "Stale data", tone: "warn" as const },
    offline: { label: "Offline", tone: "crit" as const },
  };
  const entry = map[state];
  return (
    <Badge tone={entry.tone}>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        {entry.label}
      </span>
    </Badge>
  );
}

export function ConfidenceBadge({ value }: { value: string }) {
  const tone = value === "high" ? "ok" : value === "medium" ? "warn" : "neutral";
  return <Badge tone={tone}>{value}</Badge>;
}

export { StatusBadge } from "@/components/ui/feedback";
