import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { writeAudit } from "../audit.js";

/**
 * Central helper for GoBD-style Änderungshistorie — wraps `writeAudit` with explicit JSON deltas.
 * `beforeData` / `afterData` are serialized via `JSON.stringify` in `writeAudit` (Revisionssicherheit).
 */
export type CreateAuditLogParams = {
  staffId: number | null;
  action: string;
  /** Target domain table name (e.g. appointments, sessions). */
  entityType: string;
  entityId?: number | null;
  beforeData?: unknown;
  afterData?: unknown;
  reason?: string | null;
};

export function createAuditLog(
  db: BetterSQLite3Database<typeof schema>,
  p: CreateAuditLogParams,
): void {
  writeAudit(db, {
    entity: p.entityType,
    entityId: p.entityId ?? null,
    action: p.action,
    staffId: p.staffId ?? undefined,
    before: p.beforeData,
    after: p.afterData,
    reason: p.reason ?? null,
  });
}
