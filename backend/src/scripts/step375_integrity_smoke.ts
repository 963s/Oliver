/**
 * Step 37.5 — Smoke: Katalog → Lagerbindung (Färbung) + Checkout-Abzug.
 *
 * Run from `backend/`: `npm run smoke:step375` (uses `node` + compiled output) or
 * `node dist/scripts/step375_integrity_smoke.js` after `npm run build`.
 *
 * Uses isolated `data/step375_smoke.db` (deleted first). Uses `exec` migration path (same as chaos_tester).
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { applyProductionSqlitePragmas } from "../db/index.js";
import { runSessionCheckoutPipeline } from "../lib/checkoutPipeline.js";
import { ensureSeedData } from "../routes/api.js";
import { applyDemoSeed } from "../seed/demoSeed.js";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "../../data");
const dbPath = join(dataDir, "step375_smoke.db");
const drizzleDir = join(__dirname, "../../drizzle");

/** Must match `drizzle/meta/_journal.json` — `exec` applies multi-statement SQL. */
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
  "0023_staff_weekly_schedules_and_calendar_exceptions",
  "0024_appointments_deleted_at",
  "0025_salon_service_catalog_inventory_link",
] as const;

function applySqlMigrations(dPath: string, mFolder: string) {
  const raw = new Database(dPath);
  try {
    for (const tag of MIGRATION_TAGS) {
      raw.exec(readFileSync(join(mFolder, `${tag}.sql`), "utf8"));
    }
  } finally {
    raw.close();
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function main() {
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }
  process.env.OLIVER_ROOS_CORE_STRESS_TSE = "ok";

  applySqlMigrations(dbPath, drizzleDir);
  const sqlite = new Database(dbPath);
  applyProductionSqlitePragmas(sqlite);
  const db = drizzle(sqlite, { schema }) as BetterSQLite3Database<typeof schema>;

  ensureSeedData(db);
  applyDemoSeed(db);

  const [farb] = db
    .select()
    .from(schema.salonServiceCatalog)
    .where(eq(schema.salonServiceCatalog.serviceName, "Färbung"))
    .limit(1)
    .all();
  assert(!!farb, "Färbung in Katalog");
  assert(
    farb!.inventoryItemId != null && (farb!.deductMl ?? 0) > 0,
    "Färbung muss nach Demo-Seed an Lager gebunden sein (Igora + deduct_ml)",
  );
  const invId = farb!.inventoryItemId!;

  const [before] = db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, invId))
    .limit(1)
    .all();
  assert(!!before, "inventory row");
  const onHand0 = before!.onHandMl;
  const deduct = farb!.deductMl!;

  const [client] = db
    .insert(schema.clients)
    .values({ name: "Step375 Z tester", firstName: "S", lastName: "T" })
    .returning()
    .all();
  assert(!!client, "client");

  const [session] = db
    .insert(schema.sessions)
    .values({ clientId: client!.id, staffId: 1, status: "open" })
    .returning()
    .all();
  assert(!!session, "session");

  const unitNetCents = 8_000;
  const vat = 1_520;
  const gross = unitNetCents + vat;
  const out = await runSessionCheckoutPipeline(db, {
    staffId: 1,
    sessionId: session!.id,
    body: {
      items: [
        {
          description: "Färbung",
          quantity: 1,
          unitNetCents,
          vatRateBps: 1900,
          inventoryItemId: invId,
          deductMl: deduct,
        },
      ],
      payments: [{ method: "cash" as const, amountCents: gross }],
    },
  });
  if (!out.ok) {
    throw new Error(`checkout: ${JSON.stringify(out.err)}`);
  }
  const [after] = db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, invId))
    .limit(1)
    .all();
  assert(!!after, "inv after");
  assert(after!.onHandMl === onHand0 - deduct, `Lager: ${onHand0} - ${deduct} = ${after!.onHandMl}`);

  const adjs = db
    .select()
    .from(schema.inventoryAdjustments)
    .where(eq(schema.inventoryAdjustments.inventoryItemId, invId))
    .all();
  const usage = adjs.filter((a) => a.reason === "usage_session" && a.deltaMl === -deduct);
  assert(usage.length >= 1, "usage_session in inventory_adjustments");

  sqlite.close();
  // eslint-disable-next-line no-console
  console.log("step375_integrity_smoke: OK (Lagerabzug + Bindung Färbung).");
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("step375_integrity_smoke: FAILED", e);
  process.exit(1);
});
