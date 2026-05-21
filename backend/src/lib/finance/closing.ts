import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";

function signedJournalAmount(row: { entryType: string; amountCents: number }): number {
  if (row.entryType === "opening_float") return row.amountCents;
  if (row.entryType === "payout") return -row.amountCents;
  if (row.entryType === "transit") return -row.amountCents;
  return 0;
}

export function computeExpectedCashCents(
  db: BetterSQLite3Database<typeof schema>,
  atMs: number,
): {
  expectedCashCents: number;
  baseCashCents: number;
  cashSalesCents: number;
  journalDeltaCents: number;
  fromMs: number;
} {
  const [lastClose] = db
    .select()
    .from(schema.dailyClosings)
    .orderBy(sql`${schema.dailyClosings.createdAt} desc`)
    .limit(1)
    .all();
  const fromMs = lastClose?.createdAt?.getTime?.() ?? 0;
  const baseCashCents = lastClose?.actualCashCents ?? 0;

  const closedInvoices = db
    .select({
      id: schema.invoices.id,
      createdAt: schema.invoices.createdAt,
    })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "closed"),
        gt(schema.invoices.createdAt, new Date(fromMs)),
        lte(schema.invoices.createdAt, new Date(atMs)),
      ),
    )
    .all();
  const invoiceIds = closedInvoices.map((r) => r.id);
  const cashPayments =
    invoiceIds.length === 0
      ? []
      : db
          .select()
          .from(schema.invoicePayments)
          .where(
            and(
              inArray(schema.invoicePayments.invoiceId, invoiceIds),
              eq(schema.invoicePayments.method, "cash"),
            ),
          )
          .all();
  const cashSalesCents = cashPayments.reduce((s, p) => s + p.amountCents, 0);

  const journalRows = db
    .select()
    .from(schema.cashJournal)
    .where(
      and(
        gt(schema.cashJournal.createdAt, new Date(fromMs)),
        lte(schema.cashJournal.createdAt, new Date(atMs)),
      ),
    )
    .all();
  const journalDeltaCents = journalRows.reduce(
    (s, r) => s + signedJournalAmount(r),
    0,
  );

  return {
    expectedCashCents: baseCashCents + cashSalesCents + journalDeltaCents,
    baseCashCents,
    cashSalesCents,
    journalDeltaCents,
    fromMs,
  };
}

export function buildDailyCloseSnapshot(
  db: BetterSQLite3Database<typeof schema>,
  fromMs: number,
  toMs: number,
) {
  const invoiceRows = db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "closed"),
        gt(schema.invoices.createdAt, new Date(fromMs)),
        lte(schema.invoices.createdAt, new Date(toMs)),
      ),
    )
    .all();
  const invoiceIds = invoiceRows.map((r) => r.id);
  const paymentRows =
    invoiceIds.length === 0
      ? []
      : db
          .select()
          .from(schema.invoicePayments)
          .where(inArray(schema.invoicePayments.invoiceId, invoiceIds))
          .all();

  const grossSalesCents = invoiceRows.reduce((s, r) => s + r.totalAmountCents, 0);
  const vatTotalCents = invoiceRows.reduce((s, r) => s + r.vatAmountCents, 0);
  const vat7Cents = 0;
  const vat19Cents = vatTotalCents;
  const paymentsByMethod = {
    cash: paymentRows
      .filter((p) => p.method === "cash")
      .reduce((s, p) => s + p.amountCents, 0),
    card: paymentRows
      .filter((p) => p.method === "card")
      .reduce((s, p) => s + p.amountCents, 0),
    voucher: paymentRows
      .filter((p) => p.method === "voucher")
      .reduce((s, p) => s + p.amountCents, 0),
    unpaidAufRechnung: paymentRows
      .filter((p) => p.method === "unpaid_auf_rechnung")
      .reduce((s, p) => s + p.amountCents, 0),
  };

  return {
    periodFromMs: fromMs,
    periodToMs: toMs,
    invoiceCount: invoiceRows.length,
    grossSalesCents,
    vat: {
      vat7Cents,
      vat19Cents,
      totalVatCents: vatTotalCents,
    },
    payments: paymentsByMethod,
  };
}
