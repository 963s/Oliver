/**
 * Chaos / hardening smoke: SQLite rollback, abrupt close mid-transaction,
 * hardware job queue under simulated total printer failure.
 *
 * Run: `npx tsx src/scripts/chaos_tester.ts` from `backend/`, or `npm run chaos:test`.
 * Isolated DB: `data/chaos_tester.db` (deleted before run).
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { processJobs } from "../lib/hardware/jobQueue.js";

/** Match `applyProductionSqlitePragmas` in `db/index.ts` (avoid importing `db/index` before `DATABASE_PATH` is set). */
function applyProductionSqlitePragmas(sqlite: InstanceType<typeof Database>): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "../../data");
const dbPath = join(dataDir, "chaos_tester.db");
const drizzleDir = join(__dirname, "../../drizzle");

/** Order must match `drizzle/meta/_journal.json`. */
const MIGRATION_TAGS = [
  "0000_platinum_33_37",
  "0001_addendum_integrity",
  "0002_staff_pin_auth",
  "0003_appointments_checkin",
  "0004_invoicing_vat_checkout",
  "0005_audit_logs_delta",
  "0006_system_settings_tse",
  "0007_invoice_zvt_checkout",
  "0008_checkout_inventory_deduct",
  "0009_low_stock_alerts",
  "0010_clients_gdpr_crm",
  "0011_scheduling_overbooking",
  "0012_advanced_scheduling_engine",
  "0013_advanced_checkout_payments",
  "0014_storno_and_orphan_recovery",
  "0015_cash_journal_and_daily_closing",
  "0016_staff_targets",
  "0017_vouchers_system",
  "0018_loyalty_system",
  "0019_client_history_and_formulas",
  "0020_waivers_and_hardware_queue",
  "0021_tse_transactions",
  "0022_device_trust_and_pins",
] as const;

function applySqlMigrations(dPath: string, mFolder: string) {
  const raw = new Database(dPath);
  try {
    for (const tag of MIGRATION_TAGS) {
      const sqlFile = readFileSync(join(mFolder, `${tag}.sql`), "utf8");
      raw.exec(sqlFile);
    }
  } finally {
    raw.close();
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`ASSERT: ${msg}`);
  }
}

/**
 * Simulates "DB gone" during a multi-step write: close the handle inside an
 * explicit transaction; reopened DB must not contain a partial row.
 */
function testAbruptCloseMidTransaction(
  dPath: string,
  barcode: string,
): void {
  const sqlite = new Database(dPath);
  applyProductionSqlitePragmas(sqlite);
  const db = drizzle(sqlite, { schema });
  let sawError = false;
  try {
    db.transaction((tx) => {
      tx
        .insert(schema.inventoryItems)
        .values({
          name: "ChaosAbruptClose",
          barcodeEan: barcode,
          onHandMl: 1,
          defaultUnitMl: 1,
          isRetail: false,
        })
        .run();
      sqlite.close();
    });
  } catch {
    sawError = true;
  }
  assert(sawError, "expected error when closing SQLite mid-transaction");

  const sqlite2 = new Database(dPath);
  applyProductionSqlitePragmas(sqlite2);
  const db2 = drizzle(sqlite2, { schema });
  const rows = db2
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.barcodeEan, barcode))
    .all();
  sqlite2.close();
  assert(rows.length === 0, `unexpected surviving row after abrupt close (${rows.length})`);
}

/** Mirrors atomic rollback expectations used during checkout (throw → full rollback). */
function testExplicitRollback(db: BetterSQLite3Database<typeof schema>): void {
  const barcode = `chaos-rollback-${Date.now()}`;
  let threw = false;
  try {
    db.transaction((tx) => {
      tx
        .insert(schema.inventoryItems)
        .values({
          name: "ChaosRollback",
          barcodeEan: barcode,
          onHandMl: 2,
          defaultUnitMl: 1,
          isRetail: false,
        })
        .run();
      throw new Error("chaos: deliberate transaction abort");
    });
  } catch {
    threw = true;
  }
  assert(threw, "expected transaction to throw");
  const still = db
    .select({ id: schema.inventoryItems.id })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.barcodeEan, barcode))
    .all();
  assert(still.length === 0, "rollback must not persist inventory row");
}

async function testHardwarePrinterStorm(
  db: BetterSQLite3Database<typeof schema>,
): Promise<void> {
  const prev = process.env.OLIVER_ROOS_HARDWARE_CHAOS_REJECT;
  process.env.OLIVER_ROOS_HARDWARE_CHAOS_REJECT = "1";

  for (let i = 0; i < 10; i++) {
    db.insert(schema.hardwareJobs)
      .values({
        jobType: "print_receipt",
        payloadJson: JSON.stringify({
          invoiceId: i + 1,
          sessionId: 1,
          chaosCase: "printer_offline",
        }),
        status: "pending",
        retryCount: 0,
      })
      .run();
  }

  let rounds = 0;
  while (rounds++ < 120) {
    processJobs(db);
    const pending = db
      .select({ id: schema.hardwareJobs.id })
      .from(schema.hardwareJobs)
      .where(eq(schema.hardwareJobs.status, "pending"))
      .all();
    if (pending.length === 0) {
      break;
    }
    await new Promise<void>((r) => setImmediate(r));
  }

  if (prev === undefined) {
    delete process.env.OLIVER_ROOS_HARDWARE_CHAOS_REJECT;
  } else {
    process.env.OLIVER_ROOS_HARDWARE_CHAOS_REJECT = prev;
  }

  const failed = db
    .select()
    .from(schema.hardwareJobs)
    .where(eq(schema.hardwareJobs.status, "failed"))
    .all();
  assert(failed.length === 10, `expected 10 failed jobs, got ${failed.length}`);

  const pendingLeft = db
    .select({ id: schema.hardwareJobs.id })
    .from(schema.hardwareJobs)
    .where(eq(schema.hardwareJobs.status, "pending"))
    .all();
  assert(pendingLeft.length === 0, "no jobs should stay pending after max retries");
}

async function main() {
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }
  process.env.DATABASE_PATH = dbPath;
  applySqlMigrations(dbPath, drizzleDir);

  // --- checkout-like durability: fail closed during an active transaction
  const abruptBarcode = `chaos-abrupt-${Date.now()}`;
  testAbruptCloseMidTransaction(dbPath, abruptBarcode);

  const { openDb } = await import("../db/index.js");
  const db = openDb(false);

  testExplicitRollback(db);

  await testHardwarePrinterStorm(db);

  // Lightweight sanity: DB still answers after chaos
  const [{ n }] = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.hardwareJobs)
    .all();

  assert(typeof n === "number" && n === 10, `hardware_jobs count expected 10, got ${n}`);

  // eslint-disable-next-line no-console
  console.log("chaos_tester: ALL PASSED (rollback, abrupt close, hardware storm)");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
