import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost, headers } from "../api";
import { formatBerlinDateTime } from "../lib/formatTime";

type PreflightPayload = {
  generatedAtIso: string;
  database: { integrityOk: boolean; integrityDetail: string };
  fortressStorage: {
    configured: boolean;
    backendReachable: boolean | null;
    noteDe: string;
  };
  printerLanTse: {
    summaryDe: string;
    configured: boolean;
    tcpReachable: boolean;
    probeMs: number;
  };
  zvtTerminal: {
    summaryDe: string;
    backendStubOperational: boolean;
    forceFailEnvActive: boolean;
    tcpConfigured: boolean;
    tcpReachable: boolean | null;
    probeMs: number;
  };
  fiscal: {
    lastClosedInvoiceId: number | null;
    lastClosedTseStatus: string | null;
    tseAusfallBanner: boolean;
    closedInvoicesIncompleteTseCount: number;
    sampleIncompleteIds: number[];
  };
  hardwareQueuePendingCount: number;
};

type MaintainMeta = {
  intervalDays: number;
  lastVacuumMs: number | null;
  dueVacuum: boolean;
};

function statusLine(ok: boolean | null): string {
  if (ok === true) return "OK";
  if (ok === false) return "Warnung";
  return "Neutral";
}

function statusClass(ok: boolean | null): string {
  if (ok === true) return "text-editorial-pulse font-light";
  if (ok === false) return "font-light text-red-600/90";
  return "text-brushed-chrome";
}

