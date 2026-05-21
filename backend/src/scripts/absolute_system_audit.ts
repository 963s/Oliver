/**
 * Autonomous Chaos QA — exhaustive in-process HTTP stress audit (isolated DB).
 *
 * Reads scope from docs (PROJECT_MEMORY) + schema via imports; exercises RBAC,
 * scheduling, inventory races, fiscal limbo, GDPR concurrency, and audit WAL throughput.
 *
 * Run from `backend/`: `npm run audit:absolute`
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import cors from "cors";
import express from "express";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { applyProductionSqlitePragmas } from "../db/index.js";
import { ensureSeedData } from "../routes/api.js";
import { registerApi } from "../routes/api.js";
import { fetchTrustedDeviceToken } from "./trustedDeviceForTests.js";
import { validateSlot } from "../lib/scheduling/index.js";
import { lowerBoundMsBerlinYmd } from "../lib/finance/berlinMonthBounds.js";
import {
  berlinYmdFromMs,
  berlinWeekdayFromYmd,
  getStaffAvailability,
} from "../services/availabilityService.js";

/** UTC instant when Europe/Berlin wall clock is `hour`:`minute` on calendar day `ymd`. */
function utcMsForBerlinWallClock(ymd: string, hour: number, minute: number): number {
  const targetMin = hour * 60 + minute;
  const dayLo = lowerBoundMsBerlinYmd(ymd);
  for (let d = 0; d < 24 * 60 * 60 * 1000; d += 60_000) {
    const ms = dayLo + d;
    if (berlinYmdFromMs(ms) !== ymd) continue;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(new Date(ms));
    const h = Number(parts.find((p) => p.type === "hour")!.value);
    const m = Number(parts.find((p) => p.type === "minute")!.value);
    if (h * 60 + m === targetMin) return ms;
  }
  throw new Error(`no Berlin wall clock ${hour}:${minute} on ${ymd}`);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "../../data");
const dbPath = join(dataDir, "absolute_system_audit.db");
const drizzleDir = join(__dirname, "../../drizzle");

/** Matches `drizzle/meta/_journal.json` through 0026. */
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
  "0026_salon_catalog_active",
  "0027_client360_operations",
  "0028_commission_settings",
  "0029_external_backup_defaults",
  "0030_sqlite_maintenance_settings",
] as const;

const OWNER_ID = 1;
const STYLIST_ID = 2;
const OWNER_PIN = "1111";
const STYLIST_PIN = "2222";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

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

async function login(
  baseUrl: string,
  deviceToken: string,
  staffId: number,
  pin: string,
): Promise<string> {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ staffId, pin }),
  });
  assert(r.ok, `login ${staffId} => ${r.status}`);
  const j = (await r.json()) as { token: string };
  return j.token;
}

function hdr(device: string, bearer: string): Record<string, string> {
  return {
    authorization: `Bearer ${bearer}`,
    "X-Device-Token": device,
    "content-type": "application/json",
  };
}

function pickWeekdaySlot(
  db: BetterSQLite3Database<typeof schema>,
): { startMs: number; endMs: number; serviceName: string } {
  const [svc] = db
    .select()
    .from(schema.salonServiceCatalog)
    .where(eq(schema.salonServiceCatalog.catalogActive, true))
    .limit(1)
    .all();
  assert(!!svc, "catalog service");
  const durMin = svc!.durationMinutes;
  const step = 15 * 60 * 1000;
  const horizon = Date.now() + 86400000 * 45;
  for (let startMs = Date.now() + step; startMs < horizon; startMs += step) {
    const wd = berlinWeekdayFromYmd(berlinYmdFromMs(startMs));
    if (wd === 0) continue;
    const ymd = berlinYmdFromMs(startMs);
    const cal = getStaffAvailability(db, OWNER_ID, ymd);
    if (!cal.isAvailable) continue;
    const endMs = startMs + durMin * 60_000;
    if (berlinYmdFromMs(endMs) !== ymd) continue;
    const av = validateSlot(db, { staffId: OWNER_ID, startMs, endMs });
    if (!av.ok) continue;
    return { startMs, endMs, serviceName: svc!.serviceName };
  }
  throw new Error("no weekday slot found");
}

