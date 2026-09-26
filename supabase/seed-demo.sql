-- SmartFuel PostgreSQL demo seed
--
-- Run this file in the Supabase SQL Editor after running
-- migrations/0001_initial.sql. It is self-contained and does not require
-- Node.js, npm, SMTP, or a local database.
--
-- Demo login:
--   george@puma.co.tz / FuelWatch2026!
--   asha@puma.co.tz   / FuelWatch2026!
--
-- This replaces only the two demo organizations. It does not delete any
-- organization created by the PostgreSQL bootstrap seed.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

DELETE FROM organizations
WHERE id IN ('org_puma_tz', 'org_total_tz');

INSERT INTO organizations (id, name, slug, currency, units, temp_unit, timezone, locale, plan)
VALUES
  ('org_puma_tz', 'PUMA Tanzania', 'puma-tanzania', 'TZS', 'liters', 'celsius', 'Africa/Dar_es_Salaam', 'en', 'enterprise'),
  ('org_total_tz', 'Total Energies Tanzania', 'total-tanzania', 'TZS', 'liters', 'celsius', 'Africa/Dar_es_Salaam', 'sw', 'growth')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  currency = EXCLUDED.currency,
  units = EXCLUDED.units,
  temp_unit = EXCLUDED.temp_unit,
  timezone = EXCLUDED.timezone,
  locale = EXCLUDED.locale,
  plan = EXCLUDED.plan,
  is_active = 1;

INSERT INTO roles (id, key, name, description, is_system, permissions)
VALUES
  ('role_super_admin', 'super_admin', 'Super Admin', 'Unrestricted access across every organization and system setting.', 1, '["*"]'),
  ('role_admin', 'admin', 'Administrator', 'Manages stations, tanks, devices, users, reports and configuration.', 1, '["*"]'),
  ('role_manager', 'manager', 'Manager', 'Views operational information and manages reports and alerts.', 1, '["dashboard.view","stations.view","stations.edit","tanks.view","tanks.edit","devices.view","readings.view","readings.export","movements.view","movements.export","vehicles.view","alerts.view","alerts.acknowledge","alerts.resolve","alerts.assign","alerts.notes","alert_rules.view","reports.view","reports.create","reports.export","reports.schedule","users.view","integrations.view","settings.view","audit.view","map.view","notifications.view"]'),
  ('role_operator', 'operator', 'Operator', 'Monitors stations and tanks and acknowledges alerts.', 1, '["dashboard.view","stations.view","tanks.view","devices.view","readings.view","movements.view","vehicles.view","alerts.view","alerts.acknowledge","alerts.notes","alert_rules.view","reports.view","map.view","notifications.view"]'),
  ('role_viewer', 'viewer', 'Viewer', 'Read-only access to dashboards, tanks and reports.', 1, '["dashboard.view","stations.view","tanks.view","devices.view","readings.view","movements.view","vehicles.view","alerts.view","reports.view","map.view","notifications.view"]')
ON CONFLICT (id) DO UPDATE SET
  key = EXCLUDED.key,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system,
  permissions = EXCLUDED.permissions;

