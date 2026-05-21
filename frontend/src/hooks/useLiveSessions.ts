import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "../api";
import { usePulseStore } from "../store/pulseStore";

/** Backend `sessions` row as returned by JSON (createdAt may be ISO string or ms). */
export type SessionApiRow = {
  id: number;
  clientId: number | null;
  staffId: number;
  appointmentId: number | null;
  status: string;
  consultationStatus?: string | null;
  createdAt: number | string;
};

type StaffRow = { id: number; displayName: string };

/**
 * Display bucket for Wet-Hands colour (mapped from row fields, not business rules).
 * Aligns with requested “walk_in / checked_in / in_progress” vocabulary.
 */
export type SessionQueueKind = "walk_in" | "checked_in" | "in_progress";

export type LiveSessionItem = {
  id: number;
  clientLabel: string;
  staffName: string;
  queueKind: SessionQueueKind;
  createdMs: number;
};

function sessionCreatedMs(s: SessionApiRow): number {
  const v = s.createdAt;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return Date.now();
}

function deriveQueueKind(s: SessionApiRow): SessionQueueKind {
  const c = String(s.consultationStatus ?? "pending").trim();
  if (c !== "" && c !== "pending") return "in_progress";
  if (s.appointmentId != null && Number.isFinite(Number(s.appointmentId))) return "checked_in";
  return "walk_in";
}

function asStaffArray(raw: unknown): StaffRow[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = Number(o.id);
    const displayName = typeof o.displayName === "string" ? o.displayName : null;
    if (!Number.isFinite(id) || id < 1 || !displayName) continue;
    out.push({ id, displayName });
  }
  return out;
}

function asSessionArray(raw: unknown): SessionApiRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SessionApiRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = Number(o.id);
    const staffId = Number(o.staffId);
    const status = typeof o.status === "string" ? o.status : "";
    if (!Number.isFinite(id) || !Number.isFinite(staffId) || status === "") continue;
    const clientId =
      o.clientId == null ? null : Number.isFinite(Number(o.clientId)) ? Number(o.clientId) : null;
    const appointmentId =
      o.appointmentId == null
        ? null
        : Number.isFinite(Number(o.appointmentId))
          ? Number(o.appointmentId)
          : null;
    out.push({
      id,
      clientId,
      staffId,
      appointmentId,
      status,
      consultationStatus:
        o.consultationStatus == null ? null : String(o.consultationStatus),
      createdAt:
        typeof o.createdAt === "number" || typeof o.createdAt === "string"
          ? o.createdAt
          : Date.now(),
    });
  }
  return out;
}

/**
 * Stale-while-revalidate: keeps previous `items` while a background refetch runs (no full-screen flash on SSE).
 */
export function useLiveSessions(): {
  items: LiveSessionItem[] | null;
  revalidating: boolean;
  error: string | null;
  nowTick: number;
} {
  const globalRefreshCounter = usePulseStore((s) => s.globalRefreshCounter);
  const [items, setItems] = useState<LiveSessionItem[] | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const clientNameCache = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setRevalidating(true);
    setError(null);
    try {
      const [sessionsRaw, staffRaw] = await Promise.all([
        apiGet<unknown>("/api/sessions"),
        apiGet<unknown>("/api/staff"),
      ]);
      const sessions = asSessionArray(sessionsRaw);
      const staff = asStaffArray(staffRaw);
      const staffMap = new Map(staff.map((s) => [s.id, s.displayName]));
      const open = sessions.filter((s) => s.status === "open");
      open.sort((a, b) => sessionCreatedMs(a) - sessionCreatedMs(b));

      const needClients = new Set<number>();
      for (const s of open) {
        if (s.clientId != null) needClients.add(s.clientId);
      }
      for (const cid of needClients) {
        if (clientNameCache.current.has(cid)) continue;
        try {
          const row = await apiGet<{ name: string }>(`/api/clients/${cid}`);
          clientNameCache.current.set(cid, row.name);
        } catch {
          clientNameCache.current.set(cid, `Kunde #${cid}`);
        }
      }

      const next: LiveSessionItem[] = open.map((s) => {
        const clientLabel =
          s.clientId == null
            ? "Walk-in"
            : (clientNameCache.current.get(s.clientId) ?? `Kunde #${s.clientId}`);
        return {
          id: s.id,
          clientLabel,
          staffName: staffMap.get(s.staffId) ?? `Team #${s.staffId}`,
          queueKind: deriveQueueKind(s),
          createdMs: sessionCreatedMs(s),
        };
      });
      setItems(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "load_failed";
      setError(msg);
    } finally {
      setRevalidating(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [globalRefreshCounter, load]);

  return { items, revalidating, error, nowTick };
}
