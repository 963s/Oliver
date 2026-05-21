/**
 * Read-only invariant checks on the SQLite DB (architectural / GoBD sanity).
 *
 * Run from `backend/`: `npm run integrity:check` (or `node dist/scripts/integrity_checker.js` after `npm run build`).
 * Honors `DATABASE_PATH` (same as `openDb()`); default: `backend/data/salon.db`.
 */
import { eq, and, sql } from "drizzle-orm";
import { openDb } from "../db/index.js";
import * as schema from "../db/schema.js";

type CheckName =
  | "closed_invoice_missing_fiscal_trail"
  | "negative_salon_stock"
  | "invoice_payments_total_mismatch";

interface CheckResult {
  name: CheckName;
  pass: boolean;
  message: string;
  sampleIds?: number[];
}

function printResult(r: CheckResult): void {
  const status = r.pass ? "PASS" : "FAIL";
  // eslint-disable-next-line no-console
  console.log(`[${status}] ${r.name}: ${r.message}`);
  if (r.sampleIds && r.sampleIds.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `        sample ids: ${r.sampleIds.slice(0, 20).join(", ")}${r.sampleIds.length > 20 ? " …" : ""}`,
    );
  }
}

function checkClosedInvoicesFiscalTrail(
  db: ReturnType<typeof openDb>,
): CheckResult {
  const closed = db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.status, "closed"))
    .all();

  const bad: number[] = [];
  for (const inv of closed) {
    const sig = inv.tseSignature?.trim() ?? "";
    if (sig.length > 0) {
      continue;
    }
    const [ausfall] = db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entity, "invoices"),
          eq(schema.auditLogs.entityId, inv.id),
          eq(schema.auditLogs.action, "tse_ausfall_detected"),
        ),
      )
      .limit(1)
      .all();
    if (!ausfall) {
      bad.push(inv.id);
    }
  }

  return {
    name: "closed_invoice_missing_fiscal_trail",
    pass: bad.length === 0,
    message:
      bad.length === 0
        ? "no closed invoice without tse_signature and without tse_ausfall_detected audit"
        : `found ${bad.length} closed invoice(s) with empty tse_signature and no tse_ausfall_detected audit`,
    sampleIds: bad,
  };
}

function checkNegativeSalonStock(
  db: ReturnType<typeof openDb>,
): CheckResult {
  const negStock = db
    .select({ id: schema.inventoryItems.id })
    .from(schema.inventoryItems)
    .where(
      and(
        sql`${schema.inventoryItems.onHandMl} < 0`,
        eq(schema.inventoryItems.isRetail, false),
      ),
    )
    .all();

  return {
    name: "negative_salon_stock",
    pass: negStock.length === 0,
    message:
      negStock.length === 0
        ? "no salon (non-retail) items with on_hand_ml < 0"
        : `found ${negStock.length} salon item(s) with negative on_hand_ml`,
    sampleIds: negStock.map((r) => r.id),
  };
}

function checkInvoicePaymentTotals(
  db: ReturnType<typeof openDb>,
): CheckResult {
  const closed = db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.status, "closed"))
    .all();

  const mismatch: number[] = [];
  for (const inv of closed) {
    const payRows = db
      .select()
      .from(schema.invoicePayments)
      .where(eq(schema.invoicePayments.invoiceId, inv.id))
      .all();
    const sumCents = payRows.reduce((a, p) => a + p.amountCents, 0);
    if (sumCents !== inv.totalAmountCents) {
      mismatch.push(inv.id);
    }
  }

  return {
    name: "invoice_payments_total_mismatch",
    pass: mismatch.length === 0,
    message:
      mismatch.length === 0
        ? "all closed invoices: sum(payments) == total_amount_cents"
        : `found ${mismatch.length} closed invoice(s) where payment sum ≠ total_amount_cents (expected total_amount_cents)`,
    sampleIds: mismatch,
  };
}

function main() {
  /** Read-only on an already-migrated DB (same as production). Do not run migrator here — journal SQL may be multi-statement. */
  const db = openDb(false);

  try {
    db.select().from(schema.invoices).limit(1).all();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("no such table")) {
      // eslint-disable-next-line no-console
      console.error(
        "integrity_checker: schema missing or empty DB. Start the API once to apply migrations, or set DATABASE_PATH to a migrated salon.db (see backend/src/db/index.ts).",
      );
      process.exitCode = 2;
      return;
    }
    throw e;
  }

  // eslint-disable-next-line no-console
  console.log("integrity_checker: scanning database invariants…\n");

  const results: CheckResult[] = [
    checkClosedInvoicesFiscalTrail(db),
    checkNegativeSalonStock(db),
    checkInvoicePaymentTotals(db),
  ];

  for (const r of results) {
    printResult(r);
  }

  const allPass = results.every((r) => r.pass);
  // eslint-disable-next-line no-console
  console.log(
    `\nintegrity_checker: ${allPass ? "ALL CHECKS PASSED" : "ONE OR MORE CHECKS FAILED"} (exit ${allPass ? 0 : 1})`,
  );
  if (!allPass) {
    process.exitCode = 1;
  }
}

main();
