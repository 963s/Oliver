import * as schema from "../../db/schema.js";
import { berlinYmdFromMs } from "../../services/availabilityService.js";

/** Kalendertag des Beleges in Europe/Berlin (wie Chef-Briefing). */
export function invoiceBerlinYmd(
  inv: typeof schema.invoices.$inferSelect,
): string {
  const ms =
    inv.tseEndTime?.getTime() ??
    inv.updatedAt.getTime() ??
    inv.createdAt.getTime();
  return berlinYmdFromMs(ms);
}
