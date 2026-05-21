import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import { LuxuryDatePicker } from "../components/ui/LuxuryDatePicker";
import { luxuryGlassPanel, luxuryButtonGhost } from "../lib/luxuryUi";

type Target = {
  id: number;
  targetRevenueCents: number | null;
  targetRetailUnitCount: number | null;
  progressRevenueCents: number | null;
  progressRetailUnits: number | null;
  businessDate: string;
} | null;

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 37 — Self-only read (stylist); owner sets targets in Settings.
 */
export function Rings() {
  const role = localStorage.getItem("or:staffRole") ?? "stylist";
  const isOwner = role === "owner" || role === "super_admin";
  const selfId = Number(localStorage.getItem("or:staffId") ?? 1);
  const viewAll =
    isOwner && localStorage.getItem("or:viewAllTargets") === "true";
  const viewAs = Number(
    localStorage.getItem("or:ringsViewStaffId") ?? String(selfId),
  );
  const staffId =
    viewAll && Number.isFinite(viewAs) && viewAs > 0 ? viewAs : selfId;
  const [d, setD] = useState(todayYmd());
  const [t, setT] = useState<Target>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setErr("");
    void apiGet<Target>(`/api/staff/${staffId}/targets?date=${encodeURIComponent(d)}`)
      .then(setT)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [d, staffId]);

  const simulateProgress = () => {
    if (!t) return;
    setT({
      ...t,
      progressRevenueCents: (t.progressRevenueCents ?? 0) + 5000,
    });
  };

  const rev = t?.targetRevenueCents ?? 0;
  const pr = t?.progressRevenueCents ?? 0;
  const ring = rev > 0 ? Math.min(100, (pr / rev) * 100) : 0;
  const retailT = t?.targetRetailUnitCount ?? 0;
  const pru = t?.progressRetailUnits ?? 0;
  const ring2 = retailT > 0 ? Math.min(100, (pru / retailT) * 100) : 0;

  const revenueLine = useMemo(
    () => `${(pr / 100).toFixed(0)} / ${(rev / 100).toFixed(0)} €`,
    [pr, rev],
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 text-deep-charcoal sm:px-6">
      <div className={`p-6 md:p-8 ${luxuryGlassPanel}`}>
        <p className="text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/40">Heute — Ziele</p>
        <h2 className="mt-2 font-editorial-display text-5xl font-normal uppercase tracking-[0.14em] text-deep-charcoal">Rings</h2>
        <p className="mt-2 text-sm text-deep-charcoal/40">
          Persönliche Ziele · Auswahl im Terminal-Menü (Inhaber: Fremdziele lesen).
        </p>

        <div className="mt-8 w-full">
          <LuxuryDatePicker
            className="w-full"
            label="Geschäftstag"
            value={d}
            onChange={setD}
            yearSpan={{ before: 2, after: 1 }}
          />
        </div>

        {err ? (
          <p className="mt-6 rounded-xl border border-red-400/60 bg-red-50/60 px-4 py-3 text-sm text-red-600/90" role="alert">
            {err}
          </p>
        ) : null}

        {loading ? (
          <p className="mt-8 text-center text-deep-charcoal/45">Lade Ziele…</p>
        ) : null}

        {!loading && t == null && !err ? (
          <p className="mt-8 text-center text-base text-deep-charcoal/50">
            Keine Ziele — Inhaber legt Werte in Einstellungen an.
          </p>
        ) : null}

        {!loading && t != null ? (
          <div className="mt-10 space-y-14">
            <div className="flex flex-col items-center text-center">
              <p className="text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/40">Umsatz-Fortschritt</p>
              <div
                className="relative mx-auto mt-8 flex justify-center"
                style={{
                  width: 240,
                  height: 240,
                  borderRadius: "50%",
                  background: `conic-gradient(var(--editorial-pulse) ${ring}%, rgba(255,255,255,0.06) 0)`,
                  boxShadow: "0 0 48px rgba(212,175,55,0.08)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <div
                  className="flex flex-col items-center justify-center rounded-full bg-gray-50"
                  style={{ width: 182, height: 182 }}
                >
                  <span className="font-heading text-5xl font-light tabular-nums text-deep-charcoal sm:text-6xl">
                    {ring.toFixed(0)}
                    <span className="text-3xl font-bold text-deep-charcoal/60 sm:text-4xl">%</span>
                  </span>
                </div>
              </div>
              <p className="mt-8 font-mono text-4xl font-light tabular-nums tracking-tight text-editorial-pulse sm:text-5xl">
                {revenueLine}
              </p>
              <p className="mt-2 text-xs text-deep-charcoal/40">Salon-Brutto vs. Tagesziel</p>
            </div>

            <div className="flex flex-col items-center text-center">
              <p className="text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/40">Retail-Units</p>
              <div
                className="relative mx-auto mt-8 flex justify-center"
                style={{
                  width: 240,
                  height: 240,
                  borderRadius: "50%",
                  background: `conic-gradient(var(--editorial-pulse) ${ring2}%, rgba(255,255,255,0.06) 0)`,
                  boxShadow: "0 0 48px rgba(212,175,55,0.06)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <div
                  className="flex flex-col items-center justify-center rounded-full bg-gray-50"
                  style={{ width: 182, height: 182 }}
                >
                  <span className="font-heading text-5xl font-light tabular-nums text-deep-charcoal sm:text-6xl">
                    {ring2.toFixed(0)}
                    <span className="text-3xl font-bold text-deep-charcoal/60 sm:text-4xl">%</span>
                  </span>
                </div>
              </div>
              <p className="mt-8 font-mono text-4xl font-light tabular-nums text-editorial-pulse sm:text-5xl">
                {pru} <span className="text-2xl font-semibold text-deep-charcoal/35 sm:text-3xl">/</span> {retailT}
              </p>
              <p className="mt-2 text-xs text-deep-charcoal/40">Verkaufs-Units vs. Ziel</p>
            </div>

            <button
              type="button"
              className={`${luxuryButtonGhost} w-full justify-center`}
              onClick={simulateProgress}
            >
              Demo +50 € Fortschritt (lokal)
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
