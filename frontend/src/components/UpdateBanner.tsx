import { useEffect, useState } from "react";

type UpdateInfo = {
  version: string;
  currentVersion: string;
  url: string;
  dmgUrl?: string;
  canAutoInstall?: boolean;
  notes: string;
};

type Phase = "idle" | "downloading" | "installing" | "error";

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const off1 = window.orElectron?.onUpdateAvailable((payload) => {
      setInfo(payload);
      setDismissed(false);
      setPhase("idle");
      setPercent(0);
      setErrorMsg(null);
    });
    const off2 = window.orElectron?.onUpdateProgress((p) => {
      setPercent(p.percent);
    });
    // Behebt das IPC-vor-Listener-Rennen: das Main-Prozess hatte vielleicht
    // schon ein Update erkannt, bevor wir bereit waren zuzuhören. Jetzt fragen
    // wir aktiv nach.
    void window.orElectron?.getPendingUpdate().then((pending) => {
      if (pending) {
        setInfo({
          version:        pending.version,
          currentVersion: pending.currentVersion,
          url:            pending.url,
          dmgUrl:         pending.dmgUrl,
          canAutoInstall: Boolean(pending.dmgUrl),
          notes:          pending.notes ?? "",
        });
      }
    });
    // Sofortiger Check beim Mounten, falls Main noch nicht gecheckt hat
    void window.orElectron?.checkForUpdate();
    return () => { off1?.(); off2?.(); };
  }, []);

  if (!info || dismissed) return null;

  const autoInstallAvailable = info.canAutoInstall && info.dmgUrl;

  const onInstall = async () => {
    if (!autoInstallAvailable) {
      // Fallback: Browser-Download
      void window.orElectron?.openUpdatePage(info.url);
      return;
    }
    setPhase("downloading");
    setErrorMsg(null);
    try {
      const result = await window.orElectron?.installUpdate();
      if (result?.ok) {
        setPhase("installing"); // Die App schließt sich gleich
      } else {
        setPhase("error");
        setErrorMsg(result?.error ?? "Installation fehlgeschlagen");
      }
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  };

  const buttonLabel = (() => {
    switch (phase) {
      case "idle":        return autoInstallAvailable ? "Jetzt installieren" : "Herunterladen";
      case "downloading": return `Lade ${percent}% ...`;
      case "installing":  return "Installation läuft ...";
      case "error":       return "Erneut versuchen";
    }
  })();

  const busy = phase === "downloading" || phase === "installing";

  return (
    <div className="fixed bottom-4 right-4 z-[400] max-w-sm border border-champagne-gold/40 bg-gray-200 px-4 py-3 shadow-luxury">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-champagne-gold">
            Neue Version verfügbar
          </p>
          <p className="mt-1 text-sm text-deep-charcoal">
            Version <strong>{info.version}</strong>
            <span className="text-deep-charcoal/60"> (aktuell {info.currentVersion})</span>
          </p>
          {phase === "downloading" && (
            <div className="mt-2 h-1.5 w-full bg-deep-charcoal/10">
              <div
                className="h-full bg-champagne-gold transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          {phase === "installing" && (
            <p className="mt-1 text-xs text-deep-charcoal/60">
              App wird gleich neu gestartet ...
            </p>
          )}
          {phase === "error" && errorMsg && (
            <p className="mt-1 text-xs text-red-600">
              {errorMsg}
            </p>
          )}
          {phase === "idle" && !autoInstallAvailable && (
            <p className="mt-1 text-xs text-deep-charcoal/60">
              Manuelle Installation erforderlich.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onInstall}
              disabled={busy}
              className="border border-champagne-gold bg-champagne-gold px-3 py-1 text-xs font-bold uppercase tracking-wider text-deep-charcoal disabled:opacity-60"
            >
              {buttonLabel}
            </button>
            {!busy && (
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="border border-deep-charcoal/20 px-3 py-1 text-xs font-light uppercase tracking-wider text-deep-charcoal/60"
              >
                Später
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
