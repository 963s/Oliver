import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { writeAuditTx } from "./audit.js";
import { syncLowStockAlertForItemTx } from "./lowStockService.js";
import type { StaffRole } from "./sessionAuth.js";
import { isOwnerRole } from "./sessionAuth.js";

export type ManualAdjustType = "increase" | "decrease";
export type ManualDecreaseCategory = "waste" | "expiry" | "count_correction";

const DECREASE_CATEGORIES = new Set<string>(["waste", "expiry", "count_correction"]);

/**
 * True if the caller may apply this (type, category) pair.
 * - Owner / super_admin: all combinations.
 * - Other roles: only decrease + waste (e.g. breakage / loss).
 */
export function isManualAdjustAllowed(
  role: StaffRole,
  type: ManualAdjustType,
  category: ManualDecreaseCategory | null,
): boolean {
  if (isOwnerRole(role)) return true;
  if (type === "increase") return false;
  return type === "decrease" && category === "waste";
}

export function machineReasonFor(
  type: ManualAdjustType,
  category: ManualDecreaseCategory | null,
): string {
  if (type === "increase") return "manual_stock_in";
  if (category === "waste") return "manual_waste";
  if (category === "expiry") return "manual_expiry";
  if (category === "count_correction") return "manual_count_correction";
  return "manual_waste";
}

function parseDecreaseCategory(
  raw: unknown,
): ManualDecreaseCategory | "missing" | "invalid" {
  if (raw === undefined || raw === null) return "missing";
  if (typeof raw !== "string" || !DECREASE_CATEGORIES.has(raw)) return "invalid";
  return raw as ManualDecreaseCategory;
}

export type ParseManualAdjustBodyResult =
  | { ok: true; itemId: number; amountMl: number; type: ManualAdjustType; category: ManualDecreaseCategory | null; userReason: string }
  | { ok: false; error: string; status: number }

/**
 * Body: itemId, amountMl (positive integer), type, optional category (required for decrease), reason (non-empty).
 */
export function parseManualAdjustBody(body: unknown): ParseManualAdjustBodyResult {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") {
    return { ok: false, error: "body required", status: 400 };
  }
  const itemId = Math.floor(Number(b.itemId));
  if (!Number.isFinite(itemId) || itemId < 1) {
    return { ok: false, error: "itemId must be a positive integer", status: 400 };
  }
  const amountMl = Math.floor(Number(b.amountMl));
  if (!Number.isFinite(amountMl) || amountMl < 1) {
    return { ok: false, error: "amountMl must be a positive integer", status: 400 };
  }
  const type = b.type;
  if (type !== "increase" && type !== "decrease") {
    return { ok: false, error: "type must be increase or decrease", status: 400 };
  }
  const userReason = String(b.reason ?? "").trim();
  if (userReason.length < 1) {
    return { ok: false, error: "reason is required", status: 400 };
  }
  if (userReason.length > 4000) {
    return { ok: false, error: "reason too long", status: 400 };
  }
  if (type === "increase") {
    if (b.category != null) {
      return { ok: false, error: "category must be omitted for type increase", status: 400 };
    }
    return { ok: true, itemId, amountMl, type: "increase", category: null, userReason };
  }
  const cat = parseDecreaseCategory(b.category);
  if (cat === "missing") {
    return { ok: false, error: "category is required for type decrease (waste, expiry, count_correction)", status: 400 };
  }
  if (cat === "invalid") {
    return { ok: false, error: "category must be waste, expiry, or count_correction", status: 400 };
  }
  return { ok: true, itemId, amountMl, type: "decrease", category: cat, userReason };
}

export class ManualAdjustPermissionError extends Error {
  status = 403;
  code = "adjustment_forbidden";
  constructor() {
    super("Owner role required for this adjustment");
    this.name = "ManualAdjustPermissionError";
  }
}

export class ManualAdjustStockError extends Error {
  status = 409;
  code = "insufficient_stock";
  onHandMl: number;
  requestedMl: number;
  constructor(onHand: number, requested: number) {
    super("Not enough on-hand quantity for this decrease");
    this.name = "ManualAdjustStockError";
    this.onHandMl = onHand;
    this.requestedMl = requested;
  }
}

export class ManualAdjustNotFoundError extends Error {
  status = 404;
  code = "not_found";
  constructor() {
    super("Item not found");
    this.name = "ManualAdjustNotFoundError";
  }
}

/**
 * One atomic transaction: optional negative only for is_retail on decrease (same spirit as checkout).
 * Otherwise blocks negative on_hand_ml.
 */
export function applyManualInventoryAdjust(
  db: BetterSQLite3Database<typeof schema>,
  input: {
    staffId: number;
    role: StaffRole;
    itemId: number;
    amountMl: number;
    type: ManualAdjustType;
    category: ManualDecreaseCategory | null;
    userReason: string;
  },
): { item: typeof schema.inventoryItems.$inferSelect; adjustment: typeof schema.inventoryAdjustments.$inferSelect } {
  if (!isManualAdjustAllowed(input.role, input.type, input.category)) {
    throw new ManualAdjustPermissionError();
  }

  const machineReason = machineReasonFor(input.type, input.category);
  const delta =
    input.type === "increase" ? input.amountMl : -input.amountMl;
  const note = JSON.stringify({
    userReason: input.userReason,
    kind: "manual",
    type: input.type,
    category: input.category,
  });

  return db.transaction((tx) => {
    const [row] = tx
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, input.itemId))
      .limit(1)
      .all();
    if (!row) {
      throw new ManualAdjustNotFoundError();
    }
    const beforeSnap = {
      id: row.id,
      name: row.name,
      onHandMl: row.onHandMl,
      isRetail: row.isRetail,
    };
    const next = row.onHandMl + delta;
    if (next < 0) {
      const canNegative = row.isRetail && input.type === "decrease";
      if (!canNegative) {
        throw new ManualAdjustStockError(row.onHandMl, -delta);
      }
    }

    tx.update(schema.inventoryItems)
      .set({ onHandMl: next })
      .where(eq(schema.inventoryItems.id, row.id))
      .run();

    const [adj] = tx
      .insert(schema.inventoryAdjustments)
      .values({
        inventoryItemId: row.id,
        deltaMl: delta,
        reason: machineReason,
        staffId: input.staffId,
        note,
      })
      .returning()
      .all();
    if (!adj) {
      throw new Error("insert adjustment failed");
    }

    const [updated] = tx
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, row.id))
      .limit(1)
      .all();
    if (!updated) throw new Error("re-read item failed");
    const afterSnap = {
      id: updated.id,
      name: updated.name,
      onHandMl: updated.onHandMl,
      isRetail: updated.isRetail,
    };
    writeAuditTx(tx, {
      entity: "inventory_items",
      entityId: row.id,
      action: "inventory_manual_adjust",
      staffId: input.staffId,
      reason: input.userReason,
      before: beforeSnap,
      after: afterSnap,
      payload: {
        adjustmentId: adj.id,
        machineReason,
        type: input.type,
        category: input.category,
        amountMl: input.amountMl,
        retailNegative: updated.onHandMl < 0,
      },
    });
    syncLowStockAlertForItemTx(tx, row.id);
    return { item: updated, adjustment: adj };
  });
}
