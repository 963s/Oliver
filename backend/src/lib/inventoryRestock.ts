import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { writeAuditTx } from "./audit.js";
import { findItemByBarcodeScan, GoodsReceiptValidationError } from "./goodsReceipt.js";
import type { LowStockDb } from "./lowStockService.js";
import { syncLowStockAlertForItemTx } from "./lowStockService.js";

export const RESTOCK_REASON = "restock" as const;

export type BulkRestockLine = {
  barcode: string;
  /** ml added to `on_hand_ml` (integer, ≥ 1). */
  quantityAdded: number;
};

export type BulkRestockInput = {
  staffId: number;
  /** Supplier / delivery Beleg (GoBD). */
  supplierInvoiceRef: string;
  lines: BulkRestockLine[];
};

export type BulkRestockResultLine = {
  barcode: string;
  itemId: number;
  name: string;
  deltaMl: number;
  onHandMlAfter: number;
  adjustmentId: number;
};

/**
 * Batch Wareneingang: increment stock + `inventory_adjustments.reason = restock` + audit per line.
 */
export function applyBulkRestock(
  db: BetterSQLite3Database<typeof schema>,
  input: BulkRestockInput,
): { supplierInvoiceRef: string; results: BulkRestockResultLine[] } {
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
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) {
    throw new GoodsReceiptValidationError(400, "lines_required", "lines array required");
  }
  if (lines.length > 200) {
    throw new GoodsReceiptValidationError(400, "lines_too_many", "max 200 lines per batch");
  }

  return db.transaction((tx) => {
    const results: BulkRestockResultLine[] = [];
    for (const raw of lines) {
      const code = String(raw.barcode ?? "").trim();
      const addMl = Math.max(0, Math.floor(Number(raw.quantityAdded)));
      if (!code) {
        throw new GoodsReceiptValidationError(400, "barcode_required", "barcode required per line");
      }
      if (!Number.isFinite(addMl) || addMl < 1) {
        throw new GoodsReceiptValidationError(
          400,
          "quantityAdded_invalid",
          "quantityAdded must be a positive integer (ml)",
        );
      }
      const item = findItemByBarcodeScan(tx, code);
      if (!item) {
        throw new GoodsReceiptValidationError(
          404,
          "unknown_barcode",
          `Unknown barcode: ${code}`,
        );
      }

      const beforeSnap = {
        id: item.id,
        name: item.name,
        onHandMl: item.onHandMl,
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
          reason: RESTOCK_REASON,
          staffId: input.staffId,
          note: JSON.stringify({
            kind: "bulk_restock",
            barcode: code,
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
      };
      writeAuditTx(tx, {
        entity: "inventory_items",
        entityId: item.id,
        action: "inventory_bulk_restock_line",
        staffId: input.staffId,
        reason: ref,
        before: beforeSnap,
        after: afterSnap,
        payload: {
          deltaMl: addMl,
          adjustmentId: adj.id,
          reasonCode: RESTOCK_REASON,
          barcode: code,
        },
      });
      syncLowStockAlertForItemTx(tx as unknown as LowStockDb, item.id);

      results.push({
        barcode: code,
        itemId: updated.id,
        name: updated.name,
        deltaMl: addMl,
        onHandMlAfter: updated.onHandMl,
        adjustmentId: adj.id,
      });
    }
    return { supplierInvoiceRef: ref, results };
  });
}