/** Step 50 — Pre-flight readiness & SQLite maintenance (Chef / Verwaltung). */
export function AdminDiagnostics() {
  const [pre, setPre] = useState<PreflightPayload | null>(null);
  const [meta, setMeta] = useState<MaintainMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyRun, setBusyRun] = useState(false);
  const [maintMsg, setMaintMsg] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const [pf, mt] = await Promise.all([
        apiGet<PreflightPayload>("/api/admin/diagnostics/preflight"),
        apiGet<MaintainMeta>("/api/admin/system/sqlite-maintain/meta"),
      ]);
      setPre(pf);
      setMeta(mt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "preflight_failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const analyzeOnly = async () => {
    setBusyRun(true);
    setMaintMsg(null);
    try {
      const r = await apiPost<{ messageDe?: string }>("/api/admin/system/sqlite-maintain", {
        analyzeOnly: true,
      });
      setMaintMsg(r.messageDe ?? "OK");
      await refresh();
    } catch (e) {
      setMaintMsg(e instanceof Error ? e.message : "analyze_failed");
    } finally {
      setBusyRun(false);
    }
  };

  const forceVacuum = async () => {
    if (
      !window.confirm(
        "VACUUM sperrt die Datenbank kurzzeitig. Jetzt nach Feierabend ausführen? Fortfahren?",
      )
    )
      return;
    setBusyRun(true);
    setMaintMsg(null);
    try {
      const r = await apiPost<{ messageDe?: string }>("/api/admin/system/sqlite-maintain", {
        forceVacuum: true,
      });
      setMaintMsg(r.messageDe ?? "OK");
      await refresh();
    } catch (e) {
      setMaintMsg(e instanceof Error ? e.message : "vacuum_failed");
    } finally {
      setBusyRun(false);
    }
  };

  const downloadDebugBundle = async (encrypted: boolean) => {
    setExportMsg(null);
    try {
      const base = import.meta.env.VITE_API_BASE ?? "";
      const url = `${base}/api/admin/system/debug-bundle${encrypted ? "?enc=1" : ""}`;
      const h = {
        ...headers(),
        Accept: "*/*",
      };
      delete (h as Record<string, string>)["Content-Type"];

      const r = await fetch(url, { headers: h });
      if (!r.ok) {
        throw new Error(r.statusText);
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename="([^"]+)"/);
      let fname =
        encrypted ? `OliverRoos_Debug_enc_${Date.now()}.bin`
        : `OliverRoos_Debug_${Date.now()}.json`;
      if (m?.[1]) fname = m[1];
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u;
      a.download = fname;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(u);
      setExportMsg(
        encrypted ?
          "Verschlüsseltes Paket heruntergeladen (Server: OLIVER_ROOS_SUPPORT_SECRET)."
        : "JSON-Paket heruntergeladen — vertraulich behandeln.",
      );
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : "export_failed");
    }
  };

  const fortressOk =
    !pre ?
      null
    : !pre.fortressStorage.configured ? null
    : pre.fortressStorage.backendReachable === true;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 text-deep-charcoal">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-editorial-display text-5xl font-normal uppercase tracking-[0.14em] text-deep-charcoal">Diagnose-Zentrum</h1>
          <p className="mt-3 max-w-xl text-xs font-light uppercase tracking-[0.2em] text-brushed-chrome">
            Systemchecks vor Live-Betrieb — echte TCP‑Proben, Datenbank‑Integrität, fiskaler Status.
            Alle Prüfungen lesend bzw.&nbsp;durch echte Kontaktversuche ohne Belegstellung.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busyRun}
            className="min-h-touch border border-deep-charcoal/15 px-6 text-[11px] font-light uppercase tracking-[0.24em] text-deep-charcoal disabled:opacity-50"
            onClick={() => void refresh()}
          >
            Systemcheck neu ausführen
          </button>
          <Link
            to="/admin"
            className="inline-flex min-h-touch items-center justify-center border border-editorial-pulse px-6 text-[11px] font-light uppercase tracking-[0.24em] text-editorial-pulse no-underline"
          >
            ← Chef-Ansicht
          </Link>
        </div>
      </div>

      {err && (
        <div className="mb-6 border border-red-400/55 bg-red-50/60 px-4 py-3 text-red-600/90" role="alert">
          {err}
        </div>
      )}

      {pre && (
        <section className="mb-10 grid gap-6 md:grid-cols-2">
          <article className="border border-deep-charcoal/10 bg-gray-100/40 p-6">
            <h2 className="text-lg font-bold font-heading text-deep-charcoal">SQLite</h2>
            <p className={`mt-3 ${statusClass(pre.database.integrityOk ? true : false)}`}>
              {statusLine(pre.database.integrityOk ? true : false)} — {pre.database.integrityDetail}
            </p>
          </article>

          <article className="border border-deep-charcoal/10 bg-gray-100/40 p-6">
            <h2 className="text-lg font-bold font-heading text-deep-charcoal">Fortress‑Pfad (Server‑Sicht)</h2>
            <p className="mt-2 text-sm text-brushed-chrome">{pre.fortressStorage.noteDe}</p>
            <p className={`mt-3 ${statusClass(fortressOk)}`}>
              {statusLine(fortressOk)}
              {!pre.fortressStorage.configured ?
                " — Kein externes Ziel eingetragen."
              : pre.fortressStorage.backendReachable === true ?
                " — Ordner lesbar/schreibbar."
              : pre.fortressStorage.backendReachable === false ?
                " — Pfad hier nicht erreichbar (USB-Server-Mismatch möglich)."
              : " —"}
            </p>
          </article>

          <article className="border border-deep-charcoal/10 bg-gray-100/40 p-6">
            <h2 className="text-lg font-bold font-heading text-deep-charcoal">Drucker / LAN‑TSE</h2>
            <p className="mt-2 text-brushed-chrome">{pre.printerLanTse.summaryDe}</p>
            <p
              className={`mt-3 ${statusClass(pre.printerLanTse.configured ? pre.printerLanTse.tcpReachable : null)}`}
            >
              TCP: {pre.printerLanTse.configured ?
                `${pre.printerLanTse.tcpReachable ? "erreichbar" : "ausgefallen"} (${pre.printerLanTse.probeMs} ms)`
              : "Übersprungen"}
            </p>
          </article>

          <article className="border border-deep-charcoal/10 bg-gray-100/40 p-6">
            <h2 className="text-lg font-bold font-heading text-deep-charcoal">EC / ZVT</h2>
            <p className="mt-2 text-brushed-chrome">{pre.zvtTerminal.summaryDe}</p>
            <p className={`mt-3 ${statusClass(pre.zvtTerminal.backendStubOperational ? true : false)}`}>
              Bridge-Stubs:{" "}
              {pre.zvtTerminal.forceFailEnvActive ?
                "TEST‑Ausfall aktiv (ENV)"
              : pre.zvtTerminal.backendStubOperational ?
                "operativ"
              : "Ausfall"}
              {pre.zvtTerminal.tcpConfigured && pre.zvtTerminal.tcpReachable !== null ?
                ` · TCP: ${pre.zvtTerminal.tcpReachable ? "OK" : "Fehlschlag"} (${pre.zvtTerminal.probeMs} ms)`
              : ""}
            </p>
          </article>

          <article className="border border-deep-charcoal/10 bg-gray-100/40 p-6 md:col-span-2">
            <h2 className="text-lg font-bold font-heading text-deep-charcoal">Fiskaler Zustand</h2>
            <ul className="mt-3 space-y-2 text-brushed-chrome">
              <li>
                Letzter geschlossener Beleg (ID&nbsp;#{pre.fiscal.lastClosedInvoiceId ?? "—"}
                ){": "}
                <span className="text-deep-charcoal font-mono">
                  {pre.fiscal.lastClosedTseStatus ?? "—"}
                </span>
              </li>
              <li>
                Geschlossene Belege mit unvollständiger / ausgefallener TSE (Stichprobe, max.&nbsp;
                {pre.fiscal.sampleIncompleteIds.length})
                {": "}
                <span
                  className={
                    pre.fiscal.closedInvoicesIncompleteTseCount > 0 ?
                      "font-light text-editorial-pulse"
                    : "text-deep-charcoal"
                  }
                >
                  {pre.fiscal.closedInvoicesIncompleteTseCount}
                </span>
                {pre.fiscal.sampleIncompleteIds.length > 0 && (
                  <span className="ml-2 font-mono text-sm text-brushed-chrome">
                    (
                    {pre.fiscal.sampleIncompleteIds.slice(0, 8).join(", ")}
                    {pre.fiscal.sampleIncompleteIds.length > 8 ? "…" : ""})
                  </span>
                )}
              </li>
              <li>Warteschlange Hardware (pending): {pre.hardwareQueuePendingCount}</li>
            </ul>
            {pre.fiscal.tseAusfallBanner && (
              <p className="mt-4 border-l border-editorial-pulse pl-3 text-editorial-pulse">
                Warnung — letzter Beleg zeigt einen TSE‑Ausfall. Technische Intervention empfohlen.
              </p>
            )}
          </article>
        </section>
      )}

      <section className="border border-deep-charcoal/10 bg-gray-100/40 p-8">
        <h2 className="text-xl font-bold font-heading text-deep-charcoal">Datenbank-Wartung</h2>
        <p className="mt-2 max-w-2xl text-brushed-chrome">
          <strong className="text-deep-charcoal">VACUUM</strong> erfolgt höchstens alle{" "}
          {meta?.intervalDays ?? 10}&nbsp;Tage — automatisch nur nach erfolgreicher Fortress‑
          Kopie, wenn fällig. So bleiben Backups ohne unnötiges Risiko konsistent&nbsp;verteilt.
          <strong className="block pt-3 text-deep-charcoal">ANALYZE / PRAGMA optimize</strong>
          können Sie tägliche Abfragen fein abstimmen, ohne Daten zu löschen.
        </p>
        <ul className="mt-6 space-y-2 text-brushed-chrome">
          <li>
            Letztes VACUUM:{" "}
            {meta?.lastVacuumMs != null ?
              formatBerlinDateTime(new Date(meta.lastVacuumMs))
            : "— noch keines protokolliert —"}
          </li>
          <li>VACUUM fällig: {meta?.dueVacuum ? "ja" : "nein"}</li>
        </ul>
        <div className="mt-8 flex flex-wrap gap-4">
          <button
            type="button"
            disabled={busyRun}
            className="min-h-touch border border-deep-charcoal/15 px-8 text-[11px] font-light uppercase tracking-[0.24em] disabled:opacity-50"
            onClick={() => void analyzeOnly()}
          >
            Statistik aktualisieren (ANALYZE)
          </button>
          <button
            type="button"
            disabled={busyRun}
            className="min-h-touch border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-8 text-[11px] font-light uppercase tracking-[0.28em] text-editorial-pulse disabled:opacity-50"
            onClick={() => void forceVacuum()}
          >
            VACUUM jetzt erzwingen
          </button>
        </div>
        {maintMsg && <p className="mt-6 text-sm text-brushed-chrome">{maintMsg}</p>}
      </section>

      <section className="mt-10 border border-deep-charcoal/10 bg-gray-100/40 p-8">
        <h2 className="text-xl font-bold font-heading text-deep-charcoal">Debug-Brücke</h2>
        <p className="mt-3 max-w-2xl text-brushed-chrome">
          Fehlerpaket für technischen Support: Audit‑Tail (400 Zeilen), Warteschlange, ZVT‑Waisen,
          fehlgeschlagene Druck-/Hardware‑Jobs, TSE‑Lücken. Kein DATEV‑Ersatz. JSON ist vertraulich;
          AES‑GZIP nur wenn auf dem Server <span className="font-mono">OLIVER_ROOS_SUPPORT_SECRET</span>≥
          &nbsp;24 Zeichen gesetzt ist.
        </p>
        <div className="mt-6 flex flex-wrap gap-4">
          <button
            type="button"
            className="min-h-touch border border-deep-charcoal/15 px-8 text-[11px] font-light uppercase tracking-[0.24em]"
            onClick={() => void downloadDebugBundle(false)}
          >
            Fehlerprotokoll exportieren (.json)
          </button>
          <button
            type="button"
            className="min-h-touch border border-editorial-pulse px-8 text-[11px] font-light uppercase tracking-[0.24em] text-editorial-pulse"
            onClick={() => void downloadDebugBundle(true)}
          >
            Verschlüsselt (.bin)
          </button>
        </div>
        {exportMsg && (
          <p className="mt-4 border-l border-deep-charcoal/15 pl-3 text-sm">{exportMsg}</p>
        )}
      </section>
    </div>
  );
}
