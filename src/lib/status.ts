/**
 * Status vocabulary - pure mapping helpers.
 *
 * Deliberately free of React so both server components and client components can
 * import them. Every status in this product is rendered as colour **plus** text
 * (PRD §89), so the label helpers below are as important as the tones.
 */

export type StatusTone = "ok" | "warn" | "brown" | "crit" | "info" | "idle" | "neutral";

export type TankStatus = "full" | "normal" | "low" | "critical" | "offline";
export type StationStatus = "online" | "warning" | "critical" | "offline";
export type DeviceStatus = "online" | "delayed" | "offline" | "fault" | "never_connected";
export type AlertStatus = "active" | "acknowledged" | "resolved";
export type AlertSeverity = "critical" | "warning" | "info";
export type VehicleStatus = "active" | "maintenance" | "inactive";
export type DataState = "live" | "delayed" | "stale" | "offline";

export function tankStatusTone(status: TankStatus): StatusTone {
  return status === "full"
    ? "ok"
    : status === "normal"
      ? "info"
      : status === "low"
        ? "brown"
        : status === "critical"
          ? "crit"
          : "neutral";
}

export function tankStatusLabel(status: TankStatus): string {
  return status === "full"
    ? "Full"
    : status === "normal"
      ? "Normal"
      : status === "low"
        ? "Low"
        : status === "critical"
          ? "Critical"
          : "Offline";
}

export function stationStatusTone(status: StationStatus): StatusTone {
  return status === "online" ? "ok" : status === "warning" ? "warn" : status === "critical" ? "crit" : "neutral";
}

export function stationStatusLabel(status: StationStatus): string {
  return status === "online" ? "Online" : status === "warning" ? "Warning" : status === "critical" ? "Critical" : "Offline";
}

export function deviceStatusTone(status: DeviceStatus): StatusTone {
  return status === "online" ? "ok" : status === "delayed" ? "warn" : status === "never_connected" ? "neutral" : "crit";
}

export function deviceStatusLabel(status: DeviceStatus): string {
  return status === "online"
    ? "Online"
    : status === "delayed"
      ? "Delayed"
      : status === "offline"
        ? "Offline"
        : status === "fault"
          ? "Fault"
          : "Never connected";
}

export function alertStatusTone(status: AlertStatus): StatusTone {
  return status === "active" ? "crit" : status === "acknowledged" ? "warn" : "ok";
}

export function alertStatusLabel(status: AlertStatus): string {
  return status === "active" ? "Active" : status === "acknowledged" ? "Acknowledged" : "Resolved";
}

export function alertSeverityTone(severity: AlertSeverity): StatusTone {
  return severity === "critical" ? "crit" : severity === "warning" ? "warn" : "info";
}

export function alertSeverityLabel(severity: AlertSeverity): string {
  return severity === "critical" ? "Critical" : severity === "warning" ? "Warning" : "Info";
}

export function vehicleStatusTone(status: VehicleStatus): StatusTone {
  return status === "active" ? "ok" : status === "maintenance" ? "warn" : "neutral";
}

export function vehicleStatusLabel(status: VehicleStatus): string {
  return status === "active" ? "Active" : status === "maintenance" ? "In maintenance" : "Inactive";
}

export function dataStateTone(state: DataState): StatusTone {
  return state === "live" ? "ok" : state === "delayed" ? "warn" : state === "stale" ? "warn" : "crit";
}

export function dataStateLabel(state: DataState): string {
  return state === "live" ? "Live" : state === "delayed" ? "Delayed" : state === "stale" ? "Stale data" : "Offline";
}

/** Human-readable label for a derived fuel movement. */
export function eventTypeLabel(type: string): string {
  switch (type) {
    case "refill":
      return "Refill";
    case "consumption":
      return "Tank outflow";
    case "anomaly":
      return "Possible anomaly";
    case "delivery":
      return "Delivery";
    case "device_offline":
      return "Device offline";
    case "device_online":
      return "Device came back online";
    default:
      return type;
  }
}

export function eventTypeTone(type: string): StatusTone {
  switch (type) {
    case "refill":
    case "delivery":
      return "ok";
    case "consumption":
      return "info";
    case "anomaly":
      return "warn";
    case "device_offline":
      return "crit";
    case "device_online":
      return "ok";
    default:
      return "neutral";
  }
}

export function confidenceTone(confidence: string): StatusTone {
  return confidence === "high" ? "ok" : confidence === "medium" ? "warn" : "neutral";
}

/** Tank state thresholds from the PRD (§59), used for copy and validation. */
export function tankStateForPercent(percent: number, criticalPct = 15, lowPct = 30, fullPct = 85): TankStatus {
  if (percent >= fullPct) return "full";
  if (percent >= lowPct) return "normal";
  if (percent >= criticalPct) return "low";
  return "critical";
}
