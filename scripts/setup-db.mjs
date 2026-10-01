#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import postgres from "postgres";

const ROOT = resolve(process.cwd());
const databaseUrl = process.env.DATABASE_URL ?? "file:./db/smartfuel.db";
const isPostgres = process.env.DB_PROVIDER === "postgresql" || /^postgres(?:ql)?:\/\//.test(databaseUrl);
const reset = process.argv.includes("--reset");

if (!isPostgres && reset && process.env.CONFIRM_LOCAL_SQLITE_RESET !== "YES") {
  throw new Error("Refusing destructive SQLite reset. Set CONFIRM_LOCAL_SQLITE_RESET=YES only for a disposable local database.");
}

if (isPostgres) {
  if (reset) throw new Error("Refusing to reset a PostgreSQL database from this script. Use Supabase migrations and an explicit administrative procedure.");
  const sql = postgres(databaseUrl, { prepare: false, ssl: "require", max: 1, connect_timeout: 10 });
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
    const migrationsDir = join(ROOT, "supabase", "migrations");
    const files = existsSync(migrationsDir) ? (await import("node:fs/promises")).readdir(migrationsDir) : [];
    for (const file of files.filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) {
      const version = file.split("_")[0];
      const applied = await sql`SELECT 1 FROM schema_migrations WHERE version = ${version}`;
      if (applied.length > 0) continue;
      const migration = readFileSync(join(migrationsDir, file), "utf8");
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`INSERT INTO schema_migrations (version) VALUES (${version})`;
      });
      process.stdout.write(`Applied PostgreSQL migration ${file}\n`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  process.exit(0);
}

const path = databaseUrl.replace(/^file:/, "");
const dbPath = path === ":memory:" ? path : (path.startsWith("/") ? path : join(ROOT, path || "db/smartfuel.db"));
if (reset && dbPath !== ":memory:") {
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${dbPath}${suffix}`;
    if (existsSync(target)) rmSync(target);
  }
}
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
const database = new DatabaseSync(dbPath);
database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
database.exec(readFileSync(join(ROOT, "db", "schema.sqlite.sql"), "utf8"));
database.close();
process.stdout.write(`SQLite schema ready at ${dbPath}\n`);
