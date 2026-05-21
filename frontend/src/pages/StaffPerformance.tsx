import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api";
import { formatEurDeFromCents } from "../lib/formatMoney";
import { formatInTimeZone } from "date-fns-tz";
import { startOfMonth } from "date-fns";
import { BERLIN } from "../lib/formatTime";
import { LuxuryDatePicker } from "../components/ui/LuxuryDatePicker";

type MyPerformance = {
  displayName: string;
  fromYmd: string;
  toYmd: string;
  commissionServiceBps: number;
  commissionRetailBps: number;
  umsatzBruttoOhneTrinkgeldCents: number;
  provisionCents: number;
  trinkgeldCents: number;
  belegeMitAnteil: number;
};

/**
 * Nur eigene Zahlen — kein Salon-Gesamtumsatz (RBAC Backend).
 */
export function StaffPerformance() {
  const [data, setData] = useState<MyPerformance | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const defaultFrom = useMemo(
    () => formatInTimeZone(startOfMonth(new Date()), BERLIN, "yyyy-MM-dd"),
    [],
  );
  const defaultTo = useMemo(
    () => formatInTimeZone(new Date(), BERLIN, "yyyy-MM-dd"),
    [],
  );
  const [fromYmd, setFromYmd] = useState(defaultFrom);
  const [toYmd, setToYmd] = useState(defaultTo);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const q = `/api/reports/my-performance?from=${encodeURIComponent(fromYmd)}&to=${encodeURIComponent(toYmd)}`;
      const j = await apiGet<MyPerformance>(q);
      setData(j);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [fromYmd, toYmd]);

  useEffect(() => {
    void load();
  }, [load]);

  const pct = (bps: number) => `${(bps / 100).toFixed(1).replace(".", ",")} %`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 text-deep-charcoal">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-editorial-display text-5xl font-normal uppercase tracking-[0.14em]">Meine Performance</h1>
          <p className="mt-3 text-xs font-light uppercase tracking-[0.28em] text-deep-charcoal/45">
            Nur deine Daten: Umsatz (ohne Trinkgeld), Provision, Trinkgeld — Period wählbar
            (Europe/Berlin).
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex min-h-touch items-center justify-center border border-deep-charcoal/15 px-5 text-[11px] font-light uppercase tracking-[0.3em] text-deep-charcoal/70 no-underline hover:border-editorial-pulse hover:text-editorial-pulse"
        >
          ← Start
        </Link>
      </div>

      <div className="mb-8 flex flex-wrap items-end gap-6">
        <div className="min-w-[min(100%,18rem)]">
          <LuxuryDatePicker label="Von" value={fromYmd} onChange={setFromYmd} yearSpan={{ before: 5, after: 1 }} />
        </div>
        <div className="min-w-[min(100%,18rem)]">
          <LuxuryDatePicker label="Bis" value={toYmd} onChange={setToYmd} yearSpan={{ before: 5, after: 1 }} />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="min-h-touch self-end border border-editorial-pulse bg-transparent px-8 text-[11px] font-light uppercase tracking-[0.32em] text-editorial-pulse disabled:opacity-50"
        >
          Laden
        </button>
      </div>

      {loading && (
        <p className="text-brushed-chrome" aria-live="polite">
          Lade Daten…
        </p>
      )}
      {err && <div className="mb-4 border border-[#7f1d1d]/50 bg-red-50/60 px-4 py-3 text-sm text-[#f87171]/85">{err}</div>}
      {data && !loading && (
        <>
          <p className="mb-8 text-sm font-light uppercase tracking-[0.22em] text-deep-charcoal/45">
            Hallo <strong className="text-deep-charcoal">{data.displayName}</strong>
            · {data.fromYmd} — {data.toYmd}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="border border-deep-charcoal/10 bg-gray-100/40 p-5">
              <h2 className="font-editorial-display text-lg font-normal uppercase tracking-[0.18em] text-deep-charcoal/68">
                Dein Verkauf
              </h2>
              <p className="mt-3 font-mono text-2xl font-bold tabular-nums">
                {formatEurDeFromCents(data.umsatzBruttoOhneTrinkgeldCents)}{" "}
                <span className="text-xs font-light uppercase tracking-[0.22em] text-deep-charcoal/42">brutto ohne TG</span>
              </p>
              <p className="mt-3 text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/40">
                {data.belegeMitAnteil} Beleg(e) als Verkaufssitzung (Kasse/Zeilen)
              </p>
            </section>

            <section className="border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/40 p-5">
              <h2 className="font-editorial-display text-lg font-normal uppercase tracking-[0.18em] text-editorial-pulse">
                Provision (Schätzung)
              </h2>
              <p className="mt-2 text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
                Leistung {pct(data.commissionServiceBps)} · Ware {pct(data.commissionRetailBps)} auf Zeilen-Netto,
                eingestellt im System.
              </p>
              <p className="mt-4 font-mono text-2xl font-bold tabular-nums text-editorial-pulse">
                {formatEurDeFromCents(data.provisionCents)}
              </p>
            </section>

            <section className="border border-deep-charcoal/10 bg-gray-100/40 p-5 sm:col-span-2">
              <h2 className="font-editorial-display text-lg font-normal uppercase tracking-[0.18em] text-deep-charcoal/68">
                Trinkgeld (auf dich gebucht)
              </h2>
              <p className="mt-2 text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/44">
                Getrennt vom Salon-Umsatz (KassenSichV-Rechnungen); Auszahlung laut interner Regel.
              </p>
              <p className="mt-3 font-mono text-3xl font-bold tabular-nums">
                {formatEurDeFromCents(data.trinkgeldCents)}
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
