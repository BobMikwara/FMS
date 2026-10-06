#!/usr/bin/env node
/**
 * Safely bootstraps one PostgreSQL organization and its first administrator.
 * Existing data is never updated or deleted; reruns only accept exact bootstrap
 * identities and leave account passwords, permissions, and device keys intact.
 */
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const args = new Set(process.argv.slice(2));
if (!args.has("--bootstrap")) {
  throw new Error("Refusing PostgreSQL bootstrap without the explicit --bootstrap flag.");
}

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(?:ql)?:\/\//.test(url)) {
  throw new Error("DATABASE_URL must be a PostgreSQL connection string");
}

const organizationId = process.env.SEED_ORGANIZATION_ID ?? "org_smartfuel_default";
const organizationName = (process.env.SEED_ORGANIZATION_NAME ?? "SmartFuel").trim();
const organizationSlug = (process.env.SEED_ORGANIZATION_SLUG ?? "smartfuel").trim().toLowerCase();
const roleId = "role_super_admin";
const adminId = "usr_bootstrap_admin";
const rawAdminEmail = process.env.SEED_ADMIN_EMAIL;
const adminEmail = rawAdminEmail?.trim().toLowerCase() ?? "";
const adminName = (process.env.SEED_ADMIN_NAME ?? "SmartFuel Administrator").trim();
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const deviceKey = process.env.SEED_DEVICE_KEY;

if (!organizationId.trim() || !organizationName || !organizationSlug) {
  throw new Error("Set a valid bootstrap organization ID, name, and slug");
}
if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
  throw new Error("Set SEED_ADMIN_EMAIL to the intended administrator's email address");
}
if (!adminPassword || adminPassword.length < 12) {
  throw new Error("Set SEED_ADMIN_PASSWORD to a unique password of at least 12 characters");
}
if (!deviceKey || deviceKey.length < 32) {
  throw new Error("Set SEED_DEVICE_KEY to a unique device key of at least 32 characters");
}

const adminPasswordHash = await bcrypt.hash(adminPassword, 12);
const deviceKeyHash = createHash("sha256").update(deviceKey).digest("hex");
const sql = postgres(url, { prepare: false, ssl: "require", max: 1, connect_timeout: 10 });

