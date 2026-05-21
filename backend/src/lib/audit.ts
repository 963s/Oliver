import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";

/**
 * §15 — Actions where `reason` MUST be a non-empty string (Storno, manual price, etc.).
 * Calling `writeAudit` / `writeAuditTx` with these actions without `reason` throws.
 */
export const AUDIT_ACTIONS_REQUIRING_REASON = new Set<string>([
  "invoice_storno",
  "invoice_void_draft",
  "invoice_item_price_adjust",
  "invoice_item_delete",
  /** Manual ml adjust (waste, expiry, count, stock-in); `reason` = free-text from operator. */
  "inventory_manual_adjust",
  /** Supplier / delivery goods receipt; `reason` = supplier invoice / Beleg ref. */
  "inventory_goods_receipt",
  /** GDPR Art. 17 / shop policy — free-text basis (e.g. data subject request id). */
  "client_anonymize",
  /** Owner changed per-staff service speed (capacity-impacting). */
  "staff_service_duration_upsert",
  "staff_service_duration_delete",
  /** §12.5.57 — Chemical / treatment waiver; `reason` = witness note / variant read to client. */
  "waiver_signed",
  /** §36 — Appointment row hidden via soft-delete (deleted_at); `reason` = operator note (Pflicht). */
  "appointment_soft_delete",
  /** §36 — Line net differs from salon_service_catalog.reference_net_cents at checkout close. */
  "checkout_price_override",
]);

export type AuditRowInput = {
  entity: string;
  entityId?: number | null;
  action: string;
  /** Optional structured delta; also written to `before_state_json` / `after_state_json`. */
  before?: unknown;
  after?: unknown;
  /** Extra fields stored in `payload_json` (without duplicating before/after when top-level before/after are set). */
  payload?: unknown;
  reason?: string | null;
  staffId?: number | null;
};

/**
 * Example row after a **manual line price change** on an open invoice (future endpoint):
 * - `action`: `invoice_item_price_adjust`
 * - `reason`: free text (e.g. owner override) — **required**
 * - `before_state_json`: snapshot of the line before (unit_net_cents, vat_rate_bps, qty, description)
 * - `after_state_json`: same fields after edit
 * - `payload_json`: e.g. `{ "invoiceId": 7, "currency": "EUR" }` (no semantic duplicate of before/after)
 *
 * Example JSON shape:
 * ```json
 * {
 *   "entity": "invoice_items",
 *   "entityId": 42,
 *   "action": "invoice_item_price_adjust",
 *   "reason": "Korrektur nach Inhaber-Freigabe — Stammkundenpreis",
 *   "before_state_json": "{\"invoiceId\":7,\"unitNetCents\":2500,\"vatRateBps\":1900,\"quantity\":1,\"description\":\"Haarschnitt\"}",
 *   "after_state_json": "{\"invoiceId\":7,\"unitNetCents\":2200,\"vatRateBps\":1900,\"quantity\":1,\"description\":\"Haarschnitt\"}",
 *   "payload_json": "{\"invoiceId\":7,\"currency\":\"EUR\"}"
 * }
 * ```
 */

function normalizeDelta(row: AuditRowInput): {
  before: unknown | undefined;
  after: unknown | undefined;
  payload: unknown | undefined;
} {
  let before = row.before;
  let after = row.after;
  let payload = row.payload;
  if (
    before === undefined &&
    after === undefined &&
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    ("before" in payload || "after" in payload)
  ) {
    const p = payload as Record<string, unknown>;
    before = p.before as unknown;
    after = p.after as unknown;
    const { before: _b, after: _a, ...rest } = p;
    payload = Object.keys(rest).length > 0 ? rest : undefined;
  }
  return { before, after, payload };
}

function buildAuditValues(row: AuditRowInput): typeof schema.auditLogs.$inferInsert {
  if (AUDIT_ACTIONS_REQUIRING_REASON.has(row.action)) {
    const r = row.reason?.trim();
    if (!r) {
      throw new Error(
        `audit_logs: non-empty reason required for action "${row.action}"`,
      );
    }
  }
  const { before, after, payload } = normalizeDelta(row);

  const payloadOnly: Record<string, unknown> = {};
  if (payload !== undefined) {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      Object.assign(payloadOnly, payload as Record<string, unknown>);
    } else {
      payloadOnly.data = payload;
    }
  }

  return {
    entity: row.entity,
    entityId: row.entityId ?? null,
    action: row.action,
    beforeStateJson: before !== undefined ? JSON.stringify(before) : null,
    afterStateJson: after !== undefined ? JSON.stringify(after) : null,
    payloadJson: Object.keys(payloadOnly).length
      ? JSON.stringify(payloadOnly)
      : null,
    reason: row.reason?.trim() ? row.reason.trim() : null,
    staffId: row.staffId ?? null,
  };
}

type Dbish = Pick<BetterSQLite3Database<typeof schema>, "insert">;

export function writeAudit(
  db: BetterSQLite3Database<typeof schema>,
  row: AuditRowInput,
): void {
  db.insert(schema.auditLogs).values(buildAuditValues(row)).run();
}

/** Same as `writeAudit` but commits inside an explicit `db.transaction` callback. */
export function writeAuditTx(tx: Dbish, row: AuditRowInput): void {
  tx.insert(schema.auditLogs).values(buildAuditValues(row)).run();
}
