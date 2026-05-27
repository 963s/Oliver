import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, gt, inArray, isNull, lt, ne } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { whereNotDeleted } from "../lib/db/softDelete.js";
import {
  appointmentsOverlapWithBuffer,
  SANITIZATION_BUFFER_MS,
} from "../lib/scheduling/sanitizationBuffer.js";
import { getHolidaysForYear } from "./holidayService.js";

export type StaffAvailabilityDto = {
  staffId: number;
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
  /** Kurztext für UI / Logs (deutsch); null wenn verfügbar ohne Hinweis. */
  reason: string | null;
};

/** Calendar date YYYY-MM-DD in Europe/Berlin for an instant (booking API / audits). */
export function berlinYmdFromMs(ms: number): string {
  return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

/** Wochentag 0 = Sonntag … 6 = Samstag — bezogen auf den Kalendertag in Europe/Berlin. */
export function berlinWeekdayFromYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d, 12, 0, 0);
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    weekday: "short",
  }).format(new Date(ms));
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[short] ?? 0;
}

function holidayNameForDate(ymd: string): string | null {
  const year = Number.parseInt(ymd.slice(0, 4), 10);
  if (!Number.isFinite(year)) return null;
  const list = getHolidaysForYear(year);
  const hit = list.find((h) => h.date === ymd);
  return hit ? hit.name : null;
}

/**
 * Verfügbarkeit eines Mitarbeiters an einem Kalendertag (YYYY-MM-DD, Europe/Berlin).
 * Hierarchie: Kalenderausnahmen → Feiertage BW → Sonntag → Wochenvorlage.
 */
export function getStaffAvailability(
  db: BetterSQLite3Database<typeof schema>,
  staffId: number,
  date: string,
): StaffAvailabilityDto {
  const empty = (): Omit<StaffAvailabilityDto, "staffId" | "isAvailable"> => ({
    startTime: null,
    endTime: null,
    reason: null,
  });

  const salonRows = db
    .select()
    .from(schema.calendarExceptions)
    .where(
      and(
        eq(schema.calendarExceptions.exceptionDate, date),
        isNull(schema.calendarExceptions.staffId),
      ),
    )
    .all();

  const staffRows = db
    .select()
    .from(schema.calendarExceptions)
    .where(
      and(
        eq(schema.calendarExceptions.exceptionDate, date),
        eq(schema.calendarExceptions.staffId, staffId),
      ),
    )
    .all();

  const salonClosed = salonRows.find((r) => r.exceptionType === "closed");
  if (salonClosed) {
    return {
      staffId,
      isAvailable: false,
      ...empty(),
      reason: salonClosed.reason ?? "Geschlossen (Betrieb)",
    };
  }

  const staffClosed = staffRows.find((r) => r.exceptionType === "closed");
  if (staffClosed) {
    return {
      staffId,
      isAvailable: false,
      ...empty(),
      reason: staffClosed.reason ?? "Nicht im Dienst (Ausnahme)",
    };
  }

  const salonOpen = salonRows.find((r) => r.exceptionType === "open_override");
  const staffOpen = staffRows.find((r) => r.exceptionType === "open_override");
  const skipHolidayAndSunday = Boolean(salonOpen || staffOpen);

  const timeFromOpenOverride = staffOpen ?? salonOpen;
  if (
    timeFromOpenOverride?.startTime &&
    timeFromOpenOverride?.endTime &&
    skipHolidayAndSunday
  ) {
    return {
      staffId,
      isAvailable: true,
      startTime: timeFromOpenOverride.startTime,
      endTime: timeFromOpenOverride.endTime,
      reason: null,
    };
  }

  if (!skipHolidayAndSunday) {
    const hol = holidayNameForDate(date);
    if (hol) {
      return {
        staffId,
        isAvailable: false,
        ...empty(),
        reason: `Feiertag: ${hol}`,
      };
    }
    if (berlinWeekdayFromYmd(date) === 0) {
      return {
        staffId,
        isAvailable: false,
        ...empty(),
        reason: "Sonntag (Ladenschluss / Sonntagsruhe)",
      };
    }
  }

  const dow = berlinWeekdayFromYmd(date);
  const [wrow] = db
    .select()
    .from(schema.staffWeeklySchedules)
    .where(
      and(
        eq(schema.staffWeeklySchedules.staffId, staffId),
        eq(schema.staffWeeklySchedules.dayOfWeek, dow),
      ),
    )
    .limit(1)
    .all();

  if (!wrow || !wrow.isWorking || !wrow.startTime || !wrow.endTime) {
    return {
      staffId,
      isAvailable: false,
      ...empty(),
      reason: "Kein regulärer Dienst",
    };
  }

  return {
    staffId,
    isAvailable: true,
    startTime: wrow.startTime,
    endTime: wrow.endTime,
    reason: null,
  };
}

/**
 * Prüft Überschneidung mit bestehenden Terminen (gebucht oder eingecheckt).
 * Jeder Termin blockiert zusätzlich `SANITIZATION_BUFFER_MS` nach `endAt` (Reinigungspuffer).
 */
export function checkAppointmentConflict(
  db: BetterSQLite3Database<typeof schema>,
  staffId: number,
  startAtMs: number,
  endAtMs: number,
  excludeAppointmentId?: number,
): boolean {
  if (endAtMs <= startAtMs) return false;
  const loose = and(
    eq(schema.appointments.staffId, staffId),
    inArray(schema.appointments.status, ["booked", "checked_in"]),
    whereNotDeleted(schema.appointments),
    lt(schema.appointments.startAt, new Date(endAtMs + SANITIZATION_BUFFER_MS)),
    gt(schema.appointments.endAt, new Date(startAtMs - SANITIZATION_BUFFER_MS)),
  );
  const where =
    excludeAppointmentId != null
      ? and(loose, ne(schema.appointments.id, excludeAppointmentId))
      : loose;
  const rows = db
    .select({
      id: schema.appointments.id,
      startAt: schema.appointments.startAt,
      endAt: schema.appointments.endAt,
    })
    .from(schema.appointments)
    .where(where)
    .all();
  for (const row of rows) {
    const os = row.startAt.getTime();
    const oe = row.endAt.getTime();
    if (
      appointmentsOverlapWithBuffer(os, oe, startAtMs, endAtMs, SANITIZATION_BUFFER_MS)
    ) {
      return true;
    }
  }
  return false;
}
