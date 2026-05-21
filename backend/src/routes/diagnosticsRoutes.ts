import type { Express, Request, Response } from "express";
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { eq, desc, sql, and, or, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { requireAdmin } from "../middleware/auth.js";
import { getStaffContext } from "../lib/sessionAuth.js";
import { getSqliteHandle } from "../db/index.js";
import { writeAudit } from "../lib/audit.js";
import { tcpReachableProbe } from "../lib/tcpProbe.js";

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function sysGet(
  db: BetterSQLite3Database<typeof schema>,
  key: string,
): string {
  const [row] = db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1)
    .all();
  return row?.value ?? "";
}

function sysUpsertQuiet(
  db: BetterSQLite3Database<typeof schema>,
  key: string,
  value: string,
  nowMs: Date,
): void {
  const [existing] = db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1)
    .all();
  if (existing) {
    db.update(schema.systemSettings)
      .set({ value, updatedAt: nowMs })
      .where(eq(schema.systemSettings.key, key))
      .run();
  } else {
    db.insert(schema.systemSettings).values({ key, value, updatedAt: nowMs }).run();
  }
}

/**
 * Step 50 — Salon pre-flight diagnostics, SQLite maintenance cadence, support bundle export.
 */
export function registerDiagnosticsRoutes(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  app.get(
    "/api/admin/diagnostics/preflight",
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const sqlite = getSqliteHandle();
      let integrityOk = false;
      let integrityDetail = "unknown";
      try {
        const simpleResult = sqlite.pragma("integrity_check", { simple: true });
        integrityDetail =
          typeof simpleResult === "string" ?
            simpleResult
          : String((simpleResult as unknown as { integrity_check?: string })?.integrity_check ?? simpleResult ?? "");
        integrityOk = integrityDetail.trim().toLowerCase() === "ok";
      } catch (e) {
        integrityOk = false;
        integrityDetail = e instanceof Error ? e.message : "integrity_failed";
      }

      const backupPathRaw = sysGet(db, "external_backup_path").trim();
      let fortressStorage: {
        configured: boolean;
        backendReachable: boolean | null;
        noteDe: string;
      } = {
        configured: Boolean(backupPathRaw),
        backendReachable: null,
        noteDe:
          "Der eingetragene Pfad wird vom Backend auf dieser Maschine geprüft. USB‑Laufwerke sind nur erreichbar, wenn der API‑Server dort denselben Pfad sieht (typisch: Desktop‑Kiosk).",
      };
      if (backupPathRaw) {
        try {
          const { accessSync, constants } = await import("node:fs");
          accessSync(backupPathRaw, constants.R_OK | constants.W_OK);
          fortressStorage.backendReachable = true;
        } catch {
          fortressStorage.backendReachable = false;
        }
      }

      const tseHost = process.env.TSE_PRINTER_HOST?.trim() ?? "";
      const tsePort = Math.floor(Number(process.env.TSE_PRINTER_PORT ?? "9100"));
      let printerTcp: {
        configured: boolean;
        tcpReachable: boolean;
        probeMs: number;
      };
      if (!tseHost) {
        printerTcp = {
          configured: false,
          tcpReachable: false,
          probeMs: 0,
        };
      } else {
        const t0 = Date.now();
        const ok = await tcpReachableProbe(
          tseHost,
          Number.isFinite(tsePort) && tsePort > 0 ? tsePort : 9100,
          3000,
        );
        printerTcp = {
          configured: true,
          tcpReachable: ok,
          probeMs: Date.now() - t0,
        };
      }

      const zvtForceFail = process.env.OLIVER_ROOS_ZVT_FORCE_FAIL === "1";
      const zvtHost = process.env.OLIVER_ROOS_ZVT_PROBE_HOST?.trim() ?? "";
      const zvtPort = Math.floor(
        Number(process.env.OLIVER_ROOS_ZVT_PROBE_PORT ?? "20007"),
      );
      let zvtBlock: {
        backendStubOperational: boolean;
        forceFailEnvActive: boolean;
        tcpConfigured: boolean;
        tcpReachable: boolean | null;
        probeMs: number;
      };

      if (zvtHost) {
        const t0 = Date.now();
        const ok = await tcpReachableProbe(zvtHost, zvtPort > 0 ? zvtPort : 20007, 3000);
        zvtBlock = {
          backendStubOperational: !zvtForceFail,
          forceFailEnvActive: zvtForceFail,
          tcpConfigured: true,
          tcpReachable: ok,
          probeMs: Date.now() - t0,
        };
      } else {
        zvtBlock = {
          backendStubOperational: !zvtForceFail,
          forceFailEnvActive: zvtForceFail,
          tcpConfigured: false,
          tcpReachable: null,
          probeMs: 0,
        };
      }

      const lastClosed = db
        .select({
          tseStatus: schema.invoices.tseStatus,
          tseSignature: schema.invoices.tseSignature,
          id: schema.invoices.id,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.status, "closed"))
        .orderBy(desc(schema.invoices.id))
        .limit(1)
        .all();
      const lc = lastClosed[0];

      const tseIncomplete = db
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.status, "closed"),
            or(
              isNull(schema.invoices.tseSignature),
              eq(schema.invoices.tseStatus, "ausfall_failed"),
            ),
          ),
        )
        .limit(25)
        .all();

      const pendingJobs = db
        .select({ cnt: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.hardwareJobs)
        .where(eq(schema.hardwareJobs.status, "pending"))
        .all();
      const pendingHardwareCount = pendingJobs[0]?.cnt ?? 0;

      res.json({
        generatedAtIso: new Date().toISOString(),
        timezoneNote: "Server wall clock UTC; Geschäftslogik Europe/Berlin wo relevant.",
        database: {
          integrityOk,
          integrityDetail,
        },
        fortressStorage,
        printerLanTse: {
          summaryDe: printerTcp.configured
            ? `TCP‑Test ${printerTcp.tcpReachable ? "erfolgreich" : "fehlgeschlagen"} (${printerTcp.probeMs} ms)`
            : "TSE_PRINTER_HOST nicht gesetzt — Netz‑TSE‑Drucker nicht konfiguriert.",
          ...printerTcp,
        },
        zvtTerminal: {
          summaryDe:
            zvtBlock.tcpConfigured ?
              `EC‑Gerät (${zvtHost}:${zvtPort}) ${zvtBlock.tcpReachable ? "TCP erreichbar" : "TCP nicht erreichbar"} (${zvtBlock.probeMs} ms)`
            : "Kein TCP‑Test konfiguriert (optional: OLIVER_ROOS_ZVT_PROBE_HOST / PORT). Bridge antwortet im Stub‑Modus, sofern OLIVER_ROOS_ZVT_FORCE_FAIL≠1.",
          ...zvtBlock,
        },
        fiscal: {
          lastClosedInvoiceId: lc?.id ?? null,
          lastClosedTseStatus: lc?.tseStatus ?? null,
          tseAusfallBanner: lc?.tseStatus === "ausfall_failed",
          closedInvoicesIncompleteTseCount: tseIncomplete.length,
          sampleIncompleteIds: tseIncomplete.map((r) => r.id),
        },
        hardwareQueuePendingCount: pendingHardwareCount,
      });
    }),
  );

  app.get(
    "/api/admin/system/sqlite-maintain/meta",
    requireAdmin,
    asyncRoute((_req, res) => {
      const intervalDays = Math.max(
        1,
        Math.min(
          365,
          Math.floor(Number(sysGet(db, "sqlite_maintenance_interval_days")) || 10),
        ),
      );
      const lastRaw = sysGet(db, "sqlite_last_vacuum_at_ms").trim();
      const lastVacuumMs =
        typeof lastRaw === "string" && lastRaw !== "" ? Number(lastRaw) : NaN;
      const lastVacuumValid = Number.isFinite(lastVacuumMs);
      const intervalMs = intervalDays * 86_400_000;
      const dueVacuum =
        !lastVacuumValid || Date.now() - lastVacuumMs >= intervalMs;
      res.json({
        intervalDays,
        lastVacuumMs: lastVacuumValid ? lastVacuumMs : null,
        dueVacuum,
      });
    }),
  );

  app.post(
    "/api/admin/system/sqlite-maintain",
    requireAdmin,
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const body = (typeof req.body === "object" && req.body !== null ?
        req.body
      : {}) as {
        vacuumIfDue?: boolean;
        forceVacuum?: boolean;
        analyzeOnly?: boolean;
      };

      const intervalDays = Math.max(
        1,
        Math.min(
          365,
          Math.floor(Number(sysGet(db, "sqlite_maintenance_interval_days")) || 10),
        ),
      );
      const lastRaw = sysGet(db, "sqlite_last_vacuum_at_ms").trim();
      const lastVacuumMs =
        typeof lastRaw === "string" && lastRaw !== "" ? Number(lastRaw) : NaN;
      const lastVacuumValid = Number.isFinite(lastVacuumMs);
      const intervalMs = intervalDays * 86_400_000;
      const vacuumDue =
        !lastVacuumValid || Date.now() - lastVacuumMs >= intervalMs;

      const sqlite = getSqliteHandle();

      try {
        if (body.analyzeOnly === true) {
          sqlite.exec("PRAGMA analysis_limit = 48000;");
          sqlite.exec("PRAGMA optimize;");
          sqlite.exec("ANALYZE;");
          writeAudit(db, {
            entity: "system",
            entityId: null,
            action: "sqlite_maintenance_analyze",
            staffId: ctx.staffId,
            payload: { mode: "analyze_only" },
          });
          res.status(200).json({
            ok: true,
            vacuumRan: false,
            analyzeRan: true,
            messageDe: "ANALYZE / PRAGMA optimize ausgeführt.",
          });
          return;
        }

        const force = Boolean(body.forceVacuum);
        const ifDue = Boolean(body.vacuumIfDue);

        if (!force && !ifDue) {
          res.status(400).json({
            error: "no_maintenance_action",
            messageDe:
              "Keine Wartungsaktion: vacuumIfDue, forceVacuum oder analyzeOnly wählen.",
          });
          return;
        }

        if (force) {
          sqlite.prepare("VACUUM").run();
          sqlite.prepare("ANALYZE").run();
          const nowTs = Date.now();
          sysUpsertQuiet(db, "sqlite_last_vacuum_at_ms", String(nowTs), new Date(nowTs));
          writeAudit(db, {
            entity: "system",
            entityId: null,
            action: "sqlite_maintenance_vacuum",
            staffId: ctx.staffId,
            payload: { force: true, intervalDays },
          });
          res.status(200).json({
            ok: true,
            vacuumRan: true,
            analyzeRan: true,
            messageDe: "VACUUM und ANALYZE (Administrator-Zwang) ausgeführt.",
          });
          return;
        }

        if (!vacuumDue) {
          res.status(200).json({
            ok: true,
            vacuumRan: false,
            analyzeRan: false,
            messageDe:
              "VACUUM nicht nötig — letzte Wartung innerhalb des Sicherheitsintervalls. Externe Backups haben Vorrang.",
          });
          return;
        }

        sqlite.prepare("VACUUM").run();
        sqlite.prepare("ANALYZE").run();
        const ts = Date.now();
        sysUpsertQuiet(db, "sqlite_last_vacuum_at_ms", String(ts), new Date(ts));
        writeAudit(db, {
          entity: "system",
          entityId: null,
          action: "sqlite_maintenance_vacuum",
          staffId: ctx.staffId,
          payload: { vacuumIfDue: true, intervalDays },
        });
        res.status(200).json({
          ok: true,
          vacuumRan: true,
          analyzeRan: true,
          messageDe:
            "Geplantes VACUUM (Intervall) und ANALYZE abgeschlossen — Performance-Puffer für den Salon.",
        });
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "MAINTENANCE_FAIL";
        res.status(500).json({
          ok: false,
          error: "sqlite_maintenance_failed",
          messageDe:
            msg + " — Bei laufenden Kassiervorgängen später erneut versuchen.",
        });
      }
    }),
  );

  app.get(
    "/api/admin/system/debug-bundle",
    requireAdmin,
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const audits = db
        .select()
        .from(schema.auditLogs)
        .orderBy(desc(schema.auditLogs.id))
        .limit(400)
        .all();

      const orphans = db
        .select()
        .from(schema.orphanPayments)
        .orderBy(desc(schema.orphanPayments.id))
        .limit(120)
        .all();

      const failedJobs = db
        .select()
        .from(schema.hardwareJobs)
        .where(eq(schema.hardwareJobs.status, "failed"))
        .orderBy(desc(schema.hardwareJobs.id))
        .limit(80)
        .all();

      const pendingJobs = db
        .select()
        .from(schema.hardwareJobs)
        .where(eq(schema.hardwareJobs.status, "pending"))
        .orderBy(desc(schema.hardwareJobs.id))
        .limit(80)
        .all();

      const incompleteTseInvoices = db
        .select({
          id: schema.invoices.id,
          status: schema.invoices.status,
          tseStatus: schema.invoices.tseStatus,
        })
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.status, "closed"),
            or(
              isNull(schema.invoices.tseSignature),
              eq(schema.invoices.tseStatus, "ausfall_failed"),
            ),
          ),
        )
        .orderBy(desc(schema.invoices.id))
        .limit(50)
        .all();

      const bundle = {
        generatedAtIso: new Date().toISOString(),
        exporterStaffId: ctx.staffId,
        tauriClientLogsDe:
          "Tauri‑/WebView‑Konsolen‑Dump ist clientseitig: in der Desktop‑App Entwicklertools öffnen oder Screenshot des Fehlers beilegen — nicht im Server‑Bundle enthalten.",
        advisoryDe:
          "Vertraulich — nur zur technischen Analyse weitergeben. Ersetzt keine offizielle Datenexporte für Behörden.",
        runtime: {
          node: process.version,
          zvtForceFail: process.env.OLIVER_ROOS_ZVT_FORCE_FAIL === "1",
          tsePrinterHostSet: Boolean(process.env.TSE_PRINTER_HOST?.trim()),
        },
        auditLogsTail: audits,
        orphanPaymentsTail: orphans,
        hardwareJobsFailedTail: failedJobs,
        hardwareJobsPendingTail: pendingJobs,
        closedInvoicesTseIncomplete: incompleteTseInvoices,
      };

      writeAudit(db, {
        entity: "system",
        entityId: null,
        action: "debug_bundle_export",
        staffId: ctx.staffId,
        payload: {
          auditRowCount: audits.length,
          bundleBytesApprox: JSON.stringify(bundle).length,
        },
      });

      const encoded = encodeURIComponent(bundle.generatedAtIso.replace(/:/g, "-"));

      const wantEnc = req.query.enc === "1";
      const secret = process.env.OLIVER_ROOS_SUPPORT_SECRET?.trim() ?? "";

      let bodyOut: Buffer;
      let mime: string;
      let filename: string;

      if (wantEnc && secret.length >= 24) {
        const key = createHash("sha256").update(secret, "utf8").digest(); // 32 bytes
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        const jsonBuf = Buffer.from(JSON.stringify(bundle, null, 2), "utf8");
        const compressed = gzipSync(jsonBuf);
        const encChunks = Buffer.concat([
          cipher.update(compressed),
          cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        bodyOut = Buffer.concat([iv, tag, encChunks]);
        mime = "application/octet-stream";
        filename = `OliverRoos_Debug_${encoded}.bin`;
      } else {
        bodyOut = Buffer.from(JSON.stringify(bundle, null, 2), "utf8");
        mime = "application/json; charset=utf-8";
        filename = `OliverRoos_Debug_${encoded}.json`;
      }

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename.replace(/[^\w.-]+/g, "_")}"`,
      );
      res.setHeader("Content-Type", mime);
      res.send(bodyOut);
    }),
  );
}
