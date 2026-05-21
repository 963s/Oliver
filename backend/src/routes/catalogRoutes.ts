import type { Express, Request, Response } from "express";
import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { requireAdmin } from "../middleware/auth.js";
import { getStaffContext } from "../lib/sessionAuth.js";
import { writeAudit } from "../lib/audit.js";

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function registerCatalogAdminRoutes(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  app.get(
    "/api/admin/catalog/services",
    requireAdmin,
    asyncRoute((_req, res) => {
      const rows = db
        .select()
        .from(schema.salonServiceCatalog)
        .orderBy(asc(schema.salonServiceCatalog.serviceName))
        .all();
      res.json(rows);
    }),
  );

  app.post(
    "/api/admin/catalog/services",
    requireAdmin,
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const b = req.body as {
        serviceName?: string;
        durationMinutes?: number;
        referenceNetCents?: number;
        vatRateBps?: number;
        catalogActive?: boolean;
      };
      const serviceName = String(b.serviceName ?? "").trim();
      if (!serviceName || serviceName.length > 200) {
        res.status(400).json({ error: "service_name_invalid" });
        return;
      }
      const durationMinutes = Math.floor(Number(b.durationMinutes));
      if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 16 * 60) {
        res.status(400).json({ error: "duration_minutes_invalid" });
        return;
      }
      const referenceNetCents = Math.max(0, Math.floor(Number(b.referenceNetCents ?? 0)));
      const vatRaw = Math.floor(Number(b.vatRateBps ?? 1900));
      const vatRateBps = vatRaw === 700 || vatRaw === 1900 ? vatRaw : 1900;
      const catalogActive = b.catalogActive !== false;

      try {
        const [row] = db
          .insert(schema.salonServiceCatalog)
          .values({
            serviceName,
            durationMinutes,
            referenceNetCents,
            vatRateBps,
            catalogActive,
          })
          .returning()
          .all();
        if (!row) {
          res.status(500).json({ error: "insert_failed" });
          return;
        }
        writeAudit(db, {
          entity: "salon_service_catalog",
          entityId: row.id,
          action: "catalog_service_create",
          staffId: ctx.staffId,
          payload: {
            serviceName: row.serviceName,
            durationMinutes: row.durationMinutes,
            referenceNetCents: row.referenceNetCents,
            vatRateBps: row.vatRateBps,
            catalogActive: row.catalogActive,
          },
        });
        res.status(201).json(row);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("UNIQUE")) {
          res.status(409).json({ error: "service_name_exists" });
          return;
        }
        throw e;
      }
    }),
  );

  app.patch(
    "/api/admin/catalog/services/:id",
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
        .from(schema.salonServiceCatalog)
        .where(eq(schema.salonServiceCatalog.id, id))
        .limit(1)
        .all();
      if (!before) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      const b = req.body as {
        serviceName?: string;
        durationMinutes?: number;
        referenceNetCents?: number;
        vatRateBps?: number;
        catalogActive?: boolean;
      };
      const updates: Partial<typeof schema.salonServiceCatalog.$inferInsert> = {};
      if (b.serviceName !== undefined) {
        const sn = String(b.serviceName).trim();
        if (!sn || sn.length > 200) {
          res.status(400).json({ error: "service_name_invalid" });
          return;
        }
        updates.serviceName = sn;
      }
      if (b.durationMinutes !== undefined) {
        const dm = Math.floor(Number(b.durationMinutes));
        if (!Number.isFinite(dm) || dm < 5 || dm > 16 * 60) {
          res.status(400).json({ error: "duration_minutes_invalid" });
          return;
        }
        updates.durationMinutes = dm;
      }
      if (b.referenceNetCents !== undefined) {
        updates.referenceNetCents = Math.max(
          0,
          Math.floor(Number(b.referenceNetCents)),
        );
      }
      if (b.vatRateBps !== undefined) {
        const vr = Math.floor(Number(b.vatRateBps));
        if (vr !== 700 && vr !== 1900) {
          res.status(400).json({ error: "vat_rate_invalid" });
          return;
        }
        updates.vatRateBps = vr;
      }
      if (b.catalogActive !== undefined) {
        updates.catalogActive = Boolean(b.catalogActive);
      }

      if (Object.keys(updates).length === 0) {
        res.json(before);
        return;
      }

      try {
        db.update(schema.salonServiceCatalog)
          .set(updates)
          .where(eq(schema.salonServiceCatalog.id, id))
          .run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("UNIQUE")) {
          res.status(409).json({ error: "service_name_exists" });
          return;
        }
        throw e;
      }

      const [after] = db
        .select()
        .from(schema.salonServiceCatalog)
        .where(eq(schema.salonServiceCatalog.id, id))
        .limit(1)
        .all();
      writeAudit(db, {
        entity: "salon_service_catalog",
        entityId: id,
        action: "catalog_service_update",
        staffId: ctx.staffId,
        before: before,
        after: after ?? before,
      });
      res.json(after ?? before);
    }),
  );
}
