import { useEffect, useState } from "react";

/** Small version chip in the bottom-right corner. Click to go to update settings. */
export function VersionBadge() {
  const [version, setVersion] = useState<string>("");
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    void window.orElectron?.getUpdateStatus().then((s) => {
      setVersion(s.currentVersion);
      setHasUpdate(s.pendingUpdate != null);
    });
    const off = window.orElectron?.onUpdateAvailable(() => setHasUpdate(true));
    return () => { off?.(); };
  }, []);

  if (!version) return null;

  return (
    <a
      href="#/admin/settings#updates"
      className="fixed bottom-2 left-2 z-[100] flex items-center gap-1.5 border border-deep-charcoal/[0.08] bg-white/70 px-2.5 py-1 text-[10px] font-light uppercase tracking-[0.18em] text-deep-charcoal/45 no-underline backdrop-blur-none transition hover:bg-white hover:text-deep-charcoal/80"
      title={hasUpdate ? "Update verfügbar — klicken zum Aktualisieren" : `Version ${version}`}
    >
      {hasUpdate && (
        <span className="h-1.5 w-1.5 rounded-full bg-champagne-gold" aria-hidden />
      )}
      <span className="font-mono">v{version}</span>
    </a>
  );
}
