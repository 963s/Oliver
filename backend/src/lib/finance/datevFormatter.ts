/**
 * German CSV conventions for DATEV-style exports: semicolon delimiter, comma as decimal separator.
 */

/** Convert integer cents to German EUR display (e.g. 1250 → "12,50"). */
export function formatCentsDeGerman(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const euros = Math.floor(abs / 100);
  const cs = abs % 100;
  const euroPart = euros.toLocaleString("de-DE", { useGrouping: false });
  return `${sign}${euroPart},${String(cs).padStart(2, "0")}`;
}

export function escapeCsvCell(v: string): string {
  if (v.includes(";") || v.includes('"') || v.includes("\n") || v.includes("\r")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/** Build CSV with `;` delimiter and `\n` row endings (UTF-8). */
export function buildSemicolonCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((c) => escapeCsvCell(c)).join(";"))
    .join("\n");
}
