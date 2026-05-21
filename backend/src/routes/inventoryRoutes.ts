import type { Express, Request, Response } from "express";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { requireAdmin } from "../middleware/auth.js";
import { getStaffContext } from "../lib/sessionAuth.js";
import { findItemByBarcodeScan } from "../lib/goodsReceipt.js";
import { GoodsReceiptValidationError } from "../lib/goodsReceipt.js";
import { applyBulkRestock } from "../lib/inventoryRestock.js";

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/**
 * Admin inventory logistics — Wareneingang batch restock + barcode lookup alias.
 */
export function registerInventoryAdminRoutes(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  app.get(
    "/api/inventory/items",
    requireAdmin,
    asyncRoute((req, res) => {
      const code = String(req.query.barcode ?? "").trim();
      if (!code) {
        res.status(400).json({ error: "barcode_required" });
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

  app.post(
    "/api/inventory/restock",
    requireAdmin,
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      const body = req.body as {
        supplierInvoiceRef?: string;
        lines?: { barcode?: string; quantityAdded?: number }[];
      };
      try {
        const out = applyBulkRestock(db, {
          staffId: c.staffId,
          supplierInvoiceRef: String(body.supplierInvoiceRef ?? ""),
          lines: (body.lines ?? []).map((l) => ({
            barcode: String(l.barcode ?? ""),
            quantityAdded: Number(l.quantityAdded ?? 0),
          })),
        });
        res.status(201).json(out);
      } catch (e) {
        if (e instanceof GoodsReceiptValidationError) {
          res.status(e.status).json({ error: e.code, message: e.message });
          return;
        }
        throw e;
      }
    }),
  );
}
