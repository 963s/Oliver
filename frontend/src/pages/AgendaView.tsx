import { useCallback, useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../api";
import { BERLIN, formatBerlinTimeHHmm } from "../lib/formatTime";
import {
  isPrematureCheckIn,
  useDayAppointments,
  type TodayAppointmentRow,
} from "../hooks/useTodayAppointments";
import { AgendaGrid } from "./AgendaGrid";
import { LuxuryDatePicker } from "../components/ui/LuxuryDatePicker";
import { useClient360Store } from "../store/client360Store";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import {
  Client360Panel,
  Client360EmptyState,
  Client360SlotState,
} from "../components/agenda/Client360Panel";

// ContextPanel replaced by Client360Panel component

/**
 * Agenda — 3-column desktop layout: grid (center) + context panel (right).
 */
export function AgendaView() {
  const { fiscalActive } = useFeatureFlags();
  const navigate = useNavigate();
  const todayYmd = formatInTimeZone(new Date(), BERLIN, "yyyy-MM-dd");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [gridDate, setGridDate] = useState(todayYmd);
  const effectiveYmd = view === "grid" ? gridDate : todayYmd;
  const { items, revalidating, error, refetch } = useDayAppointments(effectiveYmd);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [confirmEarly, setConfirmEarly] = useState<TodayAppointmentRow | null>(null);

  // Context panel state — driven by agenda clicks
  const [selectedApt, setSelectedApt] = useState<TodayAppointmentRow | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{
    staffId: number;
    slotIndex: number;
    label: string;
  } | null>(null);

  const [staffMap, setStaffMap] = useState<Map<number, string>>(new Map());

  // Build staff map from items
  const staffById = (() => {
    if (staffMap.size > 0) return staffMap;
    const m = new Map<number, string>();
    for (const a of items ?? []) {
      if (!m.has(a.staffId)) m.set(a.staffId, `Staff #${a.staffId}`);
    }
    return m;
  })();

  // Fetch staff names
  useEffect(() => {
    void apiGet<{ id: number; displayName: string }[]>("/api/staff").then((rows) => {
      const m = new Map(rows.map((r) => [r.id, r.displayName]));
      setStaffMap(m);
    }).catch(() => {});
  }, []);

  const handleAppointmentSelect = useCallback((apt: TodayAppointmentRow) => {
    setSelectedApt(apt);
    setSelectedSlot(null);
  }, []);

  const runCheckIn = (a: TodayAppointmentRow) => {
    setBusyId(a.id);
    setMsg("");
    void apiPost<{ session: { id: number }; idempotent?: boolean }>(
      `/api/appointments/${a.id}/check-in`,
      {},
    )
      .then(() => {
        setConfirmEarly(null);
        navigate("/", { replace: true });
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : "check-in fehlgeschlagen"))
      .finally(() => setBusyId(null));
  };

  const requestCheckIn = (a: TodayAppointmentRow) => {
    if (a.status !== "booked") return;
    if (isPrematureCheckIn(a.startAt)) {
      setConfirmEarly(a);
      return;
    }
    runCheckIn(a);
  };

  const cancelApt = (id: number) => {
    if (!window.confirm("Termin wirklich absagen? (Status: abgesagt)")) return;
    setBusyId(id);
    setMsg("");
    void apiPatch<{ id: number }>(`/api/appointments/${id}/status`, { status: "canceled" })
      .then(() => {
        void refetch();
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : "absage fehlgeschlagen"))
      .finally(() => setBusyId(null));
  };

  const noShowApt = (id: number) => {
    if (!window.confirm("Als nicht erschienen markieren?")) return;
    setBusyId(id);
    setMsg("");
    void apiPost(`/api/appointments/${id}/no-show`, {})
      .then(() => {
        void refetch();
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : "no-show fehlgeschlagen"))
      .finally(() => setBusyId(null));
  };

  const openSession = (a: TodayAppointmentRow) => {
    setBusyId(a.id);
    setMsg("");
    void apiPost<{ session: { id: number } }>(`/api/appointments/${a.id}/check-in`, {})
      .then((r) => {
        navigate(`/mirror?session=${r.session.id}`);
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : "Session nicht erreichbar"))
      .finally(() => setBusyId(null));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Toolbar ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-deep-charcoal/[0.06] bg-white/60 px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-xl uppercase tracking-wider text-deep-charcoal/90">Agenda</h1>
          <div className="flex border border-deep-charcoal/10 bg-gray-200/60 p-0.5">
            <button
              type="button"
              className={`inline-flex h-7 items-center px-3 text-[10px] font-light uppercase tracking-[0.15em] ${
                view === "grid"
                  ? "border border-editorial-pulse bg-editorial-pulse/10 text-editorial-pulse"
                  : "text-deep-charcoal/40 hover:text-deep-charcoal/60"
              }`}
              onClick={() => setView("grid")}
            >
              Raster
            </button>
            <button
              type="button"
              className={`inline-flex h-7 items-center px-3 text-[10px] font-light uppercase tracking-[0.15em] ${
                view === "list"
                  ? "border border-editorial-pulse bg-editorial-pulse/10 text-editorial-pulse"
                  : "text-deep-charcoal/40 hover:text-deep-charcoal/60"
              }`}
              onClick={() => setView("list")}
            >
              Liste
            </button>
          </div>
          {view === "grid" && (
            <div className="w-72">
              <LuxuryDatePicker
                label=""
                value={gridDate}
                onChange={setGridDate}
                yearSpan={{ before: 1, after: 2 }}
              />
            </div>
          )}
          {revalidating && items != null && (
            <span className="text-xs text-editorial-pulse" title="Aktualisiere">
              ●
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-xs font-medium uppercase tracking-wider text-deep-charcoal/60 hover:text-deep-charcoal"
          >
            ← Live
          </Link>
          <Link
            to="/bookings"
            className="editorial-pulse-fill px-4 py-2 text-xs font-semibold uppercase tracking-wider transition hover:opacity-90"
          >
            + Neuer Termin
          </Link>
        </div>
      </div>

      {error && view === "grid" && (
        <div className="border-b border-red-900/40 bg-red-950/30 px-4 py-1.5 text-xs text-red-300" role="alert">
          {error}
        </div>
      )}
      {msg && (
        <div className="border-b border-editorial-pulse/30 bg-editorial-pulse/5 px-4 py-1.5 text-xs text-editorial-pulse">
          {msg}
        </div>
      )}

      {/* ── Grid view: fluid 2-col with context panel ── */}
      {view === "grid" && (
        <div className="flex min-h-0 flex-1">
          {/* Agenda grid — flexes to fill all available space */}
          <div className="min-w-0 flex-1 overflow-auto p-3 lg:p-4">
            <AgendaGrid
              dateYmd={gridDate}
              appointments={items}
              appointmentsError={error}
              onAppointmentsChange={() => void refetch()}
              onAppointmentClientOpen={(clientId) => {
                useClient360Store.getState().openProfile(clientId);
              }}
              onAppointmentSelect={handleAppointmentSelect}
            />
          </div>

          {/* Client Brain right column — fluid width */}
          <aside className="hidden w-[340px] shrink-0 flex-col border-l border-deep-charcoal/[0.06] bg-gray-100/80 lg:flex xl:w-[380px] 2xl:w-[420px]">
            <div className="shrink-0 border-b border-deep-charcoal/[0.06] px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-deep-charcoal/55">
                Kundenakte
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!selectedApt && !selectedSlot && <Client360EmptyState />}
              {selectedSlot && !selectedApt && (
                <Client360SlotState
                  label={selectedSlot.label}
                  staffName={staffById.get(selectedSlot.staffId) ?? `#${selectedSlot.staffId}`}
                />
              )}
              {selectedApt && (
                <Client360Panel
                  appointment={selectedApt}
                  staffById={staffById}
                  fiscalActive={fiscalActive}
                  onSessionComplete={() => {
                    void refetch();
                    setSelectedApt(null);
                  }}
                  onOpenProfile={(cid) => useClient360Store.getState().openProfile(cid)}
                />
              )}
            </div>
          </aside>
        </div>
      )}

      {/* ── List view ── */}
      {view === "list" && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl">
            {error && (
              <div className="mb-3 border border-red-900/40 bg-red-950/30 px-4 py-2 text-xs text-red-300" role="alert">
                {error}
              </div>
            )}

            {items === null && !error && (
              <p className="py-12 text-center text-deep-charcoal/30" aria-live="polite">
                Lade …
              </p>
            )}

            {items !== null && items.length === 0 && (
              <p className="py-12 text-center text-deep-charcoal/30">
                {effectiveYmd === todayYmd
                  ? "Keine offenen Termine für heute."
                  : "Keine offenen Termine für diesen Tag."}
              </p>
            )}

            {items != null && items.length > 0 && (
              <ul className="space-y-2" aria-label="Terminliste">
                {items.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-4 border border-deep-charcoal/[0.06] bg-gray-100/40 p-3 transition hover:bg-gray-100/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-lg font-light tabular-nums text-editorial-pulse">
                        {formatBerlinTimeHHmm(a.startAt)}
                      </p>
                      <p className="text-sm text-deep-charcoal/80">{a.clientName}</p>
                      <p className="text-xs text-deep-charcoal/50">{a.serviceName}</p>
                      <p className="text-[10px] uppercase tracking-wider text-deep-charcoal/30">
                        {a.status}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      {a.status === "booked" && (
                        <>
                          <button
                            type="button"
                            className="h-8 border border-editorial-pulse bg-editorial-pulse/10 px-4 text-[10px] uppercase tracking-wider text-editorial-pulse transition hover:bg-editorial-pulse/20 disabled:opacity-50"
                            disabled={busyId != null}
                            onClick={() => requestCheckIn(a)}
                          >
                            {busyId === a.id ? "…" : "Check-in"}
                          </button>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="h-7 flex-1 border border-red-900/40 px-2 text-[9px] uppercase tracking-wider text-red-400 hover:bg-red-950/30"
                              disabled={busyId != null}
                              onClick={() => cancelApt(a.id)}
                            >
                              Absagen
                            </button>
                            <button
                              type="button"
                              className="h-7 flex-1 border border-deep-charcoal/10 px-2 text-[9px] uppercase tracking-wider text-deep-charcoal/50 hover:bg-gray-100/60"
                              disabled={busyId != null}
                              onClick={() => noShowApt(a.id)}
                            >
                              No-Show
                            </button>
                          </div>
                        </>
                      )}
                      {a.status === "checked_in" && (
                        <>
                          <p className="text-center text-[10px] uppercase tracking-wider text-editorial-pulse">
                            Eingecheckt
                          </p>
                          <button
                            type="button"
                            className="h-8 border border-editorial-pulse bg-editorial-pulse/10 px-4 text-[10px] uppercase tracking-wider text-editorial-pulse transition hover:bg-editorial-pulse/20 disabled:opacity-50"
                            disabled={busyId != null}
                            onClick={() => openSession(a)}
                          >
                            {busyId === a.id ? "…" : "Spiegel öffnen"}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Early check-in confirm dialog */}
      {confirmEarly && (
        <div
          className="fixed inset-0 z-[330] flex items-center justify-center bg-gray-400/70 p-4 "
          role="dialog"
          aria-modal="true"
          aria-labelledby="early-h1"
        >
          <div className="w-full max-w-md border border-deep-charcoal/10 bg-gray-100 p-5 text-deep-charcoal shadow-2xl">
            <h2 id="early-h1" className="font-heading text-xl uppercase tracking-wider text-editorial-pulse">
              Termin erst später
            </h2>
            <p className="mt-2 text-sm text-deep-charcoal/60">
              Einchecken? Der Termin ist um{" "}
              <strong className="text-deep-charcoal">{formatBerlinTimeHHmm(confirmEarly.startAt)}</strong> Uhr
              (Berlin) und liegt mehr als <strong className="text-deep-charcoal">1 Stunde</strong> in der
              Zukunft.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="h-8 flex-1 border border-deep-charcoal/10 text-[10px] uppercase tracking-wider text-deep-charcoal/50 hover:bg-gray-100/60"
                onClick={() => setConfirmEarly(null)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="h-8 flex-1 border border-editorial-pulse bg-editorial-pulse/10 text-[10px] uppercase tracking-wider text-editorial-pulse hover:bg-editorial-pulse/20"
                onClick={() => {
                  if (!confirmEarly) return;
                  runCheckIn(confirmEarly);
                }}
              >
                Trotzdem einchecken
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
