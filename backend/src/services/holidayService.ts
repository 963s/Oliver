import Holidays from "date-holidays";

/** Germany — Baden-Württemberg (Bundesland codes match ISO 3166-2:DE). */
const REGION_DE_BW = { country: "DE", state: "BW" } as const;

/**
 * Single configured instance: Gesetzliche Feiertage for BW; names resolved in German (`de`).
 * No SQLite persistence — recomputed per request/year (Phase 2 availability engine).
 */
const bwPublic = new Holidays(REGION_DE_BW.country, REGION_DE_BW.state, {
  languages: ["de"],
});

export type PublicHolidayDto = {
  date: string;
  name: string;
};

/**
 * Returns gesetzliche Feiertage (type `public`) for BW as sorted calendar dates `YYYY-MM-DD`.
 */
export function getHolidaysForYear(year: number): PublicHolidayDto[] {
  const rows = bwPublic.getHolidays(year, "de");
  const publicOnly = rows.filter((h) => h.type === "public");
  const mapped = publicOnly.map((h) => ({
    date: h.date.slice(0, 10),
    name: h.name,
  }));
  mapped.sort((a, b) => a.date.localeCompare(b.date));
  return mapped;
}
