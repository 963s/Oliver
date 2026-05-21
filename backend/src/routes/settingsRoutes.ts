import type { Express, Request, Response } from "express";
import { eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  getStaffContext,
  isOwnerRole,
  normalizeRole,
  type StaffRole,
} from "../lib/sessionAuth.js";
import { hashPin } from "../lib/pin.js";
import { writeAudit } from "../lib/audit.js";
import {
  isValidIpv4,
  parsePort,
  readZvtConfig,
  zvtConnectivityProbe,
} from "../services/zvtService.js";
import {
  readPrinterConfig,
  printerConnectivityProbe,
} from "../services/printerService.js";

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const ASSIGN_OWNER_ROLES: StaffRole[] = ["owner", "super_admin"];

function canAssignRole(actorRole: StaffRole, targetRole: StaffRole): boolean {
  if (ASSIGN_OWNER_ROLES.includes(targetRole)) {
    return isOwnerRole(actorRole);
  }
  return true;
}

/** Keys editable via Admin UI (system_settings). */
const SETTINGS_ALLOWLIST = new Set([
  "fiskaly_enabled",
  "tse_provider_type",
  "commission_service_bps",
  "commission_retail_bps",
  "feature_zvt_verbose_logs",
  "feature_inventory_low_stock_banner",
  "feature_client360_patch_test",
  "feature_client360_privacy_toggle",
  "feature_client360_hospitality",
  "feature_client360_loyalty_badge",
  "feature_client360_anonymize_button",
  "payment_terminal_ip",
  "payment_terminal_port",
  "payment_auto_link",
  "printer_ip",
  "printer_port",
  "printer_auto_print",
]);