async function main() {
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }
  process.env.DATABASE_PATH = dbPath;
  process.env.OLIVER_ROOS_CORE_STRESS_TSE = "ok";

  applySqlMigrations(dbPath, drizzleDir);
  const sqlite = new Database(dbPath);
  applyProductionSqlitePragmas(sqlite);
  const db = drizzle(sqlite, { schema }) as BetterSQLite3Database<typeof schema>;
  ensureSeedData(db);

  /** Demo seed may omit weekly templates — force one salon-wide open window for the probe weekday. */
  db.delete(schema.staffWeeklySchedules)
    .where(eq(schema.staffWeeklySchedules.staffId, OWNER_ID))
    .run();
  for (let dow = 1; dow <= 6; dow++) {
    db.insert(schema.staffWeeklySchedules)
      .values({
        staffId: OWNER_ID,
        dayOfWeek: dow,
        isWorking: true,
        startTime: "07:00",
        endTime: "21:00",
      })
      .run();
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  registerApi(app, db);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const deviceToken = await fetchTrustedDeviceToken(baseUrl, OWNER_ID, OWNER_PIN);
  const ownerTok = await login(baseUrl, deviceToken, OWNER_ID, OWNER_PIN);
  const stylistTok = await login(baseUrl, deviceToken, STYLIST_ID, STYLIST_PIN);

  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    // eslint-disable-next-line no-console
    console.log(s);
  };

  log("=== absolute_system_audit: START ===");

  // --- 1) RBAC: stylist forbidden on admin/finance endpoints ---
  log("-- RBAC (stylist → 403) --");
  const stylistHdr = hdr(deviceToken, stylistTok);
  const rbacChecks: [string, RequestInit][] = [
    [`${baseUrl}/api/reports/chef-briefing?date=2026-04-30`, { headers: stylistHdr }],
    [`${baseUrl}/api/inventory/restock`, { method: "POST", headers: stylistHdr, body: "{}" }],
    [`${baseUrl}/api/admin/staff`, { method: "POST", headers: stylistHdr, body: "{}" }],
    [`${baseUrl}/api/admin/catalog/services`, { method: "GET", headers: stylistHdr }],
    [`${baseUrl}/api/finance/daily-close-expected`, { headers: stylistHdr }],
    [
      `${baseUrl}/api/finance/daily-close`,
      {
        method: "POST",
        headers: stylistHdr,
        body: JSON.stringify({ actualCashCents: 0, differenceReason: "audit" }),
      },
    ],
    [`${baseUrl}/api/system/backup/sqlite`, { headers: stylistHdr }],
    [`${baseUrl}/api/clients/1/anonymize`, { method: "POST", headers: stylistHdr, body: "{}" }],
  ];
  await Promise.all(
    rbacChecks.map(async ([url, init]) => {
      const r = await fetch(url, init);
      assert(r.status === 403, `RBAC ${url} => ${r.status} expected 403`);
    }),
  );
  log("RBAC parallel: OK");

  // --- 2) Appointments: Sunday + overlap + buffer ---
  log("-- Appointment engine --");
  const slot = pickWeekdaySlot(db);
  const ownerHeaders = hdr(deviceToken, ownerTok);

  let sundayYmd = "";
  let sunProbe = Date.now() + 86400000;
  for (let i = 0; i < 21; i++, sunProbe += 86400000) {
    const ymd = berlinYmdFromMs(sunProbe);
    if (berlinWeekdayFromYmd(ymd) !== 0) continue;
    sundayYmd = ymd;
    break;
  }
  assert(sundayYmd !== "", "find Sunday");
  /** Same Berlin calendar day as `sundayYmd` — do not use sunProbe + N hours (crosses midnight). */
  const sunStart = utcMsForBerlinWallClock(sundayYmd, 10, 0);
  assert(
    berlinWeekdayFromYmd(berlinYmdFromMs(sunStart)) === 0,
    "Sunday probe still Sunday after wall-clock mapping",
  );
  const [svcForSun] = db
    .select()
    .from(schema.salonServiceCatalog)
    .where(eq(schema.salonServiceCatalog.serviceName, slot.serviceName))
    .limit(1)
    .all();
  assert(!!svcForSun, "service row");
  const sunEnd = sunStart + svcForSun!.durationMinutes * 60_000;
  const sunRes = await fetch(`${baseUrl}/api/appointments`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      clientName: "Sonntag Test",
      staffId: OWNER_ID,
      serviceName: slot.serviceName,
      startAt: sunStart,
      endAt: sunEnd,
    }),
  });
  assert(sunRes.status === 409, `Sunday expect 409 got ${sunRes.status}`);

  const a1 = await fetch(`${baseUrl}/api/appointments`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      clientName: "Overlap A",
      staffId: OWNER_ID,
      serviceName: slot.serviceName,
      startAt: slot.startMs,
      endAt: slot.endMs,
    }),
  });
  assert(a1.status === 201, `apt1 ${a1.status}`);
  const apt1 = (await a1.json()) as { id: number };

  const a2 = await fetch(`${baseUrl}/api/appointments`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      clientName: "Overlap B",
      staffId: OWNER_ID,
      serviceName: slot.serviceName,
      startAt: slot.startMs,
      endAt: slot.endMs,
    }),
  });
  assert(a2.status === 409, `double-book expect 409 got ${a2.status}`);

  const bufStart = slot.endMs;
  const bufEnd = bufStart + svcForSun!.durationMinutes * 60_000;
  const a3 = await fetch(`${baseUrl}/api/appointments`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      clientName: "Buffer clash",
      staffId: OWNER_ID,
      serviceName: slot.serviceName,
      startAt: bufStart,
      endAt: bufEnd,
    }),
  });
  assert(a3.status === 409, `buffer overlap expect 409 got ${a3.status}`);
  log(`Appointments (Sonntag / double-book / Puffer): OK (probe apt id=${apt1.id})`);

  // --- 3) Inventory race: two checkouts oversubscribing salon stock ---
  log("-- Inventory race --");
  const [invRow] = db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.isRetail, false))
    .limit(1)
    .all();
  assert(!!invRow, "salon inventory row");
  db.update(schema.inventoryItems)
    .set({ onHandMl: 500 })
    .where(eq(schema.inventoryItems.id, invRow!.id))
    .run();

  const s1 = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ walkInClientName: "Race A" }),
  });
  const s2 = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ walkInClientName: "Race B" }),
  });
  assert(s1.ok && s2.ok, "open sessions");
  const sess1 = (await s1.json()) as { id: number };
  const sess2 = (await s2.json()) as { id: number };

  /** Gross = 1000 net + 19% VAT = 1190¢ — must match payments sum or checkout returns 400. */
  const raceLineGrossCents = 1190;
  const checkoutBody = (sid: number) => ({
    items: [
      {
        description: "Race ml line",
        quantity: 1,
        unitNetCents: 1000,
        vatRateBps: 1900,
        inventoryItemId: invRow!.id,
        deductMl: 400,
      },
    ],
    payments: [{ method: "cash", amountCents: raceLineGrossCents }],
    tipAmountCents: 0,
    invoiceKind: "normal",
  });

  const [r1, r2] = await Promise.all([
    fetch(`${baseUrl}/api/sessions/${sess1.id}/checkout`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify(checkoutBody(sess1.id)),
    }),
    fetch(`${baseUrl}/api/sessions/${sess2.id}/checkout`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify(checkoutBody(sess2.id)),
    }),
  ]);
  const ok200 = r1.status === 200 ? r1 : r2.status === 200 ? r2 : null;
  const fail = r1.status !== 200 ? r1 : r2;
  assert(ok200 != null, "one checkout must close");
  assert(fail.status >= 400, "second checkout must fail");
  const [invAfter] = db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, invRow!.id))
    .limit(1)
    .all();
  assert(invAfter!.onHandMl === 100, `stock after race ${invAfter!.onHandMl}`);
  log("Inventory concurrent checkout: OK");

  // --- 4) Fiscal limbo: TSE fail draft + daily close still allowed for owner ---
  log("-- Fiscal limbo + daily close --");
  process.env.OLIVER_ROOS_CORE_STRESS_TSE = "fail";
  const limboSess = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ walkInClientName: "Limbo" }),
  });
  assert(limboSess.ok, "limbo session");
  const ls = (await limboSess.json()) as { id: number };
  const limboCheckout = await fetch(`${baseUrl}/api/sessions/${ls.id}/checkout`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      items: [
        {
          description: "Limbo",
          quantity: 1,
          unitNetCents: 500,
          vatRateBps: 1900,
        },
      ],
      payments: [{ method: "cash", amountCents: 595 }],
      tipAmountCents: 0,
      invoiceKind: "normal",
    }),
  });
  assert(limboCheckout.status === 202, `draft checkout ${limboCheckout.status}`);
  process.env.OLIVER_ROOS_CORE_STRESS_TSE = "ok";

  const expRes = await fetch(`${baseUrl}/api/finance/daily-close-expected`, {
    headers: ownerHeaders,
  });
  assert(expRes.ok, "daily-close-expected owner");
  const expJson = (await expRes.json()) as { expectedCashCents: number };
  const closeRes = await fetch(`${baseUrl}/api/finance/daily-close`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      actualCashCents: expJson.expectedCashCents,
    }),
  });
  assert(closeRes.status === 201, `daily close ${closeRes.status}`);
  log("Fiscal limbo + management daily close: OK");

  // --- 5) GDPR vs parallel mutations ---
  log("-- GoBD vs GDPR concurrency --");
  const [cl] = db
    .insert(schema.clients)
    .values({
      name: "GDPR Chaos",
      firstName: "GDPR",
      lastName: "Chaos",
      phone: "+49000000001",
      email: null,
      gdprConsent: true,
      gdprConsentDate: new Date(),
    })
    .returning()
    .all();
  const clientId = cl!.id;

  const gdprSession = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ clientId }),
  });
  assert(gdprSession.ok, "session with client");
  const gs = (await gdprSession.json()) as { id: number };

  const chaos = await Promise.allSettled([
    fetch(`${baseUrl}/api/clients/${clientId}/anonymize`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ reason: "audit parallel" }),
    }).then(async (r) => ({ tag: "anonymize" as const, status: r.status })),
    fetch(`${baseUrl}/api/sessions/${gs.id}/checkout`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        items: [
          {
            description: "Chaos line",
            quantity: 1,
            unitNetCents: 800,
            vatRateBps: 1900,
          },
        ],
        payments: [{ method: "cash", amountCents: 952 }],
        tipAmountCents: 0,
        invoiceKind: "normal",
      }),
    }).then(async (r) => ({ tag: "checkout" as const, status: r.status })),
    fetch(`${baseUrl}/api/appointments/${apt1.id}`, {
      method: "PUT",
      headers: ownerHeaders,
      body: JSON.stringify({ clientName: "Patched concurrent" }),
    }).then(async (r) => ({ tag: "appointment_put" as const, status: r.status })),
  ]);

  let checkoutOk = false;
  let anonymOk = false;
  for (const c of chaos) {
    if (c.status !== "fulfilled") continue;
    const v = c.value;
    if (v.tag === "anonymize" && v.status < 400) anonymOk = true;
    if (v.tag === "checkout" && v.status === 200) checkoutOk = true;
  }
  assert(anonymOk || checkoutOk, "at least one GDPR/checkout path completed");
  const [clAfter] = db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1)
    .all();
  assert(!!clAfter, "client row still exists");
  log("GDPR / checkout / PATCH concurrency: OK (row retained)");

  // --- 6) Audit burst (WAL) ---
  log("-- Audit burst --");
  const burst = 120;
  const results = await Promise.all(
    Array.from({ length: burst }, (_, i) =>
      fetch(`${baseUrl}/api/clients/search?q=${encodeURIComponent(String.fromCharCode(97 + (i % 26)))}`, {
        headers: ownerHeaders,
      }),
    ),
  );
  for (const r of results) {
    assert(r.ok || r.status === 400, `search ${r.status}`);
  }
  const auditCount = db.select().from(schema.auditLogs).all().length;
  assert(auditCount >= burst, `audit rows ${auditCount}`);
  log(`Audit burst (${burst} parallel client_search): OK (total audit rows=${auditCount})`);

  sqlite.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  log("=== absolute_system_audit: PASSED ===");
  // eslint-disable-next-line no-console
  console.log("\n--- summary ---\n" + lines.join("\n"));
}

try {
  await main();
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("absolute_system_audit: FAILED", e);
  process.exit(1);
}
