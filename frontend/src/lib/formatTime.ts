import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

/** Europe/Berlin — single source for agenda / Kasse displays. */
export const BERLIN = "Europe/Berlin";

function toDate(utcOrIso: string | number | Date): Date {
  return typeof utcOrIso === "string" || typeof utcOrIso === "number" ? new Date(utcOrIso) : utcOrIso;
}

/**
 * Display time in Europe/Berlin (integer minutes, 24h) for UTC instants from the API.
 */
export function formatBerlinTimeHHmm(utcOrIso: string | number | Date): string {
  const d = toDate(utcOrIso);
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: BERLIN,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** e.g. 30.04.2026, 14:00 */
export function formatBerlinDateTime(utcOrIso: string | number | Date): string {
  const d = toDate(utcOrIso);
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: BERLIN,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Query window for GET /api/appointments: start–end of **calendar** day in Berlin
 * (matches how staff reads the agenda, independent of server OS timezone).
 */
export function startEndBerlinZonedDayMs(anchor: Date = new Date()): { fromMs: number; toMs: number } {
  const ymd = formatInTimeZone(anchor, BERLIN, "yyyy-MM-dd");
  return startEndBerlinDayMsForYmd(ymd);
}

/** Kalendertag (yyyy-mm-dd) in Berlin → Unix-ms Fenster für API-Queries. */
export function startEndBerlinDayMsForYmd(ymd: string): { fromMs: number; toMs: number } {
  return {
    fromMs: fromZonedTime(`${ymd}T00:00:00.000`, BERLIN).getTime(),
    toMs: fromZonedTime(`${ymd}T23:59:59.999`, BERLIN).getTime(),
  };
}

export function isSameBerlinDate(
  a: string | number | Date,
  b: string | number | Date = new Date(),
): boolean {
  const ymdA = formatInTimeZone(toDate(a), BERLIN, "yyyy-MM-dd");
  const ymdB = formatInTimeZone(toDate(b), BERLIN, "yyyy-MM-dd");
  return ymdA === ymdB;
}
