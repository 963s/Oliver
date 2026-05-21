import { and, eq, gte, isNull, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";

function dayBounds(dateStr: string): { from: Date; to: Date } {
  const [y, m, d] = String(dateStr).split("-").map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error("invalid_target_date");
  }
  const from = new Date(y, m - 1, d, 0, 0, 0, 0);
  const to = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { from, to };
}

function lineGrossCents(line: {
  quantity: number;
  unitNetCents: number;
  vatRateBps: number;
}): number {
  const q = Math.max(1, Math.floor(line.quantity));
  const unitNet = Math.floor(line.unitNetCents);
  const bps = Math.floor(line.vatRateBps);
  const net = q * unitNet;
  const vat = Math.round((net * bps) / 10000);
  return net + vat;
}

export function computeStaffPerformanceForDate(
  db: BetterSQLite3Database<typeof schema>,
  staffId: number,
  targetDate: string,
): {
  serviceAchievedCents: number;
  retailAchievedCents: number;
  totalAchievedCents: number;
} {
  const { from, to } = dayBounds(targetDate);
  const invoiceRows = db
    .select({
      id: schema.invoices.id,
    })
    .from(schema.invoices)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.invoices.sessionId))
    .where(
      and(
        eq(schema.invoices.status, "closed"),
        eq(schema.sessions.staffId, staffId),
        isNull(schema.invoices.stornoForInvoiceId),
        gte(schema.invoices.createdAt, from),
        lte(schema.invoices.createdAt, to),
      ),
    )
    .all();
  if (invoiceRows.length === 0) {
    return {
      serviceAchievedCents: 0,
      retailAchievedCents: 0,
      totalAchievedCents: 0,
    };
  }
  const invoiceIds = invoiceRows.map((r) => r.id);
  let serviceAchievedCents = 0;
  let retailAchievedCents = 0;
  for (const invoiceId of invoiceIds) {
    const lineRows = db
      .select({
        id: schema.invoiceItems.id,
        quantity: schema.invoiceItems.quantity,
        unitNetCents: schema.invoiceItems.unitNetCents,
        vatRateBps: schema.invoiceItems.vatRateBps,
        inventoryItemId: schema.invoiceItems.inventoryItemId,
      })
      .from(schema.invoiceItems)
      .where(eq(schema.invoiceItems.invoiceId, invoiceId))
      .all();
    for (const line of lineRows) {
      const gross = lineGrossCents(line);
      if (line.inventoryItemId == null) {
        serviceAchievedCents += gross;
        continue;
      }
      const [inv] = db
        .select({ isRetail: schema.inventoryItems.isRetail })
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.id, line.inventoryItemId))
        .limit(1)
        .all();
      if (inv?.isRetail) retailAchievedCents += gross;
      else serviceAchievedCents += gross;
    }
  }
  return {
    serviceAchievedCents,
    retailAchievedCents,
    totalAchievedCents: serviceAchievedCents + retailAchievedCents,
  };
}
