import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "../../db/schema.js";
import { writeAudit } from "../audit.js";

/**
 * §36 GoBD — Soft-delete helpers.
 *
 * Drizzle tables that opt into Revisionssicherheit carry a nullable `deletedAt`
 * column. Rows with `deletedAt IS NOT NULL` MUST be excluded from every
 * user-facing read query (lists, reports, agenda, revenue). The row itself
 * stays in the database forever — fiscal/audit data is never hard-deleted.
 */
export interface SoftDeletableTable extends SQLiteTable {
  id: SQLiteColumn;
  deletedAt: SQLiteColumn;
  updatedAt?: SQLiteColumn;
}

/**
 * Drizzle WHERE fragment that excludes soft-deleted rows.
 *
 *   db.select().from(appointments).where(whereNotDeleted(appointments)).all()
 *   db.select().from(appointments).where(and(eq(appointments.id, id), whereNotDeleted(appointments))).all()
 */
export function whereNotDeleted(table: SoftDeletableTable): SQL {
  return isNull(table.deletedAt);
}

export interface SoftDeleteRequest {
  /** Audit entity label (table name), e.g. "appointments". */
  entityName: string;
  /** Audit action label, e.g. "appointment_soft_delete". */
  auditAction: string;
  staffId: number | null;
  /** Free-text Begründung — required by §15 for actions in `AUDIT_ACTIONS_REQUIRING_REASON`. */
  reason: string;
  /** Optional snapshot fn (defaults to passthrough). Use e.g. snapshotAppointmentRow. */
  snapshot?: (row: unknown) => unknown;
}

export interface SoftDeleteResult {
  ok: boolean;
  /** Row state immediately before the soft-delete write (null if not found). */
  before: Record<string, unknown> | null;
  /** Row state after the soft-delete write (null if not found). */
  after: Record<string, unknown> | null;
}

/**
 * Soft-deletes a single row (sets `deletedAt = now` and bumps `updatedAt` if present)
 * and writes a paired audit log with before/after JSON snapshots.
 *
 * Returns `{ ok: false }` when the row is missing or already soft-deleted —
 * caller decides whether that is a 404 or a no-op.
 */
export function softDelete(
  db: BetterSQLite3Database<typeof schema>,
  table: SoftDeletableTable,
  id: number,
  req: SoftDeleteRequest,
): SoftDeleteResult {
  const idCol = table.id;
  const deletedCol = table.deletedAt;
  const updatedCol = table.updatedAt;

  const beforeRows = db
    .select()
    .from(table)
    .where(and(eq(idCol, id), isNull(deletedCol)))
    .limit(1)
    .all() as Record<string, unknown>[];
  const before = beforeRows[0] ?? null;

  if (!before) {
    return { ok: false, before: null, after: null };
  }

  const now = new Date();
  const setValues: Record<string, unknown> = { deletedAt: now };
  if (updatedCol) {
    setValues.updatedAt = now;
  }
  db.update(table).set(setValues).where(eq(idCol, id)).run();

  const afterRows = db
    .select()
    .from(table)
    .where(eq(idCol, id))
    .limit(1)
    .all() as Record<string, unknown>[];
  const after = afterRows[0] ?? null;

  const snap = req.snapshot ?? ((r: unknown) => r);
  writeAudit(db, {
    entity: req.entityName,
    entityId: id,
    action: req.auditAction,
    staffId: req.staffId ?? undefined,
    before: snap(before),
    after: after ? snap(after) : null,
    reason: req.reason,
  });

  return { ok: true, before, after };
}
