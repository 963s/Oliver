import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import * as schema from "./schema.js";

/**
 * Production SQLite tuning: concurrent writers (WAL), brief waits on locks,
 * balanced durability vs throughput (`NORMAL` with WAL is standard for server apps).
 */
export function applyProductionSqlitePragmas(
  sqlite: InstanceType<typeof Database>,
): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
}

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "data");
const dbPath = process.env.DATABASE_PATH ?? join(dataDir, "salon.db");
const migrationsFolder = join(here, "..", "..", "drizzle");

/** Live better-sqlite3 handle for WAL-safe `backup()` (single instance after `openDb`). */
let sqliteHandle: InstanceType<typeof Database> | null = null;

export function resolveDataDir(): string {
  mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

/** Resolved path to the SQLite file (`DATABASE_PATH` or `backend/data/salon.db`). */
export function getSqliteFilePath(): string {
  resolveDataDir();
  return dbPath;
}

export function getSqliteHandle(): InstanceType<typeof Database> {
  if (!sqliteHandle) {
    throw new Error("sqlite_not_initialized");
  }
  return sqliteHandle;
}

export function openDb(runMigrations = true) {
  resolveDataDir();
  const sqlite = new Database(dbPath);
  applyProductionSqlitePragmas(sqlite);
  sqliteHandle = sqlite;
  const db = drizzle(sqlite, { schema });
  if (runMigrations) {
    migrate(db, { migrationsFolder });
  }
  return db;
}

export { schema };
