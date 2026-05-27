import { useEffect, useState } from "react";
import { Download, Sparkles, X } from "lucide-react";

type UpdateInfo = {
  version: string;
  currentVersion: string;
  url: string;
  dmgUrl?: string;
  canAutoInstall?: boolean;
  notes: string;
};

type Phase = "idle" | "downloading" | "installing" | "error";

/**
 * Unmissable update banner — full-width strip at the top of the window.
 *
 * The salon owner is an elderly user and the previous bottom-right chip was
 * easy to miss while another modal or the agenda grid had focus. This banner
 * occupies the full width above everything and uses a strong gold background
 * with a single primary CTA. Dismissable only via the small X — but it
 * reappears the next time the renderer mounts (i.e., next launch).
 *
 * Also wires `window.focus` to re-check GitHub. Salon staff often park the
 * app in the background while doing other work — this guarantees they see a
 * new version as soon as they tab back.
 */
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
    // Race-fix: main may have detected an update before we mounted.
    void window.orElectron?.getPendingUpdate().then((pending) => {
      if (pending) {
        setInfo({
          version: pending.version,
          currentVersion: pending.currentVersion,
          url: pending.url,
          dmgUrl: pending.dmgUrl,
          canAutoInstall: Boolean(pending.dmgUrl),
          notes: pending.notes ?? "",
        });
      }
    });
    // Trigger an immediate check on mount.
    void window.orElectron?.checkForUpdate();
    // Re-check when the salon owner brings the app back to focus —
    // catches releases that landed while they were doing something else.
    const onFocus = () => {
      void window.orElectron?.checkForUpdate();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      off1?.();
      off2?.();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!info || dismissed) return null;

  const autoInstallAvailable = info.canAutoInstall && info.dmgUrl;
  const busy = phase === "downloading" || phase === "installing";

  const onInstall = async () => {
    if (!autoInstallAvailable) {
      void window.orElectron?.openUpdatePage(info.url);
      return;
    }
    setPhase("downloading");
    setErrorMsg(null);
    try {
      const result = await window.orElectron?.installUpdate();
      if (result?.ok) {
        setPhase("installing");
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
      case "idle":
        return autoInstallAvailable
          ? "Jetzt installieren"
          : "Herunterladen";
      case "downloading":
        return `Lade ${percent}% …`;
      case "installing":
        return "Wird installiert …";
      case "error":
        return "Erneut versuchen";
    }
  })();

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed left-0 right-0 top-0 z-[1000] flex flex-wrap items-center gap-4 border-b-2 border-[#a3811f] bg-[#D4AF37] px-6 py-3 text-[#1A1612] shadow-lg"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/40">
        <Sparkles size={22} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold uppercase tracking-wide">
          Neue Version verfügbar
        </p>
        <p className="mt-0.5 text-base">
          Version{" "}
          <strong className="font-mono text-lg">{info.version}</strong>{" "}
          (aktuell{" "}
          <span className="font-mono">{info.currentVersion}</span>)
          {!autoInstallAvailable && (
            <span className="ml-2 text-sm">
              · Manuelle Installation erforderlich
            </span>
          )}
        </p>
        {phase === "downloading" && (
          <div className="mt-2 h-2 w-full max-w-md overflow-hidden rounded-full bg-[#1A1612]/15">
            <div
              className="h-full bg-[#1A1612] transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
        {phase === "installing" && (
          <p className="mt-1 text-sm">
            Die App startet gleich automatisch neu.
          </p>
        )}
        {phase === "error" && errorMsg && (
          <p className="mt-1 text-sm font-medium text-red-900">
            Fehler: {errorMsg}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void onInstall()}
          disabled={busy}
          className="inline-flex min-h-12 items-center gap-2 rounded-md bg-[#1A1612] px-5 text-base font-semibold text-[#D4AF37] disabled:opacity-50"
        >
          <Download size={18} strokeWidth={2} />
          <span>{buttonLabel}</span>
        </button>
        {!busy && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Banner schließen"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[#1A1612]/70 hover:bg-[#1A1612]/10"
          >
            <X size={18} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
