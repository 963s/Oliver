import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api";
import { formatEurDeFromCents } from "../lib/formatMoney";
import { formatInTimeZone } from "date-fns-tz";
import { startOfMonth } from "date-fns";
import { BERLIN } from "../lib/formatTime";
import { useAuthStore } from "../store/authStore";
import { isOwnerRole } from "../lib/staffRoles";
import { LuxuryDatePicker } from "../components/ui/LuxuryDatePicker";

type CockpitTotals = {
  bruttoInklTrinkgeldCents: number;
  trinkgeldGesamtCents: number;
  salonUmsatzBruttoCents: number;
  nettoCents: number;
  vat7Cents: number;
  vat19Cents: number;
  geschlosseneBelege: number;
};

type CockpitStaffRow = {
  staffId: number;
  displayName: string;
  umsatzBruttoOhneTrinkgeldCents: number;
  provisionCents: number;
  trinkgeldCents: number;
  geschlosseneBelegeAlsVerkaeufer: number;
};

type InventoryHeatRow = {
  inventoryItemId: number;
  name: string;
  onHandMl: number;
  minStockThresholdMl: number | null;
  verkaufteMl14d: number;
  geschwindigkeitMlProTag: number;
  deckungTageSchaetzung: number | null;
  nachbestellen: boolean;
};

type BusinessCockpit = {
  fromYmd: string;
  toYmd: string;
  commissionServiceBps: number;
  commissionRetailBps: number;
  totals: CockpitTotals;
  staff: CockpitStaffRow[];
  inventoryHeat: InventoryHeatRow[];
};

/**
 * Geschäfts-Cockpit — nur Inhaber (Backend `requireOwner`).
 */
