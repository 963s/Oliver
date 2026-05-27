import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import * as schema from "./schema.js";

/**
 * Production SQLite tuning for the salon's local DB.
 *
 *   WAL                  — concurrent readers / single writer; lower latency.
 *   busy_timeout 5s      — silently wait on transient locks instead of failing.
 *   synchronous NORMAL   — durable on power loss when paired with WAL.
 *   foreign_keys ON      — enforce FK constraints (off by default in SQLite).
 *   cache_size -32000    — 32 MiB page cache (negative = KiB; salon DB is small).
 *   temp_store MEMORY    — keep ORDER BY / DISTINCT temporaries off disk.
 *   mmap_size 128 MiB    — memory-mapped reads for the typical hot working set.
 */
export function applyProductionSqlitePragmas(
  sqlite: InstanceType<typeof Database>,
): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("cache_size = -32000");
  sqlite.pragma("temp_store = MEMORY");
  sqlite.pragma("mmap_size = 134217728");
}

/**
 * Quick `PRAGMA integrity_check` on startup — single string `"ok"` when the
 * file is healthy, otherwise a list of corruption diagnostics.
 *
 * `PRAGMA optimize` should be invoked roughly weekly (SQLite docs) — call this
 * on a schedule from the supervisor, not on every open.
 */
export function runSqliteIntegrityCheck(
  sqlite: InstanceType<typeof Database>,
): { ok: boolean; report: string } {
  const rows = sqlite.prepare("PRAGMA integrity_check").all() as Array<{
    integrity_check: string;
  }>;
  const report = rows.map((r) => r.integrity_check).join("; ");
  return { ok: report.trim() === "ok", report };
}

export function runSqliteOptimize(
  sqlite: InstanceType<typeof Database>,
): void {
  sqlite.pragma("optimize");
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
  // Integrity check is fast on a salon-scale DB (<50MB) and worth doing on
  // every open so a corrupt file surfaces in the log instead of silently.
  // Logger import lives at call-site to avoid a cycle (logger.ts itself does
  // not depend on this module, but keeping it lazy here is defensive).
  try {
    // Lazy require to avoid bootstrap cycles; failure path is non-fatal.
    void import("../lib/logger.js").then(({ logger }) => {
      const { ok, report } = runSqliteIntegrityCheck(sqlite);
      if (ok) logger.info("sqlite_integrity_ok");
      else logger.error("sqlite_integrity_failed", { report });
    });
  } catch { /* logger unavailable during bootstrap; ignore */ }
  return db;
}

export { schema };
