import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { syncLowStockAlertForItemTx } from "./lowStockService.js";

export class InsufficientSalonStockError extends Error {
  readonly code = "insufficient_salon_stock" as const;
  constructor(
    readonly inventoryItemId: number,
    readonly onHandMl: number,
    readonly requiredMl: number,
  ) {
    super("insufficient_salon_stock");
    this.name = "InsufficientSalonStockError";
  }
}

export type CheckoutDeductLine = {
  invoiceItemId: number;
  inventoryItemId: number;
  quantity: number;
  /** Integer ml per unit; total deduction = deductMl * quantity. */
  deductMl: number;
};

type Tx = Pick<
  BetterSQLite3Database<typeof schema>,
  "select" | "insert" | "update" | "delete"
>;

/**
 * Called inside the **same** DB transaction as fiscal close. Salon/formula items
 * cannot go negative; retail (`is_retail`) may, with caller posting audit after commit.
 */
export function applyCheckoutInventoryDeductions(
  tx: Tx,
  opts: {
    invoiceId: number;
    sessionId: number;
    staffId: number;
    lines: CheckoutDeductLine[];
  },
): {
  retailNegative: {
    inventoryItemId: number;
    onHandAfter: number;
    name: string;
    beforeOnHand: number;
    deductedMl: number;
  }[];
} {
  const retailNegative: {
    inventoryItemId: number;
    onHandAfter: number;
    name: string;
    beforeOnHand: number;
    deductedMl: number;
  }[] = [];

  for (const line of opts.lines) {
    const q = Math.max(1, Math.floor(line.quantity));
    const per = Math.max(0, Math.floor(line.deductMl));
    if (per < 1) continue;
    const totalMl = per * q;
    if (totalMl < 1) continue;

    const [row] = tx
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, line.inventoryItemId))
      .limit(1)
      .all();
    if (!row) {
      throw new Error("inventory_item_not_found_during_deduct");
    }

    const before = row.onHandMl;
    const after = before - totalMl;

    if (!row.isRetail && after < 0) {
      throw new InsufficientSalonStockError(
        line.inventoryItemId,
        before,
        totalMl,
      );
    }

    tx.update(schema.inventoryItems)
      .set({ onHandMl: after })
      .where(eq(schema.inventoryItems.id, line.inventoryItemId))
      .run();

    syncLowStockAlertForItemTx(tx, line.inventoryItemId);

    tx.insert(schema.inventoryAdjustments)
      .values({
        inventoryItemId: line.inventoryItemId,
        deltaMl: -totalMl,
        reason: "usage_session",
        invoiceId: opts.invoiceId,
        staffId: opts.staffId,
        note: JSON.stringify({
          action: "usage_session",
          invoiceId: opts.invoiceId,
          invoiceItemId: line.invoiceItemId,
          sessionId: opts.sessionId,
        }),
      })
      .run();

    if (row.isRetail && after < 0) {
      retailNegative.push({
        inventoryItemId: row.id,
        onHandAfter: after,
        name: row.name,
        beforeOnHand: before,
        deductedMl: totalMl,
      });
    }
  }

  return { retailNegative };
}
