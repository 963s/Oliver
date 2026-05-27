import { useEffect, useState } from "react";

/**
 * Version chip — always visible bottom-left so the salon owner can verify at a
 * glance which build is running. A gold dot lights up when an update is
 * pending; clicking the chip opens the admin settings page where they can
 * also force a manual check.
 */
export function VersionBadge() {
  const [version, setVersion] = useState<string>("");
  const [hasUpdate, setHasUpdate] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string>("");

  useEffect(() => {
    void window.orElectron?.getUpdateStatus().then((s) => {
      setVersion(s.currentVersion);
      setHasUpdate(s.pendingUpdate != null);
      if (s.pendingUpdate?.version) setLatestVersion(s.pendingUpdate.version);
    });
    const off = window.orElectron?.onUpdateAvailable((payload) => {
      setHasUpdate(true);
      setLatestVersion(payload.version);
    });
    return () => {
      off?.();
    };
  }, []);

  if (!version) return null;

  return (
    <a
      href="#/admin/settings#updates"
      className={`fixed bottom-3 left-3 z-[100] flex items-center gap-2 rounded-md border-2 px-3 py-2 text-sm no-underline transition ${
        hasUpdate
          ? "border-[#a3811f] bg-[#D4AF37] text-[#1A1612] font-semibold shadow-lg"
          : "border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text-muted)] hover:bg-[var(--app-bg)]"
      }`}
      title={
        hasUpdate
          ? `Neue Version ${latestVersion} verfügbar — klicken`
          : `Aktuelle Version: ${version}`
      }
    >
      {hasUpdate && (
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#1A1612]" aria-hidden />
      )}
      <span className="font-mono text-sm">v{version}</span>
      {hasUpdate && (
        <span className="font-mono text-xs">→ v{latestVersion}</span>
      )}
    </a>
  );
}
