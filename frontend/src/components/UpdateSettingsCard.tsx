import { useEffect, useState } from "react";

type Status = {
  currentVersion: string;
  pendingUpdate: { version: string; dmgUrl?: string; releaseUrl?: string } | null;
  lastCheckedAt: number | null;
  lastCheckOutcome: "never" | "no_update" | "update_available" | "error";
  lastCheckError: string | null;
};

function formatRelativeTime(ts: number | null): string {
  if (ts == null) return "—";
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 5)    return "soeben";
  if (diff < 60)   return `vor ${diff} Sek.`;
  if (diff < 3600) return `vor ${Math.round(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.round(diff / 3600)} Std.`;
  return `vor ${Math.round(diff / 86400)} Tagen`;
}

const outcomeLabel: Record<Status["lastCheckOutcome"], string> = {
  never:            "Noch nicht geprüft",
  no_update:        "App ist aktuell",
  update_available: "Neue Version verfügbar",
  error:            "Prüfung fehlgeschlagen",
};

export function UpdateSettingsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installPercent, setInstallPercent] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    const s = await window.orElectron?.getUpdateStatus();
    if (s) setStatus(s);
  };

  useEffect(() => {
    void refresh();
    const off1 = window.orElectron?.onUpdateCheckComplete(() => { void refresh(); });
    const off2 = window.orElectron?.onUpdateAvailable(() => { void refresh(); });
    const off3 = window.orElectron?.onUpdateProgress((p) => setInstallPercent(p.percent));
    return () => { off1?.(); off2?.(); off3?.(); };
  }, []);

  if (!status) return null;

  const checkNow = async () => {
    setChecking(true);
    setMsg(null);
    try {
      const r = await window.orElectron?.checkForUpdate();
      if (r?.status === "no_update") {
        setMsg("App ist auf dem neuesten Stand ✓");
      } else if (r?.status === "update_available") {
        setMsg(`Neue Version ${r.latest} verfügbar`);
      } else if (r?.status === "error") {
        setMsg(`Prüfung fehlgeschlagen: ${r.error}`);
      }
    } finally {
      setChecking(false);
      void refresh();
    }
  };

  const installNow = async () => {
    setInstalling(true);
    setMsg(null);
    try {
      const r = await window.orElectron?.installUpdate();
      if (!r?.ok) setMsg(r?.error ?? "Installation fehlgeschlagen");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  };

  const open = () => {
    if (status.pendingUpdate?.releaseUrl) {
      void window.orElectron?.openUpdatePage(status.pendingUpdate.releaseUrl);
    }
  };

  return (
    <section id="updates" className="border border-deep-charcoal/[0.08] bg-white/70 p-6">
      <h3 className="font-heading text-xl uppercase tracking-[0.1em] text-deep-charcoal">
        App-Updates
      </h3>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wider text-deep-charcoal/40">Aktuelle Version</p>
          <p className="mt-1 font-mono text-base">v{status.currentVersion}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-deep-charcoal/40">Letzte Prüfung</p>
          <p className="mt-1">{formatRelativeTime(status.lastCheckedAt)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-deep-charcoal/40">Status</p>
          <p className={`mt-1 ${
            status.lastCheckOutcome === "update_available" ? "text-champagne-gold font-semibold" :
            status.lastCheckOutcome === "error" ? "text-red-600" : ""
          }`}>
            {outcomeLabel[status.lastCheckOutcome]}
          </p>
        </div>
        {status.pendingUpdate && (
          <div>
            <p className="text-xs uppercase tracking-wider text-deep-charcoal/40">Verfügbare Version</p>
            <p className="mt-1 font-mono text-base text-champagne-gold">
              v{status.pendingUpdate.version}
            </p>
          </div>
        )}
      </div>

      {installing && (
        <div className="mt-4">
          <div className="h-2 w-full bg-deep-charcoal/10">
            <div
              className="h-full bg-champagne-gold transition-all"
              style={{ width: `${installPercent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-deep-charcoal/60">Lade {installPercent}% — App wird gleich neu gestartet</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={checkNow}
          disabled={checking || installing}
          className="border border-deep-charcoal/15 px-5 py-2 text-xs font-semibold uppercase tracking-[0.15em] disabled:opacity-50 hover:bg-gray-100"
        >
          {checking ? "Prüfe ..." : "Jetzt prüfen"}
        </button>

        {status.pendingUpdate && (
          <>
            <button
              type="button"
              onClick={installNow}
              disabled={installing}
              className="editorial-pulse-fill px-5 py-2 text-xs font-semibold uppercase tracking-[0.15em] disabled:opacity-50"
            >
              {installing ? "Installiere ..." : `Auf v${status.pendingUpdate.version} aktualisieren`}
            </button>
            <button
              type="button"
              onClick={open}
              className="border border-deep-charcoal/15 px-5 py-2 text-xs font-semibold uppercase tracking-[0.15em] hover:bg-gray-100"
            >
              Release-Notizen ↗
            </button>
          </>
        )}
      </div>

      {msg && (
        <p className="mt-4 text-sm text-deep-charcoal/70">{msg}</p>
      )}

      {status.lastCheckError && status.lastCheckOutcome === "error" && (
        <p className="mt-2 text-xs text-red-600">
          Letzte Fehlermeldung: {status.lastCheckError}
        </p>
      )}
    </section>
  );
}
