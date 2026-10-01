import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import postgres, { type Sql } from "postgres";

/**
 * Database adapter used by the repositories.
 *
 * Production uses Supabase PostgreSQL through its transaction pooler. SQLite is
 * retained as an optional local-development adapter only. All callers use the
 * same async API, which is important because PostgreSQL drivers are async and
 * Vercel functions must not block the event loop while waiting for the pooler.
 *
 * The production schema is applied by Supabase migrations. The application
 * never creates or mutates a production schema during a request.
 */

const ROOT = resolve(process.cwd());
const DATABASE_URL = process.env.DATABASE_URL ?? "file:./db/smartfuel.db";
const DB_PROVIDER = process.env.DB_PROVIDER ?? (DATABASE_URL.startsWith("postgres") ? "postgresql" : "sqlite");
const USE_POSTGRES = DB_PROVIDER === "postgresql" || DATABASE_URL.startsWith("postgres://") || DATABASE_URL.startsWith("postgresql://");

export function isPostgres(): boolean {
  return USE_POSTGRES;
}
const DEFAULT_DB_PATH = join(ROOT, "db", "smartfuel.db");

type PostgresConnection = Sql<Record<string, postgres.PostgresType>>;

let sqliteInstance: DatabaseSync | null = null;
let postgresInstance: PostgresConnection | null = null;
const transactionStore = new AsyncLocalStorage<PostgresConnection>();
const sqliteTransactionStore = new AsyncLocalStorage<{ active: boolean }>();
let sqliteQueue: Promise<void> = Promise.resolve();
let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

function resolveDbPath(): string {
  const url = DATABASE_URL;
  const cleaned = url.replace(/^file:/, "");
  if (cleaned === ":memory:") return ":memory:";
  if (cleaned.startsWith("/")) return cleaned;
  return join(ROOT, cleaned || DEFAULT_DB_PATH);
}

function sqlite(): DatabaseSync {
  if (sqliteInstance) return sqliteInstance;
  const path = resolveDbPath();
  if (path !== ":memory:") {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const instance = new DatabaseSync(path);
  instance.exec("PRAGMA journal_mode = WAL;");
  instance.exec("PRAGMA foreign_keys = ON;");
  instance.exec("PRAGMA busy_timeout = 5000;");
  sqliteInstance = instance;
  return instance;
}

// DatabaseSync has one process-wide connection. Keep unrelated statements out
// of an open async transaction, while calls from that transaction inherit its
// context and use the connection without trying to reacquire the queue.
async function withSqliteAccess<T>(fn: () => T | Promise<T>): Promise<T> {
  if (sqliteTransactionStore.getStore()?.active) return await fn();

  const previous = sqliteQueue;
  let release!: () => void;
  sqliteQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function postgresDb(): PostgresConnection {
  const transaction = transactionStore.getStore();
  if (transaction) return transaction;
  if (postgresInstance) return postgresInstance;
  if (!DATABASE_URL.startsWith("postgres://") && !DATABASE_URL.startsWith("postgresql://")) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string when DB_PROVIDER=postgresql");
  }
  postgresInstance = postgres(DATABASE_URL, {
    max: 1,
    prepare: false,
    ssl: "require",
    connect_timeout: 10,
    idle_timeout: 20,
    connection: { application_name: "smartfuel-vercel" },
  });
  return postgresInstance;
}

function loadSqliteSchema(): string {
  const schemaPath = join(ROOT, "db", "schema.sqlite.sql");
  if (existsSync(schemaPath)) return readFileSync(schemaPath, "utf8");
  return "";
}

/**
 * Converts the repository's simple positional placeholders to PostgreSQL
 * placeholders. Repository SQL does not contain literal question marks, so a
 * deliberately small translator keeps the repository code readable while the
 * PostgreSQL adapter remains parameterised.
 */
type PostgresParameter = null | string | number | boolean | Date | Uint8Array | readonly PostgresParameter[];

function postgresParameters(params: unknown[]): PostgresParameter[] {
  return params.map((value): PostgresParameter => {
    if (value == null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date || value instanceof Uint8Array) {
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => postgresParameters([item])[0]);
    return JSON.stringify(value);
  });
}

function postgresSql(sql: string): string {
  const pgNow = `to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
  const pgSevenDaysAgo = `to_char((CURRENT_TIMESTAMP - INTERVAL '7 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
  let translated = sql
    .replace(/strftime\('%Y-%m-%dT%H:%M:%SZ','now','-7 days'\)/g, pgSevenDaysAgo)
    .replace(/strftime\('%Y-%m-%dT%H:%M:%SZ','now'\)/g, pgNow)
    .replace(/strftime\('%Y-%m-%dT%H:00',\s*([a-zA-Z0-9_.]+)\)/g, "to_char(date_trunc('hour', $1::timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:00')")
    .replace(/strftime\('%Y-%m-%d',\s*([a-zA-Z0-9_.]+)\)/g, "to_char($1::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')");
  let index = 0;
  return translated.replace(/\?/g, () => `$${++index}`);
}

/** Applies the local SQLite schema only. Supabase schema is migration-owned. */
export async function ensureSchema(): Promise<void> {
  if (USE_POSTGRES || schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = Promise.resolve().then(() => {
      const database = sqlite();
      const row = database
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='organizations'")
        .get() as { n: number } | undefined;
      if (!row || row.n === 0) {
        database.exec(loadSqliteSchema());
      } else {
        database.exec(`
          CREATE TABLE IF NOT EXISTS rate_limit_buckets (
            key TEXT PRIMARY KEY,
            count INTEGER NOT NULL,
            reset_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_rate_limit_reset_at ON rate_limit_buckets(reset_at);
        `);
      }
      schemaReady = true;
    });
  }
  await schemaPromise;
}

export type Row = Record<string, unknown>;

export async function query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  if (USE_POSTGRES) return (await postgresDb().unsafe(postgresSql(sql), postgresParameters(params))) as T[];
  return await withSqliteAccess(() => {
    const stmt = sqlite().prepare(sql);
    return stmt.all(...(params as never[])) as T[];
  });
}

export async function queryOne<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  await ensureSchema();
  if (USE_POSTGRES) {
    const rows = (await postgresDb().unsafe(postgresSql(sql), postgresParameters(params))) as T[];
    return rows[0] ?? null;
  }
  return await withSqliteAccess(() => {
    const stmt = sqlite().prepare(sql);
    const row = stmt.get(...(params as never[])) as T | undefined;
    return row ?? null;
  });
}

export async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
  await ensureSchema();
  if (USE_POSTGRES) {
    const result = await postgresDb().unsafe(postgresSql(sql), postgresParameters(params));
    return { changes: Number(result.count ?? 0), lastInsertRowid: 0 };
  }
  return await withSqliteAccess(() => {
    const stmt = sqlite().prepare(sql);
    const result = stmt.run(...(params as never[]));
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  });
}

