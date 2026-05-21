import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { checkStaffAvailability } from "./availability.js";

export type ValidateSlotResult =
  | { ok: true; overlapping: number; maxAllowed: number }
  | {
      ok: false;
      code: "staff_unavailable";
      overlapping: number;
      maxAllowed: number;
    };

/**
 * Validate slot overlap against staff policy (`allow_overbooking`, `overbooking_max_concurrent`).
 */
export function validateSlot(
  db: BetterSQLite3Database<typeof schema>,
  opts: {
    staffId: number;
    startMs: number;
    endMs: number;
    excludeAppointmentId?: number;
  },
): ValidateSlotResult {
  return checkStaffAvailability(db, {
    staffId: opts.staffId,
    startAt: new Date(opts.startMs),
    endAt: new Date(opts.endMs),
    excludeAppointmentId: opts.excludeAppointmentId,
  });
}
