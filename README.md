# SmartFuel — Fuel Monitoring & Management Platform

A production-ready SaaS application for monitoring fuel tanks, detecting refills and
consumption, reconciling inventory against probe readings, and running a fleet — built to the
specification in [`PRD-FMS.pdf`](./PRD-FMS.pdf).

The platform connects **fuel probes → ingest API → backend → database → web app**, with a
GPS/telematics path that shares the same authentication and normalization layer.

---

## What it does

| Area | What you get |
| --- | --- |
| **Monitoring** | Live tank levels, volume, temperature and water level. Underground tank visualisations with smooth liquid animation. Every reading is stamped and labelled **LIVE / DELAYED / OFFLINE**. |
| **Event engine** | Raw readings are classified into **refill**, **consumption** and **anomaly** movements with a confidence rating. Raw readings and derived events are stored separately, so the audit trail stays intact. |
| **Inventory reconciliation** | Opening stock + refills − consumption = expected closing, compared against what the probe measured, per tank. Variances raise an investigation alert — never an automatic theft claim. |
| **Alerts** | Configurable rules (low %, critical %, overfill %, offline timeout, anomaly sensitivity, water, temperature) with a full **Active → Acknowledged → Resolved** lifecycle, notes and assignment. |
| **Fuel Usage Replay** | Play / pause / speed / timeline scrubbing over historical readings for any tank. |
| **Fleet** | Vehicles, GPS trackers, driver assignment and a network map plotted from real coordinates. |
| **Reports** | Daily / weekly / monthly / custom reports across ten categories, exported as PDF, Excel or CSV, plus scheduled deliveries. |
| **Administration** | Multi-tenant organizations, five operating roles plus a platform super admin, RBAC enforced at the API level, integrations, audit log and settings. |

### Product rules the implementation follows

- **Never invent probe values.** When a reading does not exist the interface says
  *“Not available”* — it never shows a plausible-looking number.
- **“Fuel Consumption / Tank Outflow”, not “liters sold.”** Until dispenser integration
  exists, outflow describes what left the tank, not what a pump rang up.
- **Never auto-claim theft.** Unexplained drops are flagged as *“possible anomaly detected”*
  and routed to a human.
- **Measured vs calculated is always distinguished**, along with the timestamp and the
  device that reported the value.
- **Offline handling**: detect the timeout, mark the device offline, notify, preserve the last
  valid reading, show the stale timestamp, auto-restore on recovery, and record the outage
  duration.
- **Impossible readings are rejected** — negative volume, level above capacity, temperature
  outside the physical range — before they reach the database.

---

## Quick start

```bash
npm install
cp .env.example .env          # then edit the values
npm run db:seed               # creates db/smartfuel.db with demo data
npm run dev                   # http://localhost:3000
```

Sign in with any seeded account — the password for all of them is `FuelWatch2026!`:

| Email | Role |
| --- | --- |
| `george@puma.co.tz` | Super Admin |
| `sarah@puma.co.tz` | Owner |
| `daniel@puma.co.tz` | Manager |
| `asha@puma.co.tz` | Station Manager |
| `neema@puma.co.tz` | Supervisor |
| `juma@puma.co.tz` | Finance |
| `admin@total.co.tz` | Super Admin (second tenant) |
| `manager@total.co.tz` | Manager (second tenant) |

Two tenants are seeded — **PUMA Tanzania** and **Total Energies Tanzania** — so you can see
that data never crosses the organization boundary.

### Demo data vs live data

The seeded database contains 30 days of internally consistent readings, derived movements,
alerts, vehicles and audit history. The seed is static and deterministic. The simulator is no longer started from a web request or
Next.js layout (that is unsafe on Vercel); invoke the simulator only from an explicit local/demo
tool. Set `DEMO_SIMULATOR=off` in production.

