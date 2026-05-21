import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../api";
import { luxuryButtonPrimary, luxuryButtonGhost, luxuryGlassPanel } from "../lib/luxuryUi";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function TouchStep({
  label,
  valueEur,
  onChangeEur,
  min,
  max,
  step,
}: {
  label: string;
  valueEur: number;
  onChangeEur: (n: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/40">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-deep-charcoal/14 bg-transparent text-2xl font-light text-deep-charcoal backdrop-blur-md transition hover:border-editorial-pulse hover:text-editorial-pulse"
          aria-label={`${label} verringern`}
          onClick={() => onChangeEur(clamp(valueEur - step, min, max))}
        >
          −
        </button>
        <div className="min-w-[5.5rem] rounded-2xl border border-deep-charcoal/10 bg-gray-100/50 px-4 py-3 text-center font-mono text-2xl font-light tabular-nums text-deep-charcoal backdrop-blur-xl">
          {valueEur}
        </div>
        <button
          type="button"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-deep-charcoal/14 bg-transparent text-2xl font-light text-deep-charcoal backdrop-blur-md transition hover:border-editorial-pulse hover:text-editorial-pulse"
          aria-label={`${label} erhöhen`}
          onClick={() => onChangeEur(clamp(valueEur + step, min, max))}
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * 34 — Kostenvoranschlag: glass layout, touch +/- statt Mini-Webfelder, kein Neon-Grün.
 */
export function Estimate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionFromUrl = Number(params.get("session") ?? "0");
  const [sessionId, setSessionId] = useState(() => (sessionFromUrl > 0 ? sessionFromUrl : 0));
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  const [approved, setApproved] = useState(false);
  const [msg, setMsg] = useState("");
  const [minEur, setMinEur] = useState(120);
  const [maxEur, setMaxEur] = useState(140);

  const load = useCallback((id: number) => {
    if (!id) return;
    void apiGet<{ range: { min: number; max: number } | null; approved: boolean }>(
      `/api/sessions/${id}/estimate`,
    )
      .then((d) => {
        setRange(d.range);
        setApproved(d.approved);
        if (d.range) {
          setMinEur(Math.round(d.range.min / 100));
          setMaxEur(Math.round(d.range.max / 100));
        }
      })
      .catch((e) => setMsg(String(e)));
  }, []);

  useEffect(() => {
    if (sessionFromUrl > 0) {
      setSessionId(sessionFromUrl);
    }
  }, [sessionFromUrl]);

  useEffect(() => {
    if (sessionId) load(sessionId);
  }, [sessionId, load]);

  useEffect(() => {
    if (minEur > maxEur) setMaxEur(minEur);
  }, [minEur, maxEur]);

  const createSession = () => {
    void apiPost<{ id: number }>("/api/sessions", {})
      .then((s) => {
        setSessionId(s.id);
        setMsg("");
        navigate(`/mirror?session=${s.id}`);
      })
      .catch((e) => setMsg(String(e)));
  };

  const saveEstimate = () => {
    const min = Math.round(minEur * 100);
    const max = Math.round(maxEur * 100);
    void apiPatch(`/api/sessions/${sessionId}/estimate`, {
      estimatedMinPriceCents: min,
      estimatedMaxPriceCents: max,
      consultationStatus: "shown_to_client",
    })
      .then(() => load(sessionId))
      .catch((e) => setMsg(String(e)));
  };

  const approve = () => {
    void apiPatch(`/api/sessions/${sessionId}/estimate`, { markApproved: true })
      .then(() => load(sessionId))
      .catch((e) => setMsg(String(e)));
  };

  const bumpSession = (delta: number) => {
    setSessionId((prev) => clamp(prev + delta, 0, 99_999_999));
  };

  return (
    <div className="flex min-h-[min(100dvh,56rem)] flex-col items-center justify-center px-4 py-10 sm:px-8">
      <div className={`w-full max-w-2xl overflow-visible p-8 md:p-10 ${luxuryGlassPanel}`}>
        <p className="text-center text-sm text-deep-charcoal/45 no-print">
          {sessionId > 0 ? (
            <Link to={`/mirror?session=${sessionId}`} className="font-semibold text-champagne-gold/90 no-underline hover:text-champagne-gold">
              ← Spiegelkarte (diese Session)
            </Link>
          ) : (
            <Link to="/walk-in" className="font-semibold text-champagne-gold/90 no-underline hover:text-champagne-gold">
              ← Walk-in / Session zuerst öffnen
            </Link>
          )}
        </p>

        <h2 className="mt-6 text-center font-editorial-display text-4xl font-normal uppercase tracking-[0.14em] text-deep-charcoal md:text-5xl">
          Für Sie (Kostenvoranschlag)
        </h2>
        <p className="mt-6 text-center font-mono text-5xl font-light tabular-nums tracking-tight text-editorial-pulse md:text-6xl">
          {range ? `${(range.min / 100).toFixed(0)} – ${(range.max / 100).toFixed(0)} €` : "—"}
        </p>
        <p className={`mt-4 text-center text-lg font-light uppercase tracking-[0.16em] ${approved ? "text-editorial-pulse/90" : "text-deep-charcoal/50"}`}>
          {approved ? "Bestätigt — Dankeschön" : "Bitte Preisrahmen prüfen"}
        </p>

        <div className="mx-auto mt-10 max-w-md border-t border-deep-charcoal/10 pt-10">
          <p className="text-center text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">Session-ID</p>
          <div className="mt-4 flex items-center justify-center gap-4">
            <button
              type="button"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-deep-charcoal/14 bg-transparent text-2xl font-light text-deep-charcoal backdrop-blur-md transition hover:border-editorial-pulse hover:text-editorial-pulse"
              aria-label="Session-ID verringern"
              onClick={() => bumpSession(-1)}
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={sessionId || ""}
              onChange={(e) => setSessionId(Math.max(0, Math.floor(Number(e.target.value))))}
              className="luxury-field mx-auto block w-full max-w-[12rem] rounded-2xl border border-deep-charcoal/12 bg-gray-100/50 px-4 py-4 text-center font-mono text-2xl font-light tabular-nums text-deep-charcoal backdrop-blur-xl"
              aria-label="Session-ID"
            />
            <button
              type="button"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-deep-charcoal/14 bg-transparent text-2xl font-light text-deep-charcoal backdrop-blur-md transition hover:border-editorial-pulse hover:text-editorial-pulse"
              aria-label="Session-ID erhöhen"
              onClick={() => bumpSession(1)}
            >
              +
            </button>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            <button type="button" onClick={createSession} className={`${luxuryButtonGhost} min-h-[56px] px-6`}>
              Neue Session
            </button>
            <button
              type="button"
              disabled={sessionId < 1}
              onClick={() => load(sessionId)}
              className={`${luxuryButtonPrimary} min-h-[56px] px-8 disabled:opacity-40`}
            >
              Laden
            </button>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-10 border-t border-deep-charcoal/10 pt-10 sm:grid-cols-2">
          <TouchStep label="Min (€)" valueEur={minEur} onChangeEur={setMinEur} min={0} max={maxEur} step={5} />
          <TouchStep label="Max (€)" valueEur={maxEur} onChangeEur={setMaxEur} min={minEur} max={5000} step={5} />
        </div>
        <p className="mt-6 text-center text-sm text-deep-charcoal/40">Stylist-Modus — Schritt 5 € (anpassbar im Code).</p>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-center">
          <button type="button" onClick={saveEstimate} className={`${luxuryButtonPrimary} min-h-[56px] flex-1 sm:max-w-md`}>
            Kunden-Display aktualisieren
          </button>
        </div>

        <div className="mt-12">
          <button
            type="button"
            disabled={approved || sessionId < 1}
            onClick={approve}
            className={`w-full min-h-[64px] ${luxuryButtonPrimary} disabled:opacity-45`}
          >
            {approved ? "Bereits bestätigt" : "Ich stimme dem Rahmen zu"}
          </button>
        </div>

        {msg ? (
          <p className="mt-8 rounded-xl border border-red-400/60 bg-red-50/60 px-4 py-3 text-center text-sm text-red-600/90" role="alert">
            {msg}
          </p>
        ) : null}
      </div>
    </div>
  );
}
