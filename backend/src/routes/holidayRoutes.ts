import type { Express, Request, Response } from "express";
import { getStaffContext } from "../lib/sessionAuth.js";
import { getHolidaysForYear } from "../services/holidayService.js";

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/**
 * Read-only Kalendar API — gesetzliche Feiertage BW (in-memory via date-holidays).
 */
export function registerHolidayRoutes(app: Express): void {
  app.get(
    "/api/calendar/holidays",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const raw = req.query.year;
      const yStr = Array.isArray(raw) ? raw[0] : raw;
      let year: number;
      if (yStr == null || String(yStr).trim() === "") {
        year = new Date().getFullYear();
      } else {
        year = Number.parseInt(String(yStr), 10);
      }
      if (!Number.isFinite(year) || year < 1900 || year > 2200) {
        res.status(400).json({ error: "invalid_year" });
        return;
      }
      res.json(getHolidaysForYear(year));
    }),
  );
}
