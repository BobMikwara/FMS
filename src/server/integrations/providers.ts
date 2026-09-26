import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedReading } from "../engine/fuel";

/**
 * Device Integration Layer (PRD §57).
 *
 * Every hardware vendor or telematics platform is represented by a `DeviceProvider`
 * that knows how to (a) authenticate an inbound payload and (b) translate a
 * vendor payload into the platform's `NormalizedReading` shape. Adding a new
 * probe or GPS provider is a matter of registering an adapter here — nothing
 * else in the application changes.
 */

export interface ProviderInfo {
  key: string;
  name: string;
  kind: "fuel_probe" | "gps";
  docsUrl: string;
  supports: {
    fuelVolume: boolean;
    fuelHeight: boolean;
    temperature: boolean;
    waterLevel: boolean;
    density: boolean;
    signal: boolean;
    battery: boolean;
    ignition: boolean;
    odometer: boolean;
  };
  authMethod: "hmac" | "api_key" | "basic";
  description: string;
}

export interface DeviceProvider extends ProviderInfo {
  /** Verifies the request signature. Returns true when the payload is trusted. */
  verify(request: Request, rawBody: string, secret: string): boolean;
  /** Translates a vendor payload into the normalized reading model. */
  normalize(payload: Record<string, unknown>): NormalizedReading | null;
}

function hmacEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return value == null ? null : String(value);
}

