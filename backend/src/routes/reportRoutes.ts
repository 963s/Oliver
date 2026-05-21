import type { Express, Request, Response } from "express";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { requireAdmin } from "../middleware/auth.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { buildChefBriefing } from "../lib/reports/chefBriefing.js";
import {
  buildBusinessCockpit,
  buildMyPerformance,
} from "../lib/reports/businessCockpit.js";
import { buildEmergencyDayPdfBytes } from "../lib/reports/emergencyDayPdf.js";
import { getStaffContext } from "../lib/sessionAuth.js";
import { writeAudit } from "../lib/audit.js";

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Management reports (Chef-Ansicht) — `requireAdmin` on every route in this module.
 */
export function registerReportRoutes(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  app.get(
    "/api/reports/business-cockpit",
    requireOwner,
    asyncRoute((req, res) => {
      const rawFrom = req.query.from;
      const rawTo = req.query.to;
      const from = typeof rawFrom === "string" && DATE_RE.test(rawFrom) ? rawFrom : "";
      const to = typeof rawTo === "string" && DATE_RE.test(rawTo) ? rawTo : "";
      if (!from || !to) {
        res.status(400).json({ error: "from_and_to_required_ymd" });
        return;
      }
      if (from > to) {
        res.status(400).json({ error: "from_after_to" });
        return;
      }
      const body = buildBusinessCockpit(db, from, to);
      res.json(body);
    }),
  );

  app.get(
    "/api/reports/my-performance",
    asyncRoute((req, res) => {
      let c;
      try {
        c = getStaffContext(req);
      } catch {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const rawFrom = req.query.from;
      const rawTo = req.query.to;
      const from =
        typeof rawFrom === "string" && DATE_RE.test(rawFrom)
          ? rawFrom
          : new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
      const to =
        typeof rawTo === "string" && DATE_RE.test(rawTo)
          ? rawTo
          : new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
      const body = buildMyPerformance(db, c.staffId, from, to);
      res.json(body);
    }),
  );

  app.get(
    "/api/reports/emergency-day-pdf",
    requireAdmin,
    asyncRoute(async (req, res) => {
      let c;
      try {
        c = getStaffContext(req);
      } catch {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const raw = req.query.date;
      const d =
        typeof raw === "string" && DATE_RE.test(raw)
          ? raw
          : new Date().toLocaleDateString("sv-SE", {
              timeZone: "Europe/Berlin",
            });
      try {
        const bytes = await buildEmergencyDayPdfBytes(db, d);
        writeAudit(db, {
          entity: "reports",
          action: "emergency_day_pdf_download",
          staffId: c.staffId,
          payload: { berlinDayYmd: d, bytes: bytes.byteLength },
        });
        const filename = `OliverRoos_Notfall_${d}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(Buffer.from(bytes));
      } catch (e) {
        res.status(500).json({ error: String(e ?? "pdf_failed") });
      }
    }),
  );

  app.get(
    "/api/reports/chef-briefing",
    requireAdmin,
    asyncRoute((req, res) => {
      const raw = req.query.date;
      const d = Array.isArray(raw) ? raw[0] : raw;
      const businessYmd =
        d != null && DATE_RE.test(String(d))
          ? String(d)
          : new Date().toLocaleDateString("sv-SE", {
              timeZone: "Europe/Berlin",
            });
      const body = buildChefBriefing(db, businessYmd);
      res.json(body);
    }),
  );
}
