/**
 * §12 — CRM helpers (GDPR-oriented naming + anonymization placeholders + reliability scoring).
 */

export function splitClientDisplayName(full: string): {
  firstName: string;
  lastName: string;
} {
  const t = String(full ?? "").trim();
  if (!t) return { firstName: "Unknown", lastName: "" };
  const i = t.indexOf(" ");
  if (i === -1) return { firstName: t, lastName: "" };
  return {
    firstName: t.slice(0, i).trim() || "Unknown",
    lastName: t.slice(i + 1).trim(),
  };
}

export function buildClientDisplayName(firstName: string, lastName: string): string {
  const a = String(firstName ?? "").trim();
  const b = String(lastName ?? "").trim();
  const s = [a, b].filter(Boolean).join(" ");
  return s.length > 0 ? s : "Unknown";
}

/** Escape `%` and `_` for SQLite LIKE with ESCAPE '\'. */
export function escapeLikePattern(raw: string): string {
  return String(raw)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

export const ANONYMIZED_FIRST = "Anonymous";
export const ANONYMIZED_LAST = "Client";
export const ANONYMIZED_DISPLAY = "Anonymous Client";

/* ── Reliability score (0..100) ─────────────────────────────────────────────
   Business intent: a single integer the salon owner can scan at a glance.
   High = trustworthy regular, low = chronic no-show. Used as input to
   pricing decisions (deposit required?), agenda warnings (yellow chip),
   and the Client 360° header.

   Inputs are *current counters*, not a time-windowed sample — the salon
   doesn't run a high enough volume for windowing to matter. Cancels are
   weighted less than no-shows because a phoned cancel is still respectful.

   Cap deductions individually so a single bad week doesn't permanently
   tank the score, then clamp to [0, 100]. On-time completions add a small
   bonus capped at +20, so a clean record always reads as a green 100.
*/

export interface ReliabilityInputs {
  noShows: number;
  cancels: number;
  /** Completed visits (closed sessions) — used for the on-time bonus. */
  completed: number;
}

export function computeReliabilityScore(inputs: ReliabilityInputs): number {
  const noShowPenalty = Math.min(60, Math.max(0, inputs.noShows) * 15);
  const cancelPenalty = Math.min(32, Math.max(0, inputs.cancels) * 8);
  const onTimeBonus = Math.min(20, Math.max(0, inputs.completed) * 2);
  const raw = 100 - noShowPenalty - cancelPenalty + onTimeBonus;
  return Math.max(0, Math.min(100, raw));
}
