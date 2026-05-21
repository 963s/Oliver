import { useCallback, useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { apiGet } from "../api";
import { BERLIN, startEndBerlinDayMsForYmd } from "../lib/formatTime";
import { usePulseStore } from "../store/pulseStore";

export type TodayAppointmentRow = {
  id: number;
  clientName: string;
  clientPhone: string | null;
  clientId?: number | null;
  staffId: number;
  serviceName: string;
  startAt: string;
  endAt: string;
  status: string;
  /** For optimistic/race checks during agenda DnD. */
  updatedAt?: string;
};

/**
 * Termine für einen festen Kalendertag (yyyy-mm-dd) in Europe/Berlin;
 * revalidiert bei globalem SSE-Puls.
 */
export function useDayAppointments(dateYmd: string): {
  items: TodayAppointmentRow[] | null;
  revalidating: boolean;
  error: string | null;
  refetch: () => void;
} {
  const globalRefreshCounter = usePulseStore((s) => s.globalRefreshCounter);
  const [items, setItems] = useState<TodayAppointmentRow[] | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRevalidating(true);
    setError(null);
    const { fromMs, toMs } = startEndBerlinDayMsForYmd(dateYmd);
    try {
      const rows = await apiGet<TodayAppointmentRow[]>(
        `/api/appointments?from=${fromMs}&to=${toMs}`,
      );
      const visible = rows.filter((r) => {
        const y = formatInTimeZone(new Date(r.startAt), BERLIN, "yyyy-MM-dd");
        return y === dateYmd && (r.status === "booked" || r.status === "checked_in");
      });
      visible.sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );
      setItems(visible);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setRevalidating(false);
    }
  }, [dateYmd]);

  useEffect(() => {
    void load();
  }, [globalRefreshCounter, load]);

  return { items, revalidating, error, refetch: load };
}

/**
 * Stale-while-revalidate: heute in **Europe/Berlin**;
 * revalidiert bei globalem SSE-Puls (Warteliste / TSE / …).
 */
export function useTodayAppointments(): {
  items: TodayAppointmentRow[] | null;
  revalidating: boolean;
  error: string | null;
  refetch: () => void;
} {
  const ymd = formatInTimeZone(new Date(), BERLIN, "yyyy-MM-dd");
  return useDayAppointments(ymd);
}

/** True if the appointment start is more than 1 hour from now (wall-clock / instant). */
export function isPrematureCheckIn(startAt: string | number | Date): boolean {
  const t = new Date(startAt).getTime();
  return t - Date.now() > 60 * 60 * 1000;
}