function parsePermissions(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

try {
  const outcome = await sql.begin(async (tx) => {
    // Preflight every identity before the first insert. Any conflicting ID,
    // unique key, disabled account, or mismatched bootstrap resource aborts the
    // transaction without modifying pre-existing rows.
    const organizationRows = await tx`
      SELECT id, slug, is_active FROM organizations
      WHERE id = ${organizationId} OR slug = ${organizationSlug}
    `;
    if (organizationRows.length > 1 || organizationRows.some((row) => row.id !== organizationId || row.slug !== organizationSlug)) {
      throw new Error("Bootstrap organization ID or slug conflicts with an existing organization; no data was changed");
    }
    const organizationExists = organizationRows.length === 1;
    if (organizationExists && Number(organizationRows[0].is_active) !== 1) {
      throw new Error("The bootstrap organization is inactive; no data was changed");
    }

    const roleRows = await tx`SELECT id, key, is_system, permissions FROM roles WHERE id = ${roleId} OR key = 'super_admin'`;
    if (roleRows.length > 1 || roleRows.some((row) => row.id !== roleId || row.key !== "super_admin")) {
      throw new Error("Bootstrap administrator role conflicts with an existing role; no data was changed");
    }
    const roleExists = roleRows.length === 1;
    if (roleExists) {
      const permissions = parsePermissions(roleRows[0].permissions);
      if (Number(roleRows[0].is_system) !== 1 || !(permissions.includes("*") || permissions.includes("organizations.manage"))) {
        throw new Error("Existing super administrator role is not a valid system administrator role; no data was changed");
      }
    }

    const userRows = await tx`
      SELECT id, email, organization_id, role_id, status FROM users
      WHERE id = ${adminId} OR lower(email) = ${adminEmail}
    `;
    if (userRows.length > 1 || userRows.some((row) =>
      row.id !== adminId ||
      row.email.toLowerCase() !== adminEmail ||
      row.organization_id !== organizationId ||
      row.role_id !== roleId ||
      row.status !== "active"
    )) {
      throw new Error("Bootstrap administrator ID or email conflicts with an existing account; no data was changed");
    }
    const userExists = userRows.length === 1;

    const fuelTypeDefinitions = [
      ["fuel_diesel", "diesel", "Diesel", "#2563eb"],
      ["fuel_petrol", "petrol", "Petrol", "#f59e0b"],
    ];
    const fuelTypeExists = new Map();
    for (const [id, systemName] of fuelTypeDefinitions) {
      const rows = await tx`
        SELECT id, organization_id, system_name FROM fuel_types
        WHERE id = ${id} OR (organization_id = ${organizationId} AND system_name = ${systemName})
      `;
      if (rows.length > 1 || rows.some((row) => row.id !== id || row.organization_id !== organizationId || row.system_name !== systemName)) {
        throw new Error(`Bootstrap fuel type ${systemName} conflicts with existing data; no data was changed`);
      }
      fuelTypeExists.set(id, rows.length === 1);
    }

    const stationRows = await tx`
      SELECT id, organization_id, code, is_archived FROM stations
      WHERE id = 'station_bootstrap' OR code = 'DSM-001'
    `;
    if (stationRows.length > 1 || stationRows.some((row) =>
      row.id !== "station_bootstrap" || row.organization_id !== organizationId || row.code !== "DSM-001" || Number(row.is_archived) === 1
    )) {
      throw new Error("Bootstrap station ID or code conflicts with existing data; no data was changed");
    }
    const stationExists = stationRows.length === 1;

    const tankRows = await tx`
      SELECT id, organization_id, station_id, fuel_type_id, code, is_archived FROM tanks
      WHERE id = 'tank_bootstrap_diesel' OR (station_id = 'station_bootstrap' AND code = 'T1')
    `;
    if (tankRows.length > 1 || tankRows.some((row) =>
      row.id !== "tank_bootstrap_diesel" ||
      row.organization_id !== organizationId ||
      row.station_id !== "station_bootstrap" ||
      row.fuel_type_id !== "fuel_diesel" ||
      row.code !== "T1" ||
      Number(row.is_archived) === 1
    )) {
      throw new Error("Bootstrap tank ID or code conflicts with existing data; no data was changed");
    }
    const tankExists = tankRows.length === 1;

    const deviceRows = await tx`
      SELECT id, organization_id, type, serial_number, provider, station_id, tank_id, api_key_hash, is_active
      FROM devices
      WHERE id = 'device_bootstrap_probe' OR serial_number = 'SF-DEMO-001' OR api_key_hash = ${deviceKeyHash}
    `;
    if (deviceRows.length > 1 || deviceRows.some((row) =>
      row.id !== "device_bootstrap_probe" ||
      row.organization_id !== organizationId ||
      row.type !== "fuel_probe" ||
      row.serial_number !== "SF-DEMO-001" ||
      row.provider !== "generic_mqtt" ||
      row.station_id !== "station_bootstrap" ||
      row.tank_id !== "tank_bootstrap_diesel" ||
      row.api_key_hash !== deviceKeyHash ||
      Number(row.is_active) !== 1
    )) {
      throw new Error("Bootstrap device ID, serial, or key conflicts with existing data; no data was changed");
    }
    const deviceExists = deviceRows.length === 1;

    if (!organizationExists) {
      await tx`
        INSERT INTO organizations (id, name, slug, currency, timezone)
        VALUES (${organizationId}, ${organizationName}, ${organizationSlug}, 'TZS', 'Africa/Dar_es_Salaam')
      `;
    }
    if (!roleExists) {
      await tx`
        INSERT INTO roles (id, key, name, description, is_system, permissions)
        VALUES (${roleId}, 'super_admin', 'Super administrator', 'Full platform access', 1, ${JSON.stringify(["*"])})
      `;
    }
    if (!userExists) {
      await tx`
        INSERT INTO users (id, organization_id, email, name, password_hash, role_id, status)
        VALUES (${adminId}, ${organizationId}, ${adminEmail}, ${adminName}, ${adminPasswordHash}, ${roleId}, 'active')
      `;
    }
    for (const [id, systemName, displayName, color] of fuelTypeDefinitions) {
      if (fuelTypeExists.get(id)) continue;
      await tx`
        INSERT INTO fuel_types (id, organization_id, system_name, display_name, color)
        VALUES (${id}, ${organizationId}, ${systemName}, ${displayName}, ${color})
      `;
    }
    if (!stationExists) {
      await tx`
        INSERT INTO stations (id, organization_id, name, code, address, city, region, country, status)
        VALUES ('station_bootstrap', ${organizationId}, 'Dar es Salaam Main Station', 'DSM-001', 'Dar es Salaam', 'Dar es Salaam', 'Dar es Salaam', 'Tanzania', 'online')
      `;
    }
    if (!tankExists) {
      await tx`
        INSERT INTO tanks (id, organization_id, station_id, fuel_type_id, name, code, capacity, current_volume, status)
        VALUES ('tank_bootstrap_diesel', ${organizationId}, 'station_bootstrap', 'fuel_diesel', 'Diesel Tank 1', 'T1', 40000, 28000, 'normal')
      `;
    }
    if (!deviceExists) {
      await tx`
        INSERT INTO devices (id, organization_id, type, serial_number, label, provider, station_id, tank_id, status, api_key_hash, is_active)
        VALUES ('device_bootstrap_probe', ${organizationId}, 'fuel_probe', 'SF-DEMO-001', 'Bootstrap probe', 'generic_mqtt', 'station_bootstrap', 'tank_bootstrap_diesel', 'never_connected', ${deviceKeyHash}, 1)
      `;
    }

    return { organizationExists, roleExists, userExists, stationExists, tankExists, deviceExists };
  });

  process.stdout.write(
    `PostgreSQL bootstrap complete for ${adminEmail}. Existing identities were preserved; new resources were created only when absent.\n`,
  );
  if (outcome.userExists) {
    process.stdout.write("The existing bootstrap administrator password was not changed.\n");
  }
  if (outcome.deviceExists) {
    process.stdout.write("The existing device key was not changed.\n");
  }
  process.stdout.write("Secrets are not printed; store them in your deployment secret manager.\n");
} finally {
  await sql.end({ timeout: 5 });
}