export function registerSettingsAdminRoutes(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  app.post(
    "/api/admin/staff",
    requireAdmin,
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const b = req.body as {
        displayName?: string;
        role?: string;
        pin?: string;
      };
      const displayName = String(b.displayName ?? "").trim();
      if (!displayName || displayName.length > 120) {
        res.status(400).json({ error: "display_name_invalid" });
        return;
      }
      const role = normalizeRole(b.role) as StaffRole;
      if (!canAssignRole(ctx.role, role)) {
        res.status(403).json({ error: "forbidden_role_assignment" });
        return;
      }
      const pin = String(b.pin ?? "").trim();
      if (!/^\d{4,6}$/.test(pin)) {
        res.status(400).json({ error: "pin_format" });
        return;
      }

      const [row] = db
        .insert(schema.staff)
        .values({
          displayName,
          role,
          pinHash: hashPin(pin),
          active: true,
        })
        .returning()
        .all();
      if (!row) {
        res.status(500).json({ error: "insert_failed" });
        return;
      }
      writeAudit(db, {
        entity: "staff",
        entityId: row.id,
        action: "staff_admin_create",
        staffId: ctx.staffId,
        payload: {
          displayName: row.displayName,
          role: row.role,
        },
      });
      res.status(201).json({
        id: row.id,
        displayName: row.displayName,
        role: row.role,
        active: row.active,
        createdAt: row.createdAt,
      });
    }),
  );

  app.patch(
    "/api/admin/staff/:id",
    requireAdmin,
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [before] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, id))
        .limit(1)
        .all();
      if (!before) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      const b = req.body as {
        displayName?: string;
        role?: string;
        pin?: string;
        active?: boolean;
      };

      const updates: Partial<typeof schema.staff.$inferInsert> = {};
      if (b.displayName !== undefined) {
        const dn = String(b.displayName).trim();
        if (!dn || dn.length > 120) {
          res.status(400).json({ error: "display_name_invalid" });
          return;
        }
        updates.displayName = dn;
      }
      if (b.role !== undefined) {
        const nr = normalizeRole(b.role) as StaffRole;
        if (!canAssignRole(ctx.role, nr)) {
          res.status(403).json({ error: "forbidden_role_assignment" });
          return;
        }
        updates.role = nr;
      }
      if (b.pin !== undefined) {
        const pin = String(b.pin).trim();
        if (pin.length === 0) {
          updates.pinHash = null;
        } else if (/^\d{4,6}$/.test(pin)) {
          updates.pinHash = hashPin(pin);
        } else {
          res.status(400).json({ error: "pin_format" });
          return;
        }
      }
      if (b.active !== undefined) {
        if (!Boolean(b.active) && id === ctx.staffId) {
          res.status(400).json({ error: "cannot_deactivate_self" });
          return;
        }
        updates.active = Boolean(b.active);
      }

      if (Object.keys(updates).length === 0) {
        res.json({
          id: before.id,
          displayName: before.displayName,
          role: before.role,
          active: before.active,
          createdAt: before.createdAt,
        });
        return;
      }

      db.update(schema.staff).set(updates).where(eq(schema.staff.id, id)).run();

      const [after] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, id))
        .limit(1)
        .all();
      writeAudit(db, {
        entity: "staff",
        entityId: id,
        action: "staff_admin_update",
        staffId: ctx.staffId,
        before: {
          displayName: before.displayName,
          role: before.role,
          active: before.active,
          hadPin: Boolean(before.pinHash),
        },
        after: {
          displayName: after?.displayName,
          role: after?.role,
          active: after?.active,
          pinRotated: b.pin !== undefined && b.pin !== "",
          pinCleared: b.pin === "",
        },
      });

      res.json({
        id: after!.id,
        displayName: after!.displayName,
        role: after!.role,
        active: after!.active,
        createdAt: after!.createdAt,
      });
    }),
  );

  app.get(
    "/api/admin/settings/hardware",
    requireAdmin,
    asyncRoute((_req, res) => {
      const keys = [
        "payment_terminal_ip",
        "payment_terminal_port",
        "payment_auto_link",
        "printer_ip",
        "printer_port",
        "printer_auto_print",
      ];
      const rows = db
        .select()
        .from(schema.systemSettings)
        .where(inArray(schema.systemSettings.key, keys))
        .all();
      const map = new Map(rows.map((r) => [r.key, r.value]));
      const out = {
        paymentTerminalIp: map.get("payment_terminal_ip") ?? "",
        paymentTerminalPort: map.get("payment_terminal_port") ?? "",
        paymentAutoLink: (map.get("payment_auto_link") ?? "0") === "1",
        printerIp: map.get("printer_ip") ?? "",
        printerPort: map.get("printer_port") ?? "",
        printerAutoPrint: (map.get("printer_auto_print") ?? "0") === "1",
      };
      res.json(out);
    }),
  );

  app.patch(
    "/api/admin/settings/hardware",
    requireAdmin,
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const b = req.body as {
        paymentTerminalIp?: string;
        paymentTerminalPort?: string;
        paymentAutoLink?: boolean;
        printerIp?: string;
        printerPort?: string;
        printerAutoPrint?: boolean;
      };

      const paymentTerminalIp = String(b.paymentTerminalIp ?? "").trim();
      const paymentTerminalPort = String(b.paymentTerminalPort ?? "").trim();
      const printerIp = String(b.printerIp ?? "").trim();
      const printerPort = String(b.printerPort ?? "").trim();
      const paymentAutoLink = Boolean(b.paymentAutoLink);
      const printerAutoPrint = Boolean(b.printerAutoPrint);

      if (paymentTerminalIp.length > 0 && !isValidIpv4(paymentTerminalIp)) {
        res.status(400).json({ error: "invalid_payment_terminal_ip" });
        return;
      }
      if (paymentTerminalPort.length > 0 && parsePort(paymentTerminalPort) == null) {
        res.status(400).json({ error: "invalid_payment_terminal_port" });
        return;
      }
      if (printerIp.length > 0 && !isValidIpv4(printerIp)) {
        res.status(400).json({ error: "invalid_printer_ip" });
        return;
      }
      if (printerPort.length > 0 && parsePort(printerPort) == null) {
        res.status(400).json({ error: "invalid_printer_port" });
        return;
      }

      const now = new Date();
      const upsert = (key: string, value: string) => {
        const [before] = db
          .select()
          .from(schema.systemSettings)
          .where(eq(schema.systemSettings.key, key))
          .limit(1)
          .all();
        if (before) {
          db.update(schema.systemSettings)
            .set({ value, updatedAt: now })
            .where(eq(schema.systemSettings.key, key))
            .run();
        } else {
          db.insert(schema.systemSettings).values({ key, value, updatedAt: now }).run();
        }
      };

      upsert("payment_terminal_ip", paymentTerminalIp);
      upsert("payment_terminal_port", paymentTerminalPort);
      upsert("payment_auto_link", paymentAutoLink ? "1" : "0");
      upsert("printer_ip", printerIp);
      upsert("printer_port", printerPort);
      upsert("printer_auto_print", printerAutoPrint ? "1" : "0");

      writeAudit(db, {
        entity: "system_settings",
        entityId: null,
        action: "hardware_settings_update",
        staffId: ctx.staffId,
        payload: {
          paymentTerminalIp,
          paymentTerminalPort,
          paymentAutoLink,
          printerIp,
          printerPort,
          printerAutoPrint,
        },
      });
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/settings/hardware/probe",
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const keys = [
        "payment_terminal_ip",
        "payment_terminal_port",
        "payment_auto_link",
        "printer_ip",
        "printer_port",
        "printer_auto_print",
      ];
      const rows = db
        .select()
        .from(schema.systemSettings)
        .where(inArray(schema.systemSettings.key, keys))
        .all();
      const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      const zvtCfg = readZvtConfig(map);
      const printerCfg = readPrinterConfig(map);
      const zvt = zvtCfg
        ? await zvtConnectivityProbe(zvtCfg)
        : { ok: false, detail: "zvt_config_incomplete" };
      const printer = printerCfg
        ? await printerConnectivityProbe(printerCfg)
        : { ok: false, detail: "printer_config_incomplete" };
      res.json({ zvt, printer });
    }),
  );

  app.get(
    "/api/admin/settings/features",
    requireAdmin,
    asyncRoute((_req, res) => {
      const keys = [...SETTINGS_ALLOWLIST];
      const existing = db
        .select()
        .from(schema.systemSettings)
        .where(inArray(schema.systemSettings.key, keys))
        .all();
      const map = new Map(existing.map((r) => [r.key, r.value]));
      const defaults: Record<string, string> = {
        fiskaly_enabled: "0",
        tse_provider_type: "HARDWARE_PRINTER",
        feature_zvt_verbose_logs: "0",
        feature_inventory_low_stock_banner: "1",
        feature_client360_patch_test: "1",
        feature_client360_privacy_toggle: "1",
        feature_client360_hospitality: "1",
        feature_client360_loyalty_badge: "1",
        feature_client360_anonymize_button: "1",
      };
      const out = keys.map((key) => ({
        key,
        value: map.get(key) ?? defaults[key] ?? "0",
      }));
      out.sort((a, b) => a.key.localeCompare(b.key));
      res.json(out);
    }),
  );

  app.patch(
    "/api/admin/settings/features",
    requireAdmin,
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const b = req.body as { key?: string; value?: string };
      const key = String(b.key ?? "").trim();
      const value = String(b.value ?? "").trim();
      if (!SETTINGS_ALLOWLIST.has(key)) {
        res.status(400).json({ error: "unknown_setting_key" });
        return;
      }
      if (value.length > 500) {
        res.status(400).json({ error: "value_too_long" });
        return;
      }
      if (key === "fiskaly_enabled" && value !== "0" && value !== "1") {
        res.status(400).json({ error: "invalid_toggle_value" });
        return;
      }
      if (
        key.startsWith("feature_") &&
        value !== "0" &&
        value !== "1"
      ) {
        res.status(400).json({ error: "invalid_toggle_value" });
        return;
      }
      if (
        key === "tse_provider_type" &&
        !["HARDWARE_PRINTER", "FISKALY_CLOUD"].includes(value)
      ) {
        res.status(400).json({ error: "invalid_tse_provider" });
        return;
      }
      if (key === "commission_service_bps" || key === "commission_retail_bps") {
        const n = Number.parseInt(value, 10);
        if (!Number.isFinite(n) || n < 0 || n > 9000) {
          res.status(400).json({ error: "commission_bps_out_of_range" });
          return;
        }
      }

      const [before] = db
        .select()
        .from(schema.systemSettings)
        .where(eq(schema.systemSettings.key, key))
        .limit(1)
        .all();

      if (before) {
        db.update(schema.systemSettings)
          .set({ value, updatedAt: new Date() })
          .where(eq(schema.systemSettings.key, key))
          .run();
      } else {
        db.insert(schema.systemSettings)
          .values({ key, value, updatedAt: new Date() })
          .run();
      }

      const [after] = db
        .select()
        .from(schema.systemSettings)
        .where(eq(schema.systemSettings.key, key))
        .limit(1)
        .all();

      writeAudit(db, {
        entity: "system_settings",
        entityId: null,
        action: "system_setting_update",
        staffId: ctx.staffId,
        before: before ? { key: before.key, value: before.value } : null,
        after: after ? { key: after.key, value: after.value } : null,
        payload: { key },
      });

      res.json({ key, value: after?.value ?? value });
    }),
  );

  /** Step 49 — external fortress backup (long paths + telemetry outside generic PATCH allowlist). */
  type ExternalBackupSchedule =
    | "manual"
    | "daily_after_close"
    | "twice_daily";
  const EXTERNAL_SCHEDULE_KEYS = new Set<ExternalBackupSchedule>([
    "manual",
    "daily_after_close",
    "twice_daily",
  ]);

  function externalBackupSysGet(key: string): string {
    const [row] = db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key))
      .limit(1)
      .all();
    return row?.value ?? "";
  }

  function externalBackupUpsertQuiet(key: string, value: string, now: Date): void {
    const [beforeRow] = db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key))
      .limit(1)
      .all();
    if (beforeRow) {
      db.update(schema.systemSettings)
        .set({ value, updatedAt: now })
        .where(eq(schema.systemSettings.key, key))
        .run();
    } else {
      db.insert(schema.systemSettings).values({ key, value, updatedAt: now }).run();
    }
  }

  app.get(
    "/api/admin/settings/external-backup",
    requireAdmin,
    asyncRoute((_req, res) => {
      const pathVal = externalBackupSysGet("external_backup_path");
      const sch = externalBackupSysGet("external_backup_schedule");
      const lastOkRaw = externalBackupSysGet("external_backup_last_ok");
      const lastDetail = externalBackupSysGet("external_backup_last_detail");
      const lastAtRaw = externalBackupSysGet("external_backup_last_at_ms");
      const parsedAt = Number.parseInt(lastAtRaw, 10);
      let lastOk: boolean | null = null;
      if (lastOkRaw === "1") lastOk = true;
      else if (lastOkRaw === "0") lastOk = false;
      const scheduleParsed: ExternalBackupSchedule = EXTERNAL_SCHEDULE_KEYS.has(sch as ExternalBackupSchedule)
        ? (sch as ExternalBackupSchedule)
        : "manual";

      res.json({
        backupPath: pathVal,
        schedule: scheduleParsed,
        lastOk,
        lastDetail,
        lastAtMs: Number.isFinite(parsedAt) ? parsedAt : null,
      });
    }),
  );

  app.patch(
    "/api/admin/settings/external-backup",
    requireAdmin,
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const bodyRaw =
        typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {};

      let changed = false;
      const changedKeys: Array<{ key: string; action: string; before: unknown; after: unknown }> = [];

      if ("backupPath" in bodyRaw) {
        let safe = "";
        if (bodyRaw.backupPath !== null && bodyRaw.backupPath !== undefined) {
          if (typeof bodyRaw.backupPath !== "string") {
            res.status(400).json({ error: "invalid_backup_path_type" });
            return;
          }
          safe = bodyRaw.backupPath.trim().slice(0, 8192);
        }

        const [beforeRow] = db
          .select()
          .from(schema.systemSettings)
          .where(eq(schema.systemSettings.key, "external_backup_path"))
          .limit(1)
          .all();
        const beforeVal = beforeRow?.value ?? null;
        const nowTs = new Date();
        externalBackupUpsertQuiet("external_backup_path", safe, nowTs);
        const [afterRow] = db
          .select()
          .from(schema.systemSettings)
          .where(eq(schema.systemSettings.key, "external_backup_path"))
          .limit(1)
          .all();
        changedKeys.push({
          key: "external_backup_path",
          action: "external_backup_path_update",
          before: beforeVal,
          after: afterRow?.value ?? safe,
        });
        changed = true;
      }

      if ("schedule" in bodyRaw && bodyRaw.schedule !== undefined) {
        if (typeof bodyRaw.schedule !== "string") {
          res.status(400).json({ error: "invalid_schedule_type" });
          return;
        }
        const s = bodyRaw.schedule as ExternalBackupSchedule;
        if (!EXTERNAL_SCHEDULE_KEYS.has(s)) {
          res.status(400).json({ error: "invalid_schedule_value" });
          return;
        }
        const [beforeRow] = db
          .select()
          .from(schema.systemSettings)
          .where(eq(schema.systemSettings.key, "external_backup_schedule"))
          .limit(1)
          .all();
        const beforeVal = beforeRow?.value ?? null;
        const nowTs = new Date();
        externalBackupUpsertQuiet("external_backup_schedule", s, nowTs);
        const [afterRow] = db
          .select()
          .from(schema.systemSettings)
          .where(eq(schema.systemSettings.key, "external_backup_schedule"))
          .limit(1)
          .all();
        changedKeys.push({
          key: "external_backup_schedule",
          action: "external_backup_schedule_update",
          before: beforeVal,
          after: afterRow?.value ?? s,
        });
        changed = true;
      }

      if (!changed) {
        res.status(400).json({ error: "no_fields" });
        return;
      }

      for (const c of changedKeys) {
        writeAudit(db, {
          entity: "system_settings",
          entityId: null,
          action: c.action,
          staffId: ctx.staffId,
          payload: { key: c.key, before: c.before, after: c.after },
        });
      }

      res.status(200).json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/settings/external-backup/sync-result",
    requireAdmin,
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const bodyRaw =
        typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {};
      const okFlag = Boolean(bodyRaw.ok);
      const detail =
        typeof bodyRaw.detail === "string"
          ? bodyRaw.detail.trim().slice(0, 500)
          : okFlag
            ? "ok"
            : "failed";

      const at = Date.now();
      const beforeSnapshot = {
        external_backup_last_ok: externalBackupSysGet("external_backup_last_ok"),
        external_backup_last_detail: externalBackupSysGet("external_backup_last_detail"),
        external_backup_last_at_ms: externalBackupSysGet("external_backup_last_at_ms"),
      };
      const nowTs = new Date();
      externalBackupUpsertQuiet("external_backup_last_ok", okFlag ? "1" : "0", nowTs);
      externalBackupUpsertQuiet("external_backup_last_detail", detail, nowTs);
      externalBackupUpsertQuiet("external_backup_last_at_ms", String(at), nowTs);
      const afterSnapshot = {
        external_backup_last_ok: okFlag ? "1" : "0",
        external_backup_last_detail: detail,
        external_backup_last_at_ms: String(at),
      };

      writeAudit(db, {
        entity: "system_settings",
        entityId: null,
        action: "external_backup_sync_result",
        staffId: ctx.staffId,
        payload: { ok: okFlag, detail, atMs: at },
        before: beforeSnapshot,
        after: afterSnapshot,
      });

      res.status(200).json({ ok: true });
    }),
  );
}
