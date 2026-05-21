/**
 * Desktop-first luxury shell tokens (2026 workstation). Compact by default.
 */

/** Floating panels, dropdowns, modals — maximum depth */
export const luxuryGlassFloat =
  "bg-gray-100/90 backdrop-blur-xl border border-deep-charcoal/10 shadow-[0_8px_32px_rgba(0,0,0,0.08)]";

export const luxuryGlassPanel =
  "bg-gray-100/90 backdrop-blur-xl border border-deep-charcoal/10 shadow-[0_8px_32px_rgba(0,0,0,0.08)]";

export const luxuryGlassPanelInner =
  "bg-gray-200/50 backdrop-blur-lg border border-deep-charcoal/[0.08]";

/** Primary CTA — compact desktop height (h-9, was h-16). */
export const luxuryButtonPrimary =
  "inline-flex h-9 items-center justify-center border border-editorial-pulse bg-editorial-pulse/10 px-6 text-[11px] font-medium uppercase tracking-[0.2em] text-editorial-pulse transition hover:bg-editorial-pulse/20 active:scale-[0.99] disabled:opacity-40";

export const luxuryButtonGhost =
  "inline-flex h-9 items-center justify-center border border-deep-charcoal/10 bg-transparent px-4 text-[11px] font-light uppercase tracking-[0.15em] text-deep-charcoal/60 transition hover:border-deep-charcoal/20 hover:text-deep-charcoal/80 active:scale-[0.99]";

/** POS settle / checkout — slightly taller for emphasis. */
export const luxuryPosSettleButton =
  "inline-flex h-10 w-full items-center justify-center gap-2 border border-editorial-pulse bg-editorial-pulse/12 px-6 text-[11px] font-medium uppercase tracking-[0.2em] text-editorial-pulse transition hover:bg-editorial-pulse/22 active:scale-[0.99] disabled:cursor-not-allowed disabled:border-deep-charcoal/8 disabled:bg-transparent disabled:text-deep-charcoal/35";

/** Base styles: `index.css` `.luxury-field` / `.luxury-select`. */
export const luxuryFieldClass = "luxury-field w-full";

export const luxurySelectClass = "luxury-field luxury-select w-full";
