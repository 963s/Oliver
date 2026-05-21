import { useEffect, useRef } from "react";

const EVENTS: (keyof DocumentEventMap)[] = [
  "mousemove",
  "mousedown",
  "touchstart",
  "keydown",
  "scroll",
  "wheel",
  "click",
];

/**
 * Calls `onIdle` after `ms` without user activity (touch/mouse/keyboard/scroll). POS safety.
 */
export function useIdleTimeout(onIdle: () => void, ms: number = 120_000): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    let t: number | undefined;

    const reset = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => onIdleRef.current(), ms);
    };

    for (const ev of EVENTS) {
      document.addEventListener(ev, reset, { capture: true, passive: true });
    }
    reset();
    return () => {
      if (t) window.clearTimeout(t);
      for (const ev of EVENTS) {
        document.removeEventListener(ev, reset, true);
      }
    };
  }, [ms]);
}