function firstNumber(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = num(payload[key]);
    if (value != null) return value;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Tectonic — reference fuel probe gateway                                    */
/* -------------------------------------------------------------------------- */

const tectonic: DeviceProvider = {
  key: "tectonic",
  name: "Tectonic Probe Gateway",
  kind: "fuel_probe",
  docsUrl: "https://docs.tectonic.example/webhooks",
  description:
    "HTTPS webhook gateway for Tectonic tank probes. Push or poll; readings are signed with HMAC-SHA256 over the raw body.",
  supports: {
    fuelVolume: true,
    fuelHeight: true,
    temperature: true,
    waterLevel: true,
    density: true,
    signal: true,
    battery: true,
    ignition: false,
    odometer: false,
  },
  authMethod: "hmac",
  verify(request, rawBody, secret) {
    const signature = request.headers.get("x-tectonic-signature");
    if (!signature) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return hmacEqual(signature.replace(/^sha256=/, ""), expected);
  },
  normalize(payload) {
    const volume = firstNumber(payload, ["volumeLiters", "volume_liters", "volume", "grossVolume"]);
    if (volume == null) return null;
    return {
      ts: str(payload.timestamp ?? payload.ts ?? payload.readingAt) ?? new Date().toISOString(),
      volumeLiters: volume,
      levelMm: firstNumber(payload, ["levelMm", "fuelHeightMm", "productLevelMm"]),
      levelPercent: firstNumber(payload, ["levelPercent", "percentFull", "fillPercent"]),
      temperatureC: firstNumber(payload, ["temperatureC", "temperature_c", "tempC"]),
      waterLevelMm: firstNumber(payload, ["waterLevelMm", "waterLevel"]),
      signal: firstNumber(payload, ["signal", "signalStrength", "rssi"]),
      batteryPct: firstNumber(payload, ["batteryPct", "battery", "batteryLevel"]),
      raw: payload,
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Veeder-Root TLS                                                             */
/* -------------------------------------------------------------------------- */

const veederRoot: DeviceProvider = {
  key: "veeder_root",
  name: "Veeder-Root TLS",
  kind: "fuel_probe",
  docsUrl: "https://docs.veeder.example/tls-api",
  description: "Veeder-Root TLS console API. Polled by the backend; authenticated with a console API key.",
  supports: {
    fuelVolume: true,
    fuelHeight: true,
    temperature: true,
    waterLevel: true,
    density: true,
    signal: false,
    battery: true,
    ignition: false,
    odometer: false,
  },
  authMethod: "api_key",
  verify(request, _rawBody, secret) {
    const key = request.headers.get("x-console-key") ?? request.headers.get("x-api-key");
    if (!key) return false;
    return hmacEqual(key, secret);
  },
  normalize(payload) {
    const tanks = (payload.tanks ?? payload.Tanks) as Record<string, unknown>[] | undefined;
    const tank = Array.isArray(tanks) ? tanks[0] : undefined;
    if (!tank) return null;
    const volume = firstNumber(tank as Record<string, unknown>, ["volume", "grossVolume", "volumeLiters"]);
    if (volume == null) return null;
    return {
      ts: str(tank.timestamp ?? payload.timestamp) ?? new Date().toISOString(),
      volumeLiters: volume,
      levelMm: firstNumber(tank as Record<string, unknown>, ["level", "fuelHeight", "productLevel"]),
      levelPercent: firstNumber(tank as Record<string, unknown>, ["percentFull", "levelPercent"]),
      temperatureC: firstNumber(tank as Record<string, unknown>, ["temperature", "tempC"]),
      waterLevelMm: firstNumber(tank as Record<string, unknown>, ["waterLevel", "waterVolume"]),
      signal: null,
      batteryPct: firstNumber(tank as Record<string, unknown>, ["batteryLevel"]),
      raw: payload,
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Generic MQTT bridge                                                        */
/* -------------------------------------------------------------------------- */

const genericMqtt: DeviceProvider = {
  key: "generic_mqtt",
  name: "Generic MQTT Bridge",
  kind: "fuel_probe",
  docsUrl: "https://docs.smartfuel.example/integrations/mqtt",
  description:
    "Bridges any MQTT-capable probe. Topics follow `smartfuel/readings/{deviceSerial}`; payloads use the normalized reading schema.",
  supports: {
    fuelVolume: true,
    fuelHeight: true,
    temperature: true,
    waterLevel: true,
    density: false,
    signal: true,
    battery: true,
    ignition: false,
    odometer: false,
  },
  authMethod: "api_key",
  verify(request, _rawBody, secret) {
    const key = request.headers.get("x-device-key");
    if (!key) return false;
    return hmacEqual(key, secret);
  },
  normalize(payload) {
    const volume = firstNumber(payload, ["volumeLiters", "volume_liters", "volume"]);
    if (volume == null) return null;
    return {
      ts: str(payload.ts ?? payload.timestamp) ?? new Date().toISOString(),
      volumeLiters: volume,
      levelMm: firstNumber(payload, ["levelMm", "level_mm"]),
      levelPercent: firstNumber(payload, ["levelPercent", "level_percent"]),
      temperatureC: firstNumber(payload, ["temperatureC", "temperature_c"]),
      waterLevelMm: firstNumber(payload, ["waterLevelMm", "water_level_mm"]),
      signal: firstNumber(payload, ["signal"]),
      batteryPct: firstNumber(payload, ["batteryPct", "battery_pct"]),
      raw: payload,
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Queclink GPS                                                               */
/* -------------------------------------------------------------------------- */

const queclink: DeviceProvider = {
  key: "queclink",
  name: "Queclink Fleet API",
  kind: "gps",
  docsUrl: "https://docs.queclink.example/openapi",
  description: "Queclink GV-series trackers. Position, ignition and odometer are reported on a 20-second cadence.",
  supports: {
    fuelVolume: false,
    fuelHeight: false,
    temperature: false,
    waterLevel: false,
    density: false,
    signal: true,
    battery: true,
    ignition: true,
    odometer: true,
  },
  authMethod: "api_key",
  verify(request, _rawBody, secret) {
    const key = request.headers.get("x-api-key");
    if (!key) return false;
    return hmacEqual(key, secret);
  },
  normalize(payload) {
    return {
      ts: str(payload.gpsUtcTime ?? payload.timestamp) ?? new Date().toISOString(),
      volumeLiters: null,
      signal: firstNumber(payload, ["gsmSignal", "signal"]),
      batteryPct: firstNumber(payload, ["batteryPower", "battery"]),
      raw: payload,
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Teltonika FMC                                                              */
/* -------------------------------------------------------------------------- */

const teltonika: DeviceProvider = {
  key: "teltonika",
  name: "Teltonika FMC",
  kind: "gps",
  docsUrl: "https://docs.teltonika.example/fmc",
  description: "Teltonika Fleet Management Communicator. Codec 8 payloads decoded by the bridge before normalization.",
  supports: {
    fuelVolume: false,
    fuelHeight: false,
    temperature: false,
    waterLevel: false,
    density: false,
    signal: true,
    battery: true,
    ignition: true,
    odometer: true,
  },
  authMethod: "api_key",
  verify(request, _rawBody, secret) {
    const key = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!key) return false;
    return hmacEqual(key, secret);
  },
  normalize(payload) {
    return {
      ts: str(payload.timestamp) ?? new Date().toISOString(),
      volumeLiters: null,
      signal: firstNumber(payload, ["rssi", "signal"]),
      batteryPct: firstNumber(payload, ["batteryLevel", "battery"]),
      raw: payload,
    };
  },
};

export const PROVIDERS: Record<string, DeviceProvider> = {
  tectonic,
  veeder_root: veederRoot,
  generic_mqtt: genericMqtt,
  queclink,
  teltonika,
};

export function getProvider(key: string): DeviceProvider | null {
  return PROVIDERS[key] ?? null;
}

export function listProviderInfo(): ProviderInfo[] {
  return Object.values(PROVIDERS).map(({ verify: _v, normalize: _n, ...info }) => info);
}

/**
 * Example payloads, surfaced in the Integrations screen so an engineer can see
 * exactly what each vendor sends and what the platform does with it.
 */
export const EXAMPLE_PAYLOADS: Record<string, string> = {
  tectonic: JSON.stringify(
    {
      deviceSerial: "PROBE-100407",
      timestamp: "2026-09-25T15:42:21.000Z",
      volumeLiters: 38420,
      levelMm: 1108,
      levelPercent: 76.8,
      temperatureC: 28.4,
      waterLevelMm: 0,
      signal: 4,
      batteryPct: 97,
    },
    null,
    2,
  ),
  veeder_root: JSON.stringify(
    {
      consoleId: "TLS-350-01",
      timestamp: "2026-09-25T15:42:21.000Z",
      tanks: [
        { tankNumber: 1, volume: 38420, level: 1108, percentFull: 76.8, temperature: 28.4, waterLevel: 0, batteryLevel: 96 },
      ],
    },
    null,
    2,
  ),
  generic_mqtt: JSON.stringify(
    {
      topic: "smartfuel/readings/PROBE-100407",
      ts: "2026-09-25T15:42:21.000Z",
      volume_liters: 38420,
      level_mm: 1108,
      level_percent: 76.8,
      temperature_c: 28.4,
      water_level_mm: 0,
      signal: 88,
      battery_pct: 97,
    },
    null,
    2,
  ),
  queclink: JSON.stringify(
    {
      imei: "864567039512345",
      gpsUtcTime: "2026-09-25T15:42:21.000Z",
      latitude: -3.3869,
      longitude: 36.683,
      speed: 42,
      ignition: true,
      odometer: 128400,
      gsmSignal: 24,
      batteryPower: 88,
    },
    null,
    2,
  ),
  teltonika: JSON.stringify(
    {
      imei: "352093083745234",
      timestamp: "2026-09-25T15:42:21.000Z",
      latitude: -3.3869,
      longitude: 36.683,
      speed: 42,
      ignition: 1,
      odometer: 128400,
      rssi: 21,
      batteryLevel: 91,
    },
    null,
    2,
  ),
};
