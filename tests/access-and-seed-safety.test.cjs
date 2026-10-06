const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  hasOrganizationWideStationAccess,
  roleRequiresStationAssignment,
  stationScopeForUser,
  userCanAccessStation,
  userCanAccessStationScopedUser,
} = require("../src/server/auth/authorization.ts");
const { translateSqlForPostgres } = require("../src/server/db/client.ts");
const { reportStationIsAllowed, resolveReportTimeZone } = require("../src/server/services/report-builder.ts");

const root = path.resolve(__dirname, "..");

function user(roleKey, stationIds = []) {
  return { roleKey, stationIds, organizationId: "org_test" };
}

test("station authorization keeps organization-wide, assigned, and empty scopes distinct", () => {
  const admin = user("admin", []);
  const operator = user("operator", ["station-a"]);
  const unassigned = user("operator", []);

  assert.equal(hasOrganizationWideStationAccess(admin), true);
  assert.equal(stationScopeForUser(admin), undefined);
  assert.deepEqual(stationScopeForUser(operator), ["station-a"]);
  assert.deepEqual(stationScopeForUser(unassigned), []);
  assert.equal(userCanAccessStation(operator, "station-a"), true);
  assert.equal(userCanAccessStation(operator, "station-b"), false);
  assert.equal(userCanAccessStation(unassigned, "station-a"), false);
});

test("manager and operator accounts require stations while administrators remain organization-wide", () => {
  assert.equal(roleRequiresStationAssignment("manager"), true);
  assert.equal(roleRequiresStationAssignment("operator"), true);
  assert.equal(roleRequiresStationAssignment("admin"), false);
  assert.equal(roleRequiresStationAssignment("super_admin"), false);
  assert.equal(roleRequiresStationAssignment("owner"), false);
});

test("station-scoped administrators cannot access organization-wide or cross-station user accounts", () => {
  const manager = user("manager", ["station-a"]);
  assert.equal(userCanAccessStationScopedUser(manager, ["station-a"], "operator"), true);
  assert.equal(userCanAccessStationScopedUser(manager, ["station-a", "station-b"], "operator"), false);
  assert.equal(userCanAccessStationScopedUser(manager, ["station-a"], "admin"), false);
  assert.equal(userCanAccessStationScopedUser(user("admin"), [], "admin"), true);
});

test("report station filters respect the caller's boundary and retain the saved time zone", async () => {
  const report = {
    organizationId: "org_test",
    filters: { stationId: "station-a", timeZone: "Africa/Dar_es_Salaam" },
  };
  assert.equal(reportStationIsAllowed(report, undefined), true);
  assert.equal(reportStationIsAllowed(report, ["station-a"]), true);
  assert.equal(reportStationIsAllowed(report, ["station-b"]), false);
  assert.equal(await resolveReportTimeZone(report), "Africa/Dar_es_Salaam");
});

test("PostgreSQL SQL translation preserves UTC hour buckets and parameter ordering", () => {
  const translated = translateSqlForPostgres(
    "SELECT strftime('%Y-%m-%dT%H:00', r.ts) AS bucket FROM readings r WHERE r.organization_id = ? AND r.ts >= ?",
  );
  assert.match(translated, /date_trunc\('hour', \(r\.ts::timestamptz AT TIME ZONE 'UTC'\)\)/);
  assert.match(translated, /YYYY-MM-DD\"T\"HH24:00/);
  assert.match(translated, /r\.organization_id = \$1 AND r\.ts >= \$2/);
});

test("seed and reset scripts refuse to run without explicit safety flags before opening a database", () => {
  const databasePath = path.join("/tmp", `fms-safety-guard-${process.pid}.sqlite`);
  const commonEnv = { ...process.env, DATABASE_URL: `file:${databasePath}` };

  const demoSeed = spawnSync(process.execPath, ["scripts/seed.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: commonEnv,
  });
  assert.notEqual(demoSeed.status, 0);
  assert.match(demoSeed.stderr, /explicit --demo flag/);
  assert.equal(existsSync(databasePath), false);

  const postgresSeed = spawnSync(process.execPath, ["scripts/seed-postgres.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: commonEnv,
  });
  assert.notEqual(postgresSeed.status, 0);
  assert.match(postgresSeed.stderr, /explicit --bootstrap flag/);
  assert.equal(existsSync(databasePath), false);

  const reset = spawnSync(process.execPath, ["scripts/setup-db.mjs", "--reset"], {
    cwd: root,
    encoding: "utf8",
    env: { ...commonEnv, CONFIRM_LOCAL_SQLITE_RESET: "" },
  });
  assert.notEqual(reset.status, 0);
  assert.match(reset.stderr, /Refusing destructive SQLite reset/);
  assert.equal(existsSync(databasePath), false);
});
