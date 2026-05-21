import { and, eq, gte, isNull, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { berlinYmdFromMs } from "../../services/availabilityService.js";
import { invoiceBerlinYmd } from "./invoiceBerlinDate.js";
import { listMonitoredItemsAtOrBelowThreshold } from "../lowStockService.js";

export type ChefBriefingDto = {
  businessDateYmd: string;
  timezone: "Europe/Berlin";
  todayGrossCents: number;
  todayNetCents: number;
  closedInvoicesToday: number;
  appointmentCountToday: number;
  appointmentsBooked: number;
  appointmentsCheckedInOrDone: number;
  /** Katalog `reference_net_per_ml` × Verbrauch (heute) — Schätzwert, keine Vollkostenrechnung. */
  cogsEstimateNetCents: number;
  lowStockItems: {
    id: number;
    name: string;
    onHandMl: number;
    minStockThresholdMl: number | null;
  }[];
};

/**
 * Single aggregation for Chef-Ansicht: read on open, not on every SSE tick.
 */
export function buildChefBriefing(
  db: BetterSQLite3Database<typeof schema>,
  todayYmd: string,
): ChefBriefingDto {
  const scanFrom = new Date(Date.now() - 3 * 86_400_000);

  const invCandidates = db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "closed"),
        isNull(schema.invoices.stornoForInvoiceId),
        gte(schema.invoices.updatedAt, scanFrom),
      ),
    )
    .all();

  let todayGrossCents = 0;
  let todayNetCents = 0;
  let closedInvoicesToday = 0;
  for (const inv of invCandidates) {
    if (invoiceBerlinYmd(inv) !== todayYmd) continue;
    todayGrossCents += inv.totalAmountCents;
    todayNetCents += inv.totalAmountCents - inv.vatAmountCents;
    closedInvoicesToday += 1;
  }

  const apptScanTo = new Date(Date.now() + 2 * 86_400_000);
  const apptRows = db
    .select()
    .from(schema.appointments)
    .where(
      and(
        isNull(schema.appointments.deletedAt),
        gte(schema.appointments.startAt, scanFrom),
        lte(schema.appointments.startAt, apptScanTo),
      ),
    )
    .all();

  let appointmentCountToday = 0;
  let appointmentsBooked = 0;
  let appointmentsCheckedInOrDone = 0;
  for (const a of apptRows) {
    if (berlinYmdFromMs(a.startAt.getTime()) !== todayYmd) continue;
    if (a.status === "canceled" || a.status === "no_show") continue;
    appointmentCountToday += 1;
    if (a.status === "booked") appointmentsBooked += 1;
    if (a.status === "checked_in" || a.status === "completed") {
      appointmentsCheckedInOrDone += 1;
    }
  }

  const usageRows = db
    .select({
      adj: schema.inventoryAdjustments,
      item: schema.inventoryItems,
    })
    .from(schema.inventoryAdjustments)
    .innerJoin(
      schema.inventoryItems,
      eq(
        schema.inventoryAdjustments.inventoryItemId,
        schema.inventoryItems.id,
      ),
    )
    .where(eq(schema.inventoryAdjustments.reason, "usage_session"))
    .all();

  let cogsEstimateNetCents = 0;
  for (const { adj, item } of usageRows) {
    if (berlinYmdFromMs(adj.createdAt.getTime()) !== todayYmd) continue;
    const mlUsed = -adj.deltaMl;
    if (mlUsed > 0 && item.referenceNetPerMlCents > 0) {
      cogsEstimateNetCents += Math.round(mlUsed * item.referenceNetPerMlCents);
    }
  }

  const lowFull = listMonitoredItemsAtOrBelowThreshold(db);
  const lowStockItems = lowFull.map((row) => ({
    id: row.id,
    name: row.name,
    onHandMl: row.onHandMl,
    minStockThresholdMl: row.minStockThresholdMl ?? null,
  }));

  return {
    businessDateYmd: todayYmd,
    timezone: "Europe/Berlin",
    todayGrossCents,
    todayNetCents,
    closedInvoicesToday,
    appointmentCountToday,
    appointmentsBooked,
    appointmentsCheckedInOrDone,
    cogsEstimateNetCents,
    lowStockItems,
  };
}

