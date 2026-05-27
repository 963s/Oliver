import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { whereNotDeleted } from "../db/softDelete.js";
import {
  appointmentsOverlapWithBuffer,
  SANITIZATION_BUFFER_MS,
} from "./sanitizationBuffer.js";

const ACTIVE_STATUSES = ["booked", "checked_in"] as const;

/**
 * Counts **active** appointments whose blocked range (service + Reinigungspuffer) overlaps
 * the proposed `[startAt, endAt)` plus buffer after the new slot.
 */
function countOverlapping(
  db: BetterSQLite3Database<typeof schema>,
  opts: {
    staffId: number;
    startAt: Date;
    endAt: Date;
    excludeAppointmentId?: number;
  },
): number {
  const newS = opts.startAt.getTime();
  const newE = opts.endAt.getTime();
  const loose = and(
    eq(schema.appointments.staffId, opts.staffId),
    inArray(schema.appointments.status, [...ACTIVE_STATUSES]),
    whereNotDeleted(schema.appointments),
    lt(schema.appointments.startAt, new Date(newE + SANITIZATION_BUFFER_MS)),
    gt(schema.appointments.endAt, new Date(newS - SANITIZATION_BUFFER_MS)),
  );
  const where =
    opts.excludeAppointmentId != null
      ? and(loose, ne(schema.appointments.id, opts.excludeAppointmentId))
      : loose;
  const rows = db.select().from(schema.appointments).where(where).all();
  let n = 0;
  for (const row of rows) {
    const os = row.startAt.getTime();
    const oe = row.endAt.getTime();
    if (
      appointmentsOverlapWithBuffer(os, oe, newS, newE, SANITIZATION_BUFFER_MS)
    ) {
      n += 1;
    }
  }
  return n;
}

/**
 * Returns max concurrent overlapping **slots** allowed for this staff member.
 */
function maxAllowedConcurrent(
  allowOverbooking: boolean,
  overbookingMaxConcurrent: number,
): number {
  if (!allowOverbooking) return 1;
  const n = Math.max(2, Math.floor(overbookingMaxConcurrent));
  return n;
}

export type StaffAvailabilityResult =
  | { ok: true; overlapping: number; maxAllowed: number }
  | {
      ok: false;
      code: "staff_unavailable";
      overlapping: number;
      maxAllowed: number;
    };

/**
 * Enforces scheduling: at most N concurrent overlapping **active** appointments
 * (N=1 or staff overbooking policy).
 */
export function checkStaffAvailability(
  db: BetterSQLite3Database<typeof schema>,
  opts: {
    staffId: number;
    startAt: Date;
    endAt: Date;
    excludeAppointmentId?: number;
  },
): StaffAvailabilityResult {
  const [st] = db
    .select()
    .from(schema.staff)
    .where(eq(schema.staff.id, opts.staffId))
    .limit(1)
    .all();
  if (!st) {
    return {
      ok: false,
      code: "staff_unavailable",
      overlapping: 0,
      maxAllowed: 0,
    };
  }
  const maxAllowed = maxAllowedConcurrent(
    st.allowOverbooking,
    st.overbookingMaxConcurrent,
  );
  const overlapping = countOverlapping(db, opts);
  if (overlapping >= maxAllowed) {
    return {
      ok: false,
      code: "staff_unavailable",
      overlapping,
      maxAllowed,
    };
  }
  return { ok: true, overlapping, maxAllowed };
}
