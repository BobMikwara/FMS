#!/usr/bin/env node
/**
 * SmartFuel — demo data generator.
 *
 * Produces a fully consistent dataset: readings are simulated first, then fuel
 * events are DERIVED from those readings using the same classification rules the
 * live engine uses, then alerts are derived from events + thresholds. This
 * guarantees the dashboard, charts and reports all agree with the underlying
 * series (PRD §37).
 *
 * Usage:  npm run db:seed (demo-only, requires an empty disposable SQLite database)
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import bcrypt from "bcryptjs";

const ROOT = resolve(process.cwd());
const databaseUrl = process.env.DATABASE_URL ?? "file:./db/smartfuel.db";
const usesPostgres = process.env.DB_PROVIDER === "postgresql" || /^postgres(?:ql)?:\/\//.test(databaseUrl);
if (usesPostgres) {
  throw new Error("The SQLite demo seeder cannot target PostgreSQL. Use the separately guarded PostgreSQL bootstrap script.");
}
const sqlitePath = databaseUrl.replace(/^file:/, "");
const DB_PATH = resolve(ROOT, sqlitePath || join("db", "smartfuel.db"));
const seedArgs = new Set(process.argv.slice(2));
if (seedArgs.has("--reset")) {
  throw new Error("The demo seeder never resets a database. Use a new disposable SQLite file instead.");
}
if (!seedArgs.has("--demo")) {
  throw new Error("Refusing to run the demo seeder without the explicit --demo flag.");
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

const rnd = (() => {
  let seed = 20260925;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
})();
const rand = (min, max) => min + rnd() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const round = (v, dp = 0) => Number(v.toFixed(dp));

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
let idCounter = 0;
function makeId(prefix) {
  idCounter += 1;
  const time = Date.now().toString(36).padStart(9, "0");
  const randPart = Array.from({ length: 8 }, () => CROCKFORD[Math.floor(rnd() * 32)]).join("");
  return `${prefix}_${time}${idCounter.toString(36)}${randPart}`;
}

const HOUR_WEIGHTS = (() => {
  const w = [
    0.18, 0.14, 0.14, 0.2, 0.38, 0.78, 1.45, 2.05, 1.95, 1.62, 1.5, 1.5, 1.5, 1.5, 1.52, 1.65, 1.95, 2.35, 2.45,
    2.05, 1.6, 1.1, 0.66, 0.32,
  ];
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
})();

const iso = (d) => new Date(d).toISOString();

/**
 * Demo device ingest keys. In production a key is generated once when a device is
 * registered, shown to the operator a single time, and stored only as a SHA-256
 * hash. The seeder derives the same hash from a deterministic demo key so the
 * documented ingest path can be exercised without hardware.
 */
const deviceApiKey = (serial) => `demo-${serial.toLowerCase()}`;
const hashDeviceKey = (key) => createHash("sha256").update(key).digest("hex");

/* -------------------------------------------------------------------------- */
/* schema                                                                     */
/* -------------------------------------------------------------------------- */

function ensureSchema(database) {
  database.exec(readFileSync(join(ROOT, "db", "schema.sqlite.sql"), "utf8"));
}

/* -------------------------------------------------------------------------- */
/* static reference data                                                      */
/* -------------------------------------------------------------------------- */

const PERMISSIONS = [
  "dashboard.view",
  "stations.view",
  "stations.create",
  "stations.edit",
  "stations.delete",
  "stations.archive",
  "tanks.view",
  "tanks.create",
  "tanks.edit",
  "tanks.delete",
  "devices.view",
  "devices.create",
  "devices.edit",
  "devices.delete",
  "devices.assign",
  "readings.view",
  "readings.export",
  "movements.view",
  "movements.export",
  "vehicles.view",
  "vehicles.create",
  "vehicles.edit",
  "vehicles.delete",
  "alerts.view",
  "alerts.acknowledge",
  "alerts.resolve",
  "alerts.assign",
  "alerts.notes",
  "alert_rules.view",
  "alert_rules.manage",
  "reports.view",
  "reports.create",
  "reports.export",
  "reports.schedule",
  "users.view",
  "users.create",
  "users.edit",
  "users.delete",
  "roles.view",
  "roles.manage",
  "organizations.manage",
  "integrations.view",
  "integrations.manage",
  "settings.view",
  "settings.manage",
  "audit.view",
  "fuel_types.manage",
  "map.view",
  "notifications.view",
];

const ROLES = [
  {
    key: "super_admin",
    name: "Super Admin",
    description: "Unrestricted access across every organization and system setting.",
    permissions: PERMISSIONS,
  },
  {
    key: "admin",
    name: "Administrator",
    description: "Manages stations, tanks, devices, users, reports and configuration for their organization.",
    permissions: PERMISSIONS.filter((p) => p !== "organizations.manage"),
  },
  {
    key: "manager",
    name: "Manager",
    description: "Views operational information, acknowledges alerts, generates and exports reports.",
    permissions: [
      "dashboard.view",
      "stations.view",
      "stations.edit",
      "tanks.view",
      "tanks.edit",
      "devices.view",
      "readings.view",
      "readings.export",
      "movements.view",
      "movements.export",
      "vehicles.view",
      "alerts.view",
      "alerts.acknowledge",
      "alerts.resolve",
      "alerts.assign",
      "alerts.notes",
      "alert_rules.view",
      "reports.view",
      "reports.create",
      "reports.export",
      "reports.schedule",
      "users.view",
      "integrations.view",
      "settings.view",
      "audit.view",
      "map.view",
      "notifications.view",
    ],
  },
  {
    key: "operator",
    name: "Operator",
    description: "Monitors stations and tanks, acknowledges alerts, records delivery notes.",
    permissions: [
      "dashboard.view",
      "stations.view",
      "tanks.view",
      "devices.view",
      "readings.view",
      "movements.view",
      "vehicles.view",
      "alerts.view",
      "alerts.acknowledge",
      "alerts.notes",
      "alert_rules.view",
      "reports.view",
      "map.view",
      "notifications.view",
    ],
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to dashboards, tanks and reports.",
    permissions: [
      "dashboard.view",
      "stations.view",
      "tanks.view",
      "devices.view",
      "readings.view",
      "movements.view",
      "vehicles.view",
      "alerts.view",
      "reports.view",
      "map.view",
      "notifications.view",
    ],
  },
];

