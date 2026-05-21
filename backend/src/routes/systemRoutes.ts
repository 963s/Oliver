import type { Express, Request, Response } from "express";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { requireAdmin } from "../middleware/auth.js";
import { getStaffContext } from "../lib/sessionAuth.js";
import { eq, inArray } from "drizzle-orm";
import { createAuditLog } from "../lib/audit/logger.js";
import { getSqliteHandle } from "../db/index.js";

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function registerSystemRoutes(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  app.get(
    "/api/system/runtime-config",
    asyncRoute((req, res) => {
      try {
        // Auth guard only: all logged-in staff may read runtime config.
        getStaffContext(req);
      } catch {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const settingKeys = [
        "sanitization_buffer_minutes",
        "feature_client360_patch_test",
        "feature_client360_privacy_toggle",
        "feature_client360_hospitality",
        "feature_client360_loyalty_badge",
        "feature_client360_anonymize_button",
      ] as const;
      const rows = db
        .select()
        .from(schema.systemSettings)
        .where(inArray(schema.systemSettings.key, [...settingKeys]))
        .all();
      const map = new Map(rows.map((r) => [r.key, r.value]));
      const rawBuf = map.get("sanitization_buffer_minutes");
      const parsedMin = Number.parseInt(String(rawBuf ?? "15"), 10);
      const safeMin = Number.isFinite(parsedMin)
        ? Math.max(0, Math.min(parsedMin, 120))
        : 15;

      const on = (k: string) => (map.get(k) ?? "1") === "1";
      res.json({
        sanitizationBufferMinutes: safeMin,
        sanitizationBufferMs: safeMin * 60 * 1000,
        client360Features: {
          patchTest: on("feature_client360_patch_test"),
          privacyToggle: on("feature_client360_privacy_toggle"),
          hospitality: on("feature_client360_hospitality"),
          loyaltyBadge: on("feature_client360_loyalty_badge"),
          anonymizeButton: on("feature_client360_anonymize_button"),
        },
      });
    }),
  );

  app.get(
    "/api/system/backup/sqlite",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const sqlite = getSqliteHandle();
      const tmpDir = await mkdtemp(join(tmpdir(), "or-sqlite-bak-"));
      const snapPath = join(tmpDir, "snapshot.sqlite");
      try {
        await sqlite.backup(snapPath);
        const buf = await readFile(snapPath);
        const ymd = new Date().toLocaleDateString("sv-SE", {
          timeZone: "Europe/Berlin",
        });
        const filename = `salon_backup_${ymd.replace(/-/g, "_")}.sqlite`;

        const ctx = getStaffContext(req);
        createAuditLog(db, {
          staffId: ctx.staffId,
          action: "sqlite_backup_downloaded",
          entityType: "system",
          entityId: null,
          afterData: {
            filename,
            bytes: buf.length,
          },
        });

        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(buf);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }),
  );
}
