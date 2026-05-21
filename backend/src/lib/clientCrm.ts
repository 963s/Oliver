/**
 * §12 — CRM helpers (GDPR-oriented naming + anonymization placeholders).
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
