import { useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../api";
import { luxuryButtonPrimary, luxuryFieldClass, luxuryGlassPanel } from "../lib/luxuryUi";

type Orphan = {
  id: number;
  amountCents: number;
  terminalId: string;
  status: string;
  matchedSessionId: number | null;
};

export function Reconcile() {
  const [rows, setRows] = useState<Orphan[]>([]);
  const [session, setSession] = useState("1");
  const [log, setLog] = useState("");

  const load = () => {
    void apiGet<Orphan[]>("/api/orphan-payments?status=open")
      .then(setRows)
      .catch((e) => setLog(String(e)));
  };

  useEffect(() => {
    load();
  }, []);

  const match = (id: number) => {
    void apiPatch(`/api/orphan-payments/${id}`, {
      matchSessionId: Number(session),
      status: "reconciled",
      belegNote: "Nächster Schritt: Fiskaly/TSE mit Steuerberater abstimmen",
    })
      .then(() => load())
      .catch((e) => setLog(String(e)));
  };

  const demoZvt = () => {
    void apiPost("/api/hardware/zvt/authorization-success", {
      amountCents: 6500,
      terminalId: localStorage.getItem("or:terminalId") ?? "T-ING-01",
      zvtReceiptId: `ZVT-${Date.now()}`,
    })
      .then(() => load())
      .catch((e) => setLog(String(e)));
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 text-deep-charcoal sm:px-6">
      <div className={`p-6 md:p-8 ${luxuryGlassPanel}`}>
        <p className="text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/40">Zahlungsabgleich</p>
        <h1 className="mt-2 font-editorial-display text-5xl font-normal uppercase tracking-[0.14em]">ZVT-Orphan ausgleichen</h1>
        <p className="mt-4 text-base leading-relaxed text-deep-charcoal/50">
          EC meldet Autorisierung, iPad war offline — manuell mit Session/Invoice führen, dann fiskal
          abschließen.
        </p>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <button type="button" className={`min-h-[56px] shrink-0 ${luxuryButtonPrimary}`} onClick={demoZvt}>
            Demo-Orphan aus Terminal
          </button>
        </div>

        <div className="mt-10 grid gap-6">
          <div>
            <label htmlFor="recon-session" className="block text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/40">
              Session-ID für Match
            </label>
            <input
              id="recon-session"
              className={`mt-3 min-h-[56px] w-full max-w-xs rounded-2xl px-4 text-lg font-mono tabular-nums text-deep-charcoal ${luxuryFieldClass}`}
              value={session}
              onChange={(e) => setSession(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
            />
          </div>
        </div>

        {log ? (
          <p className="mt-6 rounded-xl border border-red-400/60 bg-red-50/60 px-4 py-3 text-sm text-red-600/90" role="alert">
            {log}
          </p>
        ) : null}

        <ul className="mt-10 flex flex-col gap-6" aria-live="polite">
          {rows.length === 0 ? (
            <li className="rounded-2xl border border-deep-charcoal/10 bg-gray-200/60 px-6 py-10 text-center text-deep-charcoal/45">
              Keine offenen Orphans.
            </li>
          ) : (
            rows.map((o) => (
              <li
                key={o.id}
                className={`rounded-2xl border p-6 shadow-[0_0_32px_rgba(212,175,55,0.06)] backdrop-blur-md ${
                  o.status === "open"
                    ? "border-red-400/45 bg-red-50/45"
                    : "border-deep-charcoal/10 bg-gray-200/70"
                }`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-mono text-sm uppercase tracking-wider text-deep-charcoal/40">Orphan #{o.id}</p>
                    <p className="mt-2 font-heading text-2xl font-light tabular-nums text-editorial-pulse">
                      {(o.amountCents / 100).toFixed(2).replace(".", ",")} €
                    </p>
                    <p className="mt-1 text-sm text-deep-charcoal/50">{o.terminalId}</p>
                  </div>
                  <button
                    type="button"
                    className="min-h-[56px] shrink-0 rounded-2xl border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-6 text-[11px] font-light uppercase tracking-[0.2em] text-editorial-pulse backdrop-blur-md transition hover:bg-[var(--editorial-pulse-dim)]/60"
                    onClick={() => match(o.id)}
                  >
                    An Session {session} binden
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
