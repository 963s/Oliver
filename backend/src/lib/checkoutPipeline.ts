import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { writeAudit } from "./audit.js";
import { writeAuditTx } from "./audit.js";
import { computeLine } from "./germanVat.js";
import { signInvoiceFiscal } from "../modules/fiscal/tseAdapter.js";
import { resolvePaymentProof, type ZvtDirectBody } from "./checkoutPaymentProof.js";
import {
  applyCheckoutInventoryDeductions,
  type CheckoutDeductLine,
  InsufficientSalonStockError,
} from "./inventoryCheckoutDeduction.js";
import { validateVoucher } from "./finance/vouchers.js";
import { eventBus } from "./events/bus.js";
import { HardwareQueueService } from "./services/hardwareQueueService.js";
import { LoyaltyService } from "./services/loyaltyService.js";
import { AppError, CheckoutErrorCode } from "./errors/AppError.js";

type CheckoutBody = {
  /** §36 — Required when any line deviates from salon_service_catalog net/VAT (GoBD). */
  priceOverrideReason?: string;
  items?: {
    description?: string;
    quantity?: number;
    unitNetCents?: number;
    vatRateBps?: number;
    /** Link line to `inventory_items`; both required if either set. */
    inventoryItemId?: number;
    /** Integer ml to deduct per unit (× `quantity` at TSE close). */
    deductMl?: number;
  }[];
  zvt?: ZvtDirectBody;
  orphanPaymentId?: number;
  payments?: {
    amountCents?: number;
    method?: schema.InvoicePaymentMethod;
    voucherCode?: string;
  }[];
  tipAmountCents?: number;
  tipStaffId?: number | null;
  invoiceKind?: schema.InvoiceKind;
};

type LineComputed = {
  description: string;
  quantity: number;
  unitNetCents: number;
  vatRateBps: number;
  lineNetCents: number;
  lineVatCents: number;
  inventoryItemId: number | null;
  deductMl: number | null;
};

export type CheckoutPipelineError = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * §16 — ZVT → TSE → (§8) inventory ml deduction in same close tx.
 * No fiscal close if salon stock would go negative (non-retail); retail negative allowed with audit.
 */
export async function runSessionCheckoutPipeline(
  db: BetterSQLite3Database<typeof schema>,
  opts: {
    staffId: number;
    sessionId: number;
    body: CheckoutBody;
  },
): Promise<
  | { ok: true; status: number; json: Record<string, unknown> }
  | { ok: false; err: CheckoutPipelineError }
