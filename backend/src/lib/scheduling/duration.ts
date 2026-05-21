import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";

const SLACK_MS = 60_000;

/**
 * If `serviceName` exists in `salon_service_catalog`, the appointment length must
 * match `duration_minutes` (±1 min). Unknown services: no check (backward compatible).
 */
export function validateServiceDuration(
  db: BetterSQLite3Database<typeof schema>,
  serviceName: string,
  startMs: number,
  endMs: number,
):
  | { ok: true }
  | { ok: false; code: "duration_mismatch"; expectedMinutes: number; actualMinutes: number } {
  const key = String(serviceName ?? "").trim();
  if (!key) {
    return { ok: true };
  }
  const [row] = db
    .select()
    .from(schema.salonServiceCatalog)
    .where(eq(schema.salonServiceCatalog.serviceName, key))
    .limit(1)
    .all();
  if (!row) {
    return { ok: true };
  }
  const expectedMs = row.durationMinutes * 60 * 1000;
  const actualMs = endMs - startMs;
  if (Math.abs(actualMs - expectedMs) > SLACK_MS) {
    return {
      ok: false,
      code: "duration_mismatch",
      expectedMinutes: row.durationMinutes,
      actualMinutes: Math.round(actualMs / 60_000),
    };
  }
  return { ok: true };
}

function resolveDurationMinutes(
  db: BetterSQLite3Database<typeof schema>,
  staffId: number,
  serviceName: string,
): number | null {
  const key = String(serviceName ?? "").trim();
  if (!key) return null;
  const [staffOverride] = db
    .select()
    .from(schema.staffServiceDurations)
    .where(
      and(
        eq(schema.staffServiceDurations.staffId, staffId),
        eq(schema.staffServiceDurations.serviceName, key),
      ),
    )
    .limit(1)
    .all();
  if (staffOverride) return Math.max(1, Math.floor(staffOverride.durationMinutes));
  const [catalogRow] = db
    .select()
    .from(schema.salonServiceCatalog)
    .where(eq(schema.salonServiceCatalog.serviceName, key))
    .limit(1)
    .all();
  if (!catalogRow) return null;
  return Math.max(1, Math.floor(catalogRow.durationMinutes));
}

export function resolveEndAtForService(
  db: BetterSQLite3Database<typeof schema>,
  opts: {
    staffId: number;
    serviceName: string;
    startMs: number;
    requestedEndMs?: number | null;
  },
): { endMs: number; source: "requested" | "staff_override" | "catalog_default" } {
  if (opts.requestedEndMs != null && Number.isFinite(opts.requestedEndMs)) {
    return { endMs: Math.floor(opts.requestedEndMs), source: "requested" };
  }
  const minutes = resolveDurationMinutes(db, opts.staffId, opts.serviceName);
  if (minutes != null) {
    const [staffRow] = db
      .select()
      .from(schema.staffServiceDurations)
      .where(
        and(
          eq(schema.staffServiceDurations.staffId, opts.staffId),
          eq(schema.staffServiceDurations.serviceName, String(opts.serviceName).trim()),
        ),
      )
      .limit(1)
      .all();
    return {
      endMs: opts.startMs + minutes * 60_000,
      source: staffRow ? "staff_override" : "catalog_default",
    };
  }
  return { endMs: opts.startMs + 30 * 60_000, source: "catalog_default" };
}