INSERT INTO users (id, organization_id, email, name, password_hash, role_id, status, job_title, last_login_at, last_login_ip, mfa_enabled)
VALUES
  ('usr_george', 'org_puma_tz', 'george@puma.co.tz', 'George Mushi', crypt('FuelWatch2026!', gen_salt('bf', 12)), 'role_super_admin', 'active', 'Owner', CURRENT_TIMESTAMP, '197.250.44.18', 0),
  ('usr_sarah', 'org_puma_tz', 'sarah@puma.co.tz', 'Sarah Kimaro', crypt('FuelWatch2026!', gen_salt('bf', 12)), 'role_admin', 'active', 'Operations Administrator', CURRENT_TIMESTAMP, '197.250.44.18', 0),
  ('usr_daniel', 'org_puma_tz', 'daniel@puma.co.tz', 'Daniel Mollel', crypt('FuelWatch2026!', gen_salt('bf', 12)), 'role_manager', 'active', 'Regional Manager', CURRENT_TIMESTAMP, '197.250.44.18', 0),
  ('usr_asha', 'org_puma_tz', 'asha@puma.co.tz', 'Asha Laizer', crypt('FuelWatch2026!', gen_salt('bf', 12)), 'role_operator', 'active', 'Station Supervisor', CURRENT_TIMESTAMP, '197.250.44.18', 0),
  ('usr_neema', 'org_puma_tz', 'neema@puma.co.tz', 'Neema Shirima', crypt('FuelWatch2026!', gen_salt('bf', 12)), 'role_viewer', 'active', 'Finance Analyst', CURRENT_TIMESTAMP, '197.250.44.18', 0),
  ('usr_juma', 'org_puma_tz', 'juma@puma.co.tz', 'Juma Mwaipopo', crypt('FuelWatch2026!', gen_salt('bf', 12)), 'role_operator', 'active', 'Night Shift Operator', CURRENT_TIMESTAMP, '197.250.44.18', 0),
  ('usr_admin_total', 'org_total_tz', 'admin@total.co.tz', 'Fatma Said', crypt('FuelWatch2026!', gen_salt('bf', 12)), 'role_admin', 'active', 'Platform Administrator', CURRENT_TIMESTAMP, '197.250.44.18', 0),
  ('usr_manager_total', 'org_total_tz', 'manager@total.co.tz', 'Hassan Omar', crypt('FuelWatch2026!', gen_salt('bf', 12)), 'role_manager', 'active', 'Network Manager', CURRENT_TIMESTAMP, '197.250.44.18', 0)
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  password_hash = EXCLUDED.password_hash,
  role_id = EXCLUDED.role_id,
  status = 'active',
  job_title = EXCLUDED.job_title,
  failed_attempts = 0,
  locked_until = NULL,
  mfa_enabled = 0;

INSERT INTO fuel_types (id, organization_id, system_name, display_name, color, density)
SELECT
  o.id || '_fuel_' || f.system_name,
  o.id,
  f.system_name,
  f.display_name,
  f.color,
  f.density
FROM organizations o
CROSS JOIN (VALUES
  ('petrol', 'Unleaded Petrol 95', '#3b82f6', 0.745::REAL),
  ('diesel', 'Automotive Diesel 50ppm', '#10b981', 0.832::REAL),
  ('kerosene', 'Illuminating Kerosene', '#f59e0b', 0.790::REAL)
) AS f(system_name, display_name, color, density)
WHERE o.id IN ('org_puma_tz', 'org_total_tz')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  color = EXCLUDED.color,
  density = EXCLUDED.density,
  is_active = 1;

