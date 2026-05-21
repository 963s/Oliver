/**
 * Runtime shell detection: Tauri 2 webview vs a normal browser tab (e.g. iPad PWA).
 * Step 43 — infrastructure only; hardware / ESC-POS / ZVT bridges can branch on `isTauriShell()`.
 */

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

/** True when the UI is hosted inside a Tauri 2 desktop shell (not a standalone browser). */
export function isTauriShell(): boolean {
  if (typeof window === "undefined") return false;
  return window.__TAURI__ != null || window.__TAURI_INTERNALS__ != null;
}

/** True when running in a normal browser (Chrome, Safari, etc.), including PWA standalone. */
export function isBrowserTab(): boolean {
  return !isTauriShell();
}

/**
 * Heuristic for “installed” PWA / standalone display — not the same as iPad hardware,
 * but useful to distinguish browser-tab dev from home-screen launch.
 */
export function isLikelyStandalonePwa(): boolean {
  if (typeof window === "undefined" || isTauriShell()) return false;
  const mq = window.matchMedia?.("(display-mode: standalone)");
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return mq?.matches === true || nav.standalone === true;
}