> {
  const { staffId, sessionId, body } = opts;

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return {
      ok: false,
      err: { status: 400, body: { error: "items_required" } },
    };
  }
  if (!Array.isArray(body.payments) || body.payments.length === 0) {
    return {
      ok: false,
      err: { status: 400, body: { error: "payments_required" } },
    };
  }

  const [sessionBefore] = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1)
    .all();
  if (!sessionBefore) {
    return { ok: false, err: { status: 404, body: { error: "not_found" } } };
  }
  if (sessionBefore.status !== "open") {
    return { ok: false, err: { status: 409, body: { error: "session_not_open" } } };
  }

  const existingInvoices = db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.sessionId, sessionId))
    .all();
  const blocking = existingInvoices.filter(
    (inv) => inv.status === "draft" || inv.status === "closed",
  );
  if (blocking.length > 0) {
    return {
      ok: false,
      err: {
        status: 409,
        body: {
          error: "invoice_already_exists",
          invoices: blocking.map((i) => ({ id: i.id, status: i.status })),
        },
      },
    };
  }

  const lines: LineComputed[] = [];

  for (const raw of body.items) {
    const description = String(raw.description ?? "").trim();
    if (!description) {
      return {
        ok: false,
        err: { status: 400, body: { error: "invalid_item_description" } },
      };
    }
    const hasInv = raw.inventoryItemId != null;
    const hasDm = raw.deductMl != null;
    if (hasInv !== hasDm) {
      return {
        ok: false,
        err: { status: 400, body: { error: "inventory_line_incomplete" } },
      };
    }
    let invId: number | null = null;
    let deductMl: number | null = null;
    if (hasInv) {
      invId = Math.floor(Number(raw.inventoryItemId));
      deductMl = Math.floor(Number(raw.deductMl));
      if (!Number.isFinite(invId) || invId < 1) {
        return {
          ok: false,
          err: { status: 400, body: { error: "inventory_item_id_invalid" } },
        };
      }
      if (!Number.isFinite(deductMl) || deductMl < 1) {
        return {
          ok: false,
          err: { status: 400, body: { error: "deduct_ml_invalid" } },
        };
      }
      const [it] = db
        .select()
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.id, invId))
        .limit(1)
        .all();
      if (!it) {
        return {
          ok: false,
          err: { status: 400, body: { error: "inventory_item_not_found" } },
        };
      }
    }
    const computed = computeLine({
      quantity: Number(raw.quantity ?? 1),
      unitNetCents: Number(raw.unitNetCents),
      vatRateBps: Number(raw.vatRateBps),
    });
    if (!computed) {
      return { ok: false, err: { status: 400, body: { error: "invalid_item" } } };
    }
    lines.push({
      description,
      quantity: computed.quantity,
      unitNetCents: computed.unitNetCents,
      vatRateBps: computed.vatRateBps,
      lineNetCents: computed.lineNetCents,
      lineVatCents: computed.lineVatCents,
      inventoryItemId: invId,
      deductMl: deductMl,
    });
  }

  type CatalogDeviation = {
    serviceName: string;
    catalogNetCents: number;
    chargedUnitNetCents: number;
    catalogVatBps: number;
    chargedVatBps: number;
  };
  const catalogDeviations: CatalogDeviation[] = [];
  for (const line of lines) {
    const [cat] = db
      .select()
      .from(schema.salonServiceCatalog)
      .where(eq(schema.salonServiceCatalog.serviceName, line.description))
      .limit(1)
      .all();
    if (!cat || cat.referenceNetCents <= 0) continue;
    if (
      line.unitNetCents !== cat.referenceNetCents ||
      line.vatRateBps !== cat.vatRateBps
    ) {
      catalogDeviations.push({
        serviceName: line.description,
        catalogNetCents: cat.referenceNetCents,
        chargedUnitNetCents: line.unitNetCents,
        catalogVatBps: cat.vatRateBps,
        chargedVatBps: line.vatRateBps,
      });
    }
  }
  let priceOverrideAuditPack: {
    deviations: CatalogDeviation[];
    reason: string;
  } | null = null;
  if (catalogDeviations.length > 0) {
    const reason = String(body.priceOverrideReason ?? "").trim();
    if (!reason) {
      return {
        ok: false,
        err: {
          status: 400,
          body: { error: "price_override_reason_required" },
        },
      };
    }
    priceOverrideAuditPack = { deviations: catalogDeviations, reason };
  }

  const netCents = lines.reduce((s, l) => s + l.lineNetCents, 0);
  const vatCents = lines.reduce((s, l) => s + l.lineVatCents, 0);
  const grossCents = netCents + vatCents;
  const tipAmountCents = Math.floor(Number(body.tipAmountCents ?? 0));
  if (!Number.isFinite(tipAmountCents) || tipAmountCents < 0) {
    return {
      ok: false,
      err: { status: 400, body: { error: "tip_amount_invalid" } },
    };
  }
  const totalDueCents = grossCents + tipAmountCents;
  const invoiceKind = String(body.invoiceKind ?? "normal").trim() as schema.InvoiceKind;
  if (!["normal", "deposit_anzahlung", "final"].includes(invoiceKind)) {
    return {
      ok: false,
      err: { status: 400, body: { error: "invoice_kind_invalid" } },
    };
  }
  const tipStaffIdRaw = body.tipStaffId ?? null;
  const tipStaffId =
    tipStaffIdRaw == null ? null : Math.floor(Number(tipStaffIdRaw));
  if (tipStaffId != null && (!Number.isFinite(tipStaffId) || tipStaffId < 1)) {
    return {
      ok: false,
      err: { status: 400, body: { error: "tip_staff_id_invalid" } },
    };
  }
  if (tipAmountCents > 0 && tipStaffId != null) {
    const [tipStaff] = db
      .select()
      .from(schema.staff)
      .where(eq(schema.staff.id, tipStaffId))
      .limit(1)
      .all();
    if (!tipStaff) {
      return {
        ok: false,
        err: { status: 400, body: { error: "tip_staff_not_found" } },
      };
    }
  }
  const paymentRows: {
    amountCents: number;
    method: schema.InvoicePaymentMethod;
    voucherCode?: string;
  }[] = [];
  for (const p of body.payments) {
    const method = String(p.method ?? "").trim() as schema.InvoicePaymentMethod;
    const amountCents = Math.floor(Number(p.amountCents));
    if (!["cash", "card", "voucher", "unpaid_auf_rechnung"].includes(method)) {
      return {
        ok: false,
        err: { status: 400, body: { error: "payment_method_invalid" } },
      };
    }
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      return {
        ok: false,
        err: { status: 400, body: { error: "payment_amount_invalid" } },
      };
    }
    const voucherCode =
      method === "voucher" ? String(p.voucherCode ?? "").trim().toUpperCase() : undefined;
    if (method === "voucher" && !voucherCode) {
      return {
        ok: false,
        err: { status: 400, body: { error: "voucher_code_required" } },
      };
    }
    paymentRows.push({ amountCents, method, voucherCode });
  }
  const paymentSum = paymentRows.reduce((s, p) => s + p.amountCents, 0);
  if (paymentSum !== totalDueCents) {
    return {
      ok: false,
      err: {
        status: 400,
        body: {
          error: "payment_sum_mismatch",
          expected: totalDueCents,
          actual: paymentSum,
        },
      },
    };
  }
  const unpaidCents = paymentRows
    .filter((p) => p.method === "unpaid_auf_rechnung")
    .reduce((s, p) => s + p.amountCents, 0);
  if (unpaidCents > 0 && sessionBefore.clientId == null) {
    return {
      ok: false,
      err: { status: 400, body: { error: "client_required_for_unpaid" } },
    };
  }
  const voucherRows = paymentRows.filter((p) => p.method === "voucher");
  for (const v of voucherRows) {
    const chk = validateVoucher(db, v.voucherCode ?? "");
    if (!chk.ok) {
      return {
        ok: false,
        err: { status: 400, body: { error: chk.error } },
      };
    }
    if (v.amountCents > chk.voucher.remainingAmountCents) {
      return {
        ok: false,
        err: { status: 400, body: { error: "voucher_insufficient_balance" } },
      };
    }
  }
  const cardCents = paymentRows
    .filter((p) => p.method === "card")
    .reduce((s, p) => s + p.amountCents, 0);
  const payGate =
    cardCents > 0
      ? resolvePaymentProof(db, cardCents, {
          zvt: body.zvt,
          orphanPaymentId: body.orphanPaymentId,
        })
      : null;
  if (cardCents > 0 && payGate && !payGate.ok) {
    return {
      ok: false,
      err: { status: payGate.status, body: { error: payGate.error } },
    };
  }
  if (cardCents === 0 && (body.zvt != null || body.orphanPaymentId != null)) {
    return {
      ok: false,
      err: { status: 400, body: { error: "payment_proof_without_card" } },
    };
  }
  const proof = payGate && payGate.ok ? payGate.proof : null;

  const now = new Date();
  const zvtCols =
    proof?.kind === "zvt_direct"
      ? {
          zvtAmountCents: proof.amountCents,
          zvtTerminalId: proof.terminalId,
          zvtReceiptId: proof.zvtReceiptId,
          zvtAuthorizedAt: proof.authorizedAt,
        }
      : proof?.kind === "orphan"
        ? {
          zvtAmountCents: proof.row.amountCents,
          zvtTerminalId: proof.row.terminalId,
          zvtReceiptId: proof.row.zvtReceiptId,
          zvtAuthorizedAt: proof.row.authorizedAt
            ? new Date(proof.row.authorizedAt)
            : now,
        }
        : {
            zvtAmountCents: null,
            zvtTerminalId: null,
            zvtReceiptId: null,
            zvtAuthorizedAt: null,
          };

  let result: {
    invoice: typeof schema.invoices.$inferSelect;
    orphanId?: number;
    insertedItemIds: number[];
  };
  try {
    result = db.transaction((tx) => {
      const [inv] = tx
        .insert(schema.invoices)
        .values({
          sessionId,
          totalAmountCents: totalDueCents,
          vatAmountCents: vatCents,
          tipAmountCents,
          tipStaffId: tipStaffId ?? null,
          invoiceKind,
          status: "draft",
          updatedAt: now,
          zvtAmountCents: zvtCols.zvtAmountCents,
          zvtTerminalId: zvtCols.zvtTerminalId,
          zvtReceiptId: zvtCols.zvtReceiptId,
          zvtAuthorizedAt: zvtCols.zvtAuthorizedAt,
        })
        .returning()
        .all();
      if (!inv) {
        throw new AppError(
          500,
          CheckoutErrorCode.INSERT_INVOICE_FAILED,
          "insert_invoice_empty",
        );
      }
      const invoice = inv;
      const insertedItemIds: number[] = [];

      for (const line of lines) {
        const [r] = tx
          .insert(schema.invoiceItems)
          .values({
            invoiceId: invoice.id,
            description: line.description,
            quantity: line.quantity,
            unitNetCents: line.unitNetCents,
            vatRateBps: line.vatRateBps,
            inventoryItemId: line.inventoryItemId,
            deductMl: line.deductMl,
          })
          .returning()
          .all();
        if (r) insertedItemIds.push(r.id);
      }
      for (const p of paymentRows) {
        let voucherId: number | null = null;
        if (p.method === "voucher") {
          const [v] = tx
            .select()
            .from(schema.vouchers)
            .where(eq(schema.vouchers.code, p.voucherCode!))
            .limit(1)
            .all();
          if (!v || v.status !== "active") {
            throw new AppError(
              400,
              CheckoutErrorCode.VOUCHER_NOT_ACTIVE,
              "voucher_not_active",
            );
          }
          if (v.expiryDate != null && v.expiryDate.getTime() < Date.now()) {
            throw new AppError(
              400,
              CheckoutErrorCode.VOUCHER_EXPIRED,
              "voucher_expired",
            );
          }
          if (v.remainingAmountCents < p.amountCents) {
            throw new AppError(
              400,
              CheckoutErrorCode.VOUCHER_INSUFFICIENT_BALANCE,
              "voucher_insufficient_balance",
            );
          }
          const next = v.remainingAmountCents - p.amountCents;
          tx.update(schema.vouchers)
            .set({
              remainingAmountCents: next,
              status: next === 0 ? "redeemed" : "active",
            })
            .where(eq(schema.vouchers.id, v.id))
            .run();
          writeAuditTx(tx, {
            entity: "vouchers",
            entityId: v.id,
            action: "voucher_redeem",
            staffId,
            before: {
              code: v.code,
              remainingAmountCents: v.remainingAmountCents,
              status: v.status,
            },
            after: {
              code: v.code,
              remainingAmountCents: next,
              status: next === 0 ? "redeemed" : "active",
            },
            payload: {
              invoiceId: invoice.id,
              amountUsedCents: p.amountCents,
              method: p.method,
              /** Explicit balance trail (cents) for Steuerberater / GoBD voucher ledgers. */
              balanceBeforeCents: v.remainingAmountCents,
              balanceAfterCents: next,
            },
          });
          voucherId = v.id;
        }
        tx.insert(schema.invoicePayments)
          .values({
            invoiceId: invoice.id,
            amountCents: p.amountCents,
            method: p.method,
            voucherId,
          })
          .run();
      }
      if (unpaidCents > 0 && sessionBefore.clientId != null) {
        tx.insert(schema.clientDebts)
          .values({
            clientId: sessionBefore.clientId,
            sourceInvoiceId: invoice.id,
            amountCents: unpaidCents,
            status: "open",
          })
          .run();
      }

      let orphanId: number | undefined;
      if (proof?.kind === "orphan") {
        orphanId = proof.row.id;
        tx.update(schema.orphanPayments)
          .set({
            matchedSessionId: sessionId,
            matchedInvoiceId: invoice.id,
            status: "matched",
            fiscalStatus: "pending",
          })
          .where(eq(schema.orphanPayments.id, proof.row.id))
          .run();
      }

      return { invoice, orphanId, insertedItemIds };
    });
  } catch (e) {
    if (AppError.isAppError(e)) {
      return {
        ok: false,
        err: {
          status: e.statusCode,
          body: {
            error: e.errorCode,
            message: e.message,
            ...(e.details != null ? { details: e.details } : {}),
          },
        },
      };
    }
    return {
      ok: false,
      err: {
        status: 500,
        body: {
          error: CheckoutErrorCode.CHECKOUT_TRANSACTION_FAILED,
          message: "checkout_transaction_failed",
        },
      },
    };
  }

  const deductLines: CheckoutDeductLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const iid = result.insertedItemIds[i];
    if (
      iid != null &&
      line.inventoryItemId != null &&
      line.deductMl != null
    ) {
      deductLines.push({
        invoiceItemId: iid,
        inventoryItemId: line.inventoryItemId,
        quantity: line.quantity,
        deductMl: line.deductMl,
      });
    }
  }

  const tse = await signInvoiceFiscal(db, {
    invoiceId: result.invoice.id,
    sessionId,
    totals: { netCents, vatCents, grossCents },
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitNetCents: l.unitNetCents,
      vatRateBps: l.vatRateBps,
      lineNetCents: l.lineNetCents,
      lineVatCents: l.lineVatCents,
    })),
  });

  const exportBase = {
    ...tse.exportPayload,
    tseProvider: tse.provider,
    hybrid: tse.hybrid,
    zvt: zvtCols,
    invoiceId: result.invoice.id,
    sessionId,
    totals: { netCents, vatCents, grossCents, tipAmountCents, totalDueCents },
    lines,
    payments: paymentRows,
    tseError: tse.tseError,
  };
  const exportJson = JSON.stringify(exportBase);

  const canClose =
    typeof tse.signature === "string" && tse.signature.trim().length > 0;

  if (!canClose && tse.tseError) {
    writeAudit(db, {
      entity: "invoices",
      entityId: result.invoice.id,
      action: "tse_error",
      staffId,
      reason: tse.tseError.code,
      payload: {
        ...tse.tseError,
        sessionId,
        zvt: zvtCols,
        provider: tse.provider,
        note: "TSE did not return a signature; invoice remains draft. Session stays open (KassenSichV).",
      },
    });
  }

  if (!canClose) {
    db.update(schema.invoices)
      .set({ tseExportData: exportJson, updatedAt: new Date() })
      .where(eq(schema.invoices.id, result.invoice.id))
      .run();
  }

  let retailStockWarnings: {
    inventoryItemId: number;
    onHandAfter: number;
    name: string;
    beforeOnHand: number;
    deductedMl: number;
  }[] = [];

  if (canClose) {
    const closedAt = new Date();
    const appointmentId = sessionBefore.appointmentId;

    try {
      let invRetailNeg: {
        inventoryItemId: number;
        onHandAfter: number;
        name: string;
        beforeOnHand: number;
        deductedMl: number;
      }[] = [];
      db.transaction((tx) => {
        if (deductLines.length > 0) {
          const { retailNegative } = applyCheckoutInventoryDeductions(tx, {
            invoiceId: result.invoice.id,
            sessionId,
            staffId,
            lines: deductLines,
          });
          invRetailNeg = retailNegative;
        }

        tx.update(schema.invoices)
          .set({
            status: "closed",
            tseSignature: tse.signature!,
            tseExportData: exportJson,
            tseTransactionId: tse.hybrid?.tseTransactionId ?? null,
            tseSignatureNumber: tse.hybrid?.tseSignatureNumber ?? null,
            tseStartTime: tse.hybrid?.tseStartTime ?? null,
            tseEndTime: tse.hybrid?.tseEndTime ?? null,
            tseStatus: tse.hybrid?.tseStatus ?? null,
            updatedAt: closedAt,
          })
          .where(eq(schema.invoices.id, result.invoice.id))
          .run();
        tx.update(schema.sessions)
          .set({ status: "closed", closedAt: closedAt })
          .where(eq(schema.sessions.id, sessionId))
          .run();

        if (appointmentId != null) {
          const [a] = tx
            .select()
            .from(schema.appointments)
            .where(eq(schema.appointments.id, appointmentId))
            .limit(1)
            .all();
          if (a && a.status === "checked_in") {
            tx.update(schema.appointments)
              .set({ status: "completed", updatedAt: closedAt })
              .where(eq(schema.appointments.id, appointmentId))
              .run();
          }
        }

        if (result.orphanId != null) {
          tx.update(schema.orphanPayments)
            .set({
              fiscalStatus: "signed",
              fiscalSignedAt: closedAt,
            })
            .where(eq(schema.orphanPayments.id, result.orphanId))
            .run();
        }

        if (sessionBefore.clientId != null) {
          LoyaltyService.processTx(tx, {
            clientId: sessionBefore.clientId,
            paidTotalCents: totalDueCents,
          });
        }

        HardwareQueueService.enqueuePrintReceiptTx(tx, {
          invoiceId: result.invoice.id,
          sessionId,
          staffId,
          totalDueCents,
          paymentMethods: paymentRows.map((p) => p.method),
          closedAtMs: closedAt.getTime(),
          tse: {
            tseStatus: tse.hybrid?.tseStatus ?? null,
            tseTransactionId: tse.hybrid?.tseTransactionId ?? null,
            tseSignatureNumber: tse.hybrid?.tseSignatureNumber ?? null,
            tseSignature: tse.signature,
            tseStartTimeMs: tse.hybrid?.tseStartTime?.getTime() ?? null,
            tseEndTimeMs: tse.hybrid?.tseEndTime?.getTime() ?? null,
            receiptQrPayload: exportJson,
          },
        });
      });
      retailStockWarnings = invRetailNeg;

      eventBus.emit("invoice_closed", {
        invoiceId: result.invoice.id,
        sessionId,
        staffId,
        totalDueCents,
        closedAtMs: closedAt.getTime(),
        tseProvider: tse.provider,
        tseCompliance: tse.hybrid?.tseStatus ?? null,
      });
      if (tse.hybrid?.tseStatus === "ausfall_failed") {
        eventBus.emit("tse_ausfall_triggered", {
          invoiceId: result.invoice.id,
          sessionId,
          staffId,
        });
      }
    } catch (e) {
      if (e instanceof InsufficientSalonStockError) {
        return {
          ok: false,
          err: {
            status: 409,
            body: {
              error: "insufficient_salon_stock",
              inventoryItemId: e.inventoryItemId,
              onHandMl: e.onHandMl,
              requiredMl: e.requiredMl,
            },
          },
        };
      }
      return {
        ok: false,
        err: { status: 500, body: { error: "close_transaction_failed" } },
      };
    }
  }

  if (canClose && tse.hybrid?.tseStatus === "ausfall_failed") {
    writeAudit(db, {
      entity: "invoices",
      entityId: result.invoice.id,
      action: "tse_ausfall_detected",
      staffId,
      reason: "tse_ausfall",
      payload: {
        sessionId,
        invoiceId: result.invoice.id,
        note:
          "KassenSichV: hardware and cloud TSE both unavailable; sale closed with TSE-Ausfall marker signature (audit requirement).",
        exportSummary: {
          schema: tse.exportPayload.schema,
          attemptedHardware: (tse.exportPayload as { attemptedHardware?: unknown })
            .attemptedHardware,
          attemptedCloud: (tse.exportPayload as { attemptedCloud?: unknown })
            .attemptedCloud,
        },
      },
    });
  }

  if (canClose) {
    for (const w of retailStockWarnings) {
      writeAudit(db, {
        entity: "inventory_items",
        entityId: w.inventoryItemId,
        action: "retail_negative_balance",
        staffId,
        reason: "retail_checkout_deduct",
        before: { onHandMl: w.beforeOnHand, name: w.name },
        after: { onHandMl: w.onHandAfter, name: w.name },
        payload: {
          invoiceId: result.invoice.id,
          sessionId,
          deductedMl: w.deductedMl,
          message:
            "Retail SKU: book went negative after TSE close — reorder / inventur (GoBD).",
        },
      });
    }
  }

  const [invoiceRow] = db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, result.invoice.id))
    .all();
  const itemRows = db
    .select()
    .from(schema.invoiceItems)
    .where(eq(schema.invoiceItems.invoiceId, result.invoice.id))
    .all();
  const paymentOutRows = db
    .select()
    .from(schema.invoicePayments)
    .where(eq(schema.invoicePayments.invoiceId, result.invoice.id))
    .all();
  const [sessionAfter] = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .all();

  const totalsPayload = { netCents, vatCents, grossCents, lineCount: lines.length };

  if (canClose) {
    const invBefore = { status: "draft" as const, id: result.invoice.id };
    const invAfter = {
      status: "closed" as const,
      id: result.invoice.id,
      tseProvider: tse.provider,
      tseStatus: tse.hybrid?.tseStatus ?? null,
    };

    const invoiceCloseReason =
      tse.hybrid?.tseStatus === "ausfall_failed"
        ? "zvt_ok_tse_ausfall"
        : "zvt_ok_tse_ok";

    writeAudit(db, {
      entity: "invoices",
      entityId: result.invoice.id,
      action: "invoice_closed",
      staffId,
      reason: invoiceCloseReason,
      before: invBefore,
      after: invAfter,
      payload: {
        tseProvider: tse.provider,
        tseCompliance: tse.hybrid?.tseStatus ?? null,
        zvt: zvtCols,
        paymentProof: proof?.kind ?? null,
        payments: paymentRows,
        tipAmountCents,
        invoiceKind,
        inventoryDeductionLines: deductLines.length,
        retailNegativeWarnings: retailStockWarnings,
      },
    });
    writeAudit(db, {
      entity: "sessions",
      entityId: sessionId,
      action: "checkout_closed",
      staffId,
      reason: "zvt_tse_closed",
      before: sessionBefore,
      after: {
        session: sessionAfter,
        invoice: invoiceRow,
        itemCount: itemRows.length,
        totals: totalsPayload,
      },
      payload: {
        invoiceId: result.invoice.id,
        tseProvider: tse.provider,
        tseCompliance: tse.hybrid?.tseStatus ?? null,
        paymentProof: proof?.kind ?? null,
        zvt: zvtCols,
        payments: paymentRows,
        tipAmountCents,
        invoiceKind,
        inventoryDeductionLines: deductLines.length,
      },
    });
    if (priceOverrideAuditPack != null) {
      writeAudit(db, {
        entity: "checkout",
        entityId: sessionId,
        action: "checkout_price_override",
        staffId,
        reason: priceOverrideAuditPack.reason,
        payload: {
          invoiceId: result.invoice.id,
          sessionId,
          catalogDeviations: priceOverrideAuditPack.deviations,
          note:
            "Unit net / VAT basis differs from salon_service_catalog reference (Änderungshistorie).",
        },
      });
    }
  } else {
    writeAudit(db, {
      entity: "sessions",
      entityId: sessionId,
      action: "checkout_draft",
      staffId,
      reason: "tse_pending",
      before: sessionBefore,
      after: {
        session: sessionAfter,
        invoice: invoiceRow,
        itemCount: itemRows.length,
        totals: totalsPayload,
      },
      payload: {
        invoiceId: result.invoice.id,
        fiscal: "tse_pending",
        tseProvider: tse.provider,
        paymentProof: proof?.kind ?? null,
        zvt: zvtCols,
        payments: paymentRows,
        tipAmountCents,
        invoiceKind,
        tseError: tse.tseError,
        payment: "captured",
      },
    });
  }

  return {
    ok: true,
    status: canClose ? 200 : 202,
    json: {
      invoice: invoiceRow,
      items: itemRows,
      payments: paymentOutRows,
      session: sessionAfter,
      payment: { state: "authorized", zvt: zvtCols, proof: proof?.kind ?? null },
      inventory: {
        deductLines: deductLines.length,
        /** Populated when close succeeded and retail skus went negative. */
        retailNegativeWarnings: canClose ? retailStockWarnings : [],
      },
      fiscal: canClose
        ? {
            state:
              tse.hybrid?.tseStatus === "ausfall_failed" ? "ausfall" : "signed",
            provider: tse.provider,
            tseStatus: tse.hybrid?.tseStatus ?? null,
          }
        : { state: "pending", provider: tse.provider, tseError: tse.tseError },
    },
  };
}