export function AdminReports() {
  const staffRole = useAuthStore((s) => s.staffRole);
  const ownerOk = isOwnerRole(staffRole);

  const [data, setData] = useState<BusinessCockpit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    if (!ownerOk) return;
    setErr(null);
    setLoading(true);
    try {
      const q = `/api/reports/business-cockpit?from=${encodeURIComponent(fromYmd)}&to=${encodeURIComponent(toYmd)}`;
      const j = await apiGet<BusinessCockpit>(q);
      setData(j);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "forbidden_or_load_failed");
    } finally {
      setLoading(false);
    }
  }, [fromYmd, toYmd, ownerOk]);

  useEffect(() => {
    if (ownerOk) void load();
  }, [load, ownerOk]);

  const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(".", ",")} %`;

  if (!ownerOk) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center text-deep-charcoal">
          <h1 className="font-editorial-display text-4xl font-normal uppercase tracking-[0.14em]">Geschäfts-Cockpit</h1>
        <p className="mt-4 text-brushed-chrome">
          Zugriff verweigert. Nur der Inhaber darf Gesamtumsatz und Team-Provision einsehen.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex min-h-touch items-center justify-center border border-editorial-pulse px-8 text-[11px] font-light uppercase tracking-[0.24em] text-editorial-pulse no-underline"
        >
          Zurück
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 text-deep-charcoal">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-editorial-display text-5xl font-normal uppercase tracking-[0.14em]">Geschäfts-Cockpit</h1>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-brushed-chrome">
            Umsatz inkl./exkl. Trinkgeld, MwSt 7%/19%, Team Provision & Trinkgelder, Lager-Dynamik —
            Period Europe/Berlin.
          </p>
          <p className="mt-2 font-mono text-xs text-brushed-chrome">
            Provisionssätze: Leistung {data ? pct(data.commissionServiceBps) : "—"} · Ware{" "}
            {data ? pct(data.commissionRetailBps) : "—"} ({data?.commissionServiceBps ?? "… "} /{" "}
            {data?.commissionRetailBps ?? "…"} bps Admin).
          </p>
        </div>
        <Link
          to="/admin"
          className="inline-flex min-h-touch items-center justify-center border border-deep-charcoal/15 px-5 text-[11px] font-light uppercase tracking-[0.24em] text-deep-charcoal no-underline hover:border-editorial-pulse hover:text-editorial-pulse"
        >
          ← Chef-Ansicht
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
          className="min-h-touch self-end border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-10 text-[11px] font-light uppercase tracking-[0.24em] text-editorial-pulse disabled:opacity-50"
        >
          Auswerten
        </button>
      </div>

      {loading && <p className="text-brushed-chrome">Berechnung…</p>}
      {err && (
        <div className="mb-4 border border-red-400/60 bg-red-50/60 px-4 py-3 text-red-600/90">{err}</div>
      )}

      {data && !loading && (
        <div className="space-y-10">
          <div className="grid gap-4 md:grid-cols-4">
            <section className="border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/35 p-5 md:col-span-2">
              <h2 className="text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal">Salon-Brutto</h2>
              <p className="mt-2 text-xs text-brushed-chrome">
                ohne Trinkgeld (Kerngeschäft) · mit Trinkgeld (Betrag gesamt wie Karte)
              </p>
              <p className="mt-4 font-mono text-3xl font-bold tabular-nums">
                {formatEurDeFromCents(data.totals.salonUmsatzBruttoCents)}
              </p>
              <p className="mt-2 text-xs text-brushed-chrome">
                inkl. Trinkgeld: {formatEurDeFromCents(data.totals.bruttoInklTrinkgeldCents)}
              </p>
            </section>

            <section className="border border-deep-charcoal/10 bg-gray-100/40 p-5">
              <h2 className="text-xs font-light uppercase tracking-[0.2em] text-brushed-chrome">Netto gesamt</h2>
              <p className="mt-4 font-mono text-2xl font-bold tabular-nums">
                {formatEurDeFromCents(data.totals.nettoCents)}
              </p>
            </section>

            <section className="border border-deep-charcoal/10 bg-gray-100/40 p-5">
              <h2 className="text-xs font-light uppercase tracking-[0.2em] text-brushed-chrome">Trinkgeld</h2>
              <p className="mt-4 font-mono text-2xl font-bold tabular-nums">
                {formatEurDeFromCents(data.totals.trinkgeldGesamtCents)}
              </p>
              <p className="mt-2 text-[11px] text-brushed-chrome">
                Zuordnung pro Beleg im System (Empfänger-Mitarbeitende:r)
              </p>
            </section>
          </div>

          <section className="border border-deep-charcoal/10 bg-gray-100/40 p-5">
            <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.12em]">Umsatzsteuer nach Positionen</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-brushed-chrome">7 % (berechnet über Zeilen)</p>
                <p className="font-mono text-xl font-bold">{formatEurDeFromCents(data.totals.vat7Cents)}</p>
              </div>
              <div>
                <p className="text-sm text-brushed-chrome">19 %</p>
                <p className="font-mono text-xl font-bold">{formatEurDeFromCents(data.totals.vat19Cents)}</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-brushed-chrome">
              Hinweis: Trinkgelder ohne Umsatzsteuer hier nicht separat geführt — liegt im Beleg-Netto ohne
              Trinkgeldbetrag anteilig.
              {data.totals.geschlosseneBelege} geschlossene Belege im Fenster (ohne Storno).
            </p>
          </section>

          <section className="border border-deep-charcoal/10 bg-gray-100/40 p-5">
            <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.12em]">Team-Leistung</h2>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-brushed-chrome/50 font-heading uppercase text-[11px] text-brushed-chrome">
                    <th className="min-h-touch py-3 pr-4">Mitarbeiter</th>
                    <th className="min-h-touch py-3 pr-4">Umsatz o. TG</th>
                    <th className="min-h-touch py-3 pr-4">Provision</th>
                    <th className="min-h-touch py-3 pr-4">Trinkgeld</th>
                    <th className="min-h-touch py-3">Belege</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map((s) => (
                    <tr
                      key={s.staffId}
                      className="border-b border-brushed-chrome/20 [&>td]:py-4 [&>td]:align-middle"
                    >
                      <td className="font-medium">{s.displayName}</td>
                      <td className="font-mono tabular-nums">
                        {formatEurDeFromCents(s.umsatzBruttoOhneTrinkgeldCents)}
                      </td>
                      <td className="font-mono tabular-nums text-editorial-pulse">
                        {formatEurDeFromCents(s.provisionCents)}
                      </td>
                      <td className="font-mono tabular-nums">
                        {formatEurDeFromCents(s.trinkgeldCents)}
                      </td>
                      <td className="font-mono tabular-nums text-brushed-chrome">
                        {s.geschlosseneBelegeAlsVerkaeufer}
                      </td>
                    </tr>
                  ))}
                  {data.staff.length === 0 && (
                    <tr>
                      <td className="py-6 text-brushed-chrome" colSpan={5}>
                        Keine Daten im gewählten Zeitraum.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="border border-deep-charcoal/10 bg-gray-100/40 p-5">
            <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.12em]">Lager-Heatmap (14-Tage-Verkauf)</h2>
            <p className="mt-1 text-xs text-brushed-chrome">
              Schneller Nachbesteller-Hinweis: Schwellen + Restlaufzeit-Schätzung.
            </p>
            <ul className="mt-6 divide-y divide-brushed-chrome/20">
              {data.inventoryHeat.slice(0, 48).map((row) => (
                <li
                  key={row.inventoryItemId}
                  className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 py-4"
                >
                  <span className={`font-light ${row.nachbestellen ? "text-editorial-pulse" : ""}`}>
                    {row.name}
                    {row.nachbestellen ? " · Nachbestellen" : ""}
                  </span>
                  <span className="font-mono text-sm tabular-nums text-brushed-chrome">
                    {row.verkaufteMl14d} ml / 14 T · v ≈ {row.geschwindigkeitMlProTag} ml/D · Deckung ca.{" "}
                    {row.deckungTageSchaetzung != null ? `${row.deckungTageSchaetzung} T` : "—"}
                    {" · "}Best.: {row.onHandMl} ml
                  </span>
                </li>
              ))}
              {data.inventoryHeat.length === 0 && (
                <li className="py-6 text-brushed-chrome">
                  Keine verkaufte Lagerpositionszeilen oder Schwellen im Fenster — nichts anzuzeigen.
                </li>
              )}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
