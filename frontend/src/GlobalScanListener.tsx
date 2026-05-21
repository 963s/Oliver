import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const NO_CAPTURE = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * USB / Bluetooth HID barcode pistol (§12.5.39) — quick digits + Enter.
 * Skips when focus is in an editable field.
 */
export function GlobalScanListener() {
  const navigate = useNavigate();
  const location = useLocation();
  const buffer = useRef("");

  useEffect(() => {
    const flush = (raw: string) => {
      const code = raw.trim();
      if (code.length < 3) {
        return;
      }
      if (location.pathname.startsWith("/admin/wareneingang")) {
        buffer.current = "";
        return;
      }
      navigate({ pathname: "/scan", search: `?barcode=${encodeURIComponent(code)}` });
      buffer.current = "";
    };

    const onKey = (e: KeyboardEvent) => {
      if (location.pathname.startsWith("/admin/wareneingang")) {
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el) {
        if (NO_CAPTURE.has(el.tagName) || el.isContentEditable) return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter") {
        if (buffer.current.trim().length >= 3) {
          e.preventDefault();
          flush(buffer.current);
        }
        return;
      }
      if (e.key.length === 1 && /[0-9A-Za-z]/.test(e.key)) {
        buffer.current += e.key;
        if (buffer.current.length > 64) {
          buffer.current = buffer.current.slice(-64);
        }
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [navigate, location.pathname]);

  return null;
}
