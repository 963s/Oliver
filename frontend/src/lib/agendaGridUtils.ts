import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Post-appointment turnover / cleaning — keep in sync with backend
 * `SANITIZATION_BUFFER_MS` (sanitizationBuffer.ts).
 */
export const SANITIZATION_BUFFER_MS = 15 * 60 * 1000;

/** Default Schnellbuchung duration (modal); user can adjust freely in the booking form. */
export const QUICK_BOOK_DURATION_MS = 45 * 60 * 1000;

/** Raster 07:00–22:00 Europe/Berlin, Slots à 15 Minuten */
export const GRID_BERLIN = "Europe/Berlin";
export const GRID_START_H = 7;
export const GRID_END_H = 22;
export const SLOT_MINUTES = 15;

export const SLOT_COUNT = ((GRID_END_H - GRID_START_H) * 60) / SLOT_MINUTES;

const padHH = (n: number) => String(n).padStart(2, "0");

/**
 * Vertikalposition der „Jetzt“-Linie im Tagesraster (08–20 Berlin), als % der Rasterhöhe.
 * Nur sinnvoll, wenn `dateYmd` der heutige Kalendertag in Berlin ist und `nowMs` im Fenster liegt.
 */
export function liveAgendaNowTopPct(dateYmd: string, nowMs: number): number | null {
  const todayYmd = formatInTimeZone(new Date(nowMs), GRID_BERLIN, "yyyy-MM-dd");
  if (dateYmd !== todayYmd) return null;
  const winStart = fromZonedTime(
    `${dateYmd}T${padHH(GRID_START_H)}:00:00.000`,
    GRID_BERLIN,
  ).getTime();
  const winEnd = fromZonedTime(`${dateYmd}T${padHH(GRID_END_H)}:00:00.000`, GRID_BERLIN).getTime();
  if (nowMs <= winStart || nowMs >= winEnd) return null;
  const winMs = winEnd - winStart;
  return ((nowMs - winStart) / winMs) * 100;
}

export function parseHHmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Label für linke Zeitachse */
export function slotIndexToLabel(slotIndex: number): string {
  const minutesFromMidnight = GRID_START_H * 60 + slotIndex * SLOT_MINUTES;
  const h = Math.floor(minutesFromMidnight / 60);
  const m = minutesFromMidnight % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function slotStartMinutesFromBerlinMidnight(slotIndex: number): number {
  return GRID_START_H * 60 + slotIndex * SLOT_MINUTES;
}

export function slotStartMsBerlin(dateYmd: string, slotIndex: number): number {
  const mins = slotStartMinutesFromBerlinMidnight(slotIndex);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return fromZonedTime(`${dateYmd}T${hh}:${mm}:00.000`, GRID_BERLIN).getTime();
}

export function isSlotInAvailabilityWindow(
  slotIndex: number,
  startTime: string | null,
  endTime: string | null,
): boolean {
  if (!startTime || !endTime) return false;
  const slotStart = slotStartMinutesFromBerlinMidnight(slotIndex);
  const a = parseHHmmToMinutes(startTime);
  const b = parseHHmmToMinutes(endTime);
  return slotStart >= a && slotStart < b;
}

export type AppointmentGridLayout = {
  topPct: number;
  heightPct: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  /** Fraction of card height for service block vs. trailing Reinigung stripe. */
  serviceHeightFraction: number;
};

export function layoutAppointmentInGrid(
  startAt: string | number | Date,
  endAt: string | number | Date,
  dateYmd: string,
): AppointmentGridLayout | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  const winStart = fromZonedTime(
    `${dateYmd}T${pad(GRID_START_H)}:00:00.000`,
    GRID_BERLIN,
  ).getTime();
  const winEnd = fromZonedTime(
    `${dateYmd}T${pad(GRID_END_H)}:00:00.000`,
    GRID_BERLIN,
  ).getTime();
  const s = new Date(startAt).getTime();
  const e = new Date(endAt).getTime();
  const visualEnd = e + SANITIZATION_BUFFER_MS;
  if (Number.isNaN(s) || Number.isNaN(e) || e <= winStart || s >= winEnd) return null;
  const winMs = winEnd - winStart;
  const visualTopMs = Math.max(s, winStart);
  const visualBottomMs = Math.min(visualEnd, winEnd);
  if (visualBottomMs <= visualTopMs) return null;
  const top = ((visualTopMs - winStart) / winMs) * 100;
  const bottom = ((visualBottomMs - winStart) / winMs) * 100;
  const height = Math.max(bottom - top, 1.2);
  const serviceLow = Math.min(e, winEnd);
  const serviceHigh = Math.max(s, winStart);
  const serviceSpan = Math.max(0, serviceLow - serviceHigh);
  const totalSpan = visualBottomMs - visualTopMs;
  const serviceHeightFraction =
    totalSpan > 0 ? Math.min(1, Math.max(0, serviceSpan / totalSpan)) : 1;
  return {
    topPct: top,
    heightPct: height,
    clippedStart: s < winStart,
    clippedEnd: visualEnd > winEnd,
    serviceHeightFraction,
  };
}

/**
 * Shifts a proposed quick-booking window forward so it does not overlap any existing
 * appointment block including the mandatory Reinigungspuffer after each end.
 */
/** Same rule as backend `appointmentsOverlapWithBuffer` (both spans extended after end). */
export function appointmentsOverlapWithBuffer(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  bufferMs: number = SANITIZATION_BUFFER_MS,
): boolean {
  return aStart < bEnd + bufferMs && bStart < aEnd + bufferMs;
}

export function resolveQuickBookingWindow(
  requestedSlotStartMs: number,
  durationMs: number,
  staffAppointments: { startAt: string; endAt: string }[],
): { startAtMs: number; endAtMs: number } {
  let start = requestedSlotStartMs;
  const sorted = [...staffAppointments].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
  for (let iter = 0; iter < 24; iter++) {
    const end = start + durationMs;
    let nextStart = start;
    for (const apt of sorted) {
      const as = new Date(apt.startAt).getTime();
      const ae = new Date(apt.endAt).getTime();
      if (appointmentsOverlapWithBuffer(as, ae, start, end)) {
        nextStart = Math.max(nextStart, ae + SANITIZATION_BUFFER_MS);
      }
    }
    if (nextStart === start) break;
    start = nextStart;
  }
  return { startAtMs: start, endAtMs: start + durationMs };
}

/** Nur „kein Dienst laut Vorlage“ → grau; Feiertag / Sonntag / Sonderlage → hell + Text */
export function isGrayOfflineReason(reason: string | null): boolean {
  if (!reason) return false;
  return reason.includes("Kein regulärer Dienst");
}
