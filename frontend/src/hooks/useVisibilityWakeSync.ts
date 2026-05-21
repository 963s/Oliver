import { useEffect, useRef } from "react";
import { usePulseStore } from "../store/pulseStore";

/**
 * When the PWA / iPad wakes, SSE may have missed events — run a silent refetch
 * of queue-critical data (via pulse counter) plus optional per-screen work.
 */
export function useVisibilityWakeSync(onVisible?: () => void): void {
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;
  const bump = usePulseStore((s) => s.incrementGlobalRefreshCounter);

  useEffect(() => {
    const h = () => {
      if (document.visibilityState !== "visible") return;
      bump();
      onVisibleRef.current?.();
    };
    document.addEventListener("visibilitychange", h, { passive: true });
    return () => document.removeEventListener("visibilitychange", h);
  }, [bump]);
}