const STATION_DEFS = [
  { name: "PUMA Arusha — Main Branch", code: "ARN-01", city: "Arusha", region: "Arusha", lat: -3.3869, lng: 36.683, size: 1.35, tanks: 4 },
  { name: "PUMA Njiro", code: "ARN-02", city: "Arusha", region: "Arusha", lat: -3.4012, lng: 36.7312, size: 1.0, tanks: 4 },
  { name: "PUMA Soko Kuu", code: "ARN-03", city: "Arusha", region: "Arusha", lat: -3.3697, lng: 36.6901, size: 0.85, tanks: 3 },
  { name: "PUMA Ngaramtoni", code: "ARN-04", city: "Arusha", region: "Arusha", lat: -3.3291, lng: 36.6443, size: 0.9, tanks: 3 },
  { name: "PUMA Usa River", code: "ARN-05", city: "Arusha", region: "Arusha", lat: -3.2718, lng: 36.8252, size: 1.05, tanks: 4 },
  { name: "PUMA Sakina", code: "ARN-06", city: "Arusha", region: "Arusha", lat: -3.3552, lng: 36.6547, size: 0.8, tanks: 2 },
  { name: "PUMA Moshi — Central", code: "MOS-01", city: "Moshi", region: "Kilimanjaro", lat: -3.3394, lng: 37.3403, size: 1.15, tanks: 4 },
  { name: "PUMA Moshi — Rau", code: "MOS-02", city: "Moshi", region: "Kilimanjaro", lat: -3.3004, lng: 37.3542, size: 0.75, tanks: 3 },
  { name: "PUMA Monduli", code: "MND-01", city: "Monduli", region: "Arusha", lat: -3.2978, lng: 36.4512, size: 0.6, tanks: 2 },
  { name: "PUMA Manyara", code: "MNY-01", city: "Babati", region: "Manyara", lat: -4.2167, lng: 35.75, size: 0.7, tanks: 3 },
  { name: "PUMA Tanga — Central", code: "TNG-01", city: "Tanga", region: "Tanga", lat: -5.0689, lng: 39.0964, size: 0.95, tanks: 3 },
  { name: "PUMA Morogoro — Bigwa", code: "MRG-01", city: "Morogoro", region: "Morogoro", lat: -6.8234, lng: 38.2789, size: 0.8, tanks: 3 },
];

const STATION_DEFS_ORG2 = [
  { name: "Total Energies Kariakoo", code: "TE-DSM-01", city: "Dar es Salaam", region: "Dar es Salaam", lat: -6.8163, lng: 39.2797, size: 1.25, tanks: 4 },
  { name: "Total Energies Mlimani", code: "TE-DSM-02", city: "Dar es Salaam", region: "Dar es Salaam", lat: -6.7671, lng: 39.2457, size: 1.0, tanks: 3 },
  { name: "Total Energies Mwanza", code: "TE-MWZ-01", city: "Mwanza", region: "Mwanza", lat: -2.5164, lng: 32.9175, size: 0.9, tanks: 3 },
];

const TANK_BLUEPRINTS = [
  { suffix: "A", fuel: "petrol", capacity: 50000, consumption: 6200, type: "underground", maker: "Talleres Mecanicos Cofely" },
  { suffix: "B", fuel: "petrol", capacity: 30000, consumption: 3900, type: "underground", maker: "Talleres Mecanicos Cofely" },
  { suffix: "A", fuel: "diesel", capacity: 40000, consumption: 5400, type: "underground", maker: "Società Italiana Serbatoi" },
  { suffix: "B", fuel: "diesel", capacity: 25000, consumption: 3100, type: "underground", maker: "Società Italiana Serbatoi" },
  { suffix: "A", fuel: "kerosene", capacity: 15000, consumption: 1200, type: "above_ground", maker: "Poly-Mart" },
];

const VEHICLE_DEFS = [
  { name: "Delivery Tanker 01", plate: "T412 ABC", type: "tanker", make: "Volvo", model: "FM 380", year: 2021, capacity: 32000 },
  { name: "Delivery Tanker 02", plate: "T847 DEF", type: "tanker", make: "Scania", model: "R450", year: 2022, capacity: 28000 },
  { name: "Bowser 03", plate: "T115 GHI", type: "tanker", make: "Mercedes-Benz", model: "Actros", year: 2020, capacity: 22000 },
  { name: "Supervisor Hilux", plate: "T902 JKL", type: "pickup", make: "Toyota", model: "Hilux", year: 2023, capacity: 80 },
  { name: "Maintenance Van", plate: "T233 MNO", type: "van", make: "Ford", model: "Transit", year: 2019, capacity: 70 },
  { name: "Delivery Tanker 04", plate: "T556 PQR", type: "tanker", make: "Volvo", model: "FM 420", year: 2021, capacity: 30000 },
  { name: "Inspection Pickup", plate: "T778 STU", type: "pickup", make: "Isuzu", model: "D-Max", year: 2022, capacity: 76 },
  { name: "Fuel Bowser 05", plate: "T064 VWX", type: "tanker", make: "MAN", model: "TGS", year: 2023, capacity: 26000 },
];

const INTEGRATION_DEFS = [
  { kind: "fuel_probe", provider: "tectonic", name: "Tectonic Probe Gateway", status: "connected", enabled: true, config: { endpoint: "https://api.tectonic.example/v1/readings", webhookPath: "/api/webhooks/device/tectonic", pollSeconds: 15, supportsWater: true, supportsTemperature: true, supportsDensity: true } },
  { kind: "fuel_probe", provider: "veeder_root", name: "Veeder-Root TLS", status: "pending", enabled: false, config: { endpoint: "", webhookPath: "/api/webhooks/device/veeder_root", pollSeconds: 30, supportsWater: true, supportsTemperature: true, supportsDensity: false } },
  { kind: "fuel_probe", provider: "generic_mqtt", name: "Generic MQTT Bridge", status: "disconnected", enabled: false, config: { broker: "mqtts://broker.example:8883", topicPrefix: "smartfuel/readings", qos: 1 } },
  { kind: "gps", provider: "queclink", name: "Queclink Fleet API", status: "connected", enabled: true, config: { endpoint: "https://api.queclink.example/v2", pollSeconds: 20, supportsIgnition: true, supportsOdometer: true } },
  { kind: "gps", provider: "teltonika", name: "Teltonika FMC", status: "connected", enabled: true, config: { endpoint: "https://fmc.teltonika.example/api", pollSeconds: 20, supportsIgnition: true, supportsOdometer: true } },
  { kind: "email", provider: "smtp", name: "Transactional email (SMTP)", status: "connected", enabled: true, config: { host: "smtp.mailgun.example", port: 587, from: "alerts@smartfuel.co.tz", secure: false } },
  { kind: "sms", provider: "africas_talking", name: "Africa's Talking SMS", status: "disconnected", enabled: false, config: { senderId: "SmartFuel", endpoint: "https://api.africastalking.com/version1/messaging" } },
  { kind: "whatsapp", provider: "meta_cloud", name: "WhatsApp Business Cloud API", status: "disconnected", enabled: false, config: { phoneNumberId: "", templateNamespace: "smartfuel_alerts" } },
];

/* -------------------------------------------------------------------------- */
/* main                                                                       */
/* -------------------------------------------------------------------------- */

function assertEmptyDatabase(database) {
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all();
  const populated = [];
  for (const { name } of tables) {
    const escaped = String(name).replaceAll('"', '""');
    const row = database.prepare(`SELECT count(*) AS n FROM "${escaped}"`).get();
    if (Number(row?.n ?? 0) > 0) populated.push(String(name));
  }
  if (populated.length > 0) {
    throw new Error(`Refusing to seed a non-empty SQLite database. Existing rows were found in: ${populated.join(", ")}. Use a new disposable database file.`);
  }
}

