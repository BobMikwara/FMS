# SmartFuel — Entity Relationship Documentation

The executable schema is [`db/schema.sql`](../db/schema.sql). This document explains the shape
of the model, the reasoning behind it, and the invariants the application relies on. It is
generated from the schema, so if the two ever disagree the schema wins.

**21 tables.** Runtime is SQLite (`node:sqlite`); the same shape ports to PostgreSQL by
swapping the data types listed under [Portability](#portability).

---

## Conventions

| Concern | Convention |
| --- | --- |
| Primary keys | `TEXT`, cuid-like prefixed ids (`org_`, `usr_`, `stn_`, `tnk_`, `dev_`, `veh_`, `evt_`, `alr_`, `rpt_`…) so the type of a record is obvious in logs and URLs. |
| Booleans | `INTEGER` `0` / `1`. |
| Floats | `REAL`. Volumes in **litres**, temperatures in **Celsius**, levels as both `REAL` litres and percent. |
| Timestamps | `TEXT`, **ISO-8601 UTC** (`2026-09-26T07:33:26Z`). Every default and every write uses `strftime('%Y-%m-%dT%H:%M:%SZ','now')`, so all timestamps sort lexicographically and range queries are correct. |
| JSON columns | `TEXT` holding a JSON document (`permissions`, `condition`, `metadata`, `filters`, `recipients`, `previous`, `next`). Small, never queried by the database, and easy to evolve. |
| Foreign keys | Enforced with `PRAGMA foreign_keys = ON`. Deletion cascades from `organizations` down; records that must survive (readings, audit logs, fuel events) use `ON DELETE SET NULL` on the actor/device side. |
| Table order | `db/schema.sql` is ordered so no `CREATE TABLE` forward-references a table that does not exist yet. Keep `user_stations` after `stations` and `alert_rules` before `alerts` if the file is rewritten. |
| Indexes | Every foreign key used in a `WHERE` clause has an index; see the `idx_*` statements at the end of each table. |

---

## Tenancy and identity

```
organizations ──1:N──> users ──N:1──> roles
      │                   │
      │                   └──N:N──> stations        (user_stations)
      │
      └──1:N──> stations ──1:N──> tanks ──1:N──> readings
```

### `organizations`
The tenant boundary. Everything else hangs off `organization_id`, and every repository query
filters on it — there is no code path that reads across tenants. Carries the display
preferences (`currency`, `units`, `temp_unit`, `timezone`, `locale`, `plan`).

> Readings are **always stored in litres and Celsius at capture time**. These settings only
> control display, so changing them never rewrites history.

### `roles` and `users`
`roles` holds the permission list as a JSON array of strings (`dashboard.view`,
`tanks.create`, …). `users` carries the credential material: `password_hash` (bcrypt),
`failed_attempts` and `locked_until` for the lockout policy, and `mfa_enabled`.

`roles` is deliberately **not** scoped to an organization — the five operating roles plus the
platform super admin are shared vocabulary, which keeps the permission names meaningful in the
audit log. `users.organization_id` provides the tenant boundary.

### `user_stations`
Join table scoping a user to specific stations. An empty set means *whole organization*, which
is what the Owner and Super Admin roles get; managers and operators get explicit rows.

### `password_reset_tokens`
Only the **hash** of a reset token is stored, with an expiry and a `used_at` marker so a token
is single-use.

---

## Physical plant

```
stations ──1:N──> tanks ──N:1──> fuel_types
    │                │
    │                └──1:N──> devices      (a probe is bound to one tank)
    │                         
    └──1:N──> devices ──N:1──> vehicles      (a tracker is bound to one vehicle)
```

### `stations`
A physical site with coordinates (`latitude`, `longitude`) used by the network map, trading
hours (`opening_time`, `closing_time`) used by the anomaly detector to judge whether a movement
happened inside operating hours, and a rollup `status` of `online | warning | critical |
offline`.

### `tanks`
The heart of the model. Beyond `capacity` and `current_volume` it stores the **per-tank
thresholds** (`low_threshold_pct`, `critical_threshold_pct`, `overfill_threshold_pct`), because
a 40,000 L diesel tank and a 2,000 L petrol tank should not share one low-level rule.

`last_reading_at` is the timestamp of the last reading of any quality;
`last_valid_reading_at` is the last one that passed validation. When a probe goes silent the
interface shows the latter with a stale-data banner, so a stale number is never mistaken for a
live one.

`status` is `full | normal | low | critical | offline`. **`offline` is deliberately a tank
status as well as a device status** — a tank whose probe has stopped reporting is not “normal,
we just don't know”.

### `fuel_types`
`system_name` is the stable machine key (`diesel`, `petrol_95`); `display_name` is what humans
read. `density` converts probe height into volume and must match the supplier's certificate of
analysis.

### `devices`
One table for both **fuel probes** and **GPS trackers**, discriminated by `type`. That is a
deliberate choice: both arrive over the same authenticated endpoint, both go through the same
`normalize()` step, and both share the offline-timeout logic. A probe points at `tank_id`; a
tracker points at `vehicle_id`.

`api_key_hash` stores a SHA-256 of the device ingest key. **The key itself is never stored and
never returned by the API layer.**

`status` is `never_connected | online | delayed | offline | fault`. `never_connected` is
distinct from `offline` so a freshly registered device is not immediately reported as a
failure.

### `vehicles`
The fleet. `station_id` is the home station (used as a fallback position on the map when no GPS
fix has arrived), `driver_name` / `driver_phone` support the contact workflow, and
`is_archived` removes a vehicle from active lists without destroying its history.

---

## Readings and derived events

```
devices ──> readings (raw, immutable) ──> fuel_events (derived) ──> alerts
```

### `readings`
One row per probe report, **immutable and unedited**. `raw` keeps the original vendor payload
verbatim so a disputed number can always be traced back to what the hardware actually sent.
This is the single source of truth; everything downstream is a derivation.

### `fuel_events`
The derived movement ledger. Each row records what changed between two consecutive readings:

| Column | Meaning |
| --- | --- |
| `type` | `consumption` \| `refill` \| `anomaly` \| `water_detected` \| `temperature_abnormal` |
| `volume` | Magnitude of the movement in litres (always positive) |
| `level_before` / `level_after` | Volume before and after, so the arithmetic is auditable |
| `duration_sec` | How long the movement took — a 2,900 L rise in 3 minutes is a delivery, the same rise over 6 hours is not |
| `confidence` | `high` \| `medium` \| `low` |
| `status` | `confirmed` \| `suspected` \| `rejected` |
| `reason` | Human-readable explanation, e.g. *“Delivery recorded outside operating hours”* |

Keeping raw readings and derived events in separate tables is a hard requirement: it means the
classification logic can be re-run against unchanged inputs, and a reclassification never
rewrites history.

---

## Alerting

```
alert_rules ──> alerts ──> alert_notes
                    │
                    └──> notifications
```

### `alert_rules`
Ten rule types ship seeded: `low_fuel`, `critical_fuel`, `overfill`, `suspected_loss`,
`refill`, `probe_offline`, `gps_offline`, `water_detected`, `temperature_abnormal`,
`invalid_reading`.

`condition` is a JSON document (`{ metric, operator, value, windowMinutes? }`), `scope` is
`tank | station | organization`, and the optional `tank_id` / `station_id` / `device_id` /
`fuel_type_id` columns narrow it. `cooldown_min` prevents a flapping probe from generating
hundreds of identical alerts.

### `alerts`
Carries the full lifecycle: `status` of `active | acknowledged | resolved`, with
`acknowledged_at` / `acknowledged_by_id` / `resolved_at` / `resolved_by_id` and
`resolution_note`. `assigned_to_id` supports the “who owns this” workflow. `value`, `unit` and
`threshold` record what actually tripped the rule, so the alert is self-explanatory months
later. `fuel_event_id` links an anomaly alert back to the exact movement that caused it.

`metadata` holds the *“possible anomaly detected”* framing. **The engine never writes a
conclusion of theft** — it records an observation and routes it to a human.

### `alert_notes`
Append-only discussion thread on an alert. Notes are the operational record of an
investigation.

### `notifications`
Per-user inbox entries with `channel` (`in_app | email | sms | push`) and `is_read`.

---

## Reporting

### `reports`
A generated artefact: `category`, `period`, `date_from`/`date_to`, `format`, `filters`,
`status`, `progress`, `file_url` and `error`. The dataset is built on demand by
`src/server/services/report-builder.ts` from the same read models the dashboard uses, so the
download can never disagree with the screen.

### `scheduled_reports`
A recurring definition: `period` (`daily | weekly | monthly`), `day_of_week`, `day_of_month`,
`time_of_day`, `timezone`, `recipients` (JSON array), `format`, and an optional `station_id`
scope. `last_run_at` / `next_run_at` drive the schedule and the UI countdown.

---

## Platform services

### `integrations`
One row per connected vendor, with a `UNIQUE (organization_id, kind, provider)` constraint so a
provider cannot be registered twice. `kind` is `probe | telematics | notification |
accounting`; `provider` is the adapter key registered in
`src/server/integrations/providers.ts`.

**`secret_ref` holds the *name of an environment variable*, never a credential.** The actual
secret lives in the deployment environment, is read server-side, and is never written to the
database or sent to the browser.

### `system_settings`
Key/value configuration per organization, with the value stored as JSON. Written only through
the `PATCH /api/settings` endpoint, which validates the group names first so a malformed
payload cannot corrupt unrelated configuration. Engine tunables live under the `engine` key
(refill threshold, consumption minimum, rapid-change rate, offline timeout, delayed threshold,
temperature bounds, reconciliation variance).

### `audit_logs`
Append-only. Every write action in the API records the acting user, their IP address and user
agent, the affected entity, and `previous` / `next` JSON snapshots. There is no update or
delete path — the table is the compliance record.

---

## Data flow

```
   probe / tracker
        │  vendor payload + X-Device-Key
        ▼
   provider.verify()          reject bad signatures before parsing
        ▼
   provider.normalize()       → NormalizedReading
        ▼
   validateReading()          reject negative, over-capacity, out-of-range temperature
        ▼
   INSERT readings            raw payload preserved in `raw`
        ▼
   classifyMovement()         compare with the previous valid reading
        ▼
   INSERT fuel_events         consumption | refill | anomaly (+ confidence, reason)
        ▼
   evaluateRules()            match against alert_rules, honouring cooldown
        ▼
   INSERT alerts              + notifications
        ▼
   realtime bus (SSE)         browser updates without a refresh
        ▼
   sweepDeviceHealth()        mark offline / auto-restore, record outage duration
        ▼
   reconcileTank()            opening + refills − consumption vs measured
```

Two sweeps run on a timer rather than only on ingest:

- **`sweepDeviceHealth`** — a device silent past `deviceOfflineMinutes` is marked offline, its
  tank is marked offline, an alert is raised, and the last valid reading is preserved. When
  data returns the device is restored automatically and the offline alert is resolved with the
  note *“Device communication restored”*.
- **`reconcileTank`** — compares expected closing stock against the probe reading and raises an
  alert when the variance exceeds the configured percentage. The alert language is always
  *“possible anomaly”*, never *“theft”*.

---

## Portability

To move from SQLite to PostgreSQL, change the column types below and the connection string.
No application code changes — all data access is behind the repositories in
`src/server/db/repo/`.

| SQLite | PostgreSQL |
| --- | --- |
| `TEXT` primary keys | `TEXT` (or `UUID` with a cast on read) |
| `REAL` | `DOUBLE PRECISION` |
| `INTEGER` booleans | `BOOLEAN` |
| `TEXT` timestamps | `TIMESTAMPTZ` |
| `TEXT` JSON columns | `JSONB` |
| `strftime('%Y-%m-%dT%H:%M:%SZ','now')` | `now() AT TIME ZONE 'utc'` |
