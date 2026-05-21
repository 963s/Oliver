import type { Express, Request, Response } from "express";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asc, eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { getStaffContext } from "../lib/sessionAuth.js";
import { getStaffAvailability } from "../services/availabilityService.js";

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Kalender-Aggregation: gelöste Arbeitsfenster aller aktiven Mitarbeitenden für einen Tag.
 */
export function registerCalendarRoutes(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  app.get(
    "/api/calendar/availability",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const raw = req.query.date;
      const d = Array.isArray(raw) ? raw[0] : raw;
      if (d == null || !DATE_RE.test(String(d))) {
        res.status(400).json({ error: "invalid_date" });
        return;
      }
      const date = String(d);

      const staffRows = db
        .select({ id: schema.staff.id })
        .from(schema.staff)
        .where(eq(schema.staff.active, true))
        .orderBy(asc(schema.staff.id))
        .all();

      const body = staffRows.map((s) => getStaffAvailability(db, s.id, date));
      res.json(body);
    }),
  );
}
