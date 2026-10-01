/**
 * Core domain types shared by the server, the API layer and (structurally) the
 * UI. Kept dependency-free so both server and client code can import them.
 */

export type Unit = "liters" | "gallons";
export type TempUnit = "celsius" | "fahrenheit";

export type StationStatus = "online" | "warning" | "critical" | "offline";
export type TankStatus = "full" | "normal" | "low" | "critical" | "offline";
export type DeviceType = "fuel_probe" | "gps_tracker";
export type DeviceStatus = "online" | "delayed" | "offline" | "fault" | "never_connected";

export type FuelEventType =
  | "refill"
  | "consumption"
  | "delivery"
  | "anomaly"
  | "device_offline"
  | "device_online";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertStatus = "active" | "acknowledged" | "resolved";

export type AlertType =
  | "low_fuel"
  | "critical_fuel"
  | "high_fuel"
  | "overfill"
  | "refill"
  | "suspected_loss"
  | "probe_offline"
  | "gps_offline"
  | "no_data"
  | "sensor_error"
  | "invalid_reading"
  | "water_detected"
  | "rapid_change"
  | "temperature_abnormal"
  | "excessive_consumption"
  | "unexpected_refuel"
  | "reconciliation_variance";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  currency: string;
  units: Unit;
  tempUnit: TempUnit;
  timezone: string;
  locale: string;
  plan: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  status: "active" | "invited" | "suspended";
  phone: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  mfaEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  stationIds: string[];
  /** Brute-force protection counters (never exposed to the client). */
  failedAttempts?: number;
  lockedUntil?: string | null;
}

export interface Station {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  address: string;
  city: string;
  region: string;
  country: string;
  phone: string | null;
  email: string | null;
  latitude: number;
  longitude: number;
  status: StationStatus;
  openingTime: string;
  closingTime: string;
  timezone: string;
  currency: string;
  volumeUnit: Unit;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FuelType {
  id: string;
  organizationId: string;
  systemName: string;
  displayName: string;
  color: string;
  density: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Tank {
  id: string;
  organizationId: string;
  stationId: string;
  fuelTypeId: string;
  name: string;
  code: string;
  capacity: number;
  currentVolume: number;
  currentLevelMm: number | null;
  currentTempC: number | null;
  waterLevelMm: number | null;
  tankType: "underground" | "above_ground";
  manufacturer: string | null;
  installationDate: string | null;
  minLevel: number;
  lowThresholdPct: number;
  criticalThresholdPct: number;
  overfillThresholdPct: number;
  lastReadingAt: string | null;
  lastValidReadingAt: string | null;
  status: TankStatus;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  organizationId: string;
  type: DeviceType;
  serialNumber: string;
  label: string | null;
  provider: string;
  model: string | null;
  firmware: string | null;
  stationId: string | null;
  tankId: string | null;
  vehicleId: string | null;
  status: DeviceStatus;
  lastSeenAt: string | null;
  lastReadingAt: string | null;
  signalStrength: number | null;
  batteryPct: number | null;
  ipAddress: string | null;
  /** SHA-256 of the device ingest API key. Never returned by the API layer. */
  apiKeyHash: string | null;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicle {
  id: string;
  organizationId: string;
  name: string;
  plateNumber: string;
  type: string;
  make: string | null;
  model: string | null;
  year: number | null;
  fuelTypeId: string | null;
  tankCapacity: number | null;
  stationId: string | null;
  status: "active" | "maintenance" | "inactive";
  odometerKm: number | null;
  driverName: string | null;
  driverPhone: string | null;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Reading {
  id: string;
  ts: string;
  createdAt: string;
  organizationId: string;
  tankId: string;
  deviceId: string;
  volumeLiters: number;
  levelPercent: number | null;
  levelMm: number | null;
  temperatureC: number | null;
  waterLevelMm: number | null;
  signal: number | null;
  batteryPct: number | null;
  raw: Record<string, unknown> | null;
}

export interface FuelEvent {
  id: string;
  ts: string;
  createdAt: string;
  organizationId: string;
  stationId: string;
  tankId: string;
  deviceId: string | null;
  vehicleId: string | null;
  type: FuelEventType;
  volume: number;
  levelBefore: number;
  levelAfter: number;
  durationSec: number | null;
  confidence: "high" | "medium" | "low";
  status: "confirmed" | "suspected" | "rejected";
  reason: string | null;
  note: string | null;
}

export interface Alert {
  id: string;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
  stationId: string;
  tankId: string | null;
  deviceId: string | null;
  fuelEventId: string | null;
  ruleId: string | null;
  type: AlertType | string;
  severity: AlertSeverity;
  title: string;
  message: string;
  value: number | null;
  unit: string | null;
  threshold: number | null;
  status: AlertStatus;
  metadata: Record<string, unknown> | null;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  assignedToId: string | null;
  resolutionNote: string | null;
}

export interface AlertRule {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  type: string;
  scope: "tank" | "station" | "device" | "vehicle" | "organization";
  tankId: string | null;
  stationId: string | null;
  deviceId: string | null;
  fuelTypeId: string | null;
  condition: Record<string, unknown>;
  severity: AlertSeverity;
  channels: string[];
  isEnabled: boolean;
  cooldownMin: number;
  createdAt: string;
  updatedAt: string;
}

export interface Report {
  id: string;
  organizationId: string;
  createdById: string;
  title: string;
  category: string;
  period: string;
  dateFrom: string;
  dateTo: string;
  filters: Record<string, unknown>;
  status: "queued" | "generating" | "ready" | "failed" | "archived";
  progress: number;
  format: "pdf" | "excel" | "csv";
  fileUrl: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledReport {
  id: string;
  organizationId: string;
  name: string;
  category: string;
  period: "daily" | "weekly" | "monthly";
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timeOfDay: string;
  timezone: string;
  recipients: string[];
  format: string;
  stationId: string | null;
  filters: Record<string, unknown>;
  isEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Integration {
  id: string;
  organizationId: string;
  kind: string;
  provider: string;
  name: string;
  status: "connected" | "disconnected" | "error" | "pending";
  config: Record<string, unknown>;
  secretRef: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  ts: string;
  userId: string | null;
  userLabel: string;
  action: string;
  entity: string;
  entityId: string | null;
  entityLabel: string | null;
  summary: string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
}

export interface Notification {
  id: string;
  organizationId: string;
  userId: string | null;
  alertId: string | null;
  title: string;
  body: string;
  severity: AlertSeverity;
  channel: string;
  isRead: boolean;
  createdAt: string;
}

export interface AlertNote {
  id: string;
  alertId: string;
  userId: string;
  body: string;
  createdAt: string;
}

export interface SystemSetting {
  id: string;
  organizationId: string;
  key: string;
  value: string;
  updatedAt: string;
}
