import { and, eq, gte, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";

type SnapshotShape = {
  periodFromMs?: number;
  periodToMs?: number;
  grossSalesCents?: number;
  vat?: { vat7Cents?: number; vat19Cents?: number; totalVatCents?: number };
  payments?: {
    cash?: number;
    card?: number;
    voucher?: number;
    unpaidAufRechnung?: number;
  };
};

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractTseTransactionId(tseExportData: string | null, fallback: number): string {
  if (!tseExportData) return String(fallback);
  try {
    const p = JSON.parse(tseExportData) as Record<string, unknown>;
    const cands = [
      p.transactionId,
      p.transaction_id,
      p.txId,
      p.tx_id,
      (p.tse as Record<string, unknown> | undefined)?.transactionId,
      (p.tse as Record<string, unknown> | undefined)?.txId,
    ];
    for (const c of cands) {
      if (typeof c === "string" && c.trim()) return c.trim();
      if (typeof c === "number" && Number.isFinite(c)) return String(c);
    }
  } catch {
    // keep fallback
  }
  return String(fallback);
}

export function buildDatevCsvForDailyClose(
  db: BetterSQLite3Database<typeof schema>,
  dailyClosingId: number,
): { filename: string; csv: string } {
  const [closing] = db
    .select()
    .from(schema.dailyClosings)
    .where(eq(schema.dailyClosings.id, dailyClosingId))
    .limit(1)
    .all();
  if (!closing) {
    throw new Error("daily_close_not_found");
  }
  const snapshot = JSON.parse(closing.snapshotJson) as SnapshotShape;
  const fromMs = Number(snapshot.periodFromMs ?? 0);
  const toMs = Number(snapshot.periodToMs ?? closing.createdAt.getTime());

  const invoices = db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "closed"),
        gte(schema.invoices.createdAt, new Date(fromMs)),
        lte(schema.invoices.createdAt, new Date(toMs)),
      ),
    )
    .all();

  const header = [
    "RowType",
    "Buchungsdatum",
    "Belegfeld1",
    "Buchungstext",
    "Umsatz_19_Cents",
    "Umsatz_7_Cents",
    "Trinkgeld_0_Cents",
    "Gesamt_Cents",
    "TSE_Signatur",
    "TSE_Transaction_ID",
    "Invoice_ID",
    "DailyClose_ID",
    "Expected_Cash_Cents",
    "Actual_Cash_Cents",
    "Difference_Cents",
  ];
  const rows: (string | number)[][] = [header];

  rows.push([
    "Z_REPORT_SUMMARY",
    ymd(closing.createdAt),
    `Z-${closing.id}`,
    "Daily close summary",
    Number(snapshot.vat?.vat19Cents ?? 0) > 0 ? Number(snapshot.grossSalesCents ?? 0) : 0,
    Number(snapshot.vat?.vat7Cents ?? 0) > 0 ? Number(snapshot.grossSalesCents ?? 0) : 0,
    0,
    Number(snapshot.grossSalesCents ?? 0),
    "",
    "",
    "",
    closing.id,
    closing.expectedCashCents,
    closing.actualCashCents,
    closing.differenceCents,
  ]);

  for (const inv of invoices) {
    const lines = db
      .select()
      .from(schema.invoiceItems)
      .where(eq(schema.invoiceItems.invoiceId, inv.id))
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
    const tip0 = inv.tipAmountCents ?? 0;
    rows.push([
      "INVOICE",
      ymd(inv.createdAt),
      `INV-${inv.id}`,
      inv.stornoForInvoiceId != null ? "Storno invoice" : "Sale invoice",
      gross19,
      gross7,
      tip0,
      inv.totalAmountCents,
      inv.tseSignature ?? "",
      extractTseTransactionId(inv.tseExportData, inv.id),
      inv.id,
      closing.id,
      "",
      "",
      "",
    ]);
  }

  const csv = rows.map((r) => r.map((c) => csvCell(c)).join(";")).join("\n");
  return {
    filename: `datev_z_report_${closing.id}.csv`,
    csv,
  };
}