function main() {
  const database = new DatabaseSync(DB_PATH);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("BEGIN IMMEDIATE;");

  try {
    // Check before schema setup: a populated legacy file must remain untouched.
    // The lock and preflight share the transaction with schema creation and inserts,
    // so a concurrent writer cannot turn an empty-database check into a wipe.
    assertEmptyDatabase(database);
    ensureSchema(database);
    const insert = (sql, params) => database.prepare(sql).run(...params);
    const one = (sql, params = []) => database.prepare(sql).get(...params);

  /* ---- organizations ---- */
  const org1 = "org_puma_tz";
  const org2 = "org_total_tz";
  insert(
    `INSERT INTO organizations (id, name, slug, currency, units, temp_unit, timezone, locale, plan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [org1, "PUMA Tanzania", "puma-tanzania", "TZS", "liters", "celsius", "Africa/Dar_es_Salaam", "en", "enterprise"],
  );
  insert(
    `INSERT INTO organizations (id, name, slug, currency, units, temp_unit, timezone, locale, plan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [org2, "Total Energies Tanzania", "total-tanzania", "TZS", "liters", "celsius", "Africa/Dar_es_Salaam", "sw", "growth"],
  );

  /* ---- roles ---- */
  const roleIds = {};
  for (const role of ROLES) {
    const roleId = `role_${role.key}`;
    roleIds[role.key] = roleId;
    insert(
      `INSERT INTO roles (id, key, name, description, is_system, permissions) VALUES (?, ?, ?, ?, 1, ?)`,
      [roleId, role.key, role.name, role.description, JSON.stringify(role.permissions)],
    );
  }

  /* ---- users ---- */
  const passwordHash = bcrypt.hashSync("FuelWatch2026!", 10);
  const userDefs = [
    { org: org1, email: "george@puma.co.tz", name: "George Mushi", role: "super_admin", title: "Owner" },
    { org: org1, email: "sarah@puma.co.tz", name: "Sarah Kimaro", role: "admin", title: "Operations Administrator" },
    { org: org1, email: "daniel@puma.co.tz", name: "Daniel Mollel", role: "manager", title: "Regional Manager" },
    { org: org1, email: "asha@puma.co.tz", name: "Asha Laizer", role: "operator", title: "Station Supervisor" },
    { org: org1, email: "neema@puma.co.tz", name: "Neema Shirima", role: "viewer", title: "Finance Analyst" },
    { org: org1, email: "juma@puma.co.tz", name: "Juma Mwaipopo", role: "operator", title: "Night Shift Operator" },
    { org: org2, email: "admin@total.co.tz", name: "Fatma Said", role: "admin", title: "Platform Administrator" },
    { org: org2, email: "manager@total.co.tz", name: "Hassan Omar", role: "manager", title: "Network Manager" },
  ];
  const userIds = [];
  for (const def of userDefs) {
    const userId = `usr_${def.email.split("@")[0].replace(/[^a-z]/g, "")}`;
    userIds.push(userId);
    insert(
      `INSERT INTO users (id, organization_id, email, name, password_hash, role_id, status, phone, job_title, last_login_at, last_login_ip, mfa_enabled)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now', '-2 hours'), '197.250.44.18', ?)`,
      [
        userId,
        def.org,
        def.email,
        def.name,
        passwordHash,
        roleIds[def.role],
        `+255 7${randInt(10, 99)} ${randInt(100, 999)} ${randInt(100, 999)}`,
        def.title,
        def.role === "super_admin" ? 1 : 0,
      ],
    );
  }

  /* ---- fuel types ---- */
  const fuelTypeIds = {};
  for (const [org, prefix] of [[org1, "ft1"], [org2, "ft2"]]) {
    const defs = [
      { system: "petrol", display: "Unleaded Petrol 95", color: "#3b82f6", density: 0.745 },
      { system: "diesel", display: "Automotive Diesel 50ppm", color: "#10b981", density: 0.832 },
      { system: "kerosene", display: "Illuminating Kerosene", color: "#f59e0b", density: 0.79 },
    ];
    for (const def of defs) {
      const id = `${prefix}_${def.system}`;
      fuelTypeIds[`${org}:${def.system}`] = id;
      insert(
        `INSERT INTO fuel_types (id, organization_id, system_name, display_name, color, density) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, org, def.system, def.display, def.color, def.density],
      );
    }
  }

  /* ---- stations ---- */
  const stations = [];
  const tankDefs = [];
  const deviceDefs = [];

  function buildStation(org, def, index) {
    const stationId = `stn_${def.code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const status = def.code === "MRG-01" ? "offline" : "online";
    insert(
      `INSERT INTO stations (id, organization_id, name, code, address, city, region, country, phone, email,
         latitude, longitude, status, opening_time, closing_time, timezone, currency, volume_unit, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Tanzania', ?, ?, ?, ?, ?, '06:00', '23:00', 'Africa/Dar_es_Salaam', 'TZS', 'liters', ?)`,
      [
        stationId,
        org,
        def.name,
        def.code,
        `${randInt(1, 400)} ${def.city} Road, ${def.city}`,
        def.city,
        def.region,
        `+255 27 ${randInt(200, 299)} ${randInt(1000, 9999)}`,
        `${def.code.toLowerCase().replace(/[^a-z0-9]/g, "")}@puma.co.tz`,
        def.lat,
        def.lng,
        status,
        `${def.city} ${def.region} site. ${def.tanks} monitored tanks.`,
      ],
    );
    stations.push({ id: stationId, org, def, status });

    // Tanks: petrol A, petrol B, diesel A, diesel B, kerosene A (first N)
    const order = [0, 1, 2, 3, 4].slice(0, def.tanks);
    order.forEach((blueprintIndex, i) => {
      const bp = TANK_BLUEPRINTS[blueprintIndex];
      const tankId = `tnk_${def.code.toLowerCase().replace(/[^a-z0-9]/g, "")}_${bp.fuel[0]}${bp.suffix}`;
      const capacity = bp.capacity * (0.8 + def.size * 0.25);
      const daily = bp.consumption * def.size * rand(0.85, 1.15);
      const code = `${bp.fuel[0].toUpperCase()}${bp.suffix}`;
      tankDefs.push({
        id: tankId,
        org,
        stationId,
        fuelTypeId: fuelTypeIds[`${org}:${bp.fuel}`],
        name: `${bp.fuel === "petrol" ? "Petrol" : bp.fuel === "diesel" ? "Diesel" : "Kerosene"} Tank ${bp.suffix}`,
        code,
        capacity,
        daily,
        fuel: bp.fuel,
        tankType: bp.type,
        maker: bp.maker,
        installYear: randInt(2015, 2023),
        stationName: def.name,
        stationCode: def.code,
      });

      const deviceId = `dev_probe_${tankId.replace(/^tnk_/, "")}`;
      deviceDefs.push({
        id: deviceId,
        org,
        type: "fuel_probe",
        serial: `PROBE-${String(100000 + index * 37 + i * 911).slice(0, 6)}`,
        tankId,
        stationId,
        model: pick(["TLS-350R", "TLS-450PLUS", "Maglink LX4", "SiteSentinel Nano"]),
        firmware: `v${randInt(2, 5)}.${randInt(0, 9)}.${randInt(0, 9)}`,
      });
    });
  }

  STATION_DEFS.forEach((def, i) => buildStation(org1, def, i));
  STATION_DEFS_ORG2.forEach((def, i) => buildStation(org2, def, i + 20));

  /* ---- tanks ---- */
  for (const tank of tankDefs) {
    const lowPct = pick([15, 18, 20, 20, 22]);
    const criticalPct = pick([8, 10, 10, 12]);
    insert(
      `INSERT INTO tanks (id, organization_id, station_id, fuel_type_id, name, code, capacity, current_volume,
         tank_type, manufacturer, installation_date, min_level, low_threshold_pct, critical_threshold_pct,
         overfill_threshold_pct, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, 95, 'normal', ?)`,
      [
        tank.id,
        tank.org,
        tank.stationId,
        tank.fuelTypeId,
        tank.name,
        tank.code,
        round(tank.capacity),
        tank.tankType,
        tank.maker,
        `${tank.installYear}-${String(randInt(1, 12)).padStart(2, "0")}-15`,
        lowPct,
        criticalPct,
        tank.notes ?? null,
      ],
    );
  }

  /* ---- devices ---- */
  for (const dev of deviceDefs) {
    const isOffline =
      !!dev.tankId && dev.tankId.toLowerCase().endsWith("_da") && dev.stationId === "stn_mrg01";
    if (isOffline) {
      insert(
        `INSERT INTO devices (id, organization_id, type, serial_number, label, provider, model, firmware,
           station_id, tank_id, status, signal_strength, battery_pct, ip_address, api_key_hash, metadata, last_seen_at)
         VALUES (?, ?, 'fuel_probe', ?, ?, 'tectonic', ?, ?, ?, ?, 'offline', 0, 0, ?, ?, ?, ?)`,
        [
          dev.id,
          dev.org,
          dev.serial,
          `${dev.serial} probe`,
          dev.model,
          dev.firmware,
          dev.stationId,
          dev.tankId,
          `197.250.${randInt(1, 250)}.${randInt(1, 250)}`,
          hashDeviceKey(deviceApiKey(dev.serial)),
          JSON.stringify({ vendor: "tectonic", protocol: "https-webhook", note: "Communication lost — awaiting field visit" }),
          iso(Date.now() - 3 * 3_600_000),
        ],
      );
      continue;
    }
    insert(
      `INSERT INTO devices (id, organization_id, type, serial_number, label, provider, model, firmware,
         station_id, tank_id, status, signal_strength, battery_pct, ip_address, api_key_hash, metadata,
         last_seen_at, last_reading_at)
       VALUES (?, ?, 'fuel_probe', ?, ?, 'tectonic', ?, ?, ?, ?, 'online', ?, ?, ?, ?, ?, ?, ?)`,
      [
        dev.id,
        dev.org,
        dev.serial,
        `${dev.serial} probe`,
        dev.model,
        dev.firmware,
        dev.stationId,
        dev.tankId,
        randInt(55, 99),
        randInt(88, 100),
        `197.250.${randInt(1, 250)}.${randInt(1, 250)}`,
        hashDeviceKey(deviceApiKey(dev.serial)),
        JSON.stringify({ vendor: "tectonic", protocol: "https-webhook", calibrationDate: `2026-0${randInt(1, 9)}-12` }),
        iso(Date.now() - randInt(20, 240) * 1000),
        iso(Date.now() - randInt(20, 240) * 1000),
      ],
    );
  }

  // GPS devices on vehicles
  const vehicles = [];
  VEHICLE_DEFS.forEach((v, i) => {
    const vehicleId = `veh_${v.plate.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const station = stations[i % Math.min(6, stations.length)];
    insert(
      `INSERT INTO vehicles (id, organization_id, name, plate_number, type, make, model, year, fuel_type_id,
         tank_capacity, station_id, status, odometer_km, driver_name, driver_phone, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vehicleId,
        org1,
        v.name,
        v.plate,
        v.type,
        v.make,
        v.model,
        v.year,
        fuelTypeIds[`${org1}:diesel`],
        v.capacity,
        station.id,
        pick(["active", "active", "active", "maintenance"]),
        randInt(42000, 210000),
        pick(["Baraka Mwakalinga", "Zawadi Mtei", "Emmanuel Kessy", "Paskalina Lyimo", "Goodluck Mosha"]),
        `+255 7${randInt(10, 99)} ${randInt(100, 999)} ${randInt(100, 999)}`,
        null,
      ],
    );
    vehicles.push({ id: vehicleId, ...v, stationId: station.id });

    const gpsId = `dev_gps_${vehicleId.replace(/^veh_/, "")}`;
    insert(
      `INSERT INTO devices (id, organization_id, type, serial_number, label, provider, model, firmware,
         station_id, vehicle_id, status, signal_strength, battery_pct, api_key_hash, metadata,
         last_seen_at, last_reading_at)
       VALUES (?, ?, 'gps_tracker', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gpsId,
        org1,
        `GPS-${String(200000 + i * 417).slice(0, 6)}`,
        `${v.name} tracker`,
        pick(["queclink", "teltonika"]),
        pick(["GV355CEU", "FMB920", "GV350CEU", "FMC003"]),
        `v${randInt(1, 4)}.${randInt(0, 9)}.${randInt(0, 9)}`,
        station.id,
        vehicleId,
        "online",
        randInt(45, 98),
        randInt(60, 100),
        hashDeviceKey(deviceApiKey(`GPS-${String(200000 + i * 417).slice(0, 6)}`)),
        JSON.stringify({ ignition: rnd() > 0.35, lastLat: station.def.lat + rand(-0.02, 0.02), lastLng: station.def.lng + rand(-0.02, 0.02), speedKph: randInt(0, 90) }),
        iso(Date.now() - randInt(20, 240) * 1000),
        iso(Date.now() - randInt(20, 240) * 1000),
      ],
    );
  });

  /* ---- readings + derived events ---- */
  const DAYS = 30;
  const now = Date.now();
  const startOfHistory = now - DAYS * 86_400_000;

  const readingRows = [];
  const eventRows = [];
  const anomalyTankIds = new Set();

  for (const tank of tankDefs) {
    const capacity = round(tank.capacity);
    const lowPct = one("SELECT low_threshold_pct AS v FROM tanks WHERE id = ?", [tank.id]).v;
    const criticalPct = one("SELECT critical_threshold_pct AS v FROM tanks WHERE id = ?", [tank.id]).v;
    const station = one("SELECT opening_time AS o, closing_time AS c, code AS code FROM stations WHERE id = ?", [tank.stationId]);

    let volume = capacity * rand(0.45, 0.8);
    let pendingDeliveryAt = null;

    const forced = FORCED_STATE[tank.stationCode + ":" + tank.code];
    const isOfflineProbe = tank.stationCode === "MRG-01" && tank.code === "DA";

    const points = [];
    for (let t = startOfHistory; t <= now; t += 60 * 60 * 1000) {
      const date = new Date(t);
      const hour = date.getHours();
      const inHours = hour >= 6 && hour <= 23;

      // hourly consumption
      const hourly = (tank.daily / 24) * HOUR_WEIGHTS[hour] * 24 * 0.42 + rand(0, 12) * (inHours ? 1 : 0.05);
      const drop = Math.max(0, hourly);
      volume -= drop;

      // deliveries (only during operating hours)
      const pct = (volume / capacity) * 100;
      if (pendingDeliveryAt != null && t >= pendingDeliveryAt && inHours) {
        const added = capacity * rand(0.82, 0.96) - volume;
        if (added > 0) volume += added;
        pendingDeliveryAt = null;
      } else if (pct < rand(20, 27) && pendingDeliveryAt == null && inHours) {
        pendingDeliveryAt = t + randInt(2, 9) * 3_600_000;
      }
      volume = Math.min(capacity, Math.max(0, volume));

      points.push({ ts: t, volume, hour, temp: 25.5 + 4.5 * Math.sin(((hour - 9) / 24) * Math.PI * 2) + rand(-0.7, 0.7), water: rnd() > 0.97 ? rand(1, 8) : rand(0, 2.2) });
    }

    // Force demo states on specific tanks -------------------------------
    if (forced) {
      if (forced.mode === "critical") {
        for (const p of points) p.volume = Math.min(p.volume, capacity * 0.08);
      } else if (forced.mode === "low") {
        for (const p of points) p.volume = Math.min(p.volume, capacity * 0.17);
      }
    }

    // Inject a suspected-loss anomaly at 02:00 a few days ago on one tank
    const anomalyInjected = injectAnomaly(points, capacity);

    // Sub-sample: 5-minute resolution for the last 48 hours, hourly before.
    const series = [];
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const recent = p.ts > now - 48 * 3_600_000;
      const steps = recent ? 12 : 1;
      for (let s = 0; s < steps; s += 1) {
        const ts = recent ? p.ts + s * 5 * 60 * 1000 : p.ts;
        if (ts > now) continue;
        const jitter = s === 0 ? 0 : rand(-6, 6);
        series.push({
          ts,
          volume: Math.max(0, Math.min(capacity, p.volume + jitter - (recent && s > 0 ? (tank.daily / (24 * 12)) * HOUR_WEIGHTS[p.hour] * 24 * 0.42 * 0.9 : 0))),
          hour: new Date(ts).getHours(),
          temp: p.temp + rand(-0.4, 0.4),
          water: p.water,
        });
      }
    }

    const offlineFrom = isOfflineProbe ? now - 3 * 3_600_000 : null;

    const device = deviceDefs.find((d) => d.tankId === tank.id);
    let previousVolume = null;
    let previousTs = null;
    let run = null;

    const closeRun = () => {
      if (!run) return;
      if (Math.abs(run.drop) >= 5) {
        eventRows.push({
          ts: iso(run.endTs),
          tankId: tank.id,
          stationId: tank.stationId,
          deviceId: device.id,
          type: run.kind,
          volume: Math.abs(run.drop),
          levelBefore: run.startVolume,
          levelAfter: run.endVolume,
          durationSec: Math.max(60, Math.round((run.endTs - run.startTs) / 1000)),
          confidence: run.kind === "anomaly" ? "medium" : "high",
          status: run.kind === "anomaly" ? "suspected" : "confirmed",
          reason: run.reason ?? null,
        });
      }
      run = null;
    };

    for (const point of series) {
      if (offlineFrom && point.ts > offlineFrom) continue;
      const levelPercent = (point.volume / capacity) * 100;
      readingRows.push([
        makeId("rdg"),
        iso(point.ts),
        iso(point.ts),
        tank.org,
        tank.id,
        device.id,
        round(point.volume, 1),
        round(levelPercent, 2),
        null,
        round(point.temp, 1),
        round(point.water, 1),
        device.status === "online" ? randInt(55, 99) : null,
        randInt(85, 100),
        JSON.stringify({
          deviceSerial: device.serial,
          fuelHeightMm: round(point.volume / capacity * 1450, 1),
          temperatureC: round(point.temp, 1),
          waterLevelMm: round(point.water, 1),
          signal: randInt(3, 5),
        }),
      ]);

      // derive events
      if (previousVolume != null) {
        const delta = point.volume - previousVolume;
        const minutes = Math.max(0.5, (point.ts - previousTs) / 60000);
        const rate = Math.abs(delta) / minutes;
        const inHours = point.hour >= 6 && point.hour <= 23;
        const date = new Date(point.ts);

        if (delta >= 120) {
          closeRun();
          const suspicious = !inHours || rate > 900;
          eventRows.push({
            ts: iso(point.ts),
            tankId: tank.id,
            stationId: tank.stationId,
            deviceId: device.id,
            type: suspicious ? "anomaly" : "refill",
            volume: round(delta),
            levelBefore: round(previousVolume),
            levelAfter: round(point.volume),
            durationSec: Math.round(minutes * 60),
            confidence: suspicious ? "low" : "high",
            status: suspicious ? "suspected" : "confirmed",
            reason: suspicious ? (!inHours ? "Delivery recorded outside operating hours" : "Fill rate exceeds physical delivery capability") : null,
          });
          previousVolume = point.volume;
          previousTs = point.ts;
          continue;
        }

        if (delta < -5) {
          const anomalous = (!inHours && Math.abs(delta) >= 250) || rate > 420;
          if (anomalous) {
            closeRun();
            eventRows.push({
              ts: iso(point.ts),
              tankId: tank.id,
              stationId: tank.stationId,
              deviceId: device.id,
              type: "anomaly",
              volume: round(Math.abs(delta)),
              levelBefore: round(previousVolume),
              levelAfter: round(point.volume),
              durationSec: Math.round(minutes * 60),
              confidence: "medium",
              status: "suspected",
              reason: !inHours
                ? `Fuel dropped ${Math.round(Math.abs(delta))} L outside operating hours (${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")})`
                : `Sudden drop of ${Math.round(Math.abs(delta))} L in ${minutes.toFixed(1)} min`,
            });
            previousVolume = point.volume;
            previousTs = point.ts;
            continue;
          }
          if (!run) run = { drop: 0, startVolume: previousVolume, endVolume: point.volume, startTs: previousTs, endTs: point.ts, kind: "consumption" };
          run.drop += delta;
          run.endVolume = point.volume;
          run.endTs = point.ts;
        } else if (run) {
          closeRun();
        }
      }
      previousVolume = point.volume;
      previousTs = point.ts;
    }
    closeRun();

    // final tank state
    const last = series[series.length - 1] ?? { volume: 0, temp: 25, water: 0 };
    const lastTs = offlineFrom ?? now;
    const finalPercent = (last.volume / capacity) * 100;
    const finalStatus = offlineFrom
      ? "offline"
      : finalPercent >= 95
        ? "full"
        : finalPercent < criticalPct
          ? "critical"
          : finalPercent < lowPct
            ? "low"
            : "normal";

    insert(
      `UPDATE tanks SET current_volume = ?, current_temp_c = ?, water_level_mm = ?, last_reading_at = ?,
         last_valid_reading_at = ?, status = ? WHERE id = ?`,
      [round(last.volume), round(last.temp, 1), round(last.water, 1), iso(lastTs), iso(lastTs), finalStatus, tank.id],
    );
  }

  // Insert readings in chunks
  const chunkSize = 800;
  const readingStmt = database.prepare(
    `INSERT INTO readings (id, ts, created_at, organization_id, tank_id, device_id, volume_liters, level_percent,
       level_mm, temperature_c, water_level_mm, signal, battery_pct, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < readingRows.length; i += chunkSize) {
    const chunk = readingRows.slice(i, i + chunkSize);
    for (const row of chunk) readingStmt.run(...row);
  }

  // Insert events in chunks
  const eventStmt = database.prepare(
    `INSERT INTO fuel_events (id, ts, organization_id, station_id, tank_id, device_id, type, volume,
       level_before, level_after, duration_sec, confidence, status, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const ev of eventRows) {
    eventStmt.run(
      makeId("evt"),
      ev.ts,
      tankDefs.find((t) => t.id === ev.tankId).org,
      ev.stationId,
      ev.tankId,
      ev.deviceId,
      ev.type,
      ev.volume,
      ev.levelBefore,
      ev.levelAfter,
      ev.durationSec,
      ev.confidence,
      ev.status,
      ev.reason,
    );
  }

  /* ---- alert rules ---- */
  const ruleDefs = [
    { name: "Low fuel level", type: "low_fuel", severity: "warning", condition: { metric: "level_percent", operator: "<", value: 20 }, desc: "Raises a warning when a tank falls below its low threshold." },
    { name: "Critical fuel level", type: "critical_fuel", severity: "critical", condition: { metric: "level_percent", operator: "<", value: 10 }, desc: "Raises a critical alert when a tank falls below its critical threshold." },
    { name: "Overfill risk", type: "overfill", severity: "critical", condition: { metric: "level_percent", operator: ">", value: 95 }, desc: "Warns when a tank approaches its overfill threshold." },
    { name: "Suspected fuel loss", type: "suspected_loss", severity: "critical", condition: { metric: "drop_rate", operator: ">", value: 250, windowMinutes: 10 }, desc: "Flags sudden, unexplained decreases in tank volume." },
    { name: "Refill detected", type: "refill", severity: "info", condition: { metric: "delta_volume", operator: ">", value: 120 }, desc: "Records an information alert for every confirmed delivery." },
    { name: "Probe offline", type: "probe_offline", severity: "warning", condition: { metric: "minutes_since_reading", operator: ">", value: 10 }, desc: "Alerts when a probe stops communicating." },
    { name: "GPS device offline", type: "gps_offline", severity: "warning", condition: { metric: "minutes_since_ping", operator: ">", value: 20 }, desc: "Alerts when a GPS tracker stops reporting." },
    { name: "Water detected", type: "water_detected", severity: "warning", condition: { metric: "water_level_mm", operator: ">", value: 25 }, desc: "Warns when the probe detects water in the tank." },
    { name: "Temperature abnormality", type: "temperature_abnormal", severity: "warning", condition: { metric: "temperature_c", operator: "outside", value: [-5, 45] }, desc: "Warns when reported temperature is outside the expected range." },
    { name: "Invalid reading", type: "invalid_reading", severity: "warning", condition: { metric: "validation", operator: "fails" }, desc: "Flags readings that fail sanity validation." },
  ];
  const ruleIds = {};
  for (const rule of ruleDefs) {
    const ruleId = `rul_${rule.type}`;
    ruleIds[rule.type] = ruleId;
    insert(
      `INSERT INTO alert_rules (id, organization_id, name, description, type, scope, condition, severity, channels, is_enabled, cooldown_min)
       VALUES (?, ?, ?, ?, ?, 'tank', ?, ?, '["in_app","email"]', 1, 30)`,
      [ruleId, org1, rule.name, rule.desc, rule.type, JSON.stringify(rule.condition), rule.severity],
    );
    insert(
      `INSERT INTO alert_rules (id, organization_id, name, description, type, scope, condition, severity, channels, is_enabled, cooldown_min)
       VALUES (?, ?, ?, ?, ?, 'tank', ?, ?, '["in_app"]', 1, 30)`,
      [`rul_${rule.type}_o2`, org2, rule.name, rule.desc, rule.type, JSON.stringify(rule.condition), rule.severity],
    );
  }

  /* ---- alerts (derived from state) ---- */
  const alerts = [];
  const tankRows = database.prepare("SELECT * FROM tanks ORDER BY name").all();
  const stationById = new Map(database.prepare("SELECT * FROM stations").all().map((s) => [s.id, s]));

  const alertDefs = [];
  for (const tank of tankRows) {
    const station = stationById.get(tank.station_id);
    const percent = tank.capacity > 0 ? (tank.current_volume / tank.capacity) * 100 : 0;
    const base = {
      organizationId: tank.organization_id,
      stationId: tank.station_id,
      tankId: tank.id,
      value: round(tank.current_volume),
      unit: "L",
    };
    if (tank.status === "critical") {
      alertDefs.push({
        ...base,
        type: "critical_fuel",
        severity: "critical",
        title: `${tank.name} critically low`,
        message: `Fuel level is below ${tank.critical_threshold_pct}%. Current level: ${Math.round(tank.current_volume).toLocaleString()} L (${percent.toFixed(1)}%).`,
        threshold: tank.critical_threshold_pct,
        ageMinutes: randInt(20, 300),
        status: "active",
      });
    } else if (tank.status === "low") {
      alertDefs.push({
        ...base,
        type: "low_fuel",
        severity: "warning",
        title: `${tank.name} low fuel`,
        message: `Fuel level has dropped below ${tank.low_threshold_pct}%. Current level: ${Math.round(tank.current_volume).toLocaleString()} L (${percent.toFixed(1)}%).`,
        threshold: tank.low_threshold_pct,
        ageMinutes: randInt(40, 900),
        status: pick(["active", "acknowledged", "active"]),
      });
    }
    if (tank.status === "offline") {
      alertDefs.push({
        organizationId: tank.organization_id,
        stationId: tank.station_id,
        tankId: tank.id,
        type: "probe_offline",
        severity: "warning",
        title: `Probe offline — ${station?.code ?? ""}`,
        message: `No data received for 3 hours from ${tank.name}. The last valid reading is preserved and displayed with a stale timestamp.`,
        value: 180,
        unit: "min",
        threshold: 10,
        ageMinutes: 180,
        status: "active",
      });
    }
  }

  // Historical resolved alerts derived from anomalous events
  const suspiciousEvents = database
    .prepare("SELECT * FROM fuel_events WHERE type = 'anomaly' AND status = 'suspected' ORDER BY ts DESC LIMIT 6")
    .all();
  for (const ev of suspiciousEvents) {
    const tank = tankRows.find((t) => t.id === ev.tank_id);
    if (!tank) continue;
    alertDefs.push({
      organizationId: tank.organization_id,
      stationId: tank.station_id,
      tankId: tank.id,
      fuelEventId: ev.id,
      type: ev.level_before > ev.level_after ? "suspected_loss" : "unexpected_refuel",
      severity: "critical",
      title:
        ev.level_before > ev.level_after
          ? `Suspected fuel loss — ${tank.name}`
          : `Unexpected refueling — ${tank.name}`,
      message:
        ev.level_before > ev.level_after
          ? `${Math.abs(ev.volume).toLocaleString()} L left ${tank.name} without a matching consumption or delivery record.`
          : `${Math.abs(ev.volume).toLocaleString()} L entered ${tank.name} without a scheduled delivery.`,
      value: Math.abs(ev.volume),
      unit: "L",
      ageMinutes: randInt(600, 4000),
      status: pick(["resolved", "resolved", "acknowledged"]),
    });
  }

  // A couple of refill information alerts
  const refillEvents = database
    .prepare("SELECT * FROM fuel_events WHERE type = 'refill' ORDER BY ts DESC LIMIT 4")
    .all();
  for (const ev of refillEvents) {
    const tank = tankRows.find((t) => t.id === ev.tank_id);
    if (!tank) continue;
    alertDefs.push({
      organizationId: tank.organization_id,
      stationId: tank.station_id,
      tankId: tank.id,
      fuelEventId: ev.id,
      type: "refill",
      severity: "info",
      title: `Refill detected — ${tank.name}`,
      message: `+${Math.round(ev.volume).toLocaleString()} L received. Tank moved from ${Math.round(ev.level_before).toLocaleString()} L to ${Math.round(ev.level_after).toLocaleString()} L.`,
      value: ev.volume,
      unit: "L",
      ageMinutes: randInt(30, 2000),
      status: pick(["resolved", "active"]),
    });
  }

  const userByOrg = {
    [org1]: ["usr_george", "usr_sarah", "usr_daniel", "usr_asha"],
    [org2]: ["usr_admin", "usr_manager"],
  };
  let notificationRows = 0;
  for (const def of alertDefs) {
    const alertId = makeId("alr");
    const createdAt = new Date(Date.now() - def.ageMinutes * 60_000).toISOString();
    const status = def.status ?? "active";
    const ackUser = status !== "active" ? pick(userByOrg[def.organizationId]) : null;
    insert(
      `INSERT INTO alerts (id, organization_id, station_id, tank_id, fuel_event_id, rule_id, type, severity,
         title, message, value, unit, threshold, status, metadata, created_at, updated_at,
         acknowledged_at, acknowledged_by_id, resolved_at, resolved_by_id, resolution_note, assigned_to_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        alertId,
        def.organizationId,
        def.stationId,
        def.tankId ?? null,
        def.fuelEventId ?? null,
        ruleIds[def.type] ?? null,
        def.type,
        def.severity,
        def.title,
        def.message,
        def.value ?? null,
        def.unit ?? null,
        def.threshold ?? null,
        status,
        JSON.stringify({ seeded: true, levelPercent: def.threshold ? null : null }),
        createdAt,
        createdAt,
        status !== "active" ? createdAt : null,
        ackUser,
        status === "resolved" ? createdAt : null,
        status === "resolved" ? ackUser : null,
        status === "resolved" ? pick(["Level restored after scheduled delivery", "Verified with station log — no loss confirmed", "False positive: delivery in progress"]) : null,
        status === "active" && def.severity === "critical" ? pick(userByOrg[def.organizationId]) : null,
      ],
    );
    if (status === "active" && notificationRows < 14) {
      insert(
        `INSERT INTO notifications (id, organization_id, alert_id, title, body, severity, channel, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'in_app', ?, ?)`,
        [makeId("ntf"), def.organizationId, alertId, def.title, def.message, def.severity, rnd() > 0.4 ? 0 : 1, createdAt],
      );
      notificationRows += 1;
    }
  }

  // Notes on a few alerts
  const noteTargets = database
    .prepare("SELECT id FROM alerts WHERE status != 'active' ORDER BY created_at DESC LIMIT 5")
    .all();
  for (const row of noteTargets) {
    insert(
      `INSERT INTO alert_notes (id, alert_id, user_id, body, created_at) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now', '-25 minutes'))`,
      [makeId("anote"), row.id, "usr_asha", "Confirmed with the station attendant — delivery truck is on site."],
    );
  }

  /* ---- station statuses ---- */
  for (const station of stations) {
    const tanksHere = tankRows.filter((t) => t.station_id === station.id);
    const worst = tanksHere.some((t) => t.status === "offline")
      ? "offline"
      : tanksHere.some((t) => t.status === "critical")
        ? "critical"
        : tanksHere.some((t) => t.status === "low")
          ? "warning"
          : "online";
    if (station.status === "offline") continue;
    insert("UPDATE stations SET status = ? WHERE id = ?", [worst, station.id]);
  }

  /* ---- reports ---- */
  const reportDefs = [
    { title: "Daily Fuel Report — 24 Sept 2026", category: "fuel", period: "daily", daysAgo: 1 },
    { title: "Weekly Consumption Report", category: "consumption", period: "weekly", daysAgo: 7 },
    { title: "Monthly Network Fuel Report", category: "fuel", period: "monthly", daysAgo: 30 },
    { title: "Station Performance — Arusha Cluster", category: "station", period: "custom", daysAgo: 14 },
    { title: "Tank Reconciliation Report", category: "tank", period: "weekly", daysAgo: 7 },
  ];
  for (const def of reportDefs) {
    const dateTo = new Date(Date.now() - def.daysAgo * 86_400_000);
    const dateFrom = new Date(dateTo.getTime() - (def.period === "daily" ? 1 : def.period === "weekly" ? 7 : 30) * 86_400_000);
    insert(
      `INSERT INTO reports (id, organization_id, created_by_id, title, category, period, date_from, date_to,
         filters, status, progress, format, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 100, ?, ?, ?)`,
      [
        makeId("rpt"),
        org1,
        "usr_sarah",
        def.title,
        def.category,
        def.period,
        iso(dateFrom),
        iso(dateTo),
        JSON.stringify({ organizationId: org1 }),
        def.category === "fuel" ? "pdf" : "excel",
        JSON.stringify({ generatedBy: "Sarah Kimaro", seeded: true }),
        iso(new Date(Date.now() - def.daysAgo * 86_400_000 + 3_600_000)),
      ],
    );
  }

  /* ---- scheduled reports ---- */
  insert(
    `INSERT INTO scheduled_reports (id, organization_id, name, category, period, time_of_day, timezone, recipients, format, filters, is_enabled, next_run_at)
     VALUES (?, ?, 'Daily Fuel Report — All Stations', 'fuel', 'daily', '18:00', 'Africa/Dar_es_Salaam', '["manager@puma.co.tz","finance@puma.co.tz"]', 'pdf', '{"organizationId":"org_puma_tz"}', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now', '+1 day'))`,
    [makeId("sch"), org1],
  );
  insert(
    `INSERT INTO scheduled_reports (id, organization_id, name, category, period, day_of_week, time_of_day, timezone, recipients, format, filters, is_enabled, next_run_at)
     VALUES (?, ?, 'Weekly Consumption Digest', 'consumption', 'weekly', 1, '07:00', 'Africa/Dar_es_Salaam', '["daniel@puma.co.tz"]', 'excel', '{"organizationId":"org_puma_tz"}', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now', '+4 days'))`,
    [makeId("sch"), org1],
  );
  insert(
    `INSERT INTO scheduled_reports (id, organization_id, name, category, period, day_of_month, time_of_day, timezone, recipients, format, filters, is_enabled, next_run_at)
     VALUES (?, ?, 'Monthly Network Summary', 'station', 'monthly', 1, '06:30', 'Africa/Dar_es_Salaam', '["george@puma.co.tz"]', 'pdf', '{"organizationId":"org_puma_tz"}', 0, NULL)`,
    [makeId("sch"), org1],
  );

  /* ---- integrations ---- */
  for (const def of INTEGRATION_DEFS) {
    insert(
      `INSERT INTO integrations (id, organization_id, kind, provider, name, status, config, secret_ref, is_enabled, last_sync_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        makeId("int"),
        org1,
        def.kind,
        def.provider,
        def.name,
        def.status,
        JSON.stringify(def.config),
        def.status === "connected" ? `vault://smartfuel/${def.kind}/${def.provider}` : null,
        def.enabled ? 1 : 0,
        def.status === "connected" ? iso(now - randInt(20, 600) * 1000) : null,
      ],
    );
  }

  /* ---- settings ---- */
  const settings = {
    engine: {
      refillThresholdLiters: 120,
      consumptionMinLiters: 5,
      rapidChangeLitersPerMin: 250,
      deviceOfflineMinutes: 10,
      deviceDelayedSeconds: 90,
      temperatureMinC: -5,
      temperatureMaxC: 45,
      waterAlarmMm: 25,
      reconciliationVariancePct: 0.5,
    },
    notifications: { inApp: true, email: true, sms: false, whatsapp: false, dailySummary: true, dailySummaryTime: "18:00" },
    dashboard: { layout: "grid", showMap: true, kpiCards: ["stations", "fuelAvailable", "consumption", "refills", "alerts", "offlineDevices"] },
    reporting: { logo: true, includeCharts: true, footer: "SmartFuel — automated fuel intelligence" },
    retentionDays: 730,
  };
  for (const [key, value] of Object.entries(settings)) {
    insert(
      `INSERT INTO system_settings (id, organization_id, key, value) VALUES (?, ?, ?, ?)`,
      [makeId("set"), org1, key, JSON.stringify(value)],
    );
  }
  insert(
    `INSERT INTO system_settings (id, organization_id, key, value) VALUES (?, ?, 'dashboard', ?)`,
    [makeId("set"), org2, JSON.stringify({ layout: "grid", showMap: false, kpiCards: ["stations", "fuelAvailable", "alerts"] })],
  );

  /* ---- user station access (operators limited to a subset) ---- */
  const opStations = stations.slice(0, 3).map((s) => s.id);
  for (const stationId of opStations) {
    insert("INSERT OR IGNORE INTO user_stations (user_id, station_id) VALUES (?, ?)", ["usr_asha", stationId]);
    insert("INSERT OR IGNORE INTO user_stations (user_id, station_id) VALUES (?, ?)", ["usr_juma", stationId]);
  }

  /* ---- audit log ---- */
  const auditDefs = [
    { user: "usr_george", label: "George Mushi", action: "login", entity: "session", summary: "George Mushi signed in", minutesAgo: 122 },
    { user: "usr_sarah", label: "Sarah Kimaro", action: "created", entity: "station", entityLabel: "PUMA Sakina", summary: "Sarah Kimaro created station PUMA Sakina", minutesAgo: 2880 },
    { user: "usr_sarah", label: "Sarah Kimaro", action: "created", entity: "tank", entityLabel: "Kerosene Tank A — PUMA Sakina", summary: "Sarah Kimaro created Kerosene Tank A at PUMA Sakina", minutesAgo: 2870 },
    { user: "usr_daniel", label: "Daniel Mollel", action: "updated", entity: "tank", entityLabel: "Petrol Tank A — PUMA Arusha Main Branch", summary: "Daniel Mollel changed the low-fuel threshold from 25% to 20%", minutesAgo: 1450, previous: { lowThresholdPct: 25 }, next: { lowThresholdPct: 20 } },
    { user: "usr_asha", label: "Asha Laizer", action: "acknowledged", entity: "alert", entityLabel: "Low fuel — Petrol Tank B", summary: "Asha Laizer acknowledged the low fuel alert on Petrol Tank B", minutesAgo: 210 },
    { user: "usr_sarah", label: "Sarah Kimaro", action: "assigned", entity: "device", entityLabel: "PROBE-100911", summary: "Sarah Kimaro assigned probe PROBE-100911 to Petrol Tank A at PUMA Arusha Main Branch", minutesAgo: 4300 },
    { user: "usr_daniel", label: "Daniel Mollel", action: "export", entity: "report", entityLabel: "Weekly Consumption Report", summary: "Daniel Mollel exported the Weekly Consumption Report (Excel)", minutesAgo: 640 },
    { user: "usr_george", label: "George Mushi", action: "created", entity: "user", entityLabel: "Neema Shirima", summary: "George Mushi created user Neema Shirima with role Viewer", minutesAgo: 8600 },
    { user: "usr_sarah", label: "Sarah Kimaro", action: "connected", entity: "integration", entityLabel: "Tectonic Probe Gateway", summary: "Sarah Kimaro connected the Tectonic Probe Gateway integration", minutesAgo: 15000 },
    { user: "usr_daniel", label: "Daniel Mollel", action: "updated", entity: "setting", entityLabel: "Operating hours", summary: "Daniel Mollel updated operating hours for PUMA Arusha Main Branch", minutesAgo: 3300, previous: { closingTime: "22:00" }, next: { closingTime: "23:00" } },
    { user: "usr_asha", label: "Asha Laizer", action: "resolved", entity: "alert", entityLabel: "Suspected fuel loss — Diesel Tank A", summary: "Asha Laizer resolved a suspected fuel loss alert (verified delivery)", minutesAgo: 520 },
    { user: "usr_sarah", label: "Sarah Kimaro", action: "archived", entity: "station", entityLabel: "PUMA Mwanakwerekwe", summary: "Sarah Kimaro archived station PUMA Mwanakwerekwe", minutesAgo: 22000 },
    { user: "usr_george", label: "George Mushi", action: "updated", entity: "role", entityLabel: "Operator", summary: "George Mushi updated permissions for the Operator role", minutesAgo: 40000, previous: { permissions: 11 }, next: { permissions: 13 } },
    { user: "usr_juma", label: "Juma Mwaipopo", action: "login", entity: "session", summary: "Juma Mwaipopo signed in", minutesAgo: 46 },
  ];
  for (const def of auditDefs) {
    insert(
      `INSERT INTO audit_logs (id, ts, user_id, user_label, action, entity, entity_label, summary, previous, next, ip, user_agent)
       VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now', ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        makeId("aud"),
        `-${def.minutesAgo} minutes`,
        def.user,
        def.label,
        def.action,
        def.entity,
        def.entityLabel ?? null,
        def.summary,
        def.previous ? JSON.stringify(def.previous) : null,
        def.next ? JSON.stringify(def.next) : null,
        "197.250.44.18",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      ],
    );
  }

  /* ---- summary ---- */
  const counts = {
    organizations: one("SELECT count(*) AS n FROM organizations").n,
    users: one("SELECT count(*) AS n FROM users").n,
    stations: one("SELECT count(*) AS n FROM stations").n,
    tanks: one("SELECT count(*) AS n FROM tanks").n,
    devices: one("SELECT count(*) AS n FROM devices").n,
    vehicles: one("SELECT count(*) AS n FROM vehicles").n,
    readings: one("SELECT count(*) AS n FROM readings").n,
    events: one("SELECT count(*) AS n FROM fuel_events").n,
    alerts: one("SELECT count(*) AS n FROM alerts").n,
    rules: one("SELECT count(*) AS n FROM alert_rules").n,
    auditLogs: one("SELECT count(*) AS n FROM audit_logs").n,
  };
    database.exec("COMMIT");
    process.stdout.write(`SmartFuel demo data ready: ${JSON.stringify(counts)}\n`);
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The transaction may already have rolled back.
    }
    throw error;
  } finally {
    database.close();
  }
}

/* -------------------------------------------------------------------------- */
/* forced demo states                                                         */
/* -------------------------------------------------------------------------- */

const FORCED_STATE = {
  "ARN-01:PB": { mode: "critical" },
  "ARN-02:PA": { mode: "low" },
  "ARN-03:DA": { mode: "critical" },
  "MOS-01:PB": { mode: "low" },
  "TNG-01:PA": { mode: "low" },
  "MNY-01:DA": { mode: "low" },
};

/** Injects a single large unexplained drop so the suspected-loss story exists. */
function injectAnomaly(points, capacity) {
  const target = points.find((p) => {
    const d = new Date(p.ts);
    return d.getHours() === 2 && d.getDate() % 7 === 3;
  });
  if (!target) return false;
  const idx = points.indexOf(target);
  const drop = capacity * rand(0.015, 0.03);
  for (let i = idx; i < points.length; i += 1) {
    points[i].volume = Math.max(0, points[i].volume - drop);
  }
  return true;
}

main();
