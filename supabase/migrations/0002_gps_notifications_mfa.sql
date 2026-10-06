-- Additive storage for vehicle telemetry, durable notification delivery,
-- scheduled report runs, per-user notification reads, and MFA/session state.
-- Existing tables and rows are not modified or backfilled.

CREATE TABLE IF NOT EXISTS vehicle_positions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  received_at TEXT NOT NULL,
  latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  speed_kph REAL CHECK (speed_kph IS NULL OR speed_kph >= 0),
  heading_deg REAL CHECK (heading_deg IS NULL OR (heading_deg >= 0 AND heading_deg < 360)),
  ignition INTEGER CHECK (ignition IS NULL OR ignition IN (0, 1)),
  odometer_km REAL CHECK (odometer_km IS NULL OR odometer_km >= 0),
  event_key TEXT NOT NULL,
  UNIQUE (device_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_positions_latest
  ON vehicle_positions (organization_id, vehicle_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_positions_device_ts
  ON vehicle_positions (organization_id, device_id, ts DESC);

CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user
  ON notification_reads (user_id, read_at);

CREATE TABLE IF NOT EXISTS scheduled_report_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheduled_report_id TEXT NOT NULL REFERENCES scheduled_reports(id) ON DELETE RESTRICT,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (scheduled_report_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_report_runs_due
  ON scheduled_report_runs (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  notification_id TEXT REFERENCES notifications(id) ON DELETE SET NULL,
  scheduled_report_run_id TEXT REFERENCES scheduled_report_runs(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'delivered', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT,
  delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due
  ON notification_deliveries (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_org_created
  ON notification_deliveries (organization_id, created_at);

CREATE TABLE IF NOT EXISTS user_security_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  session_version INTEGER NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_mfa_enrollments (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_mfa_login_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_challenges_user_expiry
  ON user_mfa_login_challenges (user_id, expires_at);

CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_recovery_user
  ON user_mfa_recovery_codes (user_id, used_at);
