const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smartfuel-maintenance-test-"));
const databasePath = path.join(testDirectory, "maintenance.sqlite");
const bootstrap = new (require("node:sqlite").DatabaseSync)(databasePath);
bootstrap.exec(fs.readFileSync(path.resolve(process.cwd(), "db/schema.sqlite.sql"), "utf8"));
bootstrap.close();

process.env.DB_PROVIDER = "sqlite";
process.env.DATABASE_URL = `file:${databasePath}`;
process.env.CRON_SECRET = "maintenance-test-cron-secret-value";

const { execute, queryOne } = require("../src/server/db/client.ts");
const {
  DEFAULT_SWEEP_INTERVAL_SECONDS,
  MIN_SWEEP_INTERVAL_SECONDS,
  claimSweepLease,
  intervalElapsed,
  resetMaintenanceSweepState,
  runMaintenanceSweep,
  scheduleMaintenanceSweep,
  sweepIntervalSeconds,
} = require("../src/server/services/maintenance-sweep.ts");

const LEASE_KEY = "maintenance:sweep";
const LEASE_SQL = "SELECT key, count, reset_at FROM rate_limit_buckets WHERE key = ?";

async function leaseRow() {
  return queryOne(LEASE_SQL, [LEASE_KEY]);
}

async function clearLease() {
  await execute("DELETE FROM rate_limit_buckets WHERE key = ?", [LEASE_KEY]);
}

/** Polls until the background sweep has claimed its lease. */
async function waitForLease(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await leaseRow();
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The opportunistic sweep never claimed its lease.");
}

test("the sweep interval falls back to a safe default and never drops below one minute", () => {
  assert.equal(sweepIntervalSeconds({}), DEFAULT_SWEEP_INTERVAL_SECONDS);
  assert.equal(sweepIntervalSeconds({ MAINTENANCE_SWEEP_INTERVAL_SECONDS: "900" }), 900);
  assert.equal(sweepIntervalSeconds({ MAINTENANCE_SWEEP_INTERVAL_SECONDS: "60" }), MIN_SWEEP_INTERVAL_SECONDS);
  // Below the floor, empty, and unparseable values must not tighten the schedule.
  assert.equal(sweepIntervalSeconds({ MAINTENANCE_SWEEP_INTERVAL_SECONDS: "5" }), DEFAULT_SWEEP_INTERVAL_SECONDS);
  assert.equal(sweepIntervalSeconds({ MAINTENANCE_SWEEP_INTERVAL_SECONDS: "" }), DEFAULT_SWEEP_INTERVAL_SECONDS);
  assert.equal(sweepIntervalSeconds({ MAINTENANCE_SWEEP_INTERVAL_SECONDS: "soon" }), DEFAULT_SWEEP_INTERVAL_SECONDS);
  assert.equal(sweepIntervalSeconds({ MAINTENANCE_SWEEP_INTERVAL_SECONDS: "300.9" }), 300);
});

test("the in-process gate only opens once the interval has elapsed", () => {
  const at = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(intervalElapsed(at, at + 299_999, 300_000), false);
  assert.equal(intervalElapsed(at, at + 300_000, 300_000), true);
  assert.equal(intervalElapsed(at, at + 300_001, 300_000), true);
  // A clock that jumps backwards must not wedge the sweep shut forever.
  assert.equal(intervalElapsed(at, at - 5_000, 300_000), false);
  assert.equal(intervalElapsed(0, at, 300_000), true);
});

test("the lease is durable and re-opens only after its window closes", async () => {
  await clearLease();
  const at = Date.parse("2026-01-01T00:00:00.000Z");

  assert.equal(await claimSweepLease(300, at), true, "the first claim in a window wins");
  assert.equal(Number((await leaseRow()).reset_at), at + 300_000);

  assert.equal(await claimSweepLease(300, at + 1_000), false, "a concurrent instance is refused");
  assert.equal(await claimSweepLease(300, at + 299_999), false, "still inside the window");
  assert.equal(
    Number((await leaseRow()).reset_at),
    at + 300_000,
    "a refused claim must not push the window out, or steady traffic would starve the sweep",
  );

  assert.equal(await claimSweepLease(300, at + 300_000), true, "the next window opens on time");
  assert.equal(Number((await leaseRow()).reset_at), at + 600_000, "and restarts from the moment of the claim");
  assert.equal(await claimSweepLease(300, at + 301_000), false, "and closes immediately after");
});

test("request traffic starts at most one sweep per interval", async () => {
  await clearLease();
  resetMaintenanceSweepState();

  // Three calls in the same tick: only the first may reach the database.
  scheduleMaintenanceSweep("test-first");
  scheduleMaintenanceSweep("test-second");
  scheduleMaintenanceSweep("test-third");

  const row = await waitForLease();
  assert.equal(row.count, 1, "the in-process gate stopped the repeat calls from claiming again");
});

test("the sweep reports on every active organization and the cron route keeps its contract", async (t) => {
  t.after(() => {
    resetMaintenanceSweepState();
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  await execute("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", ["org-maint", "Maintenance", "maint"]);
  await execute("INSERT INTO organizations (id, name, slug, is_active) VALUES (?, ?, ?, 0)", [
    "org-maint-off",
    "Dormant",
    "dormant",
  ]);

  const summary = await runMaintenanceSweep();
  assert.equal(summary.processed, 1, "only the active organization is swept");
  assert.deepEqual(summary.results, [{ organizationId: "org-maint", offline: 0, restored: 0 }]);
  assert.equal(summary.clearedMfaChallenges, 0);
  assert.equal(summary.clearedMfaEnrollments, 0);

  const { GET } = require("../src/app/api/cron/maintenance/route.ts");
  const url = "http://localhost/api/cron/maintenance";

  const anonymous = await GET(new Request(url));
  assert.equal(anonymous.status, 401);

  const wrongSecret = await GET(new Request(url, { headers: { authorization: "Bearer not-the-secret-xxxxxx" } }));
  assert.equal(wrongSecret.status, 401);

  const authorized = await GET(new Request(url, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }));
  assert.equal(authorized.status, 200);

  const body = await authorized.json();
  assert.equal(body.ok, true);
  // The response keys the deployment relies on must survive the refactor.
  for (const key of ["processed", "results", "scheduledReports", "deliveries", "clearedMfaChallenges", "clearedMfaEnrollments"]) {
    assert.ok(key in body, `the cron response is missing "${key}"`);
  }
  assert.equal(body.processed, 1);
});
