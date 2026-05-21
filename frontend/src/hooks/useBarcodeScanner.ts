import { useEffect, useRef } from "react";

const MAX_BUF = 64;
const INTER_CHAR_RESET_MS = 55;

/**
 * HID barcode wedge: digit/alnum burst + Enter — ignores slow human typing between bursts.
 * Uses capture phase so routes like Wareneingang can consume scans without focusing an input.
 */
export function useBarcodeScanner(opts: {
  onScan: (barcode: string) => void;
  enabled?: boolean;
}) {
  const enabled = opts.enabled ?? true;
  const cbRef = useRef(opts.onScan);
  cbRef.current = opts.onScan;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const bufRef = { current: "" };
    const lastTsRef = { current: 0 };
    let gapClear: ReturnType<typeof setTimeout> | null = null;

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = Date.now();

      if (e.key === "Enter") {
        const raw = bufRef.current.trim();
        bufRef.current = "";
        lastTsRef.current = 0;
        if (gapClear) {
          clearTimeout(gapClear);
          gapClear = null;
        }
        if (raw.length >= 3) {
          e.preventDefault();
          e.stopPropagation();
          cbRef.current(raw);
        }
        return;
      }

      if (e.key.length === 1 && /[0-9A-Za-z]/.test(e.key)) {
        if (
          lastTsRef.current > 0 &&
          now - lastTsRef.current > INTER_CHAR_RESET_MS
        ) {
          bufRef.current = "";
        }
        bufRef.current += e.key;
        if (bufRef.current.length > MAX_BUF) {
          bufRef.current = bufRef.current.slice(-MAX_BUF);
        }
        lastTsRef.current = now;
        if (gapClear) clearTimeout(gapClear);
        gapClear = setTimeout(() => {
          bufRef.current = "";
          lastTsRef.current = 0;
        }, 120);
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (gapClear) clearTimeout(gapClear);
    };
  }, [enabled]);
}