INSERT INTO stations (id, organization_id, name, code, address, city, region, country, latitude, longitude, status, timezone, currency, volume_unit)
VALUES
  ('puma_stn_01', 'org_puma_tz', 'PUMA Arusha — Main Branch', 'ARN-01', 'Main Road', 'Arusha', 'Arusha', 'Tanzania', -3.3869, 36.6830, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('puma_stn_02', 'org_puma_tz', 'PUMA Njiro', 'ARN-02', 'Njiro Road', 'Arusha', 'Arusha', 'Tanzania', -3.4012, 36.7312, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('puma_stn_03', 'org_puma_tz', 'PUMA Soko Kuu', 'ARN-03', 'Market Street', 'Arusha', 'Arusha', 'Tanzania', -3.3697, 36.6901, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('puma_stn_04', 'org_puma_tz', 'PUMA Ngaramtoni', 'ARN-04', 'Ngaramtoni Road', 'Arusha', 'Arusha', 'Tanzania', -3.3291, 36.6443, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('puma_stn_05', 'org_puma_tz', 'PUMA Usa River', 'ARN-05', 'Usa River Road', 'Arusha', 'Arusha', 'Tanzania', -3.2718, 36.8252, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('puma_stn_06', 'org_puma_tz', 'PUMA Sakina', 'ARN-06', 'Sakina Road', 'Arusha', 'Arusha', 'Tanzania', -3.3552, 36.6547, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('puma_stn_07', 'org_puma_tz', 'PUMA Moshi — Central', 'MOS-01', 'Central Moshi', 'Moshi', 'Kilimanjaro', 'Tanzania', -3.3394, 37.3403, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('puma_stn_08', 'org_puma_tz', 'PUMA Moshi — Rau', 'MOS-02', 'Rau Road', 'Moshi', 'Kilimanjaro', 'Tanzania', -3.3004, 37.3542, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('puma_stn_09', 'org_puma_tz', 'PUMA Monduli', 'MND-01', 'Monduli Road', 'Monduli', 'Arusha', 'Tanzania', -3.2978, 36.4512, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('puma_stn_10', 'org_puma_tz', 'PUMA Manyara', 'MNY-01', 'Babati Road', 'Babati', 'Manyara', 'Tanzania', -4.2167, 35.7500, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('puma_stn_11', 'org_puma_tz', 'PUMA Tanga — Central', 'TNG-01', 'Central Tanga', 'Tanga', 'Tanga', 'Tanzania', -5.0689, 39.0964, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('puma_stn_12', 'org_puma_tz', 'PUMA Morogoro — Bigwa', 'MRG-01', 'Bigwa Road', 'Morogoro', 'Morogoro', 'Tanzania', -6.8234, 38.2789, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('total_stn_01', 'org_total_tz', 'Total Energies Kariakoo', 'TE-DSM-01', 'Kariakoo Road', 'Dar es Salaam', 'Dar es Salaam', 'Tanzania', -6.8163, 39.2797, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('total_stn_02', 'org_total_tz', 'Total Energies Mlimani', 'TE-DSM-02', 'Mlimani Road', 'Dar es Salaam', 'Dar es Salaam', 'Tanzania', -6.7671, 39.2457, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters'),
  ('total_stn_03', 'org_total_tz', 'Total Energies Mwanza', 'TE-MWZ-01', 'Mwanza Road', 'Mwanza', 'Mwanza', 'Tanzania', -2.5164, 32.9175, 'online', 'Africa/Dar_es_Salaam', 'TZS', 'liters')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  city = EXCLUDED.city,
  region = EXCLUDED.region,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  status = EXCLUDED.status,
  is_archived = 0;

INSERT INTO tanks (id, organization_id, station_id, fuel_type_id, name, code, capacity, current_volume, tank_type, manufacturer, min_level, low_threshold_pct, critical_threshold_pct, overfill_threshold_pct, status)
SELECT
  s.id || '_tank_' || f.system_name,
  s.organization_id,
  s.id,
  s.organization_id || '_fuel_' || f.system_name,
  f.display_name || ' — ' || s.name,
  upper(left(f.system_name, 1)) || 'A',
  f.capacity,
  f.capacity * f.start_level,
  'underground',
  'SmartFuel Demo Systems',
  0,
  20,
  10,
  95,
  CASE WHEN f.start_level < 0.2 THEN 'low' ELSE 'normal' END
FROM stations s
CROSS JOIN (VALUES
  ('petrol', 50000::REAL, 0.58::REAL),
  ('diesel', 40000::REAL, 0.64::REAL),
  ('kerosene', 15000::REAL, 0.46::REAL)
) AS f(system_name, capacity, start_level)
WHERE s.organization_id IN ('org_puma_tz', 'org_total_tz')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  capacity = EXCLUDED.capacity,
  current_volume = EXCLUDED.current_volume,
  status = EXCLUDED.status,
  is_archived = 0;

INSERT INTO vehicles (id, organization_id, name, plate_number, type, make, model, year, fuel_type_id, tank_capacity, station_id, status, odometer_km, driver_name, driver_phone)
SELECT
  'demo_vehicle_' || o.short_code || '_' || n,
  o.id,
  CASE n WHEN 1 THEN 'Delivery Tanker' ELSE 'Operations Vehicle' END || ' ' || n,
  CASE o.short_code WHEN 'puma' THEN 'T' ELSE 'Z' END || (400 + n) || ' ' || o.short_code || n,
  CASE WHEN n <= 2 THEN 'tanker' ELSE 'pickup' END,
  CASE WHEN n <= 2 THEN 'Volvo' ELSE 'Toyota' END,
  CASE WHEN n <= 2 THEN 'FM 380' ELSE 'Hilux' END,
  2020 + (n % 4),
  o.id || '_fuel_diesel',
  CASE WHEN n <= 2 THEN 30000 ELSE 80 END,
  (SELECT s.id FROM stations s WHERE s.organization_id = o.id ORDER BY s.id LIMIT 1 OFFSET ((n - 1) % 3)),
  'active',
  42000 + (n * 1375),
  CASE n WHEN 1 THEN 'Joseph Mollel' WHEN 2 THEN 'Rehema Said' ELSE 'Operations Team' END,
  '+255 700 000 00' || n
FROM (VALUES ('org_puma_tz', 'puma'), ('org_total_tz', 'total')) AS o(id, short_code)
CROSS JOIN generate_series(1, 4) AS n
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  station_id = EXCLUDED.station_id,
  status = 'active',
  is_archived = 0;

INSERT INTO devices (id, organization_id, type, serial_number, label, provider, model, firmware, station_id, tank_id, status, last_seen_at, last_reading_at, signal_strength, battery_pct, api_key_hash, is_active, metadata)
SELECT
  'demo_device_' || t.id,
  t.organization_id,
  'fuel_probe',
  'SF-' || upper(replace(t.id, '_', '-')),
  'Demo probe — ' || t.name,
  'generic_mqtt',
  'TankSense Pro',
  '2.4.1',
  t.station_id,
  t.id,
  CASE WHEN row_number() OVER (PARTITION BY t.organization_id ORDER BY t.id) % 13 = 0 THEN 'offline' ELSE 'online' END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  78,
  88,
  encode(digest('demo-' || upper(replace(t.id, '_', '-')), 'sha256'), 'hex'),
  1,
  '{"demo":true}'
FROM tanks t
WHERE t.organization_id IN ('org_puma_tz', 'org_total_tz')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  last_seen_at = EXCLUDED.last_seen_at,
  last_reading_at = EXCLUDED.last_reading_at,
  api_key_hash = EXCLUDED.api_key_hash,
  is_active = 1;

INSERT INTO user_stations (user_id, station_id)
SELECT u.id, s.id
FROM users u
JOIN stations s ON s.organization_id = u.organization_id
WHERE u.id IN ('usr_asha', 'usr_juma')
  AND s.organization_id = 'org_puma_tz'
  AND s.id IN ('puma_stn_01', 'puma_stn_02', 'puma_stn_03')
ON CONFLICT DO NOTHING;

INSERT INTO user_stations (user_id, station_id)
SELECT 'usr_manager_total', s.id
FROM stations s
WHERE s.organization_id = 'org_total_tz'
  AND s.id IN ('total_stn_01', 'total_stn_02')
ON CONFLICT DO NOTHING;

-- 30 days of hourly tank readings. The generated values are deterministic,
-- smooth, and contain enough movement for charts, reconciliation, and alerts.
INSERT INTO readings (id, ts, created_at, organization_id, tank_id, device_id, volume_liters, level_percent, level_mm, temperature_c, water_level_mm, signal, battery_pct, raw)
SELECT
  'demo_reading_' || t.id || '_' || to_char(g.ts AT TIME ZONE 'UTC', 'YYYYMMDDHH24'),
  to_char(g.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  to_char(g.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  t.organization_id,
  t.id,
  d.id,
  round((t.capacity * greatest(0.08, least(0.96,
    0.56
    + 0.19 * sin(extract(epoch FROM g.ts) / 86400.0 * 2 * pi())
    + 0.06 * cos(extract(epoch FROM g.ts) / 43200.0 * 2 * pi())
    - extract(epoch FROM (CURRENT_TIMESTAMP - g.ts)) / 86400.0 * 0.002
  )))::numeric, 2)::REAL,
  round((greatest(0.08, least(0.96,
    0.56
    + 0.19 * sin(extract(epoch FROM g.ts) / 86400.0 * 2 * pi())
    + 0.06 * cos(extract(epoch FROM g.ts) / 43200.0 * 2 * pi())
    - extract(epoch FROM (CURRENT_TIMESTAMP - g.ts)) / 86400.0 * 0.002
  )) * 100)::numeric, 2)::REAL,
  round((greatest(0.08, least(0.96,
    0.56
    + 0.19 * sin(extract(epoch FROM g.ts) / 86400.0 * 2 * pi())
    + 0.06 * cos(extract(epoch FROM g.ts) / 43200.0 * 2 * pi())
    - extract(epoch FROM (CURRENT_TIMESTAMP - g.ts)) / 86400.0 * 0.002
  )) * 1800)::numeric, 2)::REAL,
  round((24 + 4 * sin(extract(epoch FROM g.ts) / 86400.0 * 2 * pi()))::numeric, 2)::REAL,
  12,
  78,
  88,
  '{"source":"demo"}'
FROM tanks t
JOIN devices d ON d.tank_id = t.id
CROSS JOIN LATERAL generate_series(
  date_trunc('hour', CURRENT_TIMESTAMP - interval '30 days'),
  date_trunc('hour', CURRENT_TIMESTAMP),
  interval '1 hour'
) AS g(ts)
WHERE t.organization_id IN ('org_puma_tz', 'org_total_tz')
ON CONFLICT DO NOTHING;

UPDATE tanks t
SET current_volume = latest.volume_liters,
    current_level_mm = latest.volume_liters / NULLIF(t.capacity, 0) * 1800,
    current_temp_c = latest.temperature_c,
    water_level_mm = latest.water_level_mm,
    last_reading_at = latest.ts,
    last_valid_reading_at = latest.ts,
    status = CASE WHEN latest.level_percent <= t.critical_threshold_pct THEN 'critical' WHEN latest.level_percent <= t.low_threshold_pct THEN 'low' ELSE 'normal' END
FROM (
  SELECT DISTINCT ON (r.tank_id)
    r.tank_id,
    r.volume_liters,
    r.level_percent,
    r.level_mm,
    r.temperature_c,
    r.water_level_mm,
    r.ts
  FROM readings r
  WHERE r.organization_id IN ('org_puma_tz', 'org_total_tz')
  ORDER BY r.tank_id, r.ts DESC
) latest
WHERE t.id = latest.tank_id;

-- Derived consumption/refill movements from the generated readings.
WITH points AS (
  SELECT
    r.*,
    t.station_id,
    lag(r.volume_liters) OVER (PARTITION BY r.tank_id ORDER BY r.ts) AS previous_volume
  FROM readings r
  JOIN tanks t ON t.id = r.tank_id
  WHERE r.organization_id IN ('org_puma_tz', 'org_total_tz')
), movements AS (
  SELECT *
  FROM points
  WHERE previous_volume IS NOT NULL
    AND abs(volume_liters - previous_volume) > 50
)
INSERT INTO fuel_events (id, ts, organization_id, station_id, tank_id, device_id, type, volume, level_before, level_after, duration_sec, confidence, status, reason, note)
SELECT
  'demo_event_' || id,
  ts,
  organization_id,
  station_id,
  tank_id,
  device_id,
  CASE WHEN volume_liters < previous_volume THEN 'consumption' ELSE 'refill' END,
  abs(volume_liters - previous_volume),
  previous_volume,
  volume_liters,
  3600,
  CASE WHEN abs(volume_liters - previous_volume) > 2500 THEN 'medium' ELSE 'high' END,
  'confirmed',
  CASE WHEN volume_liters < previous_volume THEN 'Normal tank outflow' ELSE 'Delivery received' END,
  'Generated demo movement'
FROM movements
ON CONFLICT DO NOTHING;

INSERT INTO alert_rules (id, organization_id, name, description, type, scope, condition, severity, channels, is_enabled, cooldown_min)
VALUES
  ('demo_rule_puma_low', 'org_puma_tz', 'Low fuel level', 'Demo alert rule for low tank levels.', 'low_fuel', 'tank', '{"operator":"lt","value":20}', 'warning', '["in_app","email"]', 1, 30),
  ('demo_rule_puma_critical', 'org_puma_tz', 'Critical fuel level', 'Demo alert rule for critical tank levels.', 'critical_fuel', 'tank', '{"operator":"lt","value":10}', 'critical', '["in_app","email"]', 1, 30),
  ('demo_rule_total_low', 'org_total_tz', 'Low fuel level', 'Demo alert rule for low tank levels.', 'low_fuel', 'tank', '{"operator":"lt","value":20}', 'warning', '["in_app","email"]', 1, 30),
  ('demo_rule_total_device', 'org_total_tz', 'Device communication', 'Demo device health alert rule.', 'device_offline', 'device', '{"operator":"eq","value":"offline"}', 'warning', '["in_app"]', 1, 30)
ON CONFLICT (id) DO UPDATE SET
  condition = EXCLUDED.condition,
  severity = EXCLUDED.severity,
  channels = EXCLUDED.channels,
  is_enabled = 1;

INSERT INTO alerts (id, created_at, updated_at, organization_id, station_id, tank_id, device_id, rule_id, type, severity, title, message, value, unit, threshold, status, metadata, assigned_to_id)
SELECT
  'demo_alert_low_' || t.id,
  to_char(CURRENT_TIMESTAMP - interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  to_char(CURRENT_TIMESTAMP - interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  t.organization_id,
  t.station_id,
  t.id,
  d.id,
  CASE WHEN t.organization_id = 'org_puma_tz' THEN 'demo_rule_puma_low' ELSE 'demo_rule_total_low' END,
  'low_fuel',
  'warning',
  'Low fuel — ' || t.name,
  'Tank level is below the configured demo warning threshold. Review replenishment requirements.',
  17.4,
  '%',
  20,
  'active',
  '{"demo":true}',
  CASE WHEN t.organization_id = 'org_puma_tz' THEN 'usr_asha' ELSE 'usr_manager_total' END
FROM (
  SELECT t.*, row_number() OVER (PARTITION BY t.organization_id ORDER BY t.id) AS rn
  FROM tanks t
  WHERE t.organization_id IN ('org_puma_tz', 'org_total_tz')
) t
JOIN devices d ON d.tank_id = t.id
WHERE t.rn <= 3
ON CONFLICT (id) DO UPDATE SET
  status = 'active',
  updated_at = EXCLUDED.updated_at,
  message = EXCLUDED.message,
  assigned_to_id = EXCLUDED.assigned_to_id;

INSERT INTO alerts (id, created_at, updated_at, organization_id, station_id, tank_id, device_id, rule_id, type, severity, title, message, value, unit, threshold, status, metadata)
SELECT
  'demo_alert_critical_' || t.id,
  to_char(CURRENT_TIMESTAMP - interval '5 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  to_char(CURRENT_TIMESTAMP - interval '5 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  t.organization_id,
  t.station_id,
  t.id,
  d.id,
  CASE WHEN t.organization_id = 'org_puma_tz' THEN 'demo_rule_puma_critical' ELSE 'demo_rule_total_low' END,
  'critical_fuel',
  'critical',
  'Critical fuel level — ' || t.name,
  'Tank level is critically low. Arrange replenishment and verify the probe reading.',
  8.7,
  '%',
  10,
  'active',
  '{"demo":true}'
FROM (
  SELECT t.*, row_number() OVER (PARTITION BY t.organization_id ORDER BY t.id DESC) AS rn
  FROM tanks t
  WHERE t.organization_id IN ('org_puma_tz', 'org_total_tz')
) t
JOIN devices d ON d.tank_id = t.id
WHERE t.rn = 1
ON CONFLICT (id) DO UPDATE SET
  status = 'active',
  updated_at = EXCLUDED.updated_at,
  message = EXCLUDED.message;

INSERT INTO notifications (id, organization_id, user_id, alert_id, title, body, severity, channel, is_read)
SELECT
  'demo_notification_' || a.id,
  a.organization_id,
  a.assigned_to_id,
  a.id,
  a.title,
  a.message,
  a.severity,
  'in_app',
  0
FROM alerts a
WHERE a.id LIKE 'demo_alert_%'
ON CONFLICT (id) DO NOTHING;

INSERT INTO reports (id, organization_id, created_by_id, title, category, period, date_from, date_to, filters, status, progress, format, summary)
VALUES
  ('demo_report_weekly', 'org_puma_tz', 'usr_george', 'Weekly Consumption Report', 'consumption', 'weekly', to_char(CURRENT_TIMESTAMP - interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '{"stationId":null}', 'ready', 100, 'excel', '{"demo":true}'),
  ('demo_report_inventory', 'org_puma_tz', 'usr_daniel', 'Network Inventory Snapshot', 'inventory', 'monthly', to_char(CURRENT_TIMESTAMP - interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '{"stationId":null}', 'ready', 100, 'pdf', '{"demo":true}'),
  ('demo_report_total', 'org_total_tz', 'usr_admin_total', 'Mwanza Fuel Summary', 'summary', 'weekly', to_char(CURRENT_TIMESTAMP - interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '{"stationId":"total_stn_03"}', 'ready', 100, 'csv', '{"demo":true}')
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  status = 'ready',
  progress = 100,
  summary = EXCLUDED.summary;

INSERT INTO scheduled_reports (id, organization_id, name, category, period, day_of_week, time_of_day, timezone, recipients, format, station_id, filters, is_enabled, next_run_at)
VALUES
  ('demo_schedule_daily', 'org_puma_tz', 'Daily Fuel Report — All Stations', 'consumption', 'daily', NULL, '18:00', 'Africa/Dar_es_Salaam', '["manager@puma.co.tz","finance@puma.co.tz"]', 'pdf', NULL, '{"demo":true}', 1, to_char(CURRENT_TIMESTAMP + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  ('demo_schedule_weekly', 'org_puma_tz', 'Weekly Consumption Digest', 'consumption', 'weekly', 1, '07:00', 'Africa/Dar_es_Salaam', '["daniel@puma.co.tz"]', 'excel', 'puma_stn_01', '{"demo":true}', 1, to_char(CURRENT_TIMESTAMP + interval '4 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  ('demo_schedule_total', 'org_total_tz', 'Monthly Network Summary', 'summary', 'monthly', NULL, '06:30', 'Africa/Dar_es_Salaam', '["george@puma.co.tz"]', 'pdf', 'total_stn_01', '{"demo":true}', 0, NULL)
ON CONFLICT (id) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  next_run_at = EXCLUDED.next_run_at;

INSERT INTO integrations (id, organization_id, kind, provider, name, status, config, secret_ref, is_enabled)
VALUES
  ('demo_integration_puma', 'org_puma_tz', 'device_gateway', 'generic_mqtt', 'Demo Probe Gateway', 'connected', '{"host":"demo-gateway.invalid","port":1883}', 'demo-only', 1),
  ('demo_integration_total', 'org_total_tz', 'email', 'smtp', 'Demo SMTP Integration', 'disconnected', '{"from":"alerts@example.invalid"}', NULL, 0)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  config = EXCLUDED.config,
  is_enabled = EXCLUDED.is_enabled;

INSERT INTO system_settings (id, organization_id, key, value)
VALUES
  ('demo_setting_puma_dashboard', 'org_puma_tz', 'dashboard', '{"layout":"grid","showMap":true}'),
  ('demo_setting_puma_notifications', 'org_puma_tz', 'notifications', '{"inApp":true,"email":false,"sms":false}'),
  ('demo_setting_total_dashboard', 'org_total_tz', 'dashboard', '{"layout":"grid","showMap":true}')
ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO audit_logs (id, ts, user_id, user_label, action, entity, entity_id, entity_label, summary, previous, next, ip, user_agent)
VALUES
  ('demo_audit_login', to_char(CURRENT_TIMESTAMP - interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'usr_george', 'George Mushi', 'login', 'session', NULL, NULL, 'George Mushi signed in', NULL, NULL, '197.250.44.18', 'SmartFuel demo'),
  ('demo_audit_station', to_char(CURRENT_TIMESTAMP - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'usr_sarah', 'Sarah Kimaro', 'created', 'station', 'puma_stn_01', 'PUMA Arusha — Main Branch', 'Sarah Kimaro created the station', NULL, NULL, '197.250.44.18', 'SmartFuel demo'),
  ('demo_audit_alert', to_char(CURRENT_TIMESTAMP - interval '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'usr_asha', 'Asha Laizer', 'acknowledged', 'alert', 'demo_alert_low_puma_stn_01_tank_petrol', 'Low fuel alert', 'Asha Laizer acknowledged a low fuel alert', NULL, NULL, '197.250.44.18', 'SmartFuel demo')
ON CONFLICT (id) DO NOTHING;

COMMIT;

SELECT 'Demo seed complete' AS status;
SELECT email, 'FuelWatch2026!' AS password
FROM users
WHERE id IN ('usr_george', 'usr_asha', 'usr_admin_total')
ORDER BY email;