**Anything the simulator produces is labelled as simulated data.** Keep `DEMO_SIMULATOR=off`
and connect a real probe to switch to live hardware — nothing else changes.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:seed` | (Re)create the schema and seed demo data |
| `npm run db:setup` | Create the local SQLite schema, or apply pending PostgreSQL migrations |
| `npm run db:migrate` | Apply versioned `supabase/migrations/*.sql` to PostgreSQL |
| `npm run db:seed:postgres` | Idempotently bootstrap one Supabase organization, admin, station and tank |
| `npm run db:reset` | Drop and recreate the local SQLite schema (never resets PostgreSQL) |

---

## Vercel + Supabase deployment

Production uses Supabase PostgreSQL; SQLite is only a local development adapter. The checked-in
`supabase/migrations/0001_initial.sql` is the versioned schema baseline and the application never
creates production tables during a request.

1. Create a Supabase project and copy both its **direct** database URL (for migrations) and its
   **shared transaction pooler** URL (port `6543`, for Vercel Functions).
2. Apply the schema from a trusted migration environment:

   ```bash
   DB_PROVIDER=postgresql DATABASE_URL="<supabase-direct-url>" npm run db:migrate
   ```

3. Bootstrap the first tenant with secrets supplied through your shell or CI secret manager:

   ```bash
   DB_PROVIDER=postgresql DATABASE_URL="<supabase-direct-url>" \
     SEED_ADMIN_EMAIL="admin@example.com" \
     SEED_ADMIN_PASSWORD="use-a-unique-12-character-password" \
     SEED_DEVICE_KEY="generate-a-device-key" \
     npm run db:seed:postgres
   ```

4. Import the repository into Vercel and set `DB_PROVIDER=postgresql`, the **pooler**
   `DATABASE_URL`, a long random `AUTH_SECRET`, the public `AUTH_URL`, and the SMTP variables
   documented in [`.env.example`](./.env.example). Set `CRON_SECRET` as a Vercel secret, keep
   `DEMO_SIMULATOR=off`, and do not expose Supabase service-role credentials to the browser.
5. Deploy with the committed `vercel.json`. Its five-minute Cron invokes
   `/api/cron/maintenance` to sweep stale devices across all active organizations. The runtime
   PostgreSQL client uses a small pool,
   disables prepared statements for transaction pooling, and requires TLS. Rate-limit buckets
   are stored in PostgreSQL so limits work across Vercel instances.

The realtime endpoint reads durable PostgreSQL snapshots and has a bounded 60-second Vercel
lifetime; clients reconnect/poll rather than relying on an in-process event bus. Report exports
are generated in memory and returned in the response, so no local filesystem survives a deploy.

---

## Architecture

```
Probes / GPS trackers
        │  vendor payload + X-Device-Key
        ▼
POST /api/webhooks/device/:provider        Device Integration Layer
        │  provider.verify()  →  provider.normalize()
        ▼
Event engine (src/server/engine/fuel.ts)
   validate → classify movement → store event → evaluate rules
        │
        ├──► readings / fuel_events / alerts tables
        ├──► durable PostgreSQL snapshot stream (bounded SSE / polling)
        └──► audit log
        ▼
Web app (Next.js App Router, server components by default)
```

### Layout

```
src/
  app/
    (auth)/                 login, forgot/reset password
    (app)/                  authenticated shell
      page.tsx              dashboard
      stations/ tanks/ devices/ vehicles/
      movements/            fuel movement ledger
      alerts/  alerts/rules/
      reports/  reports/scheduled/
      map/
      admin/                users, roles, organizations, integrations
      settings/             organization, fuel types, notifications, system
      audit-logs/
    api/                    REST endpoints (see below)
  components/
    ui/                     buttons, forms, tables, overlays, feedback
    charts/                 SVG chart kit, tank visual, replay, network map
    domain/                 domain badges, shared query hook
    layout/                 app shell, nav, command palette, notifications
  server/
    api/route.ts            envelopes, auth + permission wrappers, validation
    auth/                   JWT sessions, password hashing, lockout, RBAC
    db/                     client + repositories
    domain/types.ts         entity interfaces
    engine/fuel.ts          ingest, validation, classification, health, reconciliation
    integrations/           provider adapters + simulator
    realtime/bus.ts         SSE fan-out
    services/               analytics read models, report builder
  lib/                      formatters, status vocabulary, CSV/Excel export
db/schema.sql               canonical PostgreSQL schema source
db/schema.sqlite.sql        local SQLite development schema
supabase/migrations/        versioned PostgreSQL migrations
scripts/seed.mjs            local demo data generator
scripts/seed-postgres.mjs   minimal production bootstrap seed
```

### API

| Method | Endpoint | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/login` · `/logout` · `/forgot-password` · `/reset-password` | sessions |
| `GET` | `/api/health` | liveness + row counts |
| `GET` | `/api/dashboard` | KPI + chart read model |
| `GET` | `/api/search` | global search for the command palette |
| `GET` | `/api/stream` | SSE realtime channel |
| `GET`/`POST` | `/api/stations` · `/api/tanks` · `/api/devices` · `/api/vehicles` | CRUD |
| `GET`/`PATCH`/`DELETE` | `/api/stations/[id]` · `/api/tanks/[id]` · … | single record |
| `GET` | `/api/tanks/[id]/readings` · `/movements` · `/replay` | history |
| `GET`/`POST` | `/api/movements` · `/api/alerts` · `/api/alert-rules` · `/api/reports` | lists + create |
| `POST` | `/api/alerts/[id]/acknowledge` · `/resolve` · `/notes` | lifecycle |
| `GET` | `/api/reports/[id]/export?format=csv\|excel\|pdf` | generated file |
| `GET`/`POST` | `/api/scheduled-reports` | schedules |
| `GET`/`POST` | `/api/users` · `/api/roles` · `/api/organizations` · `/api/integrations` | admin |
| `GET`/`PATCH` | `/api/settings` · `/api/fuel-types` | configuration |
| `GET` | `/api/audit-logs` | append-only trail |
| `POST` | `/api/webhooks/device/[provider]` | device ingest |

Every response uses the envelope `{ ok: true, data }` or `{ ok: false, error: { message, code } }`.
Raw stack traces are never returned to the client.

### Authorization

Permissions are checked in the API wrapper (`withPermission`), not in the UI. The seeded roles:

| Role | Scope |
| --- | --- |
| **Super Admin** | Platform-wide; every organization |
| **Owner** | Everything inside the organization, including billing-level settings |
| **Manager** | Stations, tanks, devices, alerts, reports, users (no organization settings) |
| **Station Manager** | Their assigned stations and tanks |
| **Supervisor** | Read + acknowledge alerts, no configuration |
| **Finance** | Reports, reconciliation, read-only elsewhere |
| **Viewer** | Read-only |

See [`docs/ERD.md`](./docs/ERD.md) for the data model.

---

## Connecting real hardware

### 1. Fuel probes

Register the device (`/devices/new`), then point your gateway at:

```
POST https://<your-host>/api/webhooks/device/tectonic
X-API-Key: <device-key>
```

Adapters exist for **Tectonic**, **Veeder-Root**, a **generic MQTT bridge**, **Queclink** and
**Teltonika**. Each adapter does two things: `verify()` the request signature and
`normalize()` the vendor payload into the platform reading shape:

```json
{
  "stationId": "stn_arn01",
  "tankId": "tnk_arn01_dA",
  "deviceId": "dev_...",
  "timestamp": "2026-09-25T15:42:21.000Z",
  "fuelType": "diesel",
  "volumeLiters": 38420,
  "levelPercent": 76.8,
  "temperature": 28.4,
  "waterLevel": 0,
  "signal": "good"
}
```

Adding a new vendor means registering one adapter in
`src/server/integrations/providers.ts` — nothing else in the application changes.

#### Device authentication

Each device carries its **own** ingest key, sent as `x-api-key` (or
`Authorization: Bearer <key>`). Only the SHA-256 hash is stored — the plaintext key is shown
once, when the device is registered, and never again.

```
curl -X POST https://<your-host>/api/webhooks/device/tectonic \
  -H "x-api-key: <device-key>" \
  -H "content-type: application/json" \
  -d '{ "deviceSerial": "PROBE-100407", "timestamp": "2026-09-25T15:42:21.000Z",
        "volumeLiters": 38420, "levelPercent": 76.8, "temperatureC": 28.4,
        "waterLevelMm": 0, "signal": "good" }'
```

A request without a valid key is rejected **before** the payload is parsed. In the seeded demo
database every device's key is `demo-<serial-number-in-lowercase>` (for example
`demo-probe-100407`), so the whole ingest path can be exercised end to end without hardware.
Real deployments generate a random key per device and never store the plaintext.

A lost key is not recoverable by design. Use **Rotate key** on the device list
(`PATCH /api/devices/{id}` with `{"rotateApiKey": true}`) — the old key stops working
immediately and the replacement is shown once. Rotating keeps the device's reading
history intact.

#### Rejected readings

A payload the engine cannot trust never reaches reporting. It is answered with `422`
(impossible value) or `409` (device misconfigured) and the reason is written back to the
caller, for example:

| Payload problem | Response |
| --- | --- |
| Negative volume | `422 Negative volume reported (-500 L)` |
| Volume above tank capacity | `422 Reported volume 999999 L exceeds tank capacity 34125 L` |
| Implausible temperature | `422 Implausible temperature (999 °C)` |
| No volume field at all | `422 The Tectonic Probe Gateway payload could not be normalised into a reading` |
| Malformed JSON | `422 Request body must be valid JSON.` |
| Missing or wrong device key | `401 Device credentials were rejected.` |
| Unknown provider | `404` |
| Tracker sent to the probe endpoint | `409 This device is a GPS tracker, not a fuel probe…` |

### 2. GPS / telematics

Same endpoint, different provider key. Positions land on the network map and on the vehicle
record; a tracker that stops reporting raises a `gps_offline` alert after the configured
timeout.

### 3. Email and in-app notifications

Password-reset links are delivered through the configured `SMTP_*` transport and are never
returned by the API. In-app alert notifications are durable PostgreSQL rows and are surfaced by
polling, so they work across serverless instances. See [`.env.example`](./.env.example).

---

## Configuration

Everything is read from environment variables — no secrets are committed, stored in the
database, or exposed to the browser. `.env.example` documents every key. The
**Settings → System** screen reports which variables are present without ever printing their
values.

| Variable | Purpose |
| --- | --- |
| `DB_PROVIDER` · `DATABASE_URL` | `sqlite` (default) or `postgresql` |
| `AUTH_SECRET` | signs session JWTs — must be long and random |
| `AUTH_URL` | public origin, used in password-reset links |
| `SESSION_MAX_AGE_SECONDS` | session lifetime |
| Device credentials | per-device API keys are hashed at rest; HMAC providers also require the provider signature |
| `REALTIME_TRANSPORT` | `sse` (default) or `polling` |
| `DEMO_SIMULATOR` | `on` generates synthetic traffic, `off` is live-only |
| `RATE_LIMIT_MAX` · `RATE_LIMIT_WINDOW_SECONDS` | per-client rate limiting |
| `SMTP_*` | password-reset email delivery |

Units, currency, language and timezone are per-organization settings. Readings are always
stored in litres and Celsius at capture time; changing a display setting never rewrites
history.

---

## Reliability & accessibility

- **No blank screens.** Every list has a proper empty state (*“No tanks have been added yet”*
  with an **+ Add Tank** action) and an elegant skeleton loader while loading.
- **No raw errors.** API failures surface a plain-language message with a retry action.
- **Status is never colour-only** — icons and text accompany every state (WCAG 1.4.1).
- **Responsive** desktop-first, with a mobile bottom nav (Home · Stations · Alerts · Reports ·
  More).
- **Keyboard operable** throughout, including the map markers and the ⌘K command palette.
- **PWA-ready** — web manifest and maskable icons ship in `public/`.
- **Light / dark / system** theming with no flash of wrong theme on load.
- **Deep links are honoured.** A KPI card that promises a filtered view actually applies the
  filter — `/tanks?low=true`, `/devices?status=offline` and
  `/devices?type=fuel_probe&reporting=problem` all land on the filtered table.
- **Honest status codes.** Uniqueness violations become `409` naming the conflicting field;
  authorisation failures are `403`; missing records are `404`. A 500 is always a genuine
  server fault and is logged, never shown to the user.
- **KPIs reconcile with the database.** Station, tank, capacity, alert and movement totals on
  the dashboard are computed from the same rows the tables show, and the “not reporting”
  device count uses exactly the predicate behind `GET /api/devices?reporting=problem`.

---

## Notes on the demo environment

The application uses a system font stack, `lucide-react` icons, a hand-built SVG network map
(no tiles or map API key), and `node:sqlite` only for local development. Production uses the
async `postgres` adapter against Supabase through the repository boundary in
`src/server/db/repo/`.
