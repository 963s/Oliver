/**
 * ZVT + orphan queue (§12.1, §12.5.36).
 * Called when the EC terminal authorizes a payment but the PWA did not complete COMMIT.
 */
import { eq, and, or, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { writeAudit } from "../../lib/audit.js";

export type ZvtSuccessPayload = {
  amountCents: number;
  terminalId: string;
  zvtReceiptId?: string;
  /** Raw reference string if no structured receipt id */
  rawZvtReference?: string;
  authorizedAt?: number;
  /** Optional JSON-serializable payload for diagnostics */
  raw?: Record<string, unknown>;
};

export function insertOrphanFromZvtSuccess(
  db: BetterSQLite3Database<typeof schema>,
  payload: ZvtSuccessPayload,
  actorStaffId?: number | null,
) {
  const authorizedAt = payload.authorizedAt ?? Date.now();
  const rows = db
    .insert(schema.orphanPayments)
    .values({
      amountCents: payload.amountCents,
      terminalId: payload.terminalId,
      zvtReceiptId: payload.zvtReceiptId ?? payload.rawZvtReference ?? null,
      authorizedAt: new Date(authorizedAt),
      rawPayload: payload.raw != null ? JSON.stringify(payload.raw) : null,
      status: "unresolved",
    })
    .returning()
    .all();
  const row = rows[0];

  writeAudit(db, {
    entity: "orphan_payments",
    entityId: row?.id,
    action: "zvt_orphan_insert",
    staffId: actorStaffId,
    payload: { terminalId: payload.terminalId, amountCents: payload.amountCents },
  });
  return row;
}

export function listOpenOrphans(
  db: BetterSQLite3Database<typeof schema>,
  terminalId?: string,
) {
  const unresolved = or(
    eq(schema.orphanPayments.status, "unresolved"),
    eq(schema.orphanPayments.status, "open"),
  );
  return db
    .select()
    .from(schema.orphanPayments)
    .where(
      terminalId
        ? and(unresolved, eq(schema.orphanPayments.terminalId, terminalId))
        : unresolved,
    )
    .orderBy(desc(schema.orphanPayments.authorizedAt))
    .all();
}
