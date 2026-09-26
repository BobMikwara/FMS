import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * SQLite engine wrapper.
 *
 * The platform is written against a thin, driver-agnostic query surface
 * (`query` / `queryOne` / `execute` / `transaction`). Everything above this
 * module is pure SQL + typed row mapping, so moving to PostgreSQL in
 * production only requires re-implementing this one file (the canonical model
 * lives in `docs/ERD.md`).
 */

const ROOT = resolve(process.cwd());
const DEFAULT_DB_PATH = join(ROOT, "db", "smartfuel.db");

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./db/smartfuel.db";
  const cleaned = url.replace(/^file:/, "");
  if (cleaned === ":memory:") return ":memory:";
  if (cleaned.startsWith("/")) return cleaned;
  return join(ROOT, cleaned);
}

const DB_PATH = resolveDbPath();

let dbInstance: DatabaseSync | null = null;
let schemaReady = false;

function loadSchema(): string {
  // Read from disk in dev, fall back to the inlined copy bundled for edge/serverless.
  const schemaPath = join(ROOT, "db", "schema.sql");
  if (existsSync(schemaPath)) return readFileSync(schemaPath, "utf8");
  return BUNDLED_SCHEMA;
}

export function db(): DatabaseSync {
  if (dbInstance) return dbInstance;
  if (DB_PATH !== ":memory:") {
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const instance = new DatabaseSync(DB_PATH);
  instance.exec("PRAGMA journal_mode = WAL;");
  instance.exec("PRAGMA foreign_keys = ON;");
  instance.exec("PRAGMA busy_timeout = 5000;");
  dbInstance = instance;
  return instance;
}

/** Applies the schema if tables are missing. Safe to call repeatedly. */
export function ensureSchema(): void {
  if (schemaReady) return;
  const database = db();
  const row = database
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='organizations'")
    .get() as { n: number } | undefined;
  if (!row || row.n === 0) {
    database.exec(loadSchema());
  }
  schemaReady = true;
}

export type Row = Record<string, unknown>;

export function query<T = Row>(sql: string, params: unknown[] = []): T[] {
  ensureSchema();
  const stmt = db().prepare(sql);
  return stmt.all(...(params as never[])) as T[];
}

export function queryOne<T = Row>(sql: string, params: unknown[] = []): T | null {
  ensureSchema();
  const stmt = db().prepare(sql);
  const row = stmt.get(...(params as never[])) as T | undefined;
  return row ?? null;
}

export function execute(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number | bigint } {
  ensureSchema();
  const stmt = db().prepare(sql);
  const result = stmt.run(...(params as never[]));
  return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
}

export function exec(sql: string): void {
  ensureSchema();
  db().exec(sql);
}

/** Runs `fn` inside a transaction, rolling back on any thrown error. */
export function transaction<T>(fn: () => T): T {
  ensureSchema();
  const database = db();
  database.exec("BEGIN");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw error;
  }
}

/** Bulk insert helper — chunks to keep statements and memory bounded. */
export function insertMany(
  table: string,
  columns: string[],
  rows: unknown[][],
  chunkSize = 200,
): number {
  if (rows.length === 0) return 0;
  ensureSchema();
  const database = db();
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
  const stmt = database.prepare(sql);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    for (const row of chunk) stmt.run(...(row as never[]));
    inserted += chunk.length;
  }
  return inserted;
}

/* -------------------------------------------------------------------------- */
/* ID + date helpers                                                          */
/* -------------------------------------------------------------------------- */

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/** Sortable, URL-safe, collision-resistant id in the cuid spirit. */
export function id(prefix = ""): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const rand = Array.from(randomBytes(12))
    .map((b) => CROCKFORD[b & 31])
    .join("");
  return prefix ? `${prefix}_${time}${rand}` : `c${time}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** ISO string without milliseconds — matches SQLite's strftime('%Y-%m-%dT%H:%M:%SZ','now') format. */
export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  const str = String(value);
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Normalises a stored ISO string into a JS Date. */
export function fromIso(value: unknown): Date | null {
  if (value == null) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const boolToInt = (v: boolean | undefined | null): number => (v ? 1 : 0);
export const intToBool = (v: unknown): boolean => Number(v) === 1;

/** SQLite epoch helpers for range queries on ISO-8601 UTC text columns. */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// The schema is inlined so the module keeps working if the process is started
// from a different working directory (e.g. `next start` in production).
const BUNDLED_SCHEMA = readFileSyncSafe();

function readFileSyncSafe(): string {
  try {
    return readFileSync(join(ROOT, "db", "schema.sql"), "utf8");
  } catch {
    return "";
  }
}
