import { useEffect, useState } from "react";

type UpdateInfo = {
  version: string;
  currentVersion: string;
  url: string;
  notes: string;
};

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const off = window.orElectron?.onUpdateAvailable((payload) => {
      setInfo(payload);
      setDismissed(false);
    });
    return () => { off?.(); };
  }, []);

  if (!info || dismissed) return null;

  const openDownload = () => {
    void window.orElectron?.openUpdatePage(info.url);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[400] max-w-sm border border-champagne-gold/40 bg-gray-200 px-4 py-3 shadow-luxury">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-champagne-gold">
            Neue Version verfügbar
          </p>
          <p className="mt-1 text-sm text-deep-charcoal">
            Version <strong>{info.version}</strong> ist verfügbar
            <span className="text-deep-charcoal/60"> (aktuell {info.currentVersion}).</span>
          </p>
          <p className="mt-1 text-xs text-deep-charcoal/60">
            Manuelle Installation: DMG herunterladen und ersetzen.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={openDownload}
              className="border border-champagne-gold bg-champagne-gold px-3 py-1 text-xs font-bold uppercase tracking-wider text-deep-charcoal"
            >
              Herunterladen
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="border border-deep-charcoal/20 px-3 py-1 text-xs font-light uppercase tracking-wider text-deep-charcoal/60"
            >
              Später
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
