-- ============================================================================
-- SmartFuel — Fuel Monitoring & Management Platform
-- Executable schema for the local/development engine (SQLite via node:sqlite).
--
-- This file is a 1:1 mirror of `docs/ERD.md` (the canonical entity model, which
-- also targets PostgreSQL in production). Every business table is scoped to an
-- organization (multi-tenant). `readings` is an append-only time-series table.
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- --------------------------------------------------------------------------
-- Multi-tenancy
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  logo_url    TEXT,
  currency    TEXT NOT NULL DEFAULT 'TZS',
  units       TEXT NOT NULL DEFAULT 'liters',
  temp_unit   TEXT NOT NULL DEFAULT 'celsius',
  timezone    TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  locale      TEXT NOT NULL DEFAULT 'en',
  plan        TEXT NOT NULL DEFAULT 'growth',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

-- --------------------------------------------------------------------------
-- Identity, roles & permissions
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system   INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role_id         TEXT NOT NULL REFERENCES roles(id),
  status          TEXT NOT NULL DEFAULT 'active',
  phone           TEXT,
  job_title       TEXT,
  avatar_url      TEXT,
  last_login_at   TEXT,
  last_login_ip   TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  mfa_enabled     INTEGER NOT NULL DEFAULT 0,
  mfa_secret      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id);

-- --------------------------------------------------------------------------
-- Geography & stations
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  address         TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  region          TEXT NOT NULL DEFAULT '',
  country         TEXT NOT NULL DEFAULT 'Tanzania',
  phone           TEXT,
  email           TEXT,
  latitude        REAL NOT NULL DEFAULT 0,
  longitude       REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'online',
  opening_time    TEXT NOT NULL DEFAULT '06:00',
  closing_time    TEXT NOT NULL DEFAULT '23:00',
  timezone        TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  currency        TEXT NOT NULL DEFAULT 'TZS',
  volume_unit     TEXT NOT NULL DEFAULT 'liters',
  notes           TEXT,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_stations_org ON stations(organization_id);
CREATE INDEX IF NOT EXISTS idx_stations_status ON stations(status);

CREATE TABLE IF NOT EXISTS user_stations (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, station_id)
);
CREATE INDEX IF NOT EXISTS idx_user_stations_station ON user_stations(station_id);

CREATE TABLE IF NOT EXISTS fuel_types (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  system_name     TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#3b82f6',
  density         REAL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (organization_id, system_name)
);
CREATE INDEX IF NOT EXISTS idx_fuel_types_org ON fuel_types(organization_id);

CREATE TABLE IF NOT EXISTS tanks (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  station_id            TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  fuel_type_id          TEXT NOT NULL REFERENCES fuel_types(id),
  name                  TEXT NOT NULL,
  code                  TEXT NOT NULL,
  capacity              REAL NOT NULL,
  current_volume        REAL NOT NULL DEFAULT 0,
  current_level_mm      REAL,
  current_temp_c        REAL,
  water_level_mm        REAL,
  tank_type             TEXT NOT NULL DEFAULT 'underground',
  manufacturer          TEXT,
  installation_date     TEXT,
  min_level             REAL NOT NULL DEFAULT 0,
  low_threshold_pct     REAL NOT NULL DEFAULT 20,
  critical_threshold_pct REAL NOT NULL DEFAULT 10,
  overfill_threshold_pct REAL NOT NULL DEFAULT 95,
  last_reading_at       TEXT,
  last_valid_reading_at TEXT,
  status                TEXT NOT NULL DEFAULT 'normal',
  notes                 TEXT,
  is_archived           INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (station_id, code)
);
CREATE INDEX IF NOT EXISTS idx_tanks_org ON tanks(organization_id);
CREATE INDEX IF NOT EXISTS idx_tanks_station ON tanks(station_id);
CREATE INDEX IF NOT EXISTS idx_tanks_fuel_type ON tanks(fuel_type_id);
CREATE INDEX IF NOT EXISTS idx_tanks_status ON tanks(status);

