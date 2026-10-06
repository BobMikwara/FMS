import { createHash } from "node:crypto";
import type { NormalizedVehiclePosition } from "../domain/types";

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;

function sources(payload: Record<string, unknown>): Record<string, unknown>[] {
  const result = [payload];
  for (const key of ["position", "gps", "location", "data"]) {
    const nested = payload[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      result.push(nested as Record<string, unknown>);
    }
  }
  return result;
}

function firstValue(sourceList: Record<string, unknown>[], keys: string[]): unknown {
  for (const source of sourceList) {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
    }
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNumber(sourceList: Record<string, unknown>[], keys: string[]): number | null {
  return finiteNumber(firstValue(sourceList, keys));
}

function normalizedTimestamp(sourceList: Record<string, unknown>[]): string | null {
  const value = firstValue(sourceList, [
    "timestamp",
    "ts",
    "gpsUtcTime",
    "gps_utc_time",
    "recordTime",
    "fixTime",
    "datetime",
  ]);
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!TIMESTAMP_PATTERN.test(text)) return null;
  const instant = Date.parse(text);
  if (!Number.isFinite(instant)) return null;
  const calendarDate = text.slice(0, 10);
  if (new Date(`${calendarDate}T00:00:00Z`).toISOString().slice(0, 10) !== calendarDate) return null;
  if (instant < Date.UTC(2000, 0, 1)) return null;
  if (instant > Date.now() + 5 * 60_000) return null;
  return new Date(instant).toISOString();
}

function normalizedIgnition(sourceList: Record<string, unknown>[]): boolean | null {
  const value = firstValue(sourceList, ["ignition", "ignitionOn", "ignition_on", "engineOn", "engine_on"]);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === "string") {
    switch (value.trim().toLowerCase()) {
      case "1":
      case "true":
      case "on":
      case "yes":
        return true;
      case "0":
      case "false":
      case "off":
      case "no":
        return false;
      default:
        return null;
    }
  }
  return null;
}

function bounded(value: number | null, min: number, max: number): number | null {
  return value !== null && value >= min && value <= max ? value : null;
}

function eventIdentifier(sourceList: Record<string, unknown>[]): string | null {
  const value = firstValue(sourceList, ["eventId", "event_id", "messageId", "message_id", "recordId", "record_id"]);
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length <= 180 ? `provider:${text}` : `provider:${createHash("sha256").update(text).digest("hex")}`;
}

/**
 * Normalize the documented flat Queclink/Teltonika webhook fields (and common
 * nested position objects) into a GPS-only model. No fuel-volume fallback is
 * provided: coordinates are never sent through the tank-reading engine.
 */
export function normalizeGpsPosition(payload: Record<string, unknown>): NormalizedVehiclePosition | null {
  const sourceList = sources(payload);
  const ts = normalizedTimestamp(sourceList);
  const latitude = optionalNumber(sourceList, ["latitude", "lat"]);
  const longitude = optionalNumber(sourceList, ["longitude", "lon", "lng"]);
  if (
    !ts ||
    latitude === null || longitude === null ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  ) return null;

  const speedKphDirect = optionalNumber(sourceList, ["speedKph", "speed_kph", "speedKmh", "speed_kmh", "speed"]);
  const speedMph = optionalNumber(sourceList, ["speedMph", "speed_mph"]);
  const speedKph = speedMph !== null ? speedMph * 1.609344 : speedKphDirect;
  const headingValue = optionalNumber(sourceList, ["headingDeg", "heading_deg", "heading", "courseDeg", "course"]);
  const headingDeg = headingValue === 360 ? 0 : bounded(headingValue, 0, 359.999999);
  const odometerMeters = optionalNumber(sourceList, ["odometerMeters", "odometer_m", "distanceMeters"]);
  const odometerDirect = optionalNumber(sourceList, ["odometerKm", "odometer_km", "odometer", "mileageKm"]);
  const odometerKm = bounded(odometerMeters !== null ? odometerMeters / 1000 : odometerDirect, 0, 100_000_000);
  const signal = bounded(optionalNumber(sourceList, ["gsmSignal", "signal", "signalStrength", "rssi"]), -200, 100);
  const batteryPct = bounded(optionalNumber(sourceList, ["batteryPct", "battery_pct", "batteryPower", "batteryLevel"]), 0, 100);

  return {
    ts,
    latitude,
    longitude,
    speedKph: bounded(speedKph, 0, 500),
    headingDeg,
    ignition: normalizedIgnition(sourceList),
    odometerKm,
    eventKey: eventIdentifier(sourceList),
    signal,
    batteryPct,
  };
}
