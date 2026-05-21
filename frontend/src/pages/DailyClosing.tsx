import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDailyClosing } from "../hooks/useDailyClosing";
import { formatEurDeFromCents } from "../lib/formatMoney";
import { useAuthStore } from "../store/authStore";
import { apiPost } from "../api";
import { cancelOpenSession } from "../lib/sessionCancelApi";
/**
 * Step 37 — Blind Kassensturz: Ist zuerst, Soll erst nach Zählen (Revisionssicherheit).
 */
export function DailyClosing() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const rehydrate = useAuthStore((s) => s.rehydrate);

  const {
    phase,
    openSessions,
    blockedByOpenSessions,
    loadErr,
    refreshValidation,
    startBlindCount,
    actualCashCents,
    appendDigit,
    backspaceMoney,
    clearMoney,
    append00,
    cancelBlindCount,
    revealExpectedAndGoReview,
    expectedCashCents,
    differenceCents,
    differenceReason,
    setDifferenceReason,
    submitClosing,
    busy,
    phaseErr,
    closingRow,
  } = useDailyClosing();

  useEffect(() => {
    if (phase !== "DONE") return;
    const t = window.setTimeout(() => {
      logout();
      rehydrate();
      navigate("/login", { replace: true });
    }, 5000);
    return () => window.clearTimeout(t);
  }, [phase, logout, rehydrate, navigate]);

  const finishAndLogout = () => {
    logout();
    rehydrate();
    navigate("/login", { replace: true });
  };

  const [printBusy, setPrintBusy] = useState(false);
  const [printMsg, setPrintMsg] = useState("");
  const [abortingSessionId, setAbortingSessionId] = useState<number | null>(null);

  const abortSessionFromClosing = async (sessionId: number) => {
    const ok = window.confirm(
      `Session #${sessionId} wirklich abbrechen? Kein Kassenbeleg — nur für hängengebliebene Sitzungen.`,
    );
    if (!ok) return;
    setAbortingSessionId(sessionId);
    try {
      await cancelOpenSession(sessionId);
      await refreshValidation();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setAbortingSessionId(null);
    }
  };

  const printZReport = async () => {
    const closeId = Number(closingRow?.id);
    if (!Number.isFinite(closeId) || closeId < 1) return;
    setPrintBusy(true);
    setPrintMsg("");
    try {
      await apiPost(`/api/hardware/print/daily-close/${closeId}`, {});
      setPrintMsg("Z-Bericht wurde an die Druckwarteschlange gesendet.");
    } catch (e) {
      setPrintMsg(e instanceof Error ? e.message : "z_report_print_failed");
    } finally {
      setPrintBusy(false);
    }
  };

  const diffNegative = differenceCents != null && differenceCents < 0;
  const diffZero = differenceCents === 0;

  const numpadKeyClass =
    "min-h-[80px] min-w-0 border border-deep-charcoal/10 bg-gray-100/40 text-4xl font-light tracking-[0.1em] text-deep-charcoal shadow-none active:border-editorial-pulse active:text-editorial-pulse disabled:opacity-50";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 print:bg-white print:text-black">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <h1 className="font-editorial-display text-5xl font-normal uppercase tracking-[0.14em] text-deep-charcoal">
            Tagesabschluss
          </h1>
          <p className="mt-3 text-xs font-light uppercase tracking-[0.26em] text-deep-charcoal/45">
            Kassensturz — blind: erst Ist zählen, dann Soll‑Anzeige (Soll‑Bestand / Ist‑Bestand).
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex min-h-touch min-w-touch items-center justify-center border border-deep-charcoal/15 px-5 text-[11px] font-light uppercase tracking-[0.3em] text-deep-charcoal/70 no-underline hover:border-editorial-pulse hover:text-editorial-pulse"
        >
          ← Dashboard
        </Link>
      </div>

      {loadErr && (
        <div className="mb-4 border border-[#7f1d1d]/50 bg-red-50/60 px-4 py-3 text-sm text-[#f87171]/85">
          {loadErr}
        </div>
      )}

      {/* Phase 1 */}
      {phase === "VALIDATING" && (
        <section className="space-y-6">
          <div className="border border-deep-charcoal/10 bg-gray-100/40 p-6">
            <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.14em] text-deep-charcoal">
              Phase 1 — Freigabe
            </h2>
            <p className="mt-4 text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
              Offene Sessions müssen geschlossen sein, bevor der Kassensturz startet.
            </p>
            {blockedByOpenSessions ? (
              <div
                className="relative mt-6 overflow-hidden border border-red-400/45 bg-red-50/55 px-6 py-8 text-center backdrop-blur-xl"
                role="alert"
              >
                <div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-900/30 via-red-950/10 to-red-900/25 motion-safe:animate-pulse"
                  aria-hidden
                />
                <div className="relative">
                  <p className="font-editorial-display text-4xl font-normal uppercase tracking-[0.16em] text-[#f87171]/92">
                    Gesperrt
                  </p>
                  <p className="mt-4 text-sm font-light uppercase tracking-[0.2em] text-[#fecaca]/90">
                    {openSessions.length} offene Session(s) — bitte zuerst an der Kasse abschließen.
                  </p>
                  <ul className="mt-5 space-y-3 border border-[#7f1d1d]/30 bg-[#1b0c10]/45 px-4 py-4 text-left text-sm text-[#fecaca]/90 backdrop-blur-sm">
                    {openSessions.map((s) => (
                      <li
                        key={s.id}
                        className="flex flex-col gap-3 border border-[#7f1d1d]/30 bg-[#1b0c10]/55 p-4 font-mono sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span>
                          Session #{s.id} · Staff {s.staffId} · seit{" "}
                          {new Date(s.createdAt).toLocaleString("de-DE")}
                        </span>
                        <button
                          type="button"
                          disabled={abortingSessionId === s.id}
                          className="inline-flex min-h-[48px] shrink-0 items-center justify-center border border-[#f87171]/55 bg-transparent px-4 text-[11px] font-light uppercase tracking-[0.22em] text-red-600/90 backdrop-blur-md hover:bg-[#7f1d1d]/15 disabled:opacity-50"
                          onClick={() => void abortSessionFromClosing(s.id)}
                        >
                          {abortingSessionId === s.id ? "…" : "Session abbrechen"}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/"
                    className="mt-8 inline-flex min-h-touch min-w-touch items-center justify-center border border-editorial-pulse bg-transparent px-8 text-[11px] font-light uppercase tracking-[0.32em] text-editorial-pulse no-underline backdrop-blur-sm transition hover:bg-[var(--editorial-pulse-dim)]"
                  >
                    Zurück zum Dashboard — Sessions schließen
                  </Link>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-lg font-semibold text-deep-charcoal/95">
                Keine offenen Sessions. Sie können mit dem blinden Zählen beginnen.
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                className="min-h-touch flex-1 border border-deep-charcoal/15 bg-transparent px-4 text-[11px] font-light uppercase tracking-[0.28em] text-deep-charcoal/78"
                onClick={() => void refreshValidation()}
              >
                Aktualisieren
              </button>
              <button
                type="button"
                disabled={blockedByOpenSessions}
                className="min-h-touch flex-[2] border border-editorial-pulse bg-transparent px-6 text-[11px] font-light uppercase tracking-[0.34em] text-editorial-pulse disabled:cursor-not-allowed disabled:opacity-40"
                onClick={startBlindCount}
              >
                Zählung starten
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Phase 2 — blind */}
      {phase === "COUNTING" && (
        <section className="fixed inset-0 z-[360] flex flex-col bg-gray-100 p-4 print:hidden">
          <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
            <p className="text-center text-lg font-bold font-heading text-deep-charcoal">
              Zählen Sie das Bargeld im Gehäuse
            </p>
            <p className="mt-2 text-center text-sm text-brushed-chrome">
              Der Soll‑Bestand wird erst nach „Weiter“ angezeigt — bitte ehrlich den Ist‑Bestand
              eingeben.
            </p>
            <div
              className="my-8 border border-deep-charcoal/12 bg-gray-100/60 py-8 text-center font-mono text-5xl font-light tabular-nums text-deep-charcoal"
              aria-live="polite"
            >
              {formatEurDeFromCents(actualCashCents)}
            </div>
            <div className="grid flex-1 grid-cols-3 gap-3">
              {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={busy}
                  className={numpadKeyClass}
                  onClick={() => appendDigit(Number(k))}
                >
                  {k}
                </button>
              ))}
              <button
                type="button"
                disabled={busy}
                className={`${numpadKeyClass} text-2xl`}
                onClick={clearMoney}
              >
                C
              </button>
              <button
                type="button"
                disabled={busy}
                className={numpadKeyClass}
                onClick={() => appendDigit(0)}
              >
                0
              </button>
              <button
                type="button"
                disabled={busy}
                className={`${numpadKeyClass} text-2xl`}
                onClick={append00}
              >
                00
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                className="min-h-touch border border-deep-charcoal/15 py-3 text-[11px] font-light uppercase tracking-[0.24em] text-deep-charcoal disabled:opacity-50"
                onClick={backspaceMoney}
              >
                ⌫ Korrektur
              </button>
              <button
                type="button"
                disabled={busy}
                className="min-h-touch border border-deep-charcoal/15 py-3 text-[11px] font-light uppercase tracking-[0.24em] text-deep-charcoal disabled:opacity-50"
                onClick={cancelBlindCount}
              >
                Abbrechen
              </button>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-3">
              <button
                type="button"
                disabled={busy}
                className="min-h-touch border border-editorial-pulse bg-transparent py-3 text-[11px] font-light uppercase tracking-[0.34em] text-editorial-pulse disabled:opacity-50"
                onClick={() => void revealExpectedAndGoReview()}
              >
                {busy ? "…" : "Weiter"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Phase 3 */}
      {(phase === "REVIEWING" || phase === "SUBMITTING") && (
        <section className="space-y-6">
          <div className="border border-deep-charcoal/10 bg-gray-100/40 p-6">
            <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.14em] text-deep-charcoal">
              Phase 3 — Abgleich
            </h2>
            <p className="mt-3 text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
              Erst jetzt wird der Soll‑Bestand aus dem System angezeigt.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="border border-deep-charcoal/10 bg-gray-100/40 p-4">
                <p className="text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
                  Soll (System)
                </p>
                <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-deep-charcoal">
                  {expectedCashCents != null ? formatEurDeFromCents(expectedCashCents) : "—"}
                </p>
              </div>
              <div className="border border-deep-charcoal/10 bg-gray-100/40 p-4">
                <p className="text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
                  Ist (gezählt)
                </p>
                <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-deep-charcoal">
                  {formatEurDeFromCents(actualCashCents)}
                </p>
              </div>
              <div
                className={`border p-4 ${
                  diffZero
                    ? "border-deep-charcoal/12 bg-gray-100/40"
                    : diffNegative
                      ? "border-red-400/55 bg-red-50/55"
                      : "border-editorial-pulse bg-[var(--editorial-pulse-dim)]/35"
                }`}
              >
                <p className="text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
                  Differenz
                </p>
                <p
                  className={`mt-2 font-mono text-3xl font-black tabular-nums ${
                    diffZero
                      ? "text-deep-charcoal"
                      : diffNegative
                        ? "text-[#f87171]/92"
                        : "text-editorial-pulse"
                  }`}
                >
                  {differenceCents != null ? formatEurDeFromCents(differenceCents) : "—"}
                </p>
              </div>
            </div>

            {!diffZero && (
              <label className="mt-8 block">
                <span className="mb-2 block text-sm font-light uppercase tracking-[0.24em] text-deep-charcoal">
                  Grund für Differenz <span className="text-[#f87171]">*</span>
                </span>
                <textarea
                  className="min-h-[140px] w-full border-b border-deep-charcoal/18 bg-transparent p-4 text-base font-light text-deep-charcoal outline-none"
                  value={differenceReason}
                  onChange={(e) => setDifferenceReason(e.target.value)}
                  placeholder="Pflichtfeld bei jeder Abweichung — z. B. Rundungsfehler, Fehlwechsel, Zählfehler …"
                  required
                />
              </label>
            )}

            {phaseErr && (
              <p className="mt-4 border border-[#7f1d1d]/50 bg-red-50/60 px-3 py-2 text-[#f87171]/85">
                {phaseErr === "difference_reason_required"
                  ? "Grund für Differenz ist Pflicht (GoBD)."
                  : phaseErr}
              </p>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={phase === "SUBMITTING"}
                className="min-h-touch border border-deep-charcoal/15 px-6 text-[11px] font-light uppercase tracking-[0.24em] text-deep-charcoal disabled:opacity-50"
                onClick={() => window.location.reload()}
              >
                Neu beginnen
              </button>
              <button
                type="button"
                disabled={phase === "SUBMITTING"}
                className="min-h-touch flex-1 border border-editorial-pulse bg-transparent px-6 text-[11px] font-light uppercase tracking-[0.32em] text-editorial-pulse disabled:opacity-50"
                onClick={() => void submitClosing()}
              >
                {phase === "SUBMITTING" ? "Speichern …" : "Tagesabschluss buchen"}
              </button>
            </div>
          </div>
        </section>
      )}

      {phase === "SUBMITTING" && (
        <div className="fixed inset-0 z-[365] flex items-center justify-center bg-gray-400/70 backdrop-blur-[20px] print:hidden">
          <p className="text-2xl font-bold text-deep-charcoal">Abschluss läuft …</p>
        </div>
      )}

      {/* Done */}
      {phase === "DONE" && closingRow && (
        <section className="border border-deep-charcoal/12 bg-gray-100/40 p-8 text-center print:border-brushed-chrome print:bg-white">
          <h2 className="font-editorial-display text-5xl font-normal uppercase tracking-[0.14em] text-deep-charcoal print:text-black">
            Tagesabschluss erfolgreich
          </h2>
          <p className="mt-6 text-sm font-light uppercase tracking-[0.22em] text-deep-charcoal/45 print:text-black">
            Buchung #{String(closingRow.id ?? "")} — Bewahrung für Datev / Steuerberater.
          </p>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-center">
            <button
              type="button"
              className="min-h-touch border border-deep-charcoal/15 bg-transparent px-8 text-[11px] font-light uppercase tracking-[0.3em] text-deep-charcoal print:hidden disabled:opacity-50"
              disabled={printBusy}
              onClick={() => void printZReport()}
            >
              {printBusy ? "Drucke…" : "Z‑Bericht drucken"}
            </button>
            <button
              type="button"
              className="min-h-touch border border-editorial-pulse bg-transparent px-8 text-[11px] font-light uppercase tracking-[0.34em] text-editorial-pulse print:hidden"
              onClick={finishAndLogout}
            >
              Fertig — Abmelden
            </button>
          </div>
          <p className="mt-6 text-sm text-brushed-chrome print:hidden">
            Automatische Abmeldung in 5 Sekunden (Station für den nächsten Tag sichern).
          </p>
          {printMsg && <p className="mt-2 text-sm text-brushed-chrome print:hidden">{printMsg}</p>}
        </section>
      )}
    </div>
  );
}
