import { useEffect, useState, type ReactNode } from "react";
import { isTauriShell } from "../lib/deviceContext";
import { useAuthStore } from "../store/authStore";

const isEmbeddedBuild = import.meta.env.VITE_EMBEDDED_DESKTOP === "1";

function apiOrigin(): string {
  const b = import.meta.env.VITE_API_BASE ?? "";
  return String(b).replace(/\/$/, "") || "http://127.0.0.1:3000";
}

/**
 * Production Tauri bundle: inject embedded device token, wait for bundled Express API,
 * then render the app (skips manual pairing on this machine).
 */
export function EmbeddedDesktopGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => !isEmbeddedBuild || !isTauriShell());
  const [splash, setSplash] = useState(
    () => isEmbeddedBuild && isTauriShell(),
  );

  useEffect(() => {
    if (!isEmbeddedBuild || !isTauriShell()) {
      setReady(true);
      setSplash(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const token = await invoke<string>("get_embedded_device_token");
        if (cancelled) return;
        useAuthStore.getState().setDeviceToken(token);
        useAuthStore.getState().rehydrate();
      } catch (e) {
        console.error("[EmbeddedDesktopGate] device token:", e);
      }

      const base = apiOrigin();
      const deadline = Date.now() + 60_000;
      while (!cancelled && Date.now() < deadline) {
        try {
          const r = await fetch(`${base}/api/health`, { cache: "no-store" });
          if (r.ok) break;
        } catch {
          /* API not up yet */
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      if (!cancelled) {
        setReady(true);
        setSplash(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (splash || !ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-6 text-[#FAFAFA]">
        <p className="font-editorial-display text-2xl uppercase tracking-[0.35em] text-deep-charcoal/90">
          Oliver Roos Frisuren
        </p>
        <p className="mt-6 max-w-xs text-center text-[11px] font-light uppercase leading-loose tracking-[0.4em] text-deep-charcoal/53">
          Studio wird geöffnet …
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
