import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import { BERLIN } from "../lib/formatTime";

type ClientRow = {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  anonymizedAt: string | null;
  patchTestAt?: string | null;
  hospitalityDrink?: string | null;
  hospitalityConversation?: string | null;
  hospitalitySeat?: string | null;
  sessionHandoverNote?: string | null;
  sessionHandoverUpdatedAt?: string | null;
};

type FormulaRow = {
  id: number;
  formulaText: string;
  notes: string | null;
  staffId: number;
  createdAt: string | number;
};

type NoteRow = {
  id: number;
  noteText: string;
  createdAt: string | number;
  staffId: number;
};

type InvoiceSlice = {
  id: number;
  sessionId: number;
  totalAmountCents: number;
  vatAmountCents: number;
  tipAmountCents: number;
  invoiceKind: string;
  createdAt: string | number;
};

type LoyaltyRow = {
  pointsBalance: number;
  stampsCount: number;
  lifetimePoints: number;
};

type SessionRow = {
  id: number;
  staffId: number | null;
  createdAt?: string | number;
};

type StaffRow = {
  id: number;
  displayName: string;
};

type AppointmentRow = {
  id: number;
  clientId: number | null;
  staffId: number;
  serviceName: string;
  startAt: string;
  status: string;
};

type FullHistoryResponse = {
  client: ClientRow;
  lastClosedInvoices: InvoiceSlice[];
  formulas: FormulaRow[];
  notes: NoteRow[];
  loyalty: LoyaltyRow | null;
  openDebtCents: number;
};

export type ClientTimelineEntry = {
  id: string;
  ts: number;
  kind: "appointment" | "invoice" | "formula" | "note";
  title: string;
  subtitle: string;
  staffName: string | null;
  amountCents?: number;
};

export type Client360Data = {
  client: ClientRow;
  formulas: FormulaRow[];
  notes: NoteRow[];
  invoices: InvoiceSlice[];
  loyalty: LoyaltyRow | null;
  reliabilityScore: number;
  noShowFlag: boolean;
  totalSpendCents: number;
  openDebtCents: number;
  completedVisitCount: number;
  loyaltyBadgeLabel: string | null;
  loyaltyBadgeDetail: string | null;
  patchTestWarning: boolean;
  timeline: ClientTimelineEntry[];
};

function toTs(v: string | number | Date | undefined): number {
  if (v == null) return 0;
  return new Date(v).getTime();
}

/** ~6 Kalendermonate — Epikutantest-Intervall in der Salonpraxis */
const PATCH_TEST_MAX_AGE_MS = 183 * 24 * 60 * 60 * 1000;

function computeLoyaltyBadge(
  completedVisitCount: number,
  totalSpendCents: number,
  loyalty: LoyaltyRow | null,
): { label: string; detail: string } {
  const stamps = loyalty?.stampsCount ?? 0;
  const life = loyalty?.lifetimePoints ?? 0;
  if (
    completedVisitCount >= 24 ||
    totalSpendCents >= 1_200_000 ||
    stamps >= 24 ||
    life >= 8000
  ) {
    return {
      label: "VVIP",
      detail: "Höchste Treue · besondere Wertschätzung",
    };
  }
  if (
    completedVisitCount >= 12 ||
    totalSpendCents >= 500_000 ||
    stamps >= 12 ||
    life >= 4000
  ) {
    return { label: "VIP", detail: "Treuer Gast · Upselling mit Fingerspitzengefühl" };
  }
  if (completedVisitCount >= 5 || stamps >= 5) {
    return { label: "Stammkunde", detail: "Regelmäßige Besuche festigen" };
  }
  if (completedVisitCount >= 2 || stamps >= 2) {
    return { label: "Wiederkehrend", detail: "Beziehung ausbauen" };
  }
  return {
    label: "Neu · Potenzial",
    detail: "Erstkontakt sensibel gestalten",
  };
}

