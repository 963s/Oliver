import { fromZonedTime } from "date-fns-tz";
import type { TodayAppointmentRow } from "../hooks/useTodayAppointments";
import {
  GRID_BERLIN,
  SLOT_COUNT,
  SLOT_MINUTES,
  appointmentsOverlapWithBuffer,
  layoutAppointmentInGrid,
  parseHHmmToMinutes,
  slotStartMsBerlin,
} from "./agendaGridUtils";

/** Gleiche Schwelle wie Backend `appointmentUpdateRequiresReason` (GoBD). */
export const THIRTY_MIN_MS = 30 * 60 * 1000;

export type AgendaAvailRow = {
  staffId: number;
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
};

export function agendaMoveRequiresReason(
  apt: TodayAppointmentRow,
  targetStaffId: number,
  proposedStartMs: number,
  proposedEndMs: number,
): boolean {
  if (apt.staffId !== targetStaffId) return true;
  const ds = Math.abs(proposedStartMs - new Date(apt.startAt).getTime());
  const de = Math.abs(proposedEndMs - new Date(apt.endAt).getTime());
  return ds > THIRTY_MIN_MS || de > THIRTY_MIN_MS;
}

function availabilityWindowMs(
  dateYmd: string,
  startTime: string,
  endTime: string,
): { start: number; end: number } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const a = parseHHmmToMinutes(startTime);
  const b = parseHHmmToMinutes(endTime);
  const sh = Math.floor(a / 60);
  const sm = a % 60;
  const eh = Math.floor(b / 60);
  const em = b % 60;
  return {
    start: fromZonedTime(
      `${dateYmd}T${pad(sh)}:${pad(sm)}:00.000`,
      GRID_BERLIN,
    ).getTime(),
    end: fromZonedTime(`${dateYmd}T${pad(eh)}:${pad(em)}:00.000`, GRID_BERLIN).getTime(),
  };
}

export function validateAgendaDrop(
  apt: TodayAppointmentRow,
  targetStaffId: number,
  targetSlotIndex: number,
  dateYmd: string,
  availability: AgendaAvailRow | undefined,
  allAppointments: TodayAppointmentRow[],
  sanitizationBufferMs: number,
):
  | { ok: true; proposedStartMs: number; proposedEndMs: number }
  | { ok: false; messageDe: string; reasonCode: "occupied" | "buffer" | "outside_hours" | "staff_unavailable" | "outside_grid" | "invalid_duration" } {
  const durationMs = new Date(apt.endAt).getTime() - new Date(apt.startAt).getTime();
  if (durationMs <= 0) {
    return { ok: false, messageDe: "Ungültige Termindauer.", reasonCode: "invalid_duration" };
  }

  const snappedSlotIndex = snapSlotIndex(targetSlotIndex);
  const proposedStartMs = slotStartMsBerlin(dateYmd, snappedSlotIndex);
  const proposedEndMs = proposedStartMs + durationMs;

  const layout = layoutAppointmentInGrid(proposedStartMs, proposedEndMs, dateYmd);
  if (!layout) {
    return {
      ok: false,
      messageDe: "Außerhalb des Rasters (08:00–20:00) oder nicht abbildbar.",
      reasonCode: "outside_grid",
    };
  }

  if (!availability?.isAvailable || !availability.startTime || !availability.endTime) {
    return { ok: false, messageDe: "Mitarbeiter nicht verfügbar.", reasonCode: "staff_unavailable" };
  }

  const win = availabilityWindowMs(dateYmd, availability.startTime, availability.endTime);
  if (proposedStartMs < win.start || proposedEndMs > win.end) {
    return { ok: false, messageDe: "Außerhalb der Arbeitszeit.", reasonCode: "outside_hours" };
  }

  for (const other of allAppointments) {
    if (other.id === apt.id) continue;
    if (other.staffId !== targetStaffId) continue;
    const os = new Date(other.startAt).getTime();
    const oe = new Date(other.endAt).getTime();
    const directOverlap = proposedStartMs < oe && os < proposedEndMs;
    if (directOverlap) {
      return {
        ok: false,
        messageDe: "Belegt",
        reasonCode: "occupied",
      };
    }
    if (appointmentsOverlapWithBuffer(proposedStartMs, proposedEndMs, os, oe, sanitizationBufferMs)) {
      return {
        ok: false,
        messageDe: "Reinigungspuffer",
        reasonCode: "buffer",
      };
    }
  }

  return { ok: true, proposedStartMs, proposedEndMs };
}

/**
 * Magnetic snapping to nearest grid slot (15 min).
 * Even if caller computes a raw slot/index from pointer math, this keeps drops aligned.
 */
export function snapSlotIndex(rawSlotIndex: number): number {
  if (!Number.isFinite(rawSlotIndex)) return 0;
  const snapped = Math.round(rawSlotIndex);
  return Math.max(0, Math.min(SLOT_COUNT - 1, snapped));
}

/** For future free-pointer drops where only minute offsets are known. */
export function snapMinutesToGrid(minutesFromGridStart: number): number {
  const snapped = Math.round(minutesFromGridStart / SLOT_MINUTES) * SLOT_MINUTES;
  return Math.max(0, snapped);
}

/** z. B. `slot-12-5` → staff 12, slot 5 */
export function parseSlotDroppableId(id: string | undefined | number): {
  staffId: number;
  slotIndex: number;
} | null {
  if (id == null) return null;
  const s = String(id);
  if (!s.startsWith("slot-")) return null;
  const rest = s.slice("slot-".length);
  const li = rest.lastIndexOf("-");
  if (li <= 0) return null;
  const staffId = Number(rest.slice(0, li));
  const slotIndex = Number(rest.slice(li + 1));
  if (!Number.isFinite(staffId) || !Number.isFinite(slotIndex)) return null;
  return { staffId, slotIndex };
}

export function parseAppointmentDragId(id: string | undefined | number): number | null {
  if (id == null) return null;
  const s = String(id);
  if (!s.startsWith("appointment-")) return null;
  const n = Number(s.slice("appointment-".length));
  return Number.isFinite(n) ? n : null;
}

export function formatAppointmentPutError(code: string): string {
  switch (code) {
    case "appointment_not_editable":
      return "Termin kann nicht mehr verschoben werden (abgeschlossen oder abgesagt).";
    case "staff_unavailable":
      return "Zeitfenster nicht frei — bitte erneut versuchen.";
    case "calendar_day_closed":
      return "Kalendertag geschlossen (Feiertag / Sonderlage).";
    case "appointment_change_reason_required":
      return "Begründung erforderlich (GoBD) — bitte im Dialog eintragen.";
    case "duration_mismatch":
      return "Dauer passt nicht zur Leistung — Termin nicht verschoben.";
    case "invalid_time_range":
      return "Ungültiger Zeitraum.";
    case "staff_not_found":
      return "Mitarbeiter nicht gefunden.";
    default:
      return code.length > 0 && code.length < 120 ? code : "Verschieben fehlgeschlagen.";
  }
}
