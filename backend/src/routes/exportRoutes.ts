import type { Express, Request, Response } from "express";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { requireAdmin } from "../middleware/auth.js";
import { getStaffContext } from "../lib/sessionAuth.js";
import { createAuditLog } from "../lib/audit/logger.js";
import { buildKassenbuchCsvForMonth } from "../lib/finance/kassenbuchExport.js";

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export function registerExportRoutes(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  app.get(
    "/api/finance/export/kassenbuch",
    requireAdmin,
    asyncRoute((req, res) => {
      const raw = req.query.month;
      const q = Array.isArray(raw) ? raw[0] : raw;
      const month =
        q != null && MONTH_RE.test(String(q).trim())
          ? String(q).trim()
          : null;
      if (!month) {
        res.status(400).json({
          error: "bad_request",
          reason: "month_required_yyyy_mm",
        });
        return;
      }

      let meta;
      try {
        meta = buildKassenbuchCsvForMonth(db, month);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "export_failed";
        if (msg === "invalid_month") {
          res.status(400).json({ error: "bad_request", reason: "invalid_month" });
          return;
        }
        throw e;
      }

      const ctx = getStaffContext(req);
      createAuditLog(db, {
        staffId: ctx.staffId,
        action: "export_downloaded",
        entityType: "finance_export",
        entityId: null,
        afterData: {
          exportKind: "kassenbuch_csv",
          month,
          filename: meta.filename,
          invoiceCount: meta.invoiceCount,
          closingCount: meta.closingCount,
        },
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${meta.filename}"`,
      );
      res.send(meta.csv);
    }),
  );
}
