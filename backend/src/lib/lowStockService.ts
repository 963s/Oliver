import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";

export const SYSTEM_ALERT_KIND_LOW_STOCK = "low_stock" as const;

/**
 * Root DB + explicit transaction handles from `db.transaction` share the same surface
 * for our use (select/insert/update/delete).
 */
export type LowStockDb = Pick<
  BetterSQLite3Database<typeof schema>,
  "select" | "insert" | "update" | "delete"
>;

function effectiveThreshold(
  minStockThresholdMl: number | null,
): number | null {
  if (minStockThresholdMl == null) return null;
  const t = Math.floor(minStockThresholdMl);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, t);
}

/**
 * Reconcile `system_alerts` for one item after any `on_hand_ml` change.
 * - If no threshold or stock above threshold: remove open low_stock alert.
 * - If at/below threshold: ensure **at most one** row; **no** extra insert if one already exists
 *   (avoids spam on every repeated deduct).
 */
export function syncLowStockAlertForItemTx(
  tx: LowStockDb,
  inventoryItemId: number,
): void {
  const [row] = tx
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, inventoryItemId))
    .limit(1)
    .all();
  if (!row) {
    return;
  }

  const th = effectiveThreshold(row.minStockThresholdMl);
  if (th == null) {
    tx.delete(schema.systemAlerts)
      .where(
        and(
          eq(schema.systemAlerts.kind, SYSTEM_ALERT_KIND_LOW_STOCK),
          eq(schema.systemAlerts.inventoryItemId, inventoryItemId),
        ),
      )
      .run();
    return;
  }

  if (row.onHandMl > th) {
    tx.delete(schema.systemAlerts)
      .where(
        and(
          eq(schema.systemAlerts.kind, SYSTEM_ALERT_KIND_LOW_STOCK),
          eq(schema.systemAlerts.inventoryItemId, inventoryItemId),
        ),
      )
      .run();
    return;
  }

  const [existing] = tx
    .select()
    .from(schema.systemAlerts)
    .where(
      and(
        eq(schema.systemAlerts.kind, SYSTEM_ALERT_KIND_LOW_STOCK),
        eq(schema.systemAlerts.inventoryItemId, inventoryItemId),
      ),
    )
    .limit(1)
    .all();
  if (existing) {
    return;
  }

  const payload = JSON.stringify({
    name: row.name,
    onHandMl: row.onHandMl,
    thresholdMl: th,
  });
  tx.insert(schema.systemAlerts)
    .values({
      kind: SYSTEM_ALERT_KIND_LOW_STOCK,
      inventoryItemId,
      payloadJson: payload,
    })
    .run();
}

export function syncLowStockAlertForItem(
  db: BetterSQLite3Database<typeof schema>,
  inventoryItemId: number,
): void {
  db.transaction((tx) => {
    syncLowStockAlertForItemTx(
      tx as unknown as LowStockDb,
      inventoryItemId,
    );
  });
}

/**
 * All items with a set threshold where book stock is already at or below that threshold
 * (diagnostic / batch view; may overlap with `system_alerts` but does not require an alert row).
 */
export function listMonitoredItemsAtOrBelowThreshold(
  db: BetterSQLite3Database<typeof schema>,
): (typeof schema.inventoryItems.$inferSelect)[] {
  return db
    .select()
    .from(schema.inventoryItems)
    .where(
      and(
        isNotNull(schema.inventoryItems.minStockThresholdMl),
        lte(
          schema.inventoryItems.onHandMl,
          schema.inventoryItems.minStockThresholdMl,
        ),
      ),
    )
    .all();
}

export function listOpenLowStockAlerts(
  db: BetterSQLite3Database<typeof schema>,
): {
  alert: typeof schema.systemAlerts.$inferSelect;
  item: typeof schema.inventoryItems.$inferSelect | null;
}[] {
  const alerts = db
    .select()
    .from(schema.systemAlerts)
    .where(eq(schema.systemAlerts.kind, SYSTEM_ALERT_KIND_LOW_STOCK))
    .all();
  return alerts.map((alert) => {
    const [item] = db
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, alert.inventoryItemId))
      .limit(1)
      .all();
    return { alert, item: item ?? null };
  });
}
