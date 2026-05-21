import { eq, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { writeAuditTx } from "./audit.js";
import type { LowStockDb } from "./lowStockService.js";
import { syncLowStockAlertForItemTx } from "./lowStockService.js";

const STOCK_IN_REASON = "stock_in" as const;

/**
 * Barcode = `barcode_ean` or `barcode_upc` (unique when set) — use with trimmed scan string.
 */
export function findItemByBarcodeScan(
  db: Pick<
    BetterSQLite3Database<typeof schema>,
    "select"
  >,
  code: string,
): (typeof schema.inventoryItems.$inferSelect) | null {
  const c = String(code).trim();
  if (!c) return null;
  const [row] = db
    .select()
    .from(schema.inventoryItems)
    .where(
      or(
        eq(schema.inventoryItems.barcodeEan, c),
        eq(schema.inventoryItems.barcodeUpc, c),
      ),
    )
    .limit(1)
    .all();
  return row ?? null;
}

function findItemById(
  db: Pick<BetterSQLite3Database<typeof schema>, "select">,
  id: number,
): (typeof schema.inventoryItems.$inferSelect) | null {
  if (!Number.isFinite(id) || id < 1) return null;
  const [row] = db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, id))
    .limit(1)
    .all();
  return row ?? null;
}

export class GoodsReceiptNotFoundError extends Error {
  status = 404;
  code = "not_found";
  constructor() {
    super("inventory item not found");
    this.name = "GoodsReceiptNotFoundError";
  }
}

export class GoodsReceiptValidationError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GoodsReceiptValidationError";
    this.status = status;
    this.code = code;
  }
}

export type GoodsReceiptInput = {
  staffId: number;
  addMl: number;
  /** Supplier invoice / delivery note (Beleg) — non-empty, trimmed for `audit_logs.reason` */
  supplierInvoiceRef: string;
  itemId?: number;
  /** Raw scan (EAN-13, UPC-A, etc.); must match an existing EAN/UPC column. */
  barcode?: string;
};

/**
 * `stock_in` goods receipt: increase `on_hand_ml`, append `inventory_adjustments` + `audit_logs`, sync low stock.
 * Provide **either** `itemId` **or** `barcode`, or both if they refer to the same row.
 */
export function applyGoodsReceipt(
  db: BetterSQLite3Database<typeof schema>,
  input: GoodsReceiptInput,
): {
  item: typeof schema.inventoryItems.$inferSelect;
  adjustment: typeof schema.inventoryAdjustments.$inferSelect;
} {
  const addMl = Math.max(0, Math.floor(Number(input.addMl)));
  if (!Number.isFinite(addMl) || addMl < 1) {
    throw new GoodsReceiptValidationError(400, "addMl_invalid", "addMl must be a positive integer");
  }
  const ref = String(input.supplierInvoiceRef ?? "").trim();
  if (ref.length < 1) {
    throw new GoodsReceiptValidationError(
      400,
      "supplier_invoice_ref_required",
      "supplierInvoiceRef is required",
    );
  }
  if (ref.length > 2000) {
    throw new GoodsReceiptValidationError(400, "supplier_invoice_ref_too_long", "ref too long");
  }

  const idNum =
    input.itemId != null ? Math.floor(Number(input.itemId)) : Number.NaN;
  const hasId = Number.isFinite(idNum) && idNum >= 1;
  const hasBc = String(input.barcode ?? "").trim().length > 0;
  if (!hasId && !hasBc) {
    throw new GoodsReceiptValidationError(400, "id_or_barcode", "itemId or barcode is required");
  }

  return db.transaction((tx) => {
    let item: (typeof schema.inventoryItems.$inferSelect) | null = null;
    if (hasId) {
      item = findItemById(tx, idNum);
    }
    if (hasBc) {
      const b = findItemByBarcodeScan(tx, input.barcode!);
      if (item && b && item.id !== b.id) {
        throw new GoodsReceiptValidationError(400, "id_barcode_mismatch", "itemId and barcode do not match the same product");
      }
      if (!item) item = b;
    }
    if (!item) {
      throw new GoodsReceiptNotFoundError();
    }

    const beforeSnap = {
      id: item.id,
      name: item.name,
      onHandMl: item.onHandMl,
      isRetail: item.isRetail,
    };
    const nextOnHand = item.onHandMl + addMl;
    tx.update(schema.inventoryItems)
      .set({ onHandMl: nextOnHand })
      .where(eq(schema.inventoryItems.id, item.id))
      .run();

    const [adj] = tx
      .insert(schema.inventoryAdjustments)
      .values({
        inventoryItemId: item.id,
        deltaMl: addMl,
        reason: STOCK_IN_REASON,
        staffId: input.staffId,
        note: JSON.stringify({
          kind: "goods_receipt",
          supplierInvoiceRef: ref,
        }),
      })
      .returning()
      .all();
    if (!adj) {
      throw new Error("insert adjustment failed");
    }

    const [updated] = tx
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, item.id))
      .limit(1)
      .all();
    if (!updated) {
      throw new Error("re-read item failed");
    }
    const afterSnap = {
      id: updated.id,
      name: updated.name,
      onHandMl: updated.onHandMl,
      isRetail: updated.isRetail,
    };
    writeAuditTx(tx, {
      entity: "inventory_items",
      entityId: item.id,
      action: "inventory_goods_receipt",
      staffId: input.staffId,
      reason: ref,
      before: beforeSnap,
      after: afterSnap,
      payload: {
        deltaMl: addMl,
        adjustmentId: adj.id,
        reasonCode: STOCK_IN_REASON,
      },
    });
    syncLowStockAlertForItemTx(tx as unknown as LowStockDb, item.id);
    return { item: updated, adjustment: adj };
  });
}
