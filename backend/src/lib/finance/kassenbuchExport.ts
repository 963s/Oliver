import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { berlinYmdFromMs } from "../../services/availabilityService.js";
import { berlinCalendarMonthUtcRange } from "./berlinMonthBounds.js";
import {
  buildSemicolonCsv,
  formatCentsDeGerman,
} from "./datevFormatter.js";

type SnapshotShape = {
  payments?: {
    cash?: number;
    card?: number;
    voucher?: number;
    unpaidAufRechnung?: number;
  };
};

function invoiceGrossSplitByVat(
  db: BetterSQLite3Database<typeof schema>,
  invoiceId: number,
): { gross19: number; gross7: number } {
  const lines = db
    .select()
    .from(schema.invoiceItems)
    .where(eq(schema.invoiceItems.invoiceId, invoiceId))
    .all();
  let gross19 = 0;
  let gross7 = 0;
  for (const line of lines) {
    const net = line.quantity * line.unitNetCents;
    const vat = Math.round((net * line.vatRateBps) / 10000);
    const gross = net + vat;
    if (line.vatRateBps === 700) gross7 += gross;
    else gross19 += gross;
  }
  return { gross19, gross7 };
}

function paymentLabelForInvoice(
  db: BetterSQLite3Database<typeof schema>,
  invoiceId: number,
): string {
  const pays = db
    .select()
    .from(schema.invoicePayments)
    .where(eq(schema.invoicePayments.invoiceId, invoiceId))
    .all();
  let cash = 0;
  let card = 0;
  let voucher = 0;
  let unpaid = 0;
  for (const p of pays) {
    if (p.method === "cash") cash += p.amountCents;
    else if (p.method === "card") card += p.amountCents;
    else if (p.method === "voucher") voucher += p.amountCents;
    else if (p.method === "unpaid_auf_rechnung") unpaid += p.amountCents;
  }
  const parts: string[] = [];
  if (cash > 0) parts.push("Bar");
  if (card > 0) parts.push("EC");
  if (voucher > 0) parts.push("Gutschein");
  if (unpaid > 0) parts.push("Auf Rechnung");
  return parts.length > 0 ? parts.join("; ") : "";
}

function snapshotPaymentLabel(snapshot: SnapshotShape): string {
  const p = snapshot.payments;
  if (!p) return "";
  const parts: string[] = [];
  if ((p.cash ?? 0) > 0) parts.push("Bar");
  if ((p.card ?? 0) > 0) parts.push("EC");
  if ((p.voucher ?? 0) > 0) parts.push("Gutschein");
  if ((p.unpaidAufRechnung ?? 0) > 0) parts.push("Auf Rechnung");
  return parts.join("; ");
}

export type KassenbuchExportMeta = {
  filename: string;
  csv: string;
  closingCount: number;
  invoiceCount: number;
};

/**
 * Single calendar month (Europe/Berlin), semicolon CSV, German decimal commas.
 * Rows: Belege (closed invoices) + Tagesabschlusszeilen (daily closings in month).
 */
export function buildKassenbuchCsvForMonth(
  db: BetterSQLite3Database<typeof schema>,
  monthYm: string,
): KassenbuchExportMeta {
  const { startMs, endMsExclusive } = berlinCalendarMonthUtcRange(monthYm);

  const invoices = db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "closed"),
        gte(schema.invoices.createdAt, new Date(startMs)),
        lt(schema.invoices.createdAt, new Date(endMsExclusive)),
      ),
    )
    .orderBy(asc(schema.invoices.createdAt), asc(schema.invoices.id))
    .all();

  const closings = db
    .select()
    .from(schema.dailyClosings)
    .where(
      and(
        gte(schema.dailyClosings.createdAt, new Date(startMs)),
        lt(schema.dailyClosings.createdAt, new Date(endMsExclusive)),
      ),
    )
    .orderBy(asc(schema.dailyClosings.createdAt), asc(schema.dailyClosings.id))
    .all();

  const header = [
    "Datum",
    "Belegnummer",
    "Buchungstext",
    "Umsatz 19%",
    "Umsatz 7%",
    "Zahlungsart",
  ];
  const rows: string[][] = [header];

  for (const inv of invoices) {
    const split = invoiceGrossSplitByVat(db, inv.id);
    const gross19col =
      split.gross19 !== 0 ? formatCentsDeGerman(split.gross19) : "";
    const gross7col =
      split.gross7 !== 0 ? formatCentsDeGerman(split.gross7) : "";
    const buchung =
      inv.stornoForInvoiceId != null
        ? `Storno zu INV-${inv.stornoForInvoiceId}`
        : "Tageseinnahmen";
    rows.push([
      berlinYmdFromMs(inv.createdAt.getTime()),
      `INV-${inv.id}`,
      buchung,
      gross19col,
      gross7col,
      paymentLabelForInvoice(db, inv.id),
    ]);
  }

  for (const c of closings) {
    let snapshot: SnapshotShape = {};
    try {
      snapshot = JSON.parse(c.snapshotJson) as SnapshotShape;
    } catch {
      snapshot = {};
    }
    const payLabs = snapshotPaymentLabel(snapshot);
    rows.push([
      berlinYmdFromMs(c.createdAt.getTime()),
      `Z-${c.id}`,
      "Tagesabschluss Kasse (Z-Nachweis; Umsatz siehe INV-Zeilen)",
      "",
      "",
      payLabs,
    ]);
  }

  const dataRows = rows.slice(1);
  dataRows.sort((a, b) => {
    if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
    return a[1].localeCompare(b[1]);
  });

  const csv = "\ufeff" + buildSemicolonCsv([header, ...dataRows]);
  const fnYm = monthYm.trim().replace("-", "_");
  return {
    filename: `kassenbuch_${fnYm}.csv`,
    csv,
    closingCount: closings.length,
    invoiceCount: invoices.length,
  };
}