export async function exec(sql: string): Promise<void> {
  await ensureSchema();
  if (USE_POSTGRES) {
    await postgresDb().unsafe(sql);
    return;
  }
  await withSqliteAccess(() => sqlite().exec(sql));
}

/** Runs an async callback inside a transaction. Repository calls inherit the transaction connection. */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  await ensureSchema();
  if (USE_POSTGRES) {
    return (await postgresDb().begin(async (tx) => transactionStore.run(tx as unknown as PostgresConnection, fn))) as T;
  }
  if (sqliteTransactionStore.getStore()?.active) return await fn();
  return await withSqliteAccess(async () => {
    const database = sqlite();
    database.exec("BEGIN IMMEDIATE");
    const context = { active: true };
    try {
      const result = await sqliteTransactionStore.run(context, fn);
      database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw error;
    } finally {
      context.active = false;
    }
  });
}

/** Bulk insert helper. PostgreSQL receives one parameterised statement. */
export async function insertMany(
  table: string,
  columns: string[],
  rows: unknown[][],
  chunkSize = 200,
): Promise<number> {
  if (rows.length === 0) return 0;
  await ensureSchema();
  const insertedRows = rows.slice(0, rows.length);
  if (USE_POSTGRES) {
    let inserted = 0;
    for (let offset = 0; offset < insertedRows.length; offset += chunkSize) {
      const chunk = insertedRows.slice(offset, offset + chunkSize);
      const values: unknown[] = [];
      const safeTuples = chunk.map((row) => {
        const placeholders = row.map((value) => `$${values.push(value)}`).join(", ");
        return `(${placeholders})`;
      });
      await postgresDb().unsafe(
        `INSERT INTO ${safeIdentifier(table)} (${columns.map(safeIdentifier).join(", ")}) VALUES ${safeTuples.join(", ")}`,
        postgresParameters(values),
      );
      inserted += chunk.length;
    }
    return inserted;
  }

  return await withSqliteAccess(() => {
    const database = sqlite();
    const placeholders = columns.map(() => "?").join(", ");
    const statement = database.prepare(`INSERT INTO ${safeIdentifier(table)} (${columns.map(safeIdentifier).join(", ")}) VALUES (${placeholders})`);
    let inserted = 0;
    for (let i = 0; i < insertedRows.length; i += chunkSize) {
      for (const row of insertedRows.slice(i, i + chunkSize)) statement.run(...(row as never[]));
      inserted += Math.min(chunkSize, insertedRows.length - i);
    }
    return inserted;
  });
}

function safeIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return value;
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

export function fromIso(value: unknown): Date | null {
  if (value == null) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const boolToInt = (v: boolean | undefined | null): number => (v ? 1 : 0);
export const intToBool = (v: unknown): boolean => Number(v) === 1 || v === true;

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export { USE_POSTGRES };
