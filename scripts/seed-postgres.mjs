#!/usr/bin/env node
/**
 * Creates the smallest useful production bootstrap dataset in Supabase.
 * It is intentionally idempotent and does not create demo readings/events.
 * Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before running it.
 */
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(?:ql)?:\/\//.test(url)) {
  throw new Error("DATABASE_URL must be a PostgreSQL connection string");
}

const sql = postgres(url, { prepare: false, ssl: "require", max: 1, connect_timeout: 10 });
const organizationId = process.env.SEED_ORGANIZATION_ID ?? "org_smartfuel_default";
const roleId = "role_super_admin";
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").trim().toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
if (!adminPassword || adminPassword.length < 12) {
  throw new Error("Set SEED_ADMIN_PASSWORD to a unique password of at least 12 characters");
}

const hash = await bcrypt.hash(adminPassword, 12);
const deviceKeyHash = createHash("sha256").update(process.env.SEED_DEVICE_KEY ?? "replace-device-key").digest("hex");
const now = new Date().toISOString();
try {
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO organizations (id, name, slug, currency, timezone)
      VALUES (${organizationId}, ${process.env.SEED_ORGANIZATION_NAME ?? "SmartFuel"}, ${process.env.SEED_ORGANIZATION_SLUG ?? "smartfuel"}, 'TZS', 'Africa/Dar_es_Salaam')
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO roles (id, key, name, description, is_system, permissions)
      VALUES (${roleId}, 'super_admin', 'Super administrator', 'Full platform access', 1, ${JSON.stringify(["*"])})
      ON CONFLICT (id) DO UPDATE SET permissions = EXCLUDED.permissions, name = EXCLUDED.name
    `;
    await tx`
      INSERT INTO users (id, organization_id, email, name, password_hash, role_id, status, created_at, updated_at)
      VALUES ('usr_bootstrap_admin', ${organizationId}, ${adminEmail}, ${process.env.SEED_ADMIN_NAME ?? "SmartFuel Administrator"}, ${hash}, ${roleId}, 'active', ${now}, ${now})
      ON CONFLICT (email) DO UPDATE SET organization_id = EXCLUDED.organization_id, role_id = EXCLUDED.role_id, status = 'active', password_hash = EXCLUDED.password_hash, updated_at = EXCLUDED.updated_at
    `;

    const fuelTypes = [
      ["fuel_diesel", "diesel", "Diesel", "#2563eb"],
      ["fuel_petrol", "petrol", "Petrol", "#f59e0b"],
    ];
    for (const [id, systemName, displayName, color] of fuelTypes) {
      await tx`
        INSERT INTO fuel_types (id, organization_id, system_name, display_name, color)
        VALUES (${id}, ${organizationId}, ${systemName}, ${displayName}, ${color})
        ON CONFLICT (id) DO NOTHING
      `;
    }

    await tx`
      INSERT INTO stations (id, organization_id, name, code, address, city, region, country, status)
      VALUES ('station_bootstrap', ${organizationId}, 'Dar es Salaam Main Station', 'DSM-001', 'Dar es Salaam', 'Dar es Salaam', 'Dar es Salaam', 'Tanzania', 'online')
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO tanks (id, organization_id, station_id, fuel_type_id, name, code, capacity, current_volume, status)
      VALUES ('tank_bootstrap_diesel', ${organizationId}, 'station_bootstrap', 'fuel_diesel', 'Diesel Tank 1', 'T1', 40000, 28000, 'normal')
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO devices (id, organization_id, type, serial_number, label, provider, station_id, tank_id, status, api_key_hash, is_active)
      VALUES ('device_bootstrap_probe', ${organizationId}, 'fuel_probe', 'SF-DEMO-001', 'Bootstrap probe', 'generic_mqtt', 'station_bootstrap', 'tank_bootstrap_diesel', 'never_connected', ${deviceKeyHash}, 1)
      ON CONFLICT (id) DO NOTHING
    `;
  });
  console.log(`PostgreSQL bootstrap data ready for ${adminEmail}.`);
  console.log("The admin password and device key are never printed; store them in your deployment secret manager.");
} finally {
  await sql.end({ timeout: 5 });
}