export function useClient360(clientId: number | null): {
  data: Client360Data | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<Client360Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (clientId == null) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [full, staff] = await Promise.all([
        apiGet<FullHistoryResponse>(`/api/clients/${clientId}/full-history`),
        apiGet<StaffRow[]>("/api/staff").catch(() => [] as StaffRow[]),
      ]);
      const staffMap = new Map(staff.map((s) => [s.id, s.displayName] as const));

      const [appointments, sessionTuples] = await Promise.all([
        // 2-year window for reliability/timeline context.
        apiGet<AppointmentRow[]>(
          `/api/appointments?from=${Date.now() - 730 * 24 * 60 * 60 * 1000}&to=${Date.now() + 24 * 60 * 60 * 1000}`,
        ).catch(() => [] as AppointmentRow[]),
        Promise.all(
          full.lastClosedInvoices.map(async (inv) => {
            const s = await apiGet<SessionRow>(`/api/sessions/${inv.sessionId}`).catch(
              () => null as SessionRow | null,
            );
            return [inv.sessionId, s] as const;
          }),
        ),
      ]);
      const sessionMap = new Map(sessionTuples);

      const ownAppts = appointments.filter((a) => a.clientId === clientId);
      const noShows = ownAppts.filter((a) => a.status === "no_show").length;
      const cancels = ownAppts.filter((a) => a.status === "canceled").length;
      const attended = ownAppts.filter(
        (a) => a.status === "checked_in" || a.status === "completed" || a.status === "booked",
      ).length;
      const completedVisitCount = ownAppts.filter((a) => a.status === "completed").length;
      const totalEvents = Math.max(1, attended + noShows + cancels);
      const reliabilityScore = Math.max(
        0,
        Math.round(((attended + Math.max(0, attended - noShows)) / (2 * totalEvents)) * 100),
      );

      const timeline: ClientTimelineEntry[] = [
        ...ownAppts.map((a) => ({
          id: `a-${a.id}`,
          ts: toTs(a.startAt),
          kind: "appointment" as const,
          title: "Termin",
          subtitle: `${a.serviceName} · ${a.status}`,
          staffName: staffMap.get(a.staffId) ?? null,
        })),
        ...full.lastClosedInvoices.map((i) => {
          const sess = sessionMap.get(i.sessionId);
          return {
            id: `i-${i.id}`,
            ts: toTs(i.createdAt),
            kind: "invoice" as const,
            title: "Verkauf",
            subtitle: `${i.invoiceKind} · Beleg #${i.id}`,
            staffName: sess?.staffId != null ? (staffMap.get(sess.staffId) ?? null) : null,
            amountCents: i.totalAmountCents,
          };
        }),
        ...full.formulas.map((f) => ({
          id: `f-${f.id}`,
          ts: toTs(f.createdAt),
          kind: "formula" as const,
          title: "Rezeptur",
          subtitle: f.formulaText,
          staffName: staffMap.get(f.staffId) ?? null,
        })),
        ...full.notes.map((n) => ({
          id: `n-${n.id}`,
          ts: toTs(n.createdAt),
          kind: "note" as const,
          title: "Notiz",
          subtitle: n.noteText,
          staffName: staffMap.get(n.staffId) ?? null,
        })),
      ].sort((a, b) => b.ts - a.ts);

      const totalSpendCents = full.lastClosedInvoices.reduce(
        (sum, inv) => sum + Number(inv.totalAmountCents ?? 0),
        0,
      );
      const patchMs = full.client.patchTestAt != null ? toTs(full.client.patchTestAt) : null;
      const patchTestWarning =
        patchMs == null || patchMs <= 0 || Date.now() - patchMs > PATCH_TEST_MAX_AGE_MS;
      const lb = computeLoyaltyBadge(
        completedVisitCount,
        totalSpendCents,
        full.loyalty,
      );
      setData({
        client: full.client,
        formulas: full.formulas,
        notes: full.notes,
        invoices: full.lastClosedInvoices,
        loyalty: full.loyalty,
        reliabilityScore,
        noShowFlag: noShows + cancels >= 3,
        totalSpendCents,
        openDebtCents: Number(full.openDebtCents ?? 0),
        completedVisitCount,
        loyaltyBadgeLabel: lb.label,
        loyaltyBadgeDetail: lb.detail,
        patchTestWarning,
        timeline,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "client_360_load_failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void refresh();
  }, [clientId, refresh]);

  return useMemo(
    () => ({ data, loading, error, refresh }),
    [data, loading, error, refresh],
  );
}

export const CLIENT_360_TIMEZONE = BERLIN;

