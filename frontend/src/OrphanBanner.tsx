import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "./api";

type Orphan = {
  id: number;
  amountCents: number;
  terminalId: string;
  status: string;
  zvtReceiptId: string | null;
};

/**
 * Open ZVT orphans — slim top strip (does not dominate the shell).
 */
export function OrphanBanner() {
  const [open, setOpen] = useState<Orphan[]>([]);
  const [dismiss, setDismiss] = useState(false);

  const load = useCallback(() => {
    const tid = localStorage.getItem("or:terminalId") ?? "";
    const q = tid ? `?status=open&terminal=${encodeURIComponent(tid)}` : "?status=open";
    void apiGet<unknown>(`/api/orphan-payments${q}`)
      .then((rows) => setOpen(Array.isArray(rows) ? (rows as Orphan[]) : []))
      .catch(() => setOpen([]));
  }, []);

  useEffect(() => {
    load();
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  if (dismiss || open.length === 0) return null;

  const summary = open
    .map((o) => `${(o.amountCents / 100).toFixed(2)}€/${o.terminalId}`)
    .join(" · ");

  return (
    <div
      className="z-[65] flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-red-500/35 bg-gradient-to-r from-red-950/95 via-red-950/90 to-red-900/85 px-4 py-2 text-sm text-red-50 shadow-[0_4px_24px_rgba(0,0,0,0.28)] backdrop-blur-xl"
      role="alert"
    >
      <p className="min-w-0 flex-1 truncate font-medium">
        <span className="font-mono tabular-nums text-red-100">{open.length}</span> offene ZVT-Zahlung
        {open.length === 1 ? "" : "en"} — Orphan zuordnen, dann TSE abschließen.{" "}
        <span className="hidden font-mono text-xs text-red-200/90 sm:inline">{summary}</span>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          to="/reconcile"
          className="inline-flex min-h-[40px] items-center rounded-lg border border-red-400/40 bg-red-950/50 px-3 text-sm font-semibold text-red-100 no-underline backdrop-blur-sm hover:border-champagne-gold/40 hover:text-deep-charcoal"
        >
          Auswahl
        </Link>
        <button
          type="button"
          className="inline-flex min-h-[40px] items-center rounded-lg border border-deep-charcoal/15 bg-white/10 px-3 text-sm font-semibold text-deep-charcoal/90 hover:bg-white/15"
          onClick={() => setDismiss(true)}
        >
          Später
        </button>
      </div>
    </div>
  );
}
