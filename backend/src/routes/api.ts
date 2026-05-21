import type { Express, Request, Response } from "express";
import { eq, and, or, desc, gte, lte, asc, like, isNull, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { writeAudit, writeAuditTx } from "../lib/audit.js";
import {
  getStaffContext,
  requireOwner,
  canReadTargets,
} from "../lib/sessionAuth.js";
import {
  insertOrphanFromZvtSuccess,
  listOpenOrphans,
} from "../modules/hardware/zvt.js";
import { applyDemoSeed } from "../seed/demoSeed.js";
import { registerAuthGuard } from "../lib/authMiddleware.js";
import {
  pairDevice,
  generatePairingToken,
  isDevBrowserDeviceRouteEnabled,
  upsertDevBrowserDevice,
} from "../lib/auth/deviceAuth.js";
import { registerDeviceGuard } from "../lib/deviceMiddleware.js";
import { requireAdmin } from "../middleware/auth.js";
import { pinLoginLimiter } from "../lib/pinLoginRateLimit.js";
import { signAuthToken, getAuthSecret } from "../lib/authToken.js";
import { hashPin, verifyPin } from "../lib/pin.js";
import { runSessionCheckoutPipeline } from "../lib/checkoutPipeline.js";
import type { ZvtDirectBody } from "../lib/checkoutPaymentProof.js";
import {
  applyManualInventoryAdjust,
  ManualAdjustNotFoundError,
  ManualAdjustPermissionError,
  ManualAdjustStockError,
  parseManualAdjustBody,
} from "../lib/inventoryManualAdjust.js";
import {
  applyGoodsReceipt,
  findItemByBarcodeScan,
  GoodsReceiptNotFoundError,
  GoodsReceiptValidationError,
} from "../lib/goodsReceipt.js";
import {
  listMonitoredItemsAtOrBelowThreshold,
  listOpenLowStockAlerts,
  syncLowStockAlertForItem,
  syncLowStockAlertForItemTx,
  type LowStockDb,
} from "../lib/lowStockService.js";
import {
  buildDailyCloseSnapshot,
  computeExpectedCashCents,
} from "../lib/finance/closing.js";
import { computeStaffPerformanceForDate } from "../lib/performance/targets.js";
import { buildDatevCsvForDailyClose } from "../lib/export/datev.js";
import { issueVoucher, validateVoucher } from "../lib/finance/vouchers.js";
import { registerHolidayRoutes } from "./holidayRoutes.js";
import { registerCalendarRoutes } from "./calendarRoutes.js";
import { registerReportRoutes } from "./reportRoutes.js";
import { registerInventoryAdminRoutes } from "./inventoryRoutes.js";
import { registerExportRoutes } from "./exportRoutes.js";
import { registerClientRoutes } from "./clientRoutes.js";
import { registerSystemRoutes } from "./systemRoutes.js";
import { registerCatalogAdminRoutes } from "./catalogRoutes.js";
import { registerSettingsAdminRoutes } from "./settingsRoutes.js";
import { registerDiagnosticsRoutes } from "./diagnosticsRoutes.js";
import { registerSseEventRoutes } from "./events.js";
import { signWithPrinterTse } from "../modules/fiscal/printerTseProvider.js";
import type { TseSignInput } from "../modules/fiscal/types.js";
import { calculateEstimate } from "../lib/pricing/estimator.js";
import {
  checkRewardEligibility,
  LOYALTY_REWARD_STAMPS_THRESHOLD,
  reverseLoyaltyAccrualForStorno,
} from "../lib/loyalty/processor.js";
import {
  ANONYMIZED_DISPLAY,
  ANONYMIZED_FIRST,
  ANONYMIZED_LAST,
  buildClientDisplayName,
  splitClientDisplayName,
} from "../lib/clientCrm.js";
import {
  incrementClientCancel,
  incrementClientNoShow,
  resolveEndAtForService,
  resolveClientIdForCounters,
  validateSlot,
  validateServiceDuration,
} from "../lib/scheduling/index.js";
import { createAuditLog } from "../lib/audit/logger.js";
import {
  appointmentUpdateRequiresReason,
  snapshotAppointmentRow,
} from "../lib/audit/appointmentSnapshot.js";
import { readDeviceTokenHeader, verifyTrustedDevice } from "../lib/auth/deviceAuth.js";
import {
  berlinYmdFromMs,
  getStaffAvailability,
} from "../services/availabilityService.js";

function parseInstant(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.floor(v);
  }
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function defaultLocalDayBounds(): { from: number; to: number } {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { from: start.getTime(), to: end.getTime() };
}

function normalizeBarcode(raw?: string): string | null {
  const v = String(raw ?? "").trim();
  return v.length === 0 ? null : v;
}

function auditCheckoutFailure(
  db: BetterSQLite3Database<typeof schema>,
  opts: {
    staffId: number;
    sessionId: number | null;
    error: string;
    sessionRow: (typeof schema.sessions.$inferSelect) | null;
    bodyItems?: unknown;
    extra?: Record<string, unknown>;
  },
): void {
  writeAudit(db, {
    entity: opts.sessionId != null ? "sessions" : "checkout",
    entityId: opts.sessionId,
    action: "checkout_failed",
    staffId: opts.staffId,
    reason: opts.error,
    before: opts.sessionRow ?? undefined,
    after: null,
    payload: {
      attemptedItems: opts.bodyItems,
      ...opts.extra,
    },
  });
}

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function registerApi(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
) {
  // registerDeviceGuard(app, db); // disabled — offline salon, no device pairing needed
  registerAuthGuard(app);
  registerHolidayRoutes(app);
  registerCalendarRoutes(app, db);
  registerReportRoutes(app, db);
  registerInventoryAdminRoutes(app, db);
  registerExportRoutes(app, db);
  registerClientRoutes(app, db);
  registerSystemRoutes(app, db);
  registerCatalogAdminRoutes(app, db);
  registerSettingsAdminRoutes(app, db);
  registerDiagnosticsRoutes(app, db);
  /**
   * §15 — No HTTP routes may UPDATE or DELETE `audit_logs` or mutate `invoices`/`invoice_items`
   * except through controlled fiscal flows (checkout closure only after TSE, future storno API).
   */

  app.get("/api/health", (_req, res) => {
    // Avoid 304 + empty body on reload (Express ETag); browser tab should always show JSON.
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, service: "oliver-roos-frisuren-api" });
  });

  app.post(
    "/api/auth/dev-pair-browser",
    asyncRoute((_req, res) => {
      if (!isDevBrowserDeviceRouteEnabled()) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const { deviceToken, deviceId } = upsertDevBrowserDevice(db);
      res.status(201).json({
        deviceToken,
        deviceId,
        deviceName: "Dev-Browser",
      });
    }),
  );

  /**
   * Kassen: letzter geschlossener Beleg — wenn `ausfall_failed`, UI-Warnbanner (TSE reparieren).
   */
  app.get(
    "/api/health/fiscal",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const rows = db
        .select({
          tseStatus: schema.invoices.tseStatus,
          id: schema.invoices.id,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.status, "closed"))
        .orderBy(desc(schema.invoices.id))
        .limit(1)
        .all();
      const last = rows[0];
      const lastClosedTseStatus = last?.tseStatus ?? null;
      res.json({
        lastClosedTseStatus,
        tseAusfallBanner: lastClosedTseStatus === "ausfall_failed",
      });
    }),
  );

  app.post(
    "/api/auth/login",
    asyncRoute((req, res) => {
      const b = req.body as { staffId?: number; pin?: string };
      const staffId = Number(b.staffId);
      const pin = String(b.pin ?? "").trim();
      const tokenHdr = readDeviceTokenHeader(req.headers);
      const trustedDev = tokenHdr ? verifyTrustedDevice(db, tokenHdr) : null;
      const trustedDeviceId = trustedDev?.id ?? null;
      if (!Number.isFinite(staffId) || staffId < 1) {
        res.status(400).json({ error: "staff_id required" });
        return;
      }
      if (!/^\d{4,6}$/.test(pin)) {
        res.status(400).json({ error: "pin_format" });
        return;
      }
      const [row] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, staffId))
        .limit(1)
        .all();
      if (!row || row.active === false) {
        try {
          writeAudit(db, {
            entity: "auth",
            entityId: staffId,
            action: "pin_login_failure",
            staffId: null,
            payload: {
              route: "login",
              trustedDeviceId,
              note: "invalid_staff_or_inactive",
            },
          });
        } catch {
          /* audit must not block auth response */
        }
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }
      if (!verifyPin(pin, row.pinHash)) {
        try {
          writeAudit(db, {
            entity: "auth",
            entityId: row.id,
            action: "pin_login_failure",
            staffId: row.id,
            payload: {
              route: "login",
              trustedDeviceId,
              note: "pin_mismatch",
            },
          });
        } catch {
          /* ignore */
        }
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }
      const token = signAuthToken(
        { staffId: row.id, role: row.role },
        getAuthSecret(),
      );
      try {
        writeAudit(db, {
          entity: "auth",
          entityId: row.id,
          action: "pin_login_success",
          staffId: row.id,
          payload: {
            route: "login",
            trustedDeviceId,
            revisionNote: "Änderungshistorie / device-bound session bootstrap",
          },
        });
      } catch {
        /* ignore */
      }
      res.json({
        token,
        staff: { id: row.id, displayName: row.displayName, role: row.role },
      });
    }),
  );

  app.post(
    "/api/auth/devices/pairing-token",
    asyncRoute((req, res) => {
      requireOwner(req);
      const row = generatePairingToken(db);
      res.status(201).json({
        pairingToken: row.pairingToken,
        trustedDeviceId: row.id,
      });
    }),
  );

  app.post(
    "/api/auth/pair",
    asyncRoute((req, res) => {
      const b = req.body as { pairingToken?: string; deviceName?: string };
      const out = pairDevice(
        db,
        String(b.pairingToken ?? ""),
        String(b.deviceName ?? ""),
      );
      if (!out.ok) {
        const status = out.error === "already_paired" ? 409 : 400;
        res.status(status).json({ error: out.error });
        return;
      }
      res.status(201).json({
        deviceToken: out.deviceToken,
        deviceId: out.deviceId,
        deviceName: out.deviceName,
      });
    }),
  );

  const PIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

  app.post(
    "/api/auth/pin-login",
    pinLoginLimiter,
    asyncRoute((req, res) => {
      const b = req.body as { staffId?: number; pin?: string };
      const staffId = Number(b.staffId);
      const pin = String(b.pin ?? "").trim();
      const tokenHdr = readDeviceTokenHeader(req.headers);
      const trustedDev = tokenHdr ? verifyTrustedDevice(db, tokenHdr) : null;
      const trustedDeviceId = trustedDev?.id ?? null;
      if (!Number.isFinite(staffId) || staffId < 1) {
        res.status(400).json({ error: "staff_id required" });
        return;
      }
      if (!/^\d{4,6}$/.test(pin)) {
        res.status(400).json({ error: "pin_format" });
        return;
      }
      const [row] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, staffId))
        .limit(1)
        .all();
      if (!row || row.active === false) {
        try {
          writeAudit(db, {
            entity: "auth",
            entityId: staffId,
            action: "pin_login_failure",
            staffId: null,
            payload: {
              route: "pin-login",
              trustedDeviceId,
              note: "invalid_staff_or_inactive",
            },
          });
        } catch {
          /* ignore */
        }
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }
      if (!verifyPin(pin, row.pinHash)) {
        try {
          writeAudit(db, {
            entity: "auth",
            entityId: row.id,
            action: "pin_login_failure",
            staffId: row.id,
            payload: {
              route: "pin-login",
              trustedDeviceId,
              note: "pin_mismatch",
            },
          });
        } catch {
          /* ignore */
        }
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }
      const token = signAuthToken(
        { staffId: row.id, role: row.role },
        getAuthSecret(),
        PIN_SESSION_TTL_MS,
      );
      try {
        writeAudit(db, {
          entity: "auth",
          entityId: row.id,
          action: "pin_login_success",
          staffId: row.id,
          payload: {
            route: "pin-login",
            trustedDeviceId,
            revisionNote: "POS PIN session (Revisionssicherheit)",
          },
        });
      } catch {
        /* ignore */
      }
      res.json({
        token,
        staff: { id: row.id, displayName: row.displayName, role: row.role },
      });
    }),
  );

  app.get(
    "/api/auth/directory",
    asyncRoute((_req, res) => {
      const rows = db
        .select({
          id: schema.staff.id,
          displayName: schema.staff.displayName,
          role: schema.staff.role,
        })
        .from(schema.staff)
        .where(eq(schema.staff.active, true))
        .all();
      res.json(rows);
    }),
  );

  app.get(
    "/api/auth/me",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const [row] = db
        .select({
          id: schema.staff.id,
          displayName: schema.staff.displayName,
          role: schema.staff.role,
        })
        .from(schema.staff)
        .where(eq(schema.staff.id, c.staffId))
        .limit(1)
        .all();
      if (!row) {
        res.status(401).json({ error: "not_found" });
        return;
      }
      res.json(row);
    }),
  );

  app.get(
    "/api/staff",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const rows = db.select().from(schema.staff).all();
      res.json(
        rows.map((r) => ({
          id: r.id,
          displayName: r.displayName,
          role: r.role,
          active: r.active,
          createdAt: r.createdAt,
        })),
      );
    }),
  );

  /** Rings / stylists — read targets for a date (self or owner + X-Owner-View-Targets). */
  app.get(
    "/api/staff/:id/targets",
    asyncRoute((req, res) => {
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      if (!canReadTargets(req, id)) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const d = String(req.query.date ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        res.status(400).json({ error: "date=YYYY-MM-DD required" });
        return;
      }
      const [row] = db
        .select()
        .from(schema.staffTargets)
        .where(
          and(eq(schema.staffTargets.staffId, id), eq(schema.staffTargets.businessDate, d)),
        )
        .limit(1)
        .all();
      if (!row) {
        res.json(null);
        return;
      }
      const tr =
        row.targetRevenueCents ??
        (row.serviceTargetCents ?? 0) + (row.retailTargetCents ?? 0);
      res.json({
        id: row.id,
        targetRevenueCents: tr,
        targetRetailUnitCount: row.targetRetailUnitCount ?? 0,
        progressRevenueCents: row.progressRevenueCents ?? 0,
        progressRetailUnits: row.progressRetailUnits ?? 0,
        businessDate: row.businessDate,
      });
    }),
  );

  app.patch(
    "/api/staff/:id/pin",
    asyncRoute((req, res) => {
      const owner = requireOwner(req);
      const idRaw = req.params.id;
      const id = Number.parseInt(idRaw ?? "", 10);
      const b = req.body as { newPin?: string };
      const newPin = String(b.newPin ?? "").trim();
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      if (!/^\d{4,6}$/.test(newPin)) {
        res.status(400).json({ error: "pin_format" });
        return;
      }
      const [target] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, id))
        .limit(1)
        .all();
      if (!target) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const pinHash = hashPin(newPin);
      db.update(schema.staff)
        .set({ pinHash })
        .where(eq(schema.staff.id, id))
        .run();
      writeAudit(db, {
        entity: "staff",
        entityId: id,
        action: "pin_change",
        staffId: owner.staffId,
        payload: { targetStaffId: id },
      });
      res.json({ ok: true, id });
    }),
  );

  /**
   * §13 — Overbooking / parallel slot policy (owner).
   */
  app.patch(
    "/api/staff/:id/scheduling",
    asyncRoute((req, res) => {
      const owner = requireOwner(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const b = req.body as {
        allowOverbooking?: boolean;
        overbookingMaxConcurrent?: number;
      };
      const [cur] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, id))
        .limit(1)
        .all();
      if (!cur) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      void owner;
      const next = {
        allowOverbooking:
          b.allowOverbooking !== undefined
            ? Boolean(b.allowOverbooking)
            : cur.allowOverbooking,
        overbookingMaxConcurrent:
          b.overbookingMaxConcurrent !== undefined
            ? Math.max(2, Math.floor(Number(b.overbookingMaxConcurrent)))
            : cur.overbookingMaxConcurrent,
      };
      if (
        b.overbookingMaxConcurrent !== undefined &&
        !Number.isFinite(next.overbookingMaxConcurrent)
      ) {
        res.status(400).json({ error: "overbookingMaxConcurrent invalid" });
        return;
      }
      db.update(schema.staff)
        .set({
          allowOverbooking: next.allowOverbooking,
          overbookingMaxConcurrent: next.overbookingMaxConcurrent,
        })
        .where(eq(schema.staff.id, id))
        .run();
      const [out] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, id))
        .limit(1)
        .all();
      writeAudit(db, {
        entity: "staff",
        entityId: id,
        action: "scheduling_policy",
        staffId: owner.staffId,
        payload: {
          allowOverbooking: out?.allowOverbooking,
          overbookingMaxConcurrent: out?.overbookingMaxConcurrent,
        },
      });
      res.json(out);
    }),
  );

  /**
   * §13 — Owner-managed per-staff service durations.
   * GET is authenticated (staff context), mutating endpoints are owner-only.
   */
  app.get(
    "/api/staff/:id/service-durations",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [st] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, id))
        .limit(1)
        .all();
      if (!st) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const rows = db
        .select()
        .from(schema.staffServiceDurations)
        .where(eq(schema.staffServiceDurations.staffId, id))
        .orderBy(asc(schema.staffServiceDurations.serviceName))
        .all();
      res.json(rows);
    }),
  );

  app.put(
    "/api/staff/:id/service-durations",
    asyncRoute((req, res) => {
      const owner = requireOwner(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const b = req.body as {
        serviceName?: string;
        durationMinutes?: number;
        reason?: string;
      };
      const serviceName = String(b.serviceName ?? "").trim();
      const durationMinutes = Math.floor(Number(b.durationMinutes));
      const reason = String(b.reason ?? "").trim();
      if (!serviceName) {
        res.status(400).json({ error: "serviceName required" });
        return;
      }
      if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 8 * 60) {
        res.status(400).json({ error: "durationMinutes invalid" });
        return;
      }
      if (!reason) {
        res.status(400).json({ error: "reason_required" });
        return;
      }
      const [st] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, id))
        .limit(1)
        .all();
      if (!st) {
        res.status(404).json({ error: "staff_not_found" });
        return;
      }
      const [before] = db
        .select()
        .from(schema.staffServiceDurations)
        .where(
          and(
            eq(schema.staffServiceDurations.staffId, id),
            eq(schema.staffServiceDurations.serviceName, serviceName),
          ),
        )
        .limit(1)
        .all();
      if (before) {
        db.update(schema.staffServiceDurations)
          .set({ durationMinutes, updatedAt: new Date() })
          .where(eq(schema.staffServiceDurations.id, before.id))
          .run();
      } else {
        db.insert(schema.staffServiceDurations)
          .values({
            staffId: id,
            serviceName,
            durationMinutes,
          })
          .run();
      }
      const [after] = db
        .select()
        .from(schema.staffServiceDurations)
        .where(
          and(
            eq(schema.staffServiceDurations.staffId, id),
            eq(schema.staffServiceDurations.serviceName, serviceName),
          ),
        )
        .limit(1)
        .all();
      writeAudit(db, {
        entity: "staff_service_durations",
        entityId: after?.id ?? before?.id ?? null,
        action: "staff_service_duration_upsert",
        staffId: owner.staffId,
        reason,
        before: before ?? null,
        after: after ?? null,
        payload: {
          targetStaffId: id,
          serviceName,
        },
      });
      res.json(after ?? null);
    }),
  );

  app.delete(
    "/api/staff/:id/service-durations",
    asyncRoute((req, res) => {
      const owner = requireOwner(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const b = req.body as { serviceName?: string; reason?: string };
      const serviceName = String(b.serviceName ?? "").trim();
      const reason = String(b.reason ?? "").trim();
      if (!serviceName) {
        res.status(400).json({ error: "serviceName required" });
        return;
      }
      if (!reason) {
        res.status(400).json({ error: "reason_required" });
        return;
      }
      const [before] = db
        .select()
        .from(schema.staffServiceDurations)
        .where(
          and(
            eq(schema.staffServiceDurations.staffId, id),
            eq(schema.staffServiceDurations.serviceName, serviceName),
          ),
        )
        .limit(1)
        .all();
      if (!before) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      db.delete(schema.staffServiceDurations)
        .where(eq(schema.staffServiceDurations.id, before.id))
        .run();
      writeAudit(db, {
        entity: "staff_service_durations",
        entityId: before.id,
        action: "staff_service_duration_delete",
        staffId: owner.staffId,
        reason,
        before,
        after: null,
        payload: {
          targetStaffId: id,
          serviceName,
        },
      });
      res.json({ ok: true });
    }),
  );

  /* --- §13: appointments + check-in --- */
  app.post(
    "/api/appointments",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const b = req.body as {
        clientName?: string;
        clientPhone?: string | null;
        clientId?: number | null;
        staffId?: number;
        serviceName?: string;
        sourceType?: string;
        startAt?: unknown;
        endAt?: unknown;
      };
      const clientName = String(b.clientName ?? "").trim();
      const serviceName = String(b.serviceName ?? "").trim();
      const staffId = Number(b.staffId);
      const startMs = parseInstant(b.startAt);
      if (!clientName || !serviceName) {
        res.status(400).json({ error: "clientName_and_serviceName_required" });
        return;
      }
      if (!Number.isFinite(staffId) || staffId < 1) {
        res.status(400).json({ error: "staff_id_required" });
        return;
      }
      if (startMs == null) {
        res.status(400).json({ error: "invalid_start_at" });
        return;
      }
      const requestedEndMs = parseInstant(b.endAt);
      const resolvedEnd = resolveEndAtForService(db, {
        staffId,
        serviceName,
        startMs,
        requestedEndMs,
      });
      const endMs = resolvedEnd.endMs;
      if (endMs <= startMs) {
        res.status(400).json({ error: "invalid_time_range" });
        return;
      }
      const dur = validateServiceDuration(
        db,
        serviceName,
        startMs,
        endMs,
      );
      if (!dur.ok) {
        res.status(400).json({
          error: "duration_mismatch",
          expectedMinutes: dur.expectedMinutes,
          actualMinutes: dur.actualMinutes,
        });
        return;
      }
      const [st] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, staffId))
        .limit(1)
        .all();
      if (!st) {
        res.status(400).json({ error: "staff_not_found" });
        return;
      }
      const dayYmdCreate = berlinYmdFromMs(startMs);
      const calDayCreate = getStaffAvailability(db, staffId, dayYmdCreate);
      if (!calDayCreate.isAvailable) {
        res.status(409).json({
          error: "calendar_day_closed",
          reason: calDayCreate.reason,
        });
        return;
      }
      const av = validateSlot(db, { staffId, startMs, endMs });
      if (!av.ok) {
        res.status(409).json({
          error: "staff_unavailable",
          overlapping: av.overlapping,
          maxAllowed: av.maxAllowed,
        });
        return;
      }
      const phone =
        b.clientPhone == null || String(b.clientPhone).trim() === ""
          ? null
          : String(b.clientPhone).trim();
      const clientId =
        b.clientId != null && Number.isFinite(b.clientId) && b.clientId >= 1
          ? Math.floor(b.clientId)
          : null;
      if (clientId != null) {
        const [cl] = db
          .select()
          .from(schema.clients)
          .where(eq(schema.clients.id, clientId))
          .limit(1)
          .all();
        if (!cl) {
          res.status(400).json({ error: "client_not_found" });
          return;
        }
        if (cl.anonymizedAt != null) {
          res.status(400).json({ error: "client_anonymized" });
          return;
        }
      }
      const sourceType = String(b.sourceType ?? "internal").trim() || "internal";
      const [row] = db
        .insert(schema.appointments)
        .values({
          clientName,
          clientPhone: phone,
          clientId: clientId ?? null,
          staffId,
          serviceName,
          sourceType,
          startAt: new Date(startMs),
          endAt: new Date(endMs),
          status: "booked",
        })
        .returning()
        .all();
      writeAudit(db, {
        entity: "appointments",
        entityId: row!.id,
        action: "create",
        staffId: c.staffId,
        after: row,
        payload: { endAtSource: resolvedEnd.source },
      });
      res.status(201).json(row);
    }),
  );

  app.get(
    "/api/appointments",
    asyncRoute((req, res) => {
      getStaffContext(req);
      let fromMs = parseInstant(
        Array.isArray(req.query.from) ? req.query.from[0] : req.query.from,
      );
      let toMs = parseInstant(
        Array.isArray(req.query.to) ? req.query.to[0] : req.query.to,
      );
      if (fromMs == null || toMs == null) {
        const b = defaultLocalDayBounds();
        fromMs = b.from;
        toMs = b.to;
      }
      const rows = db
        .select()
        .from(schema.appointments)
        .where(
          and(
            isNull(schema.appointments.deletedAt),
            gte(schema.appointments.startAt, new Date(fromMs)),
            lte(schema.appointments.startAt, new Date(toMs)),
          ),
        )
        .orderBy(asc(schema.appointments.startAt))
        .all();
      res.json(rows);
    }),
  );

  app.post(
    "/api/appointments/:id/cancel",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const bodyCancel = req.body as { reason?: string; cancelReason?: string };
      const cancelText =
        String(bodyCancel.cancelReason ?? bodyCancel.reason ?? "").trim() ||
        "Terminabsage (ohne gesonderte Begründung erfasst)";
      const [apt] = db
        .select()
        .from(schema.appointments)
        .where(
          and(eq(schema.appointments.id, id), isNull(schema.appointments.deletedAt)),
        )
        .limit(1)
        .all();
      if (!apt) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (apt.status !== "booked") {
        res.status(409).json({ error: "invalid_status" });
        return;
      }
      const now = new Date();
      db.update(schema.appointments)
        .set({
          status: "canceled",
          updatedAt: now,
          cancelReason: cancelText,
        })
        .where(eq(schema.appointments.id, id))
        .run();
      const [updated] = db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, id))
        .limit(1)
        .all();
      const cid = resolveClientIdForCounters(db, {
        clientId: apt.clientId,
        clientPhone: apt.clientPhone,
      });
      if (cid != null) {
        incrementClientCancel(db, cid);
      }
      writeAudit(db, {
        entity: "appointments",
        entityId: id,
        action: "canceled",
        staffId: c.staffId,
        before: apt,
        after: updated ?? null,
        reason: cancelText,
      });
      res.json(updated);
    }),
  );

  app.patch(
    "/api/appointments/:id/status",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const b = req.body as {
        status?: schema.AppointmentStatus;
        cancelReason?: string | null;
      };
      const nextStatus = String(b.status ?? "").trim() as schema.AppointmentStatus;
      if (!schema.APPOINTMENT_STATUSES.includes(nextStatus)) {
        res.status(400).json({ error: "invalid_status" });
        return;
      }
      const [apt] = db
        .select()
        .from(schema.appointments)
        .where(
          and(eq(schema.appointments.id, id), isNull(schema.appointments.deletedAt)),
        )
        .limit(1)
        .all();
      if (!apt) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (apt.status === nextStatus) {
        res.json(apt);
        return;
      }
      const now = new Date();
      const nextRescheduleCount =
        nextStatus === "booked" && apt.status !== "booked"
          ? apt.rescheduleCount + 1
          : apt.rescheduleCount;
      const cancelReasonStored =
        nextStatus === "canceled"
          ? String(b.cancelReason ?? "").trim() ||
            "Terminabsage (ohne gesonderte Begründung erfasst)"
          : apt.cancelReason;
      db.update(schema.appointments)
        .set({
          status: nextStatus,
          updatedAt: now,
          rescheduleCount: nextRescheduleCount,
          cancelReason: cancelReasonStored,
        })
        .where(eq(schema.appointments.id, id))
        .run();
      const [updated] = db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, id))
        .limit(1)
        .all();
      const cid = resolveClientIdForCounters(db, {
        clientId: apt.clientId,
        clientPhone: apt.clientPhone,
      });
      if (cid != null) {
        if (nextStatus === "canceled") incrementClientCancel(db, cid);
        if (nextStatus === "no_show") incrementClientNoShow(db, cid);
      }
      writeAudit(db, {
        entity: "appointments",
        entityId: id,
        action: "status_change",
        staffId: c.staffId,
        before: apt,
        after: updated ?? null,
        reason:
          nextStatus === "canceled"
            ? cancelReasonStored
            : nextStatus === "no_show"
              ? "No-Show"
              : null,
      });
      res.json(updated);
    }),
  );

  /**
   * §36 GoBD — Full appointment row update (Änderungshistorie). Requires textual `reason`
   * when reschedule delta >30min or staff reassignment.
   */
  app.put(
    "/api/appointments/:id",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const b = req.body as {
        startAt?: unknown;
        endAt?: unknown;
        staffId?: number;
        serviceName?: string;
        clientName?: string;
        clientPhone?: string | null;
        reason?: string;
      };
      const [apt] = db
        .select()
        .from(schema.appointments)
        .where(
          and(eq(schema.appointments.id, id), isNull(schema.appointments.deletedAt)),
        )
        .limit(1)
        .all();
      if (!apt) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (apt.status === "canceled" || apt.status === "completed") {
        res.status(409).json({ error: "appointment_not_editable" });
        return;
      }
      const nextStaffId =
        b.staffId != null && Number.isFinite(Number(b.staffId))
          ? Math.floor(Number(b.staffId))
          : apt.staffId;
      const nextService =
        b.serviceName != null
          ? String(b.serviceName).trim() || apt.serviceName
          : apt.serviceName;
      let startMs =
        b.startAt != null ? parseInstant(b.startAt) : apt.startAt.getTime();
      let endMs = b.endAt != null ? parseInstant(b.endAt) : apt.endAt.getTime();
      if (startMs == null) startMs = apt.startAt.getTime();
      if (endMs == null) endMs = apt.endAt.getTime();
      if (b.startAt != null && b.endAt == null) {
        const resolved = resolveEndAtForService(db, {
          staffId: nextStaffId,
          serviceName: nextService,
          startMs,
          requestedEndMs: null,
        });
        endMs = resolved.endMs;
      }
      const nextStart = new Date(startMs);
      const nextEnd = new Date(endMs);
      if (nextEnd.getTime() <= nextStart.getTime()) {
        res.status(400).json({ error: "invalid_time_range" });
        return;
      }
      const dur = validateServiceDuration(db, nextService, startMs, endMs);
      if (!dur.ok) {
        res.status(400).json({
          error: "duration_mismatch",
          expectedMinutes: dur.expectedMinutes,
          actualMinutes: dur.actualMinutes,
        });
        return;
      }
      const needsReason = appointmentUpdateRequiresReason(apt, {
        startAt: nextStart,
        endAt: nextEnd,
        staffId: nextStaffId,
      });
      const reasonText = String(b.reason ?? "").trim();
      if (needsReason && !reasonText) {
        res.status(400).json({ error: "appointment_change_reason_required" });
        return;
      }
      const [st] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, nextStaffId))
        .limit(1)
        .all();
      if (!st) {
        res.status(400).json({ error: "staff_not_found" });
        return;
      }
      const dayYmdPatch = berlinYmdFromMs(startMs);
      const calDayPatch = getStaffAvailability(db, nextStaffId, dayYmdPatch);
      if (!calDayPatch.isAvailable) {
        res.status(409).json({
          error: "calendar_day_closed",
          reason: calDayPatch.reason,
        });
        return;
      }
      const av = validateSlot(db, {
        staffId: nextStaffId,
        startMs,
        endMs,
        excludeAppointmentId: id,
      });
      if (!av.ok) {
        res.status(409).json({
          error: "staff_unavailable",
          overlapping: av.overlapping,
          maxAllowed: av.maxAllowed,
        });
        return;
      }
      const phoneNext =
        b.clientPhone !== undefined
          ? b.clientPhone == null || String(b.clientPhone).trim() === ""
            ? null
            : String(b.clientPhone).trim()
          : apt.clientPhone;
      const nameNext =
        b.clientName != null ? String(b.clientName).trim() || apt.clientName : apt.clientName;
      const slotMoved =
        apt.startAt.getTime() !== startMs ||
        apt.endAt.getTime() !== endMs ||
        apt.staffId !== nextStaffId;
      const now = new Date();
      db.update(schema.appointments)
        .set({
          staffId: nextStaffId,
          serviceName: nextService,
          clientName: nameNext,
          clientPhone: phoneNext,
          startAt: nextStart,
          endAt: nextEnd,
          rescheduleCount: slotMoved ? apt.rescheduleCount + 1 : apt.rescheduleCount,
          updatedAt: now,
        })
        .where(eq(schema.appointments.id, id))
        .run();
      const [updated] = db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, id))
        .limit(1)
        .all();
      createAuditLog(db, {
        staffId: c.staffId,
        action: "appointment_update",
        entityType: "appointments",
        entityId: id,
        beforeData: snapshotAppointmentRow(apt),
        afterData: updated ? snapshotAppointmentRow(updated) : null,
        reason: reasonText || null,
      });
      res.json(updated);
    }),
  );

  /**
   * §36 GoBD — Soft-delete (no hard DELETE): hides row from listings; row retained for Revisionssicherheit.
   */
  app.delete(
    "/api/appointments/:id",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const rawReason =
        typeof req.body === "object" && req.body != null && "reason" in req.body
          ? (req.body as { reason?: string }).reason
          : undefined;
      const qReason = Array.isArray(req.query.reason)
        ? req.query.reason[0]
        : req.query.reason;
      const reason = String(rawReason ?? qReason ?? "").trim();
      if (!reason) {
        res.status(400).json({ error: "appointment_delete_reason_required" });
        return;
      }
      const [apt] = db
        .select()
        .from(schema.appointments)
        .where(
          and(eq(schema.appointments.id, id), isNull(schema.appointments.deletedAt)),
        )
        .limit(1)
        .all();
      if (!apt) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const now = new Date();
      db.update(schema.appointments)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(schema.appointments.id, id))
        .run();
      const [updated] = db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, id))
        .limit(1)
        .all();
      createAuditLog(db, {
        staffId: c.staffId,
        action: "appointment_soft_delete",
        entityType: "appointments",
        entityId: id,
        beforeData: snapshotAppointmentRow(apt),
        afterData: updated ? snapshotAppointmentRow(updated) : null,
        reason,
      });
      res.json({ ok: true, id });
    }),
  );

  app.post(
    "/api/appointments/:id/no-show",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [apt] = db
        .select()
        .from(schema.appointments)
        .where(
          and(eq(schema.appointments.id, id), isNull(schema.appointments.deletedAt)),
        )
        .limit(1)
        .all();
      if (!apt) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (apt.status !== "booked") {
        res.status(409).json({ error: "invalid_status" });
        return;
      }
      const now = new Date();
      db.update(schema.appointments)
        .set({ status: "no_show", updatedAt: now })
        .where(eq(schema.appointments.id, id))
        .run();
      const [updated] = db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, id))
        .limit(1)
        .all();
      const cid = resolveClientIdForCounters(db, {
        clientId: apt.clientId,
        clientPhone: apt.clientPhone,
      });
      if (cid != null) {
        incrementClientNoShow(db, cid);
      }
      writeAudit(db, {
        entity: "appointments",
        entityId: id,
        action: "no_show",
        staffId: c.staffId,
        before: apt,
        after: updated ?? null,
      });
      res.json(updated);
    }),
  );

  app.post(
    "/api/appointments/:id/check-in",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }

      const [apt] = db
        .select()
        .from(schema.appointments)
        .where(
          and(eq(schema.appointments.id, id), isNull(schema.appointments.deletedAt)),
        )
        .limit(1)
        .all();
      if (!apt) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (apt.status === "canceled" || apt.status === "no_show") {
        res.status(409).json({ error: "appointment_not_checkable" });
        return;
      }

      const [existingSession] = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.appointmentId, id))
        .limit(1)
        .all();
      if (apt.status === "checked_in" && existingSession) {
        res.json({
          appointment: apt,
          session: existingSession,
          idempotent: true,
        });
        return;
      }
      if (apt.status !== "booked") {
        res.status(409).json({ error: "invalid_status" });
        return;
      }

      try {
        const out = db.transaction((tx) => {
          const [a2] = tx
            .select()
            .from(schema.appointments)
            .where(eq(schema.appointments.id, id))
            .limit(1)
            .all();
          if (!a2 || a2.status !== "booked") {
            throw new Error("concurrent_change");
          }
          const { firstName, lastName } = splitClientDisplayName(a2.clientName);
          const displayName = buildClientDisplayName(firstName, lastName);
          const [client] = tx
            .insert(schema.clients)
            .values({
              name: displayName,
              firstName,
              lastName,
              phone: a2.clientPhone ?? null,
              email: null,
              gdprConsent: true,
              gdprConsentDate: new Date(),
              preferences: null,
              anonymizedAt: null,
            })
            .returning()
            .all();
          writeAuditTx(tx, {
            entity: "clients",
            entityId: client!.id,
            action: "client_created",
            staffId: c.staffId,
            payload: {
              source: "appointment_check_in",
              appointmentId: a2.id,
            },
          });
          const [session] = tx
            .insert(schema.sessions)
            .values({
              clientId: client!.id,
              staffId: a2.staffId,
              appointmentId: a2.id,
              status: "open",
            })
            .returning()
            .all();
          const now = new Date();
          tx.update(schema.appointments)
            .set({
              status: "checked_in",
              updatedAt: now,
              clientId: client!.id,
            })
            .where(eq(schema.appointments.id, id))
            .run();
          const [updatedApt] = tx
            .select()
            .from(schema.appointments)
            .where(eq(schema.appointments.id, id))
            .limit(1)
            .all();
          writeAuditTx(tx, {
            entity: "appointments",
            entityId: id,
            action: "check_in",
            staffId: c.staffId,
            before: { status: a2.status },
            after: { status: updatedApt!.status },
            payload: { sessionId: session!.id, clientId: client!.id },
          });
          return { appointment: updatedApt!, session: session! };
        });
        res.json({ ...out, idempotent: false });
      } catch {
        res.status(409).json({ error: "check_in_failed" });
      }
    }),
  );

  /* --- 33: inventory + barcodes --- */
  app.get(
    "/api/inventory",
    asyncRoute((_req, res) => {
      res.json(db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.active, true)).all());
    }),
  );

  app.post(
    "/api/inventory",
    asyncRoute((req, res) => {
      const body = req.body as {
        name: string;
        barcodeEan?: string;
        barcodeUpc?: string;
        onHandMl?: number;
        defaultUnitMl?: number;
        minStockThresholdMl?: number | null;
      };
      const values: typeof schema.inventoryItems.$inferInsert = {
        name: body.name,
        // Empty strings are normalized to NULL, preserving UNIQUE semantics with multiple NULLs.
        barcodeEan: normalizeBarcode(body.barcodeEan),
        barcodeUpc: normalizeBarcode(body.barcodeUpc),
        onHandMl: body.onHandMl ?? 0,
        defaultUnitMl: body.defaultUnitMl ?? 0,
      };
      if ("minStockThresholdMl" in body) {
        if (body.minStockThresholdMl === null) {
          values.minStockThresholdMl = null;
        } else {
          const t = Math.max(0, Math.floor(Number(body.minStockThresholdMl)));
          values.minStockThresholdMl = Number.isFinite(t) ? t : null;
        }
      }
      const [row] = db
        .insert(schema.inventoryItems)
        .values(values)
        .returning()
        .all();
      if (row) {
        syncLowStockAlertForItem(db, row.id);
        const [r2] = db
          .select()
          .from(schema.inventoryItems)
          .where(eq(schema.inventoryItems.id, row.id))
          .limit(1)
          .all();
        res.json(r2 ?? row);
        return;
      }
      res.json(row);
    }),
  );

  /**
   * §10 — Set `min_stock_threshold_ml` (owner). Triggers resync of low_stock alert for this item.
   */
  app.patch(
    "/api/inventory/:id",
    asyncRoute((req, res) => {
      requireOwner(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const body = req.body as { minStockThresholdMl?: number | null };
      if (!("minStockThresholdMl" in body)) {
        res.status(400).json({ error: "minStockThresholdMl required" });
        return;
      }
      const raw = body.minStockThresholdMl;
      let th: number | null;
      if (raw === null || raw === undefined) {
        th = null;
      } else {
        th = Math.max(0, Math.floor(Number(raw)));
        if (!Number.isFinite(th)) {
          res.status(400).json({ error: "minStockThresholdMl invalid" });
          return;
        }
      }
      const [cur] = db
        .select()
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.id, id))
        .limit(1)
        .all();
      if (!cur) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      db.update(schema.inventoryItems)
        .set({ minStockThresholdMl: th })
        .where(eq(schema.inventoryItems.id, id))
        .run();
      syncLowStockAlertForItem(db, id);
      const [out] = db
        .select()
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.id, id))
        .limit(1)
        .all();
      res.json(out ?? cur);
    }),
  );

  app.delete(
    "/api/inventory/:id",
    asyncRoute((req, res) => {
      requireOwner(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      db.update(schema.inventoryItems)
        .set({ active: false })
        .where(eq(schema.inventoryItems.id, id))
        .run();
      res.json({ ok: true });
    }),
  );

  /**
   * §10 — Active low_stock flags + joined item; optional diagnostic list of at/below-threshold book rows.
   */
  app.get(
    "/api/system-alerts",
    asyncRoute((req, res) => {
      requireOwner(req);
      res.json({
        lowStock: listOpenLowStockAlerts(db),
        atOrBelowThreshold: listMonitoredItemsAtOrBelowThreshold(db),
      });
    }),
  );

  app.post(
    "/api/finance/cash-journal",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const b = req.body as {
        entryType?: schema.CashJournalEntryType;
        amountCents?: number;
        note?: string;
      };
      const entryType = String(b.entryType ?? "").trim() as schema.CashJournalEntryType;
      if (!["opening_float", "payout", "transit"].includes(entryType)) {
        res.status(400).json({ error: "entry_type_invalid" });
        return;
      }
      const amountCents = Math.floor(Number(b.amountCents));
      if (!Number.isFinite(amountCents) || amountCents < 1) {
        res.status(400).json({ error: "amount_cents_invalid" });
        return;
      }
      const note = String(b.note ?? "").trim() || null;
      const [row] = db
        .insert(schema.cashJournal)
        .values({
          entryType,
          amountCents,
          note,
          staffId: c.staffId,
        })
        .returning()
        .all();
      writeAudit(db, {
        entity: "cash_journal",
        entityId: row?.id,
        action: "cash_journal_entry",
        staffId: c.staffId,
        payload: row,
      });
      res.status(201).json(row);
    }),
  );

  app.get(
    "/api/vouchers/:code",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const code = String(req.params.code ?? "").trim();
      if (!code) {
        res.status(400).json({ error: "voucher_code_required" });
        return;
      }
      const out = validateVoucher(db, code);
      if (!out.ok) {
        res.status(404).json({ error: out.error });
        return;
      }
      res.json({
        id: out.voucher.id,
        code: out.voucher.code,
        remainingAmountCents: out.voucher.remainingAmountCents,
        status: out.voucher.status,
        expiryDate: out.voucher.expiryDate,
        isMultiPurpose: out.voucher.isMultiPurpose,
      });
    }),
  );

  app.get(
    "/api/clients/:id/loyalty",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [client] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      if (!client) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const [row] = db
        .select()
        .from(schema.clientLoyalty)
        .where(eq(schema.clientLoyalty.clientId, id))
        .limit(1)
        .all();
      const state =
        row ??
        ({
          clientId: id,
          pointsBalance: 0,
          stampsCount: 0,
          lifetimePoints: 0,
          lastRewardAt: null,
        } as const);
      const eligibility = checkRewardEligibility({
        stampsCount: state.stampsCount,
        lastRewardAt: state.lastRewardAt,
      });
      res.json({
        clientId: id,
        pointsBalance: state.pointsBalance,
        stampsCount: state.stampsCount,
        lifetimePoints: state.lifetimePoints,
        lastRewardAt: state.lastRewardAt,
        reward: {
          threshold: LOYALTY_REWARD_STAMPS_THRESHOLD,
          eligibleNow: eligibility.eligibleNow,
          nextRewardAtStamps: eligibility.nextRewardAtStamps,
          stampsUntilNext: eligibility.stampsUntilNext,
        },
      });
    }),
  );

  app.post(
    "/api/admin/loyalty/adjust",
    asyncRoute((req, res) => {
      const owner = requireOwner(req);
      const b = req.body as {
        clientId?: number;
        pointsDelta?: number;
        stampsDelta?: number;
        reason?: string;
      };
      const clientId = Math.floor(Number(b.clientId));
      const pointsDelta = Math.floor(Number(b.pointsDelta ?? 0));
      const stampsDelta = Math.floor(Number(b.stampsDelta ?? 0));
      const reason = String(b.reason ?? "").trim();
      if (!Number.isFinite(clientId) || clientId < 1) {
        res.status(400).json({ error: "client_id_invalid" });
        return;
      }
      if (!Number.isFinite(pointsDelta) || !Number.isFinite(stampsDelta)) {
        res.status(400).json({ error: "delta_invalid" });
        return;
      }
      if (!reason) {
        res.status(400).json({ error: "reason_required" });
        return;
      }
      const [cur] = db
        .select()
        .from(schema.clientLoyalty)
        .where(eq(schema.clientLoyalty.clientId, clientId))
        .limit(1)
        .all();
      if (cur) {
        db.update(schema.clientLoyalty)
          .set({
            pointsBalance: Math.max(0, cur.pointsBalance + pointsDelta),
            stampsCount: Math.max(0, cur.stampsCount + stampsDelta),
            lifetimePoints: Math.max(0, cur.lifetimePoints + Math.max(0, pointsDelta)),
            updatedAt: new Date(),
          })
          .where(eq(schema.clientLoyalty.id, cur.id))
          .run();
      } else {
        db.insert(schema.clientLoyalty)
          .values({
            clientId,
            pointsBalance: Math.max(0, pointsDelta),
            stampsCount: Math.max(0, stampsDelta),
            lifetimePoints: Math.max(0, pointsDelta),
            lastRewardAt: null,
            updatedAt: new Date(),
          })
          .run();
      }
      const [after] = db
        .select()
        .from(schema.clientLoyalty)
        .where(eq(schema.clientLoyalty.clientId, clientId))
        .limit(1)
        .all();
      writeAudit(db, {
        entity: "client_loyalty",
        entityId: after?.id,
        action: "loyalty_adjust",
        staffId: owner.staffId,
        reason,
        before: cur ?? null,
        after: after ?? null,
        payload: { clientId, pointsDelta, stampsDelta },
      });
      res.json(after ?? null);
    }),
  );

  app.post(
    "/api/admin/vouchers/issue",
    asyncRoute((req, res) => {
      const owner = requireOwner(req);
      const b = req.body as {
        code?: string;
        initialAmountCents?: number;
        isMultiPurpose?: boolean;
        expiryDateMs?: number | null;
      };
      try {
        const row = issueVoucher(db, {
          code: String(b.code ?? ""),
          initialAmountCents: Number(b.initialAmountCents),
          isMultiPurpose: b.isMultiPurpose ?? true,
          expiryDateMs: b.expiryDateMs ?? null,
        });
        writeAudit(db, {
          entity: "vouchers",
          entityId: row.id,
          action: "voucher_issued",
          staffId: owner.staffId,
          payload: row,
        });
        res.status(201).json(row);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "voucher_issue_failed";
        const status =
          msg === "voucher_code_required" ||
          msg === "voucher_amount_invalid" ||
          msg === "voucher_code_exists"
            ? 400
            : 500;
        res.status(status).json({ error: msg });
      }
    }),
  );

  /**
   * Blind-Kassensturz: exposes expected cash **only** when the client explicitly requests it
   * (after physical count — Phase „COUNTING“ → „REVIEWING“). Not bundled with session listings.
   */
  app.get(
    "/api/finance/daily-close-expected",
    requireAdmin,
    asyncRoute((_req, res) => {
      const nowMs = Date.now();
      const expected = computeExpectedCashCents(db, nowMs);
      res.json({
        expectedCashCents: expected.expectedCashCents,
        baseCashCents: expected.baseCashCents,
        cashSalesCents: expected.cashSalesCents,
        journalDeltaCents: expected.journalDeltaCents,
        fromMs: expected.fromMs,
      });
    }),
  );

  app.post(
    "/api/finance/daily-close",
    requireAdmin,
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const b = req.body as {
        actualCashCents?: number;
        differenceReason?: string;
      };
      const actualCashCents = Math.floor(Number(b.actualCashCents));
      if (!Number.isFinite(actualCashCents) || actualCashCents < 0) {
        res.status(400).json({ error: "actual_cash_cents_invalid" });
        return;
      }
      const nowMs = Date.now();
      const expected = computeExpectedCashCents(db, nowMs);
      const differenceCents = actualCashCents - expected.expectedCashCents;
      const differenceReason = String(b.differenceReason ?? "").trim() || null;
      if (differenceCents !== 0 && !differenceReason) {
        res.status(400).json({ error: "difference_reason_required" });
        return;
      }
      const snapshot = buildDailyCloseSnapshot(db, expected.fromMs, nowMs);
      const [row] = db
        .insert(schema.dailyClosings)
        .values({
          expectedCashCents: expected.expectedCashCents,
          actualCashCents,
          differenceCents,
          differenceReason,
          snapshotJson: JSON.stringify({
            ...snapshot,
            expectedComputation: {
              baseCashCents: expected.baseCashCents,
              cashSalesCents: expected.cashSalesCents,
              journalDeltaCents: expected.journalDeltaCents,
            },
          }),
          closedByStaffId: c.staffId,
        })
        .returning()
        .all();
      writeAudit(db, {
        entity: "daily_closings",
        entityId: row?.id,
        action: "daily_closing_executed",
        staffId: c.staffId,
        reason: differenceReason,
        payload: row,
      });
      res.status(201).json(row);
    }),
  );

  app.get(
    "/api/inventory/lookup",
    asyncRoute((req, res) => {
      const code = String(req.query.barcode ?? "").trim();
      if (!code) {
        res.status(400).json({ error: "barcode required" });
        return;
      }
      const item = findItemByBarcodeScan(db, code);
      if (!item) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(item);
    }),
  );

  /** §11 — Path-style lookup (same as `?barcode=`); for hardware / deep-link integration. */
  app.get(
    "/api/inventory/lookup/:barcode",
    asyncRoute((req, res) => {
      let raw = String(req.params.barcode ?? "");
      try {
        raw = decodeURIComponent(raw);
      } catch {
        res.status(400).json({ error: "barcode invalid" });
        return;
      }
      const code = raw.trim();
      if (!code) {
        res.status(400).json({ error: "barcode required" });
        return;
      }
      const item = findItemByBarcodeScan(db, code);
      if (!item) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(item);
    }),
  );

  /**
   * §11 — Goods receipt (Waren­eingang): `stock_in` on `inventory_adjustments`, Beleg in audit + note.
   */
  app.post(
    "/api/inventory/receive",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const body = req.body as {
        addMl: number;
        supplierInvoiceRef: string;
        itemId?: number;
        barcode?: string;
      };
      try {
        const out = applyGoodsReceipt(db, {
          staffId: c.staffId,
          addMl: body.addMl,
          supplierInvoiceRef: String(body.supplierInvoiceRef ?? ""),
          itemId: body.itemId,
          barcode: body.barcode,
        });
        res.json({
          item: out.item,
          adjustment: {
            id: out.adjustment.id,
            deltaMl: out.adjustment.deltaMl,
            reason: out.adjustment.reason,
            createdAt: out.adjustment.createdAt,
          },
        });
      } catch (e) {
        if (e instanceof GoodsReceiptNotFoundError) {
          res.status(404).json({ error: e.code });
          return;
        }
        if (e instanceof GoodsReceiptValidationError) {
          res.status(e.status).json({ error: e.code, message: e.message });
          return;
        }
        throw e;
      }
    }),
  );

  app.post(
    "/api/inventory/scan-deduct",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const body = req.body as { barcode: string; ml: number };
      const code = String(body.barcode ?? "").trim();
      const ml = Math.floor(Number(body.ml));
      if (!code) {
        res.status(400).json({ error: "barcode required" });
        return;
      }
      if (!Number.isFinite(ml) || ml <= 0) {
        res.status(400).json({ error: "ml must be a positive integer" });
        return;
      }
      const item = findItemByBarcodeScan(db, code);
      if (!item) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (item.onHandMl - ml < 0) {
        res.status(409).json({
          error: "negative_stock_blocked",
          message: "Not enough stock for requested ml deduction.",
        });
        return;
      }
      const nextQty = item.onHandMl - ml;
      db.transaction((tx) => {
        tx.update(schema.inventoryItems)
          .set({ onHandMl: nextQty })
          .where(eq(schema.inventoryItems.id, item.id))
          .run();
        syncLowStockAlertForItemTx(tx as unknown as LowStockDb, item.id);
      });
      writeAudit(db, {
        entity: "inventory_items",
        entityId: item.id,
        action: "scan_deduct",
        staffId: c.staffId,
        payload: { barcode: code, ml, previousMl: item.onHandMl, nextMl: nextQty },
      });
      res.json({ item: { ...item, onHandMl: nextQty }, deductedMl: ml });
    }),
  );

  /**
   * §9 — Manual inventory adjust (ml): owner may increase, waste, expiry, count correction;
   * other roles: decrease + waste only. Immutable audit with before/after.
   */
  app.post(
    "/api/inventory/adjust",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const parsed = parseManualAdjustBody(req.body);
      if (!parsed.ok) {
        res.status(parsed.status).json({ error: parsed.error });
        return;
      }
      try {
        const out = applyManualInventoryAdjust(db, {
          staffId: c.staffId,
          role: c.role,
          itemId: parsed.itemId,
          amountMl: parsed.amountMl,
          type: parsed.type,
          category: parsed.category,
          userReason: parsed.userReason,
        });
        res.json({
          item: out.item,
          adjustment: {
            id: out.adjustment.id,
            deltaMl: out.adjustment.deltaMl,
            reason: out.adjustment.reason,
            createdAt: out.adjustment.createdAt,
          },
        });
      } catch (e) {
        if (e instanceof ManualAdjustPermissionError) {
          res.status(403).json({ error: e.code, message: e.message });
          return;
        }
        if (e instanceof ManualAdjustStockError) {
          res.status(409).json({
            error: e.code,
            onHandMl: e.onHandMl,
            requestedMl: e.requestedMl,
          });
          return;
        }
        if (e instanceof ManualAdjustNotFoundError) {
          res.status(404).json({ error: e.code });
          return;
        }
        throw e;
      }
    }),
  );

  /**
   * §11 — Box-based goods receipt: POST { itemId, boxCount, mlPerBox }
   * يُستخدم لإضافة مخزون بطريقة "عدد علب × ML في العلبة".
   * يحسب totalMl = boxCount × mlPerBox ويضيفها لـ on_hand_ml.
   */
  app.post(
    "/api/inventory/receive-boxes",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const body = req.body as {
        itemId?: number;
        boxCount?: number;
        mlPerBox?: number;
        note?: string;
      };
      const itemId = Number(body.itemId);
      const boxCount = Math.floor(Number(body.boxCount ?? 0));
      const mlPerBox = Math.floor(Number(body.mlPerBox ?? 0));

      if (!Number.isFinite(itemId) || itemId < 1) {
        res.status(400).json({ error: "itemId_required" });
        return;
      }
      if (!Number.isFinite(boxCount) || boxCount < 1) {
        res.status(400).json({ error: "boxCount_must_be_positive" });
        return;
      }
      if (!Number.isFinite(mlPerBox) || mlPerBox < 1) {
        res.status(400).json({ error: "mlPerBox_must_be_positive" });
        return;
      }

      const totalMl = boxCount * mlPerBox;

      const [item] = db
        .select()
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.id, itemId))
        .limit(1)
        .all();

      if (!item) {
        res.status(404).json({ error: "item_not_found" });
        return;
      }

      const newOnHandMl = (item.onHandMl ?? 0) + totalMl;

      db.update(schema.inventoryItems)
        .set({ onHandMl: newOnHandMl })
        .where(eq(schema.inventoryItems.id, itemId))
        .run();

      const [adj] = db.insert(schema.inventoryAdjustments).values({
        inventoryItemId: itemId,
        deltaMl: totalMl,
        reason: `stock_in_boxes: ${boxCount} Kartons × ${mlPerBox} ml (${String(body.note ?? "").trim() || "Wareneingang"})`,
        staffId: c.staffId,
      }).returning().all();

      writeAudit(db, {
        entity: "inventory_items",
        entityId: itemId,
        action: "receive_boxes",
        staffId: c.staffId,
        before: { onHandMl: item.onHandMl },
        after: { onHandMl: newOnHandMl },
        payload: { boxCount, mlPerBox, totalMl, note: body.note ?? "" },
      });

      syncLowStockAlertForItem(db, itemId);

      const [updated] = db
        .select()
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.id, itemId))
        .limit(1)
        .all();

      res.status(201).json({
        item: updated ?? item,
        adjustment: adj ?? null,
        totalMl,
        boxCount,
        mlPerBox,
      });
    }),
  );

  /* --- 34: sessions + Kostenvoranschlag --- */
  app.get(
    "/api/sessions",
    asyncRoute((_req, res) => {
      res.json(db.select().from(schema.sessions).orderBy(desc(schema.sessions.id)).all());
    }),
  );

  /** Salon Dienstkatalog (Spiegel / Schätzung) — seltene Änderungen, clientseitig cachen. */
  app.get(
    "/api/services",
    asyncRoute((_req, res) => {
      res.json(
        db
          .select()
          .from(schema.salonServiceCatalog)
          .where(eq(schema.salonServiceCatalog.catalogActive, true))
          .orderBy(asc(schema.salonServiceCatalog.id))
          .all(),
      );
    }),
  );

  /** Lager / Verkaufsartikel (Spiegel — Standard-Einheit). */
  app.get(
    "/api/products",
    asyncRoute((_req, res) => {
      res.json(
        db
          .select()
          .from(schema.inventoryItems)
          .orderBy(asc(schema.inventoryItems.id))
          .all(),
      );
    }),
  );

  app.post(
    "/api/sessions",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const body = req.body as {
        clientId?: number;
        appointmentId?: number | null;
        walkInClientName?: string | null;
      };
      let clientId: number | null = body.clientId ?? null;
      if (clientId == null && typeof body.walkInClientName === "string") {
        const name = body.walkInClientName.trim();
        if (name.length > 0) {
          const safe = name.length > 200 ? name.slice(0, 200) : name;
          const [rowC] = db
            .insert(schema.clients)
            .values({ name: safe, firstName: "", lastName: "" })
            .returning()
            .all();
          if (rowC) {
            clientId = rowC.id;
          }
        }
      }
      const [row] = db
        .insert(schema.sessions)
        .values({
          clientId,
          appointmentId: body.appointmentId ?? null,
          staffId: c.staffId,
          status: "open",
        })
        .returning()
        .all();
      res.json(row);
    }),
  );

  app.get(
    "/api/sessions/:id",
    asyncRoute((req, res) => {
      const id = Number.parseInt(req.params.id ?? "", 10);
      const [row] = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .limit(1)
        .all();
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(row);
    }),
  );

  app.patch(
    "/api/sessions/:id",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      const [prev] = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .all();
      if (!prev) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const b = req.body as { clientId?: number | null };
      const updates: Record<string, unknown> = {};
      if (b.clientId !== undefined) {
        updates.clientId = b.clientId;
      }
      if (Object.keys(updates).length === 0) {
        res.json(prev);
        return;
      }
      db.update(schema.sessions)
        .set(updates as Partial<typeof schema.sessions.$inferInsert>)
        .where(eq(schema.sessions.id, id))
        .run();
      const [row] = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .all();
      writeAudit(db, {
        entity: "sessions",
        entityId: id,
        action: "session_update",
        staffId: c.staffId,
        payload: { before: prev, after: row },
      });
      res.json(row);
    }),
  );

  /**
   * Force-abandon an open salon session (no fiscal close). Removes draft invoices only;
   * blocked if a closed invoice exists. Reverts `checked_in` appointment to `booked`.
   * Enables Tagesabschluss when guests/staff left the flow mid-session.
   */
  app.post(
    "/api/sessions/:id/cancel",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const body = (req.body ?? {}) as { reason?: string };
      const reasonNote =
        typeof body.reason === "string" && body.reason.trim().length > 0
          ? body.reason.trim().slice(0, 500)
          : null;

      let sessionBefore: typeof schema.sessions.$inferSelect | null = null;
      try {
        const updated = db.transaction((tx) => {
          const [sess] = tx
            .select()
            .from(schema.sessions)
            .where(eq(schema.sessions.id, id))
            .limit(1)
            .all();
          if (!sess) {
            throw Object.assign(new Error("not_found"), { http: 404 });
          }
          sessionBefore = sess;
          if (sess.status !== "open") {
            throw Object.assign(new Error("session_not_open"), { http: 409 });
          }

          const invs = tx
            .select()
            .from(schema.invoices)
            .where(eq(schema.invoices.sessionId, id))
            .all();
          for (const inv of invs) {
            if (inv.status === "closed") {
              throw Object.assign(new Error("session_has_closed_invoice"), { http: 409 });
            }
          }

          const draftIds = invs.filter((i) => i.status === "draft").map((i) => i.id);
          const closedAt = new Date();

          for (const iid of draftIds) {
            tx.delete(schema.invoiceItems)
              .where(eq(schema.invoiceItems.invoiceId, iid))
              .run();
            tx.delete(schema.invoicePayments)
              .where(eq(schema.invoicePayments.invoiceId, iid))
              .run();
            tx.delete(schema.clientDebts)
              .where(eq(schema.clientDebts.sourceInvoiceId, iid))
              .run();
            tx.delete(schema.inventoryAdjustments)
              .where(eq(schema.inventoryAdjustments.invoiceId, iid))
              .run();
          }
          if (draftIds.length > 0) {
            tx.update(schema.orphanPayments)
              .set({ matchedInvoiceId: null })
              .where(inArray(schema.orphanPayments.matchedInvoiceId, draftIds))
              .run();
            tx.delete(schema.invoices).where(inArray(schema.invoices.id, draftIds)).run();
          }

          if (sess.appointmentId != null) {
            const [apt] = tx
              .select()
              .from(schema.appointments)
              .where(eq(schema.appointments.id, sess.appointmentId))
              .limit(1)
              .all();
            if (apt && apt.status === "checked_in") {
              tx.update(schema.appointments)
                .set({ status: "booked", updatedAt: closedAt })
                .where(eq(schema.appointments.id, apt.id))
                .run();
            }
          }

          tx.update(schema.sessions)
            .set({
              status: "cancelled",
              closedAt,
            })
            .where(eq(schema.sessions.id, id))
            .run();

          const [row] = tx
            .select()
            .from(schema.sessions)
            .where(eq(schema.sessions.id, id))
            .limit(1)
            .all();
          return row ?? null;
        });

        if (!updated) {
          res.status(500).json({ error: "empty_result" });
          return;
        }
        writeAudit(db, {
          entity: "sessions",
          entityId: id,
          action: "session_force_cancel",
          staffId: c.staffId,
          before: sessionBefore,
          after: updated,
          payload: { reason: reasonNote },
        });
        res.json(updated);
      } catch (e: unknown) {
        const err = e as { http?: number; message?: string };
        if (err.http === 404 || err.message === "not_found") {
          res.status(404).json({ error: "not_found" });
          return;
        }
        if (err.http === 409) {
          if (err.message === "session_not_open") {
            res.status(409).json({ error: "session_not_open" });
            return;
          }
          if (err.message === "session_has_closed_invoice") {
            res.status(409).json({ error: "session_has_closed_invoice" });
            return;
          }
        }
        throw e;
      }
    }),
  );

  app.get(
    "/api/sessions/:id/estimate",
    asyncRoute((req, res) => {
      const id = Number.parseInt(req.params.id ?? "", 10);
      const [s] = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .limit(1)
        .all();
      if (!s) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({
        range:
          s.estimatedMinPriceCents != null && s.estimatedMaxPriceCents != null
            ? {
              min: s.estimatedMinPriceCents,
              max: s.estimatedMaxPriceCents,
            }
            : null,
        status: s.consultationStatus,
        approved: s.consultationStatus === "approved",
      });
    }),
  );

  app.patch(
    "/api/sessions/:id/estimate",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      const b = req.body as {
        estimatedMinPriceCents?: number | null;
        estimatedMaxPriceCents?: number | null;
        consultationStatus?: string;
        markShownToClient?: boolean;
        markApproved?: boolean;
      };
      const [prev] = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .all();
      if (!prev) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const updates: Record<string, unknown> = {};
      if (b.estimatedMinPriceCents !== undefined) {
        updates.estimatedMinPriceCents = b.estimatedMinPriceCents;
      }
      if (b.estimatedMaxPriceCents !== undefined) {
        updates.estimatedMaxPriceCents = b.estimatedMaxPriceCents;
      }
      if (b.consultationStatus) {
        updates.consultationStatus = b.consultationStatus;
      } else if (b.markShownToClient) {
        updates.consultationStatus = "shown_to_client";
      } else if (b.markApproved) {
        updates.consultationStatus = "approved";
        updates.consultationApprovedAt = new Date();
      }
      db.update(schema.sessions)
        .set(updates as Partial<typeof schema.sessions.$inferInsert>)
        .where(eq(schema.sessions.id, id))
        .run();
      const [row] = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .all();
      writeAudit(db, {
        entity: "sessions",
        entityId: id,
        action: "estimate_update",
        staffId: c.staffId,
        payload: { before: prev, after: row },
      });
      res.json(row);
    }),
  );

  /**
   * §12.5.34 — Compute Kostenvoranschlag totals from catalog service ids + planned product ml (non-fiscal).
   * Does not mutate the session; use `PATCH …/estimate` to persist min/max for the guest screen.
   */
  app.post(
    "/api/sessions/:id/estimate",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const sessionId = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(sessionId) || sessionId < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [sess] = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1)
        .all();
      if (!sess) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const b = req.body as {
        serviceIds?: number[];
        estimatedProducts?: { productId: number; estimatedMl: number }[];
      };
      const serviceIds = Array.isArray(b.serviceIds) ? b.serviceIds : [];
      const estimatedProducts = Array.isArray(b.estimatedProducts)
        ? b.estimatedProducts
        : [];
      const out = calculateEstimate(db, { serviceIds, estimatedProducts });
      if (!out.ok) {
        res.status(400).json(out);
        return;
      }
      res.json({
        sessionId,
        totalEstimatedCents: out.totalEstimatedCents,
        totalNetCents: out.totalNetCents,
        totalVatCents: out.totalVatCents,
        lines: out.lines,
      });
    }),
  );

  /**
   * §14+§16+§8 Checkout: ZVT → TSE → optional inventory ml deduct (same atomic tx as close).
   * Body: `items` (+ optional `inventoryItemId` + `deductMl` per line), + `zvt` **or** `orphanPaymentId`.
   * §15: audits; salon stock cannot go negative unless `inventory_items.is_retail`.
   */
  app.post(
    "/api/sessions/:id/checkout",
    asyncRoute(async (req, res) => {
      const c = getStaffContext(req);
      const body = req.body as {
        priceOverrideReason?: string;
        items?: {
          description?: string;
          quantity?: number;
          unitNetCents?: number;
          vatRateBps?: number;
          inventoryItemId?: number;
          deductMl?: number;
        }[];
        zvt?: ZvtDirectBody;
        orphanPaymentId?: number;
      };
      const sessionId = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(sessionId) || sessionId < 1) {
        auditCheckoutFailure(db, {
          staffId: c.staffId,
          sessionId: null,
          error: "bad_id",
          sessionRow: null,
          bodyItems: body.items,
          extra: { param: req.params.id },
        });
        res.status(400).json({ error: "bad_id" });
        return;
      }

      const [sessionForAudit] = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .limit(1)
        .all();
      const out = await runSessionCheckoutPipeline(db, {
        staffId: c.staffId,
        sessionId,
        body,
      });
      if (!out.ok) {
        auditCheckoutFailure(db, {
          staffId: c.staffId,
          sessionId,
          error: String((out.err.body as { error?: string }).error ?? "checkout_failed"),
          sessionRow: sessionForAudit ?? null,
          bodyItems: body.items,
          extra: out.err.body,
        });
        res.status(out.err.status).json(out.err.body);
        return;
      }
      res.status(out.status).json(out.json);
    }),
  );

  /**
   * §15 — Legal storno: never delete closed invoice.
   * Creates negative storno invoice, restores inventory ml, writes immutable audit.
   */
  app.post(
    "/api/invoices/:id/storno",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const b = req.body as { reason?: string };
      const reason = String(b.reason ?? "").trim();
      if (!reason) {
        res.status(400).json({ error: "reason_required" });
        return;
      }
      const [inv] = db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, id))
        .limit(1)
        .all();
      if (!inv) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (inv.status !== "closed") {
        res.status(409).json({ error: "invoice_not_closed" });
        return;
      }
      if (inv.stornoForInvoiceId != null) {
        res.status(409).json({ error: "storno_invoice_cannot_be_restornoed" });
        return;
      }
      const [existingStorno] = db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.stornoForInvoiceId, id))
        .limit(1)
        .all();
      if (existingStorno) {
        res.status(409).json({ error: "storno_already_exists", stornoInvoiceId: existingStorno.id });
        return;
      }

      const out = db.transaction((tx) => {
        const items = tx
          .select()
          .from(schema.invoiceItems)
          .where(eq(schema.invoiceItems.invoiceId, id))
          .all();
        const payments = tx
          .select()
          .from(schema.invoicePayments)
          .where(eq(schema.invoicePayments.invoiceId, id))
          .all();
        const now = new Date();
        const [stornoInvoice] = tx
          .insert(schema.invoices)
          .values({
            sessionId: inv.sessionId,
            totalAmountCents: -Math.abs(inv.totalAmountCents),
            vatAmountCents: -Math.abs(inv.vatAmountCents),
            tipAmountCents: -Math.abs(inv.tipAmountCents),
            tipStaffId: inv.tipStaffId,
            invoiceKind: "final",
            stornoForInvoiceId: inv.id,
            status: "closed",
            updatedAt: now,
            tseSignature: null,
            tseExportData: JSON.stringify({
              kind: "storno",
              stornoForInvoiceId: inv.id,
              reason,
            }),
            zvtAmountCents: inv.zvtAmountCents != null ? -Math.abs(inv.zvtAmountCents) : null,
            zvtTerminalId: inv.zvtTerminalId,
            zvtReceiptId: inv.zvtReceiptId,
            zvtAuthorizedAt: inv.zvtAuthorizedAt,
          })
          .returning()
          .all();
        if (!stornoInvoice) {
          throw new Error("storno_insert_failed");
        }

        for (const line of items) {
          tx.insert(schema.invoiceItems)
            .values({
              invoiceId: stornoInvoice.id,
              description: `STORNO: ${line.description}`,
              quantity: line.quantity,
              unitNetCents: -Math.abs(line.unitNetCents),
              vatRateBps: line.vatRateBps,
              inventoryItemId: line.inventoryItemId,
              deductMl: line.deductMl,
            })
            .run();
          if (line.inventoryItemId != null && line.deductMl != null && line.deductMl > 0) {
            const restoreMl = Math.max(1, line.quantity) * line.deductMl;
            const [it] = tx
              .select()
              .from(schema.inventoryItems)
              .where(eq(schema.inventoryItems.id, line.inventoryItemId))
              .limit(1)
              .all();
            if (it) {
              tx.update(schema.inventoryItems)
                .set({ onHandMl: it.onHandMl + restoreMl })
                .where(eq(schema.inventoryItems.id, line.inventoryItemId))
                .run();
              syncLowStockAlertForItemTx(tx as unknown as LowStockDb, line.inventoryItemId);
              tx.insert(schema.inventoryAdjustments)
                .values({
                  inventoryItemId: line.inventoryItemId,
                  deltaMl: restoreMl,
                  reason: "storno_restock",
                  invoiceId: stornoInvoice.id,
                  staffId: c.staffId,
                  note: JSON.stringify({
                    sourceInvoiceId: inv.id,
                    sourceInvoiceItemId: line.id,
                  }),
                })
                .run();
            }
          }
        }

        for (const p of payments) {
          tx.insert(schema.invoicePayments)
            .values({
              invoiceId: stornoInvoice.id,
              amountCents: -Math.abs(p.amountCents),
              method: p.method,
            })
            .run();
        }

        const debts = tx
          .select()
          .from(schema.clientDebts)
          .where(eq(schema.clientDebts.sourceInvoiceId, inv.id))
          .all();
        for (const d of debts) {
          tx.insert(schema.clientDebts)
            .values({
              clientId: d.clientId,
              sourceInvoiceId: stornoInvoice.id,
              amountCents: -Math.abs(d.amountCents),
              status: "closed",
            })
            .run();
          tx.update(schema.clientDebts)
            .set({ status: "closed" })
            .where(eq(schema.clientDebts.id, d.id))
            .run();
        }

        tx.update(schema.invoices)
          .set({ status: "canceled", updatedAt: now })
          .where(eq(schema.invoices.id, inv.id))
          .run();

        const [sessForLoyalty] = tx
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.id, inv.sessionId))
          .limit(1)
          .all();
        const cid = sessForLoyalty?.clientId ?? null;
        const [loyaltyBefore] =
          cid != null
            ? tx
                .select()
                .from(schema.clientLoyalty)
                .where(eq(schema.clientLoyalty.clientId, cid))
                .limit(1)
                .all()
            : [undefined];
        const loyaltyAfter = reverseLoyaltyAccrualForStorno(tx, {
          clientId: cid,
          paidTotalCents: inv.totalAmountCents,
        });
        if (loyaltyBefore != null || loyaltyAfter != null) {
          writeAuditTx(tx, {
            entity: "client_loyalty",
            entityId: loyaltyAfter?.id ?? loyaltyBefore?.id ?? null,
            action: "loyalty_storno_reverse",
            staffId: c.staffId,
            reason,
            before: loyaltyBefore ?? null,
            after: loyaltyAfter ?? null,
            payload: {
              sourceInvoiceId: inv.id,
              paidTotalCentsReversed: inv.totalAmountCents,
            },
          });
        }

        writeAuditTx(tx, {
          entity: "invoices",
          entityId: inv.id,
          action: "invoice_storno",
          staffId: c.staffId,
          reason,
          before: inv,
          after: stornoInvoice,
          payload: {
            stornoInvoiceId: stornoInvoice.id,
            restoredInventoryLines: items.filter((i) => i.inventoryItemId != null && i.deductMl != null).length,
          },
        });
        return { stornoInvoiceId: stornoInvoice.id };
      });

      const [stornoInvoice] = db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, out.stornoInvoiceId))
        .limit(1)
        .all();
      res.status(201).json({ ok: true, stornoInvoice });
    }),
  );

  /* --- 35: inventur --- */
  app.post(
    "/api/inventory-audits/lines",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const b = req.body as {
        auditRunId: string;
        lines: { inventoryItemId: number; countedQtyMl: number; note?: string }[];
      };
      if (!b.auditRunId || !Array.isArray(b.lines)) {
        res.status(400).json({ error: "auditRunId and lines[] required" });
        return;
      }
      const out: unknown[] = [];
      for (const line of b.lines) {
        const [item] = db
          .select()
          .from(schema.inventoryItems)
          .where(eq(schema.inventoryItems.id, line.inventoryItemId))
          .all();
        if (!item) continue;
        const book = item.onHandMl;
        const counted = Math.max(0, Math.floor(line.countedQtyMl));
        const variance = counted - book;
        const [row] = db
          .insert(schema.inventoryAudits)
          .values({
            auditRunId: b.auditRunId,
            inventoryItemId: line.inventoryItemId,
            bookQtyMl: book,
            countedQtyMl: counted,
            varianceMl: variance,
            auditorStaffId: c.staffId,
            note: line.note ?? null,
          })
          .returning()
          .all();
        if (row) out.push(row);
      }
      writeAudit(db, {
        entity: "inventory_audits",
        action: "lines_recorded",
        staffId: c.staffId,
        payload: { auditRunId: b.auditRunId, count: out.length },
      });
      res.json({ auditRunId: b.auditRunId, lines: out });
    }),
  );

  app.post(
    "/api/inventory-audits/close",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const b = req.body as {
        auditRunId: string;
        fiscalYear: number;
        periodLabel?: string;
        archiveNote?: string;
        postAdjustments?: boolean;
      };
      if (!b.auditRunId) {
        res.status(400).json({ error: "auditRunId required" });
        return;
      }
      const lines = db
        .select()
        .from(schema.inventoryAudits)
        .where(eq(schema.inventoryAudits.auditRunId, b.auditRunId))
        .all();
      if (b.postAdjustments) {
        for (const a of lines) {
          if (a.varianceMl === 0) continue;
          db.insert(schema.inventoryAdjustments)
            .values({
              inventoryItemId: a.inventoryItemId,
              deltaMl: a.varianceMl,
              reason: "inventur",
              sourceAuditId: a.id,
              staffId: c.staffId,
              note: b.periodLabel ?? null,
            })
            .run();
          const [it] = db
            .select()
            .from(schema.inventoryItems)
            .where(eq(schema.inventoryItems.id, a.inventoryItemId))
            .all();
          if (it) {
            db.update(schema.inventoryItems)
              .set({ onHandMl: it.onHandMl + a.varianceMl })
              .where(eq(schema.inventoryItems.id, a.inventoryItemId))
              .run();
            syncLowStockAlertForItem(db, a.inventoryItemId);
          }
        }
      }
      const [runRow] = db
        .insert(schema.inventoryAuditRuns)
        .values({
          auditRunId: b.auditRunId,
          fiscalYear: b.fiscalYear,
          periodLabel: b.periodLabel ?? null,
          closedAt: new Date(),
          archiveNote: b.archiveNote ?? null,
        })
        .returning()
        .all();
      writeAudit(db, {
        entity: "inventory_audit_runs",
        entityId: runRow?.id,
        action: "inventur_close",
        staffId: c.staffId,
        payload: { auditRunId: b.auditRunId, fiscalYear: b.fiscalYear },
      });
      res.json({ run: runRow, lineCount: lines.length, adjustmentsPosted: Boolean(b.postAdjustments) });
    }),
  );

  app.get(
    "/api/inventory-audits/:runId",
    asyncRoute((req, res) => {
      const runId = req.params.runId;
      res.json(
        db
          .select()
          .from(schema.inventoryAudits)
          .where(eq(schema.inventoryAudits.auditRunId, runId))
          .all(),
      );
    }),
  );

  /* --- 36: orphan + hardware --- */
  app.get(
    "/api/orphan-payments",
    asyncRoute((req, res) => {
      const terminal = req.query.terminal as string | undefined;
      const status = req.query.status as string | undefined;
      if (status === "open" || status === "unresolved" || !status) {
        res.json(
          listOpenOrphans(
            db,
            terminal,
          ),
        );
        return;
      }
      res.json(
        db
          .select()
          .from(schema.orphanPayments)
          .orderBy(desc(schema.orphanPayments.authorizedAt))
          .all(),
      );
    }),
  );

  /** Owner: inspect async hardware job queue (pending / failed monitoring). */
  app.get(
    "/api/hardware/queue",
    asyncRoute((req, res) => {
      requireOwner(req);
      const raw = String(req.query.status ?? "").trim();
      if (raw) {
        const statuses = raw.split(",").map((s) => s.trim()).filter(Boolean);
        const rows = db
          .select()
          .from(schema.hardwareJobs)
          .where(inArray(schema.hardwareJobs.status, statuses))
          .orderBy(desc(schema.hardwareJobs.id))
          .limit(200)
          .all();
        res.json(rows);
        return;
      }
      const rows = db
        .select()
        .from(schema.hardwareJobs)
        .orderBy(desc(schema.hardwareJobs.id))
        .limit(200)
        .all();
      res.json(rows);
    }),
  );

  /**
   * Hardware bridge (Step 44): initiate card terminal flow from frontend via backend.
   * Returns proof payload consumable by `/api/sessions/:id/checkout` (`body.zvt`).
   */
  app.post(
    "/api/hardware/zvt/pay",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const b = req.body as {
        amountCents?: number;
        terminalId?: string;
      };
      const amountCents = Math.floor(Number(b.amountCents));
      const terminalId = String(b.terminalId ?? "").trim() || "SALON-EC-LOCAL";
      if (!Number.isFinite(amountCents) || amountCents < 1) {
        res.status(400).json({ error: "amount_cents_invalid" });
        return;
      }

      if (process.env.OLIVER_ROOS_ZVT_FORCE_FAIL === "1") {
        res.status(503).json({ error: "zvt_terminal_unavailable" });
        return;
      }

      const authorizedAt = new Date();
      const zvtReceiptId = `ZVT-${authorizedAt.getTime()}`;

      db.insert(schema.hardwareJobs)
        .values({
          jobType: "zvt_payment",
          payloadJson: JSON.stringify({
            amountCents,
            terminalId,
            zvtReceiptId,
            authorizedAt: authorizedAt.toISOString(),
            initiatedByStaffId: c.staffId,
          }),
          status: "pending",
          retryCount: 0,
          errorLog: null,
        })
        .run();

      writeAudit(db, {
        entity: "orphan_payments",
        entityId: null,
        action: "zvt_payment_authorized",
        staffId: c.staffId,
        payload: { amountCents, terminalId, zvtReceiptId },
      });

      res.status(201).json({
        amountCents,
        terminalId,
        zvtReceiptId,
        authorizedAt: authorizedAt.toISOString(),
      });
    }),
  );

  /**
   * Hardware bridge (Step 44): explicit receipt print trigger after checkout success.
   * Uses LAN printer/TSE transport as a connectivity probe and enqueues print job.
   */
  app.post(
    "/api/hardware/print/invoice/:id",
    asyncRoute(async (req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [inv] = db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, id))
        .limit(1)
        .all();
      if (!inv) {
        res.status(404).json({ error: "invoice_not_found" });
        return;
      }
      const items = db
        .select()
        .from(schema.invoiceItems)
        .where(eq(schema.invoiceItems.invoiceId, id))
        .all();
      if (items.length < 1) {
        res.status(409).json({ error: "invoice_items_missing" });
        return;
      }
      const lines: TseSignInput["lines"] = items.map((it) => {
        const lineNetCents = it.quantity * it.unitNetCents;
        const lineVatCents = Math.round((lineNetCents * it.vatRateBps) / 10_000);
        return {
          description: it.description,
          quantity: it.quantity,
          unitNetCents: it.unitNetCents,
          vatRateBps: it.vatRateBps,
          lineNetCents,
          lineVatCents,
        };
      });
      const netCents = lines.reduce((s, l) => s + l.lineNetCents, 0);
      const vatCents = lines.reduce((s, l) => s + l.lineVatCents, 0);
      const grossCents = netCents + vatCents;
      const tseProbe = await signWithPrinterTse({
        invoiceId: inv.id,
        sessionId: inv.sessionId,
        totals: { netCents, vatCents, grossCents },
        lines,
      });

      db.insert(schema.hardwareJobs)
        .values({
          jobType: "print_receipt",
          payloadJson: JSON.stringify({
            invoiceId: inv.id,
            sessionId: inv.sessionId,
            lineCount: items.length,
            requestedByStaffId: c.staffId,
            requestedAt: Date.now(),
            tseProbe: tseProbe.exportPayload,
          }),
          status: "pending",
          retryCount: 0,
          errorLog: null,
        })
        .run();

      writeAudit(db, {
        entity: "invoices",
        entityId: inv.id,
        action: "print_receipt_triggered",
        staffId: c.staffId,
        payload: {
          sessionId: inv.sessionId,
          tseProvider: tseProbe.provider,
          tseError: tseProbe.tseError ?? null,
        },
      });

      res.status(202).json({
        invoiceId: inv.id,
        status: "queued",
        tseProvider: tseProbe.provider,
        tseError: tseProbe.tseError ?? null,
      });
    }),
  );

  /** Hardware bridge (Step 44): explicit Z-Bericht print trigger after daily close. */
  app.post(
    "/api/hardware/print/daily-close/:id",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [row] = db
        .select()
        .from(schema.dailyClosings)
        .where(eq(schema.dailyClosings.id, id))
        .limit(1)
        .all();
      if (!row) {
        res.status(404).json({ error: "daily_close_not_found" });
        return;
      }
      db.insert(schema.hardwareJobs)
        .values({
          jobType: "print_receipt",
          payloadJson: JSON.stringify({
            kind: "daily_close_report",
            dailyCloseId: row.id,
            requestedByStaffId: c.staffId,
            requestedAt: Date.now(),
          }),
          status: "pending",
          retryCount: 0,
          errorLog: null,
        })
        .run();

      writeAudit(db, {
        entity: "daily_closings",
        entityId: row.id,
        action: "print_daily_close_triggered",
        staffId: c.staffId,
        payload: { createdAt: row.createdAt },
      });

      res.status(202).json({ dailyCloseId: row.id, status: "queued" });
    }),
  );

  app.get(
    "/api/hardware/orphans",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const terminal = String(req.query.terminal ?? "").trim() || undefined;
      const status = String(req.query.status ?? "").trim();
      const statuses =
        status.length > 0
          ? [status]
          : ["unresolved", "matched", "refunded", "open", "reconciled"];
      const rows = db
        .select()
        .from(schema.orphanPayments)
        .where(
          terminal
            ? and(
                inArray(schema.orphanPayments.status, statuses as schema.OrphanStatus[]),
                eq(schema.orphanPayments.terminalId, terminal),
              )
            : inArray(schema.orphanPayments.status, statuses as schema.OrphanStatus[]),
        )
        .orderBy(desc(schema.orphanPayments.authorizedAt))
        .all()
        .map((r) => ({
          ...r,
          status:
            r.status === "open"
              ? "unresolved"
              : r.status === "reconciled"
                ? "matched"
                : r.status,
        }));
      res.json(rows);
    }),
  );

  app.post(
    "/api/hardware/orphans/:id/resolve",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const b = req.body as {
        invoiceId?: number;
        refunded?: boolean;
        reason?: string;
      };
      const reason = String(b.reason ?? "").trim() || null;
      const [orp] = db
        .select()
        .from(schema.orphanPayments)
        .where(eq(schema.orphanPayments.id, id))
        .limit(1)
        .all();
      if (!orp) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (!["unresolved", "open"].includes(orp.status)) {
        res.status(409).json({ error: "orphan_not_unresolved" });
        return;
      }
      if (b.refunded) {
        db.update(schema.orphanPayments)
          .set({ status: "refunded" })
          .where(eq(schema.orphanPayments.id, id))
          .run();
      } else {
        const invoiceId = Math.floor(Number(b.invoiceId));
        if (!Number.isFinite(invoiceId) || invoiceId < 1) {
          res.status(400).json({ error: "invoice_id_required_or_refunded_true" });
          return;
        }
        const [inv] = db
          .select()
          .from(schema.invoices)
          .where(eq(schema.invoices.id, invoiceId))
          .limit(1)
          .all();
        if (!inv) {
          res.status(404).json({ error: "invoice_not_found" });
          return;
        }
        db.update(schema.orphanPayments)
          .set({
            matchedInvoiceId: invoiceId,
            matchedSessionId: inv.sessionId,
            status: "matched",
          })
          .where(eq(schema.orphanPayments.id, id))
          .run();
      }
      const [updated] = db
        .select()
        .from(schema.orphanPayments)
        .where(eq(schema.orphanPayments.id, id))
        .limit(1)
        .all();
      writeAudit(db, {
        entity: "orphan_payments",
        entityId: id,
        action: "orphan_resolve",
        staffId: c.staffId,
        reason,
        before: orp,
        after: updated ?? null,
      });
      res.json(updated);
    }),
  );

  app.post(
    "/api/orphan-payments",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const b = req.body as Parameters<typeof insertOrphanFromZvtSuccess>[1];
      const row = insertOrphanFromZvtSuccess(db, b, c.staffId);
      res.json(row);
    }),
  );

  app.post(
    "/api/hardware/zvt/authorization-success",
    asyncRoute((req, res) => {
      /** Public webhook: no Bearer session; attribute to system staff (default id 1). */
      const actorId =
        req.authStaff?.staffId ??
        Number.parseInt(process.env.ZVT_SYSTEM_STAFF_ID ?? "1", 10);
      const b = req.body as {
        amountCents: number;
        terminalId: string;
        zvtReceiptId?: string;
        rawZvtReference?: string;
        authorizedAt?: number;
        raw?: Record<string, unknown>;
      };
      if (b.amountCents == null || !b.terminalId) {
        res.status(400).json({ error: "amountCents and terminalId required" });
        return;
      }
      const row = insertOrphanFromZvtSuccess(
        db,
        {
          amountCents: b.amountCents,
          terminalId: b.terminalId,
          zvtReceiptId: b.zvtReceiptId,
          rawZvtReference: b.rawZvtReference,
          authorizedAt: b.authorizedAt,
          raw: b.raw,
        },
        actorId,
      );
      res.status(201).json({ orphan: row, message: "queued_for_reconciliation" });
    }),
  );

  app.patch(
    "/api/orphan-payments/:id",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      const b = req.body as {
        matchSessionId?: number | null;
        matchInvoiceId?: number | null;
        status?: "open" | "reconciled";
        /** Steuerberater: note Beleg chain step */
        belegNote?: string;
      };
      const [prev] = db
        .select()
        .from(schema.orphanPayments)
        .where(eq(schema.orphanPayments.id, id))
        .all();
      if (!prev) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      db.update(schema.orphanPayments)
        .set({
          matchedSessionId: b.matchSessionId ?? prev.matchedSessionId,
          matchedInvoiceId: b.matchInvoiceId ?? prev.matchedInvoiceId,
          // Explicitly operational only: fiscal_status remains separate and is finalized by modules/fiscal.
          status: b.status ?? prev.status,
        })
        .where(eq(schema.orphanPayments.id, id))
        .run();
      const [row] = db
        .select()
        .from(schema.orphanPayments)
        .where(eq(schema.orphanPayments.id, id))
        .all();
      writeAudit(db, {
        entity: "orphan_payments",
        entityId: id,
        action: "reconcile",
        staffId: c.staffId,
        reason: b.belegNote ?? null,
        payload: { before: prev, after: row },
      });
      res.json({
        ...row,
        fiscalPrecaution:
          "Reconciled != fiscal signed. modules/fiscal must finalize the Belegkette.",
      });
    }),
  );

  /* --- 37: staff targets (admin-only) --- */
  app.get(
    "/api/admin/targets-summary",
    asyncRoute((req, res) => {
      requireOwner(req);
      const targetDate = String(req.query.date ?? "").trim();
      if (!targetDate) {
        res.status(400).json({ error: "date=YYYY-MM-DD required" });
        return;
      }
      const staffRows = db
        .select({
          id: schema.staff.id,
          displayName: schema.staff.displayName,
        })
        .from(schema.staff)
        .where(eq(schema.staff.active, true))
        .all();
      const out = staffRows.map((s) => {
        const [target] = db
          .select()
          .from(schema.staffTargets)
          .where(
            and(
              eq(schema.staffTargets.staffId, s.id),
              eq(schema.staffTargets.targetDate, targetDate),
            ),
          )
          .limit(1)
          .all();
        const perf = computeStaffPerformanceForDate(db, s.id, targetDate);
        return {
          staffId: s.id,
          displayName: s.displayName,
          targetDate,
          targets: {
            serviceTargetCents: target?.serviceTargetCents ?? 0,
            retailTargetCents: target?.retailTargetCents ?? 0,
          },
          achieved: {
            serviceCents: perf.serviceAchievedCents,
            retailCents: perf.retailAchievedCents,
            totalCents: perf.totalAchievedCents,
          },
        };
      });
      res.json(out);
    }),
  );

  app.get(
    "/api/admin/reports/z-report/:id/export",
    asyncRoute((req, res) => {
      requireOwner(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      let out: { filename: string; csv: string };
      try {
        out = buildDatevCsvForDailyClose(db, id);
      } catch {
        res.status(404).json({ error: "daily_close_not_found" });
        return;
      }
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="${out.filename}"`);
      res.status(200).send(out.csv);
    }),
  );

  app.get(
    "/api/admin/reports/monthly-summary",
    asyncRoute((req, res) => {
      requireOwner(req);
      const monthRaw = String(req.query.month ?? "").trim(); // YYYY-MM
      const now = new Date();
      const [yy, mm] =
        monthRaw && /^\d{4}-\d{2}$/.test(monthRaw)
          ? monthRaw.split("-").map((v) => Number(v))
          : [now.getFullYear(), now.getMonth() + 1];
      const from = new Date(yy, mm - 1, 1, 0, 0, 0, 0);
      const to = new Date(yy, mm, 0, 23, 59, 59, 999);
      const rows = db
        .select()
        .from(schema.dailyClosings)
        .where(
          and(
            gte(schema.dailyClosings.createdAt, from),
            lte(schema.dailyClosings.createdAt, to),
          ),
        )
        .orderBy(asc(schema.dailyClosings.createdAt))
        .all();
      const totals = rows.reduce(
        (acc, r) => {
          acc.expectedCashCents += r.expectedCashCents;
          acc.actualCashCents += r.actualCashCents;
          acc.differenceCents += r.differenceCents;
          return acc;
        },
        { expectedCashCents: 0, actualCashCents: 0, differenceCents: 0 },
      );
      res.json({
        month: `${yy}-${String(mm).padStart(2, "0")}`,
        closingsCount: rows.length,
        totals,
        closings: rows,
      });
    }),
  );

  app.put(
    "/api/admin/staff/:id/targets",
    asyncRoute((req, res) => {
      const owner = requireOwner(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const b = req.body as {
        targetDate?: string;
        serviceTargetCents?: number;
        retailTargetCents?: number;
      };
      const targetDate = String(b.targetDate ?? "").trim();
      if (!targetDate) {
        res.status(400).json({ error: "targetDate required" });
        return;
      }
      const serviceTargetCents = Math.max(0, Math.floor(Number(b.serviceTargetCents ?? 0)));
      const retailTargetCents = Math.max(0, Math.floor(Number(b.retailTargetCents ?? 0)));
      if (!Number.isFinite(serviceTargetCents) || !Number.isFinite(retailTargetCents)) {
        res.status(400).json({ error: "target_cents_invalid" });
        return;
      }
      const existing = db
        .select()
        .from(schema.staffTargets)
        .where(
          and(
            eq(schema.staffTargets.staffId, id),
            eq(schema.staffTargets.targetDate, targetDate),
          ),
        )
        .limit(1)
        .all()[0];
      if (existing) {
        db.update(schema.staffTargets)
          .set({
            serviceTargetCents,
            retailTargetCents,
            targetDate,
            businessDate: targetDate,
            targetRevenueCents: serviceTargetCents + retailTargetCents,
          })
          .where(eq(schema.staffTargets.id, existing.id))
          .run();
      } else {
        db.insert(schema.staffTargets)
          .values({
            staffId: id,
            targetDate,
            businessDate: targetDate,
            serviceTargetCents,
            retailTargetCents,
            targetRevenueCents: serviceTargetCents + retailTargetCents,
            progressRevenueCents: 0,
            progressRetailUnits: 0,
            status: "open",
            bonusEligible: false,
            bonusCents: null,
          })
          .run();
      }
      const [row] = db
        .select()
        .from(schema.staffTargets)
        .where(
          and(
            eq(schema.staffTargets.staffId, id),
            eq(schema.staffTargets.targetDate, targetDate),
          ),
        )
        .limit(1)
        .all();
      writeAudit(db, {
        entity: "staff_targets",
        entityId: row?.id,
        action: "staff_target_updated",
        staffId: owner.staffId,
        payload: row,
      });
      res.json(row);
    }),
  );

  /* --- §12 CRM / GDPR — clients --- */
  app.get(
    "/api/clients/search",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const raw = String(req.query.q ?? "").trim();
      const q = raw.replace(/[%_\\]/g, "");
      if (q.length < 1) {
        res.status(400).json({ error: "q required" });
        return;
      }
      const pattern = `%${q}%`;
      const rows = db
        .select()
        .from(schema.clients)
        .where(
          and(
            isNull(schema.clients.anonymizedAt),
            or(
              like(schema.clients.firstName, pattern),
              like(schema.clients.lastName, pattern),
              like(schema.clients.name, pattern),
              like(schema.clients.phone, pattern),
              like(schema.clients.email, pattern),
            ),
          ),
        )
        .limit(50)
        .all();
      writeAudit(db, {
        entity: "clients",
        action: "client_search",
        staffId: c.staffId,
        payload: { queryLength: q.length },
      });
      res.json(rows);
    }),
  );

  app.get(
    "/api/clients/:id",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [row] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      writeAudit(db, {
        entity: "clients",
        entityId: id,
        action: "client_read",
        staffId: c.staffId,
        payload: { anonymized: row.anonymizedAt != null },
      });
      res.json(row);
    }),
  );

  /**
   * Client 360 — patch test / Bewirtung / session handover (non-PII operational fields).
   */
  app.patch(
    "/api/clients/:id/ops-fields",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [cl] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      if (!cl) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (cl.anonymizedAt != null) {
        res.status(409).json({ error: "client_anonymized" });
        return;
      }

      const b = req.body as {
        patchTestAt?: unknown;
        hospitalityDrink?: unknown;
        hospitalityConversation?: unknown;
        hospitalitySeat?: unknown;
        sessionHandoverNote?: unknown;
      };

      const trimCap = (v: unknown, max: number): string | null => {
        if (v == null) return null;
        const s = String(v).trim();
        if (s === "") return null;
        return s.length > max ? s.slice(0, max) : s;
      };

      let patchTestAt: Date | null | undefined;
      if (b.patchTestAt === null) {
        patchTestAt = null;
      } else if (b.patchTestAt !== undefined) {
        const t = parseInstant(b.patchTestAt);
        if (t == null) {
          res.status(400).json({ error: "patch_test_at_invalid" });
          return;
        }
        patchTestAt = new Date(t);
      }

      const hospitalityDrink =
        b.hospitalityDrink !== undefined ? trimCap(b.hospitalityDrink, 400) : undefined;
      const hospitalityConversation =
        b.hospitalityConversation !== undefined
          ? trimCap(b.hospitalityConversation, 400)
          : undefined;
      const hospitalitySeat =
        b.hospitalitySeat !== undefined ? trimCap(b.hospitalitySeat, 400) : undefined;

      let sessionHandoverNote: string | null | undefined;
      let sessionHandoverUpdatedAt: Date | null | undefined;
      if (b.sessionHandoverNote !== undefined) {
        const raw = trimCap(b.sessionHandoverNote, 4000);
        sessionHandoverNote = raw;
        sessionHandoverUpdatedAt = raw == null ? null : new Date();
      }

      const updates: Partial<typeof schema.clients.$inferInsert> = {};
      if (patchTestAt !== undefined) updates.patchTestAt = patchTestAt;
      if (hospitalityDrink !== undefined) updates.hospitalityDrink = hospitalityDrink;
      if (hospitalityConversation !== undefined) {
        updates.hospitalityConversation = hospitalityConversation;
      }
      if (hospitalitySeat !== undefined) updates.hospitalitySeat = hospitalitySeat;
      if (sessionHandoverNote !== undefined) {
        updates.sessionHandoverNote = sessionHandoverNote;
        updates.sessionHandoverUpdatedAt = sessionHandoverUpdatedAt ?? null;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "no_updates" });
        return;
      }

      db.update(schema.clients).set(updates).where(eq(schema.clients.id, id)).run();
      const [updated] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();

      writeAudit(db, {
        entity: "clients",
        entityId: id,
        action: "client_ops_fields_updated",
        staffId: c.staffId,
        payload: {
          keys: Object.keys(updates),
        },
      });

      res.json(updated ?? { id });
    }),
  );

  app.get(
    "/api/clients/:id/full-history",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [client] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      if (!client) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      let clientRow = client;
      const todayBerlin = berlinYmdFromMs(Date.now());
      const handoverMs = clientRow.sessionHandoverUpdatedAt?.getTime();
      if (
        clientRow.sessionHandoverNote &&
        handoverMs != null &&
        berlinYmdFromMs(handoverMs) !== todayBerlin
      ) {
        db.update(schema.clients)
          .set({
            sessionHandoverNote: null,
            sessionHandoverUpdatedAt: null,
          })
          .where(eq(schema.clients.id, id))
          .run();
        const [fresh] = db
          .select()
          .from(schema.clients)
          .where(eq(schema.clients.id, id))
          .limit(1)
          .all();
        if (fresh) clientRow = fresh;
      }

      const debtRows = db
        .select()
        .from(schema.clientDebts)
        .where(
          and(eq(schema.clientDebts.clientId, id), eq(schema.clientDebts.status, "open")),
        )
        .all();
      const openDebtCents = debtRows.reduce(
        (sum, r) => sum + Number(r.amountCents ?? 0),
        0,
      );

      const lastClosedInvoices = db
        .select({
          id: schema.invoices.id,
          sessionId: schema.invoices.sessionId,
          totalAmountCents: schema.invoices.totalAmountCents,
          vatAmountCents: schema.invoices.vatAmountCents,
          tipAmountCents: schema.invoices.tipAmountCents,
          invoiceKind: schema.invoices.invoiceKind,
          createdAt: schema.invoices.createdAt,
        })
        .from(schema.invoices)
        .innerJoin(schema.sessions, eq(schema.sessions.id, schema.invoices.sessionId))
        .where(
          and(
            eq(schema.sessions.clientId, id),
            eq(schema.invoices.status, "closed"),
            isNull(schema.invoices.stornoForInvoiceId),
          ),
        )
        .orderBy(desc(schema.invoices.createdAt))
        .limit(5)
        .all();

      const formulas = db
        .select()
        .from(schema.clientFormulas)
        .where(eq(schema.clientFormulas.clientId, id))
        .orderBy(desc(schema.clientFormulas.createdAt))
        .all();

      const notes = db
        .select()
        .from(schema.clientNotes)
        .where(eq(schema.clientNotes.clientId, id))
        .orderBy(desc(schema.clientNotes.createdAt))
        .limit(50)
        .all();

      const [loyalty] = db
        .select()
        .from(schema.clientLoyalty)
        .where(eq(schema.clientLoyalty.clientId, id))
        .limit(1)
        .all();

      writeAudit(db, {
        entity: "clients",
        entityId: id,
        action: "client_full_history_read",
        staffId: c.staffId,
        payload: {
          invoiceSlices: lastClosedInvoices.length,
          formulaCount: formulas.length,
          noteCount: notes.length,
        },
      });

      res.json({
        client: clientRow,
        lastClosedInvoices,
        formulas,
        notes,
        loyalty: loyalty ?? null,
        openDebtCents,
      });
    }),
  );

  app.get(
    "/api/clients/:id/formulas",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [cl] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      if (!cl) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const rows = db
        .select()
        .from(schema.clientFormulas)
        .where(eq(schema.clientFormulas.clientId, id))
        .orderBy(desc(schema.clientFormulas.createdAt))
        .all();
      res.json(rows);
    }),
  );

  app.post(
    "/api/clients/:id/formulas",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [cl] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      if (!cl) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (cl.anonymizedAt != null) {
        res.status(409).json({ error: "client_anonymized" });
        return;
      }
      const b = req.body as { formulaText?: string; notes?: string | null };
      const formulaText = String(b.formulaText ?? "").trim();
      const notes =
        b.notes == null || String(b.notes).trim() === ""
          ? null
          : String(b.notes).trim();
      if (!formulaText) {
        res.status(400).json({ error: "formula_text_required" });
        return;
      }
      const [row] = db
        .insert(schema.clientFormulas)
        .values({
          clientId: id,
          formulaText,
          notes,
          staffId: c.staffId,
        })
        .returning()
        .all();
      writeAudit(db, {
        entity: "client_formulas",
        entityId: row?.id,
        action: "client_formula_create",
        staffId: c.staffId,
        payload: { clientId: id },
      });
      res.status(201).json(row);
    }),
  );

  app.post(
    "/api/clients/:id/notes",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [cl] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      if (!cl) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (cl.anonymizedAt != null) {
        res.status(409).json({ error: "client_anonymized" });
        return;
      }
      const b = req.body as { noteText?: string };
      const noteText = String(b.noteText ?? "").trim();
      if (!noteText) {
        res.status(400).json({ error: "note_text_required" });
        return;
      }
      const [row] = db
        .insert(schema.clientNotes)
        .values({
          clientId: id,
          noteText,
          staffId: c.staffId,
        })
        .returning()
        .all();
      writeAudit(db, {
        entity: "client_notes",
        entityId: row?.id,
        action: "client_note_create",
        staffId: c.staffId,
        payload: { clientId: id },
      });
      res.status(201).json(row);
    }),
  );

  /**
   * §12.5.57 — Record signed waiver (chemical / treatment). `reason` mandatory (witness note).
   */
  app.post(
    "/api/clients/:id/waivers",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [cl] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      if (!cl) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (cl.anonymizedAt != null) {
        res.status(409).json({ error: "client_anonymized" });
        return;
      }
      const b = req.body as {
        waiverType?: string;
        signatureHash?: string;
        agreedAtMs?: number;
        reason?: string;
      };
      const reason = String(b.reason ?? "").trim();
      if (!reason) {
        res.status(400).json({ error: "reason_required" });
        return;
      }
      const waiverType = String(b.waiverType ?? "").trim();
      const signatureHash = String(b.signatureHash ?? "").trim();
      if (!waiverType || !signatureHash) {
        res.status(400).json({ error: "waiver_type_and_signature_required" });
        return;
      }
      let agreedAt = new Date();
      if (b.agreedAtMs != null && Number.isFinite(Number(b.agreedAtMs))) {
        agreedAt = new Date(Math.floor(Number(b.agreedAtMs)));
      }
      const [row] = db
        .insert(schema.clientWaivers)
        .values({
          clientId: id,
          waiverType,
          agreedAt,
          signatureHash,
          staffId: c.staffId,
        })
        .returning()
        .all();
      writeAudit(db, {
        entity: "client_waivers",
        entityId: row?.id,
        action: "waiver_signed",
        staffId: c.staffId,
        reason,
        payload: { clientId: id, waiverType },
      });
      res.status(201).json(row);
    }),
  );

  app.post(
    "/api/clients",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const b = req.body as {
        firstName: string;
        lastName: string;
        email?: string | null;
        phone?: string | null;
        preferences?: Record<string, unknown> | null;
        gdprConsent?: boolean;
        gdprConsentDate?: string | number | null;
      };
      if (b.gdprConsent !== true) {
        res
          .status(400)
          .json({ error: "gdpr_consent_required", message: "gdprConsent must be true" });
        return;
      }
      const firstName = String(b.firstName ?? "").trim();
      const lastName = String(b.lastName ?? "").trim();
      if (firstName.length < 1) {
        res.status(400).json({
          error: "name_required",
          message: "firstName is required",
        });
        return;
      }
      const name = buildClientDisplayName(firstName, lastName);
      const email =
        b.email == null || String(b.email).trim() === ""
          ? null
          : String(b.email).trim();
      const phone =
        b.phone == null || String(b.phone).trim() === ""
          ? null
          : String(b.phone).trim();
      let consentAt = new Date();
      if (b.gdprConsentDate != null) {
        const t = parseInstant(b.gdprConsentDate);
        if (t != null) consentAt = new Date(t);
      }
      const prefs =
        b.preferences != null && typeof b.preferences === "object"
          ? JSON.stringify(b.preferences)
          : null;
      const [row] = db
        .insert(schema.clients)
        .values({
          name,
          firstName,
          lastName,
          email,
          phone,
          gdprConsent: true,
          gdprConsentDate: consentAt,
          preferences: prefs,
          anonymizedAt: null,
        })
        .returning()
        .all();
      if (!row) {
        res.status(500).json({ error: "insert_failed" });
        return;
      }
      writeAudit(db, {
        entity: "clients",
        entityId: row.id,
        action: "client_created",
        staffId: c.staffId,
        payload: { source: "api_post" },
      });
      res.json(row);
    }),
  );

  /**
   * Art. 17 DSGVO — PII erasure in place (FK sessions stay valid). Owner only; `reason` mandatory.
   */
  app.delete(
    "/api/clients/:id",
    asyncRoute((req, res) => {
      const owner = requireOwner(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const body = req.body as { reason?: string } | undefined;
      const reason = String(
        (req.query?.reason as string | undefined) ?? body?.reason ?? "",
      ).trim();
      if (reason.length < 1) {
        res.status(400).json({ error: "reason_required" });
        return;
      }
      const [row] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (row.anonymizedAt != null) {
        res.status(409).json({ error: "already_anonymized" });
        return;
      }
      const before = {
        id: row.id,
        name: row.name,
        hadEmail: row.email != null,
        hadPhone: row.phone != null,
        hadPreferences: row.preferences != null,
      };
      const now = new Date();
      db.transaction((tx) => {
        tx.delete(schema.clientFormulas)
          .where(eq(schema.clientFormulas.clientId, id))
          .run();
        tx.delete(schema.clientNotes)
          .where(eq(schema.clientNotes.clientId, id))
          .run();
        tx.update(schema.appointments)
          .set({ clientName: "Anonymisiert", clientPhone: null })
          .where(
            and(eq(schema.appointments.clientId, id), isNull(schema.appointments.deletedAt)),
          )
          .run();
        tx.update(schema.clients)
          .set({
            name: ANONYMIZED_DISPLAY,
            firstName: ANONYMIZED_FIRST,
            lastName: ANONYMIZED_LAST,
            email: null,
            phone: null,
            preferences: null,
            patchTestAt: null,
            hospitalityDrink: null,
            hospitalityConversation: null,
            hospitalitySeat: null,
            sessionHandoverNote: null,
            sessionHandoverUpdatedAt: null,
            gdprConsent: false,
            gdprConsentDate: null,
            anonymizedAt: now,
          })
          .where(eq(schema.clients.id, id))
          .run();
      });
      writeAudit(db, {
        entity: "clients",
        entityId: id,
        action: "client_anonymize",
        staffId: owner.staffId,
        reason,
        before,
        after: {
          id,
          name: ANONYMIZED_DISPLAY,
          anonymizedAt: now.getTime(),
        },
      });
      const [out] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      res.json({ ok: true, client: out });
    }),
  );

  /* ── Phase-1 Feature Flags & Soft-Complete ─────────────────────────── */

  /** GET /api/settings/feature-flags — any authenticated staff */
  app.get(
    "/api/settings/feature-flags",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const rows = db.select().from(schema.systemSettings).all();
      const flags: Record<string, boolean> = {};
      for (const r of rows) {
        flags[r.key] = r.value === "1" || r.value === "true";
      }
      res.json(flags);
    }),
  );

  /** PATCH /api/settings/feature-flags — owner only */
  app.patch(
    "/api/settings/feature-flags",
    asyncRoute((req, res) => {
      const owner = requireOwner(req);
      const b = req.body as { key?: string; enabled?: boolean };
      const key = String(b.key ?? "").trim();
      if (!key) { res.status(400).json({ error: "key_required" }); return; }
      const value = b.enabled === true ? "1" : "0";
      const existing = db.select().from(schema.systemSettings)
        .where(eq(schema.systemSettings.key, key)).limit(1).all()[0];
      if (existing) {
        db.update(schema.systemSettings)
          .set({ value, updatedAt: new Date() })
          .where(eq(schema.systemSettings.key, key)).run();
      } else {
        db.insert(schema.systemSettings).values({ key, value }).run();
      }
      writeAudit(db, { entity: "system_settings", action: "feature_flag_toggled",
        staffId: owner.staffId, payload: { key, enabled: b.enabled } });
      res.json({ key, enabled: value === "1" });
    }),
  );

  /**
   * POST /api/sessions/:id/soft-complete
   * Phase-1 bypass: closes session+appointment without TSE/ZVT.
   * Blocked when fiscal_active=1.
   */
  app.post(
    "/api/sessions/:id/soft-complete",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) { res.status(400).json({ error: "bad_id" }); return; }
      const fiscalFlag = db.select().from(schema.systemSettings)
        .where(eq(schema.systemSettings.key, "fiscal_active")).limit(1).all()[0];
      if (fiscalFlag?.value === "1" || fiscalFlag?.value === "true") {
        res.status(403).json({ error: "fiscal_active",
          message: "Fiscal mode active — use full checkout pipeline." });
        return;
      }
      const body = (req.body ?? {}) as { reason?: string };
      const note = typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : "soft-complete (Phase 1 fiscal bypass)";
      let sessionBefore: typeof schema.sessions.$inferSelect | null = null;
      let updated: typeof schema.sessions.$inferSelect | null = null;
      try {
        updated = db.transaction((tx) => {
          const [sess] = tx.select().from(schema.sessions)
            .where(eq(schema.sessions.id, id)).limit(1).all();
          if (!sess) throw Object.assign(new Error("not_found"), { http: 404 });
          if (sess.status !== "open") throw Object.assign(new Error("session_not_open"), { http: 409 });
          sessionBefore = sess;
          const closedAt = new Date();
          if (sess.appointmentId != null) {
            tx.update(schema.appointments)
              .set({ status: "completed", updatedAt: closedAt })
              .where(eq(schema.appointments.id, sess.appointmentId)).run();
          }
          tx.update(schema.sessions)
            .set({ status: "closed", closedAt })
            .where(eq(schema.sessions.id, id)).run();
          const [row] = tx.select().from(schema.sessions)
            .where(eq(schema.sessions.id, id)).limit(1).all();
          return row ?? null;
        });
      } catch (e: unknown) {
        const err = e as { http?: number; message?: string };
        if (err.http === 404) { res.status(404).json({ error: "not_found" }); return; }
        if (err.http === 409) { res.status(409).json({ error: err.message }); return; }
        throw e;
      }
      if (!updated) { res.status(500).json({ error: "empty_result" }); return; }
      writeAudit(db, { entity: "sessions", entityId: id, action: "session_soft_complete",
        staffId: c.staffId, before: sessionBefore, after: updated,
        payload: { note, fiscalBypassed: true } });
      res.json({ session: updated, fiscalBypassed: true });
    }),
  );

  registerSseEventRoutes(app);
}

export function ensureSeedData(db: BetterSQLite3Database<typeof schema>) {
  const s = db.select().from(schema.staff).all();
  if (s.length === 0) {
    db.insert(schema.staff)
      .values([
        {
          displayName: "Oli",
          role: "owner",
          pinHash: hashPin("1111"),
          active: true,
        },
        {
          displayName: "Silke",
          role: "stylist",
          pinHash: hashPin("2222"),
          active: true,
        },
        {
          displayName: "Abdul",
          role: "stylist",
          pinHash: hashPin("3333"),
          active: true,
        },
      ])
      .run();
  }
  // Demo inventory seed disabled — add real products manually via admin UI

  // ── Default weekly schedule: Mon–Sat 09:00–19:00 for every staff member ──
  // Runs once per staff member; idempotent (skips if row already exists).
  {
    const allStaff = db.select().from(schema.staff).all();
    for (const member of allStaff) {
      const existing = db
        .select()
        .from(schema.staffWeeklySchedules)
        .where(eq(schema.staffWeeklySchedules.staffId, member.id))
        .all();
      if (existing.length > 0) continue; // already configured
      // 1 = Mon … 6 = Sat; Sunday (0) stays closed by default
      const workDays = [1, 2, 3, 4, 5, 6];
      db.insert(schema.staffWeeklySchedules)
        .values(
          workDays.map((dow) => ({
            staffId: member.id,
            dayOfWeek: dow,
            isWorking: true,
            startTime: "09:00",
            endTime: "19:00",
          })),
        )
        .run();
      console.log(`[seed] weekly schedule created for staff id=${member.id} ${member.displayName}`);
    }
  }

  for (const row of db.select().from(schema.staff).all()) {
    if (row.pinHash) continue;
    db.update(schema.staff)
      .set({ pinHash: hashPin("9999") })
      .where(eq(schema.staff.id, row.id))
      .run();
    console.warn(
      `[seed] staff id=${row.id} ${row.displayName} had empty pin_hash — set dev PIN 9999`,
    );
  }
  if (db.select().from(schema.systemSettings).all().length === 0) {
    db.insert(schema.systemSettings)
      .values([
        { key: "tse_provider_type", value: "HARDWARE_PRINTER" },
        { key: "fiskaly_enabled", value: "0" },
        { key: "fiscal_active", value: "0" },
      ])
      .run();
  } else {
    // Ensure fiscal_active key exists for upgrades
    const hasFlag = db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "fiscal_active"))
      .limit(1)
      .all()[0];
    if (!hasFlag) {
      db.insert(schema.systemSettings)
        .values({ key: "fiscal_active", value: "0" })
        .run();
    }
  }
}