-- --------------------------------------------------------------------------
-- Devices
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  serial_number   TEXT NOT NULL UNIQUE,
  label           TEXT,
  provider        TEXT NOT NULL DEFAULT 'tectonic',
  model           TEXT,
  firmware        TEXT,
  station_id      TEXT REFERENCES stations(id) ON DELETE SET NULL,
  tank_id         TEXT REFERENCES tanks(id) ON DELETE SET NULL,
  vehicle_id      TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'never_connected',
  last_seen_at    TEXT,
  last_reading_at TEXT,
  signal_strength INTEGER,
  battery_pct     INTEGER,
  ip_address      TEXT,
  api_key_hash    TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  metadata        TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_devices_org ON devices(organization_id);
CREATE INDEX IF NOT EXISTS idx_devices_type ON devices(type);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_tank ON devices(tank_id);
CREATE INDEX IF NOT EXISTS idx_devices_vehicle ON devices(vehicle_id);

CREATE TABLE IF NOT EXISTS vehicles (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  plate_number    TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL DEFAULT 'tanker',
  make            TEXT,
  model           TEXT,
  year            INTEGER,
  fuel_type_id    TEXT REFERENCES fuel_types(id) ON DELETE SET NULL,
  tank_capacity   REAL,
  station_id      TEXT REFERENCES stations(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  odometer_km     REAL,
  driver_name     TEXT,
  driver_phone    TEXT,
  notes           TEXT,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_org ON vehicles(organization_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);

-- --------------------------------------------------------------------------
-- Time-series readings (append-only)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS readings (
  id              TEXT PRIMARY KEY,
  ts              TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tank_id         TEXT NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
  device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  volume_liters   REAL NOT NULL,
  level_percent   REAL,
  level_mm        REAL,
  temperature_c   REAL,
  water_level_mm  REAL,
  signal          INTEGER,
  battery_pct     INTEGER,
  raw             TEXT
);
CREATE INDEX IF NOT EXISTS idx_readings_tank_ts ON readings(tank_id, ts);
CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON readings(device_id, ts);
CREATE INDEX IF NOT EXISTS idx_readings_org_ts ON readings(organization_id, ts);

-- --------------------------------------------------------------------------
-- Derived fuel events
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_events (
  id              TEXT PRIMARY KEY,
  ts              TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  station_id      TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  tank_id         TEXT NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
  device_id       TEXT REFERENCES devices(id) ON DELETE SET NULL,
  vehicle_id      TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  type            TEXT NOT NULL,
  volume          REAL NOT NULL,
  level_before    REAL NOT NULL,
  level_after     REAL NOT NULL,
  duration_sec    INTEGER,
  confidence      TEXT NOT NULL DEFAULT 'high',
  status          TEXT NOT NULL DEFAULT 'confirmed',
  reason          TEXT,
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_fuel_events_tank_ts ON fuel_events(tank_id, ts);
CREATE INDEX IF NOT EXISTS idx_fuel_events_station_ts ON fuel_events(station_id, ts);
CREATE INDEX IF NOT EXISTS idx_fuel_events_org_ts ON fuel_events(organization_id, ts);
CREATE INDEX IF NOT EXISTS idx_fuel_events_type_ts ON fuel_events(type, ts);

-- --------------------------------------------------------------------------
-- Alert engine
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_rules (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  type            TEXT NOT NULL,
  scope           TEXT NOT NULL DEFAULT 'tank',
  tank_id         TEXT REFERENCES tanks(id) ON DELETE CASCADE,
  station_id      TEXT REFERENCES stations(id) ON DELETE CASCADE,
  device_id       TEXT REFERENCES devices(id) ON DELETE CASCADE,
  fuel_type_id    TEXT REFERENCES fuel_types(id) ON DELETE CASCADE,
  condition       TEXT NOT NULL DEFAULT '{}',
  severity        TEXT NOT NULL DEFAULT 'warning',
  channels        TEXT NOT NULL DEFAULT '["in_app","email"]',
  is_enabled      INTEGER NOT NULL DEFAULT 1,
  cooldown_min    INTEGER NOT NULL DEFAULT 30,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_alert_rules_org ON alert_rules(organization_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(is_enabled);
CREATE TABLE IF NOT EXISTS alerts (
  id                 TEXT PRIMARY KEY,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  station_id         TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  tank_id            TEXT REFERENCES tanks(id) ON DELETE CASCADE,
  device_id          TEXT REFERENCES devices(id) ON DELETE CASCADE,
  fuel_event_id      TEXT REFERENCES fuel_events(id) ON DELETE SET NULL,
  rule_id            TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
  type               TEXT NOT NULL,
  severity           TEXT NOT NULL DEFAULT 'warning',
  title              TEXT NOT NULL,
  message            TEXT NOT NULL,
  value              REAL,
  unit               TEXT,
  threshold          REAL,
  status             TEXT NOT NULL DEFAULT 'active',
  metadata           TEXT,
  acknowledged_at    TEXT,
  acknowledged_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at        TEXT,
  resolved_by_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolution_note    TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_org_status ON alerts(organization_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_station ON alerts(station_id);
CREATE INDEX IF NOT EXISTS idx_alerts_tank ON alerts(tank_id);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);

CREATE TABLE IF NOT EXISTS alert_notes (
  id         TEXT PRIMARY KEY,
  alert_id   TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_alert_notes_alert ON alert_notes(alert_id);


-- --------------------------------------------------------------------------
-- Reporting
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  category        TEXT NOT NULL,
  period          TEXT NOT NULL,
  date_from       TEXT NOT NULL,
  date_to         TEXT NOT NULL,
  filters         TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'ready',
  progress        INTEGER NOT NULL DEFAULT 100,
  format          TEXT NOT NULL DEFAULT 'pdf',
  file_url        TEXT,
  summary         TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_org_created ON reports(organization_id, created_at);

CREATE TABLE IF NOT EXISTS scheduled_reports (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  period          TEXT NOT NULL,
  day_of_week     INTEGER,
  day_of_month    INTEGER,
  time_of_day     TEXT NOT NULL DEFAULT '18:00',
  timezone        TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  recipients      TEXT NOT NULL DEFAULT '[]',
  format          TEXT NOT NULL DEFAULT 'pdf',
  station_id      TEXT REFERENCES stations(id) ON DELETE SET NULL,
  filters         TEXT NOT NULL DEFAULT '{}',
  is_enabled      INTEGER NOT NULL DEFAULT 1,
  last_run_at     TEXT,
  next_run_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_org ON scheduled_reports(organization_id);

-- --------------------------------------------------------------------------
-- Integrations & configuration
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  provider        TEXT NOT NULL,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'disconnected',
  config          TEXT NOT NULL DEFAULT '{}',
  secret_ref      TEXT,
  last_sync_at    TEXT,
  last_error      TEXT,
  is_enabled      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (organization_id, kind, provider)
);
CREATE INDEX IF NOT EXISTS idx_integrations_org ON integrations(organization_id);

CREATE TABLE IF NOT EXISTS system_settings (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL DEFAULT 'null',
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (organization_id, key)
);
CREATE INDEX IF NOT EXISTS idx_system_settings_org ON system_settings(organization_id);

-- --------------------------------------------------------------------------
-- Notifications & audit
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
  alert_id        TEXT,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info',
  channel         TEXT NOT NULL DEFAULT 'in_app',
  is_read         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(organization_id, is_read, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_label  TEXT NOT NULL DEFAULT 'System',
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  entity_label TEXT,
  summary     TEXT NOT NULL,
  previous    TEXT,
  next        TEXT,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
