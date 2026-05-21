import { eq, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";

export type ZvtDirectBody = {
  amountCents: number;
  terminalId: string;
  zvtReceiptId?: string;
  rawZvtReference?: string;
  /** ISO string or epoch ms */
  authorizedAt?: number | string;
};

export type PaymentProofResult =
  | {
      kind: "zvt_direct";
      amountCents: number;
      terminalId: string;
      zvtReceiptId: string | null;
      authorizedAt: Date;
    }
  | {
      kind: "orphan";
      row: typeof schema.orphanPayments.$inferSelect;
    };

/**
 * EC / ZVT gate for card payments: if card amount > 0 then checkout must include
 * either inline ZVT authorization data or an open `orphan_payments` row matching
 * the card-paid amount.
 */
export function resolvePaymentProof(
  db: BetterSQLite3Database<typeof schema>,
  cardAmountCents: number,
  body: {
    zvt?: ZvtDirectBody;
    orphanPaymentId?: number;
  },
):
  | { ok: true; proof: PaymentProofResult }
  | { ok: false; error: string; status: number } {
  const hasZvt = body.zvt != null;
  const hasOrphan =
    body.orphanPaymentId != null && Number.isFinite(body.orphanPaymentId);
  if (cardAmountCents <= 0) {
    if (hasZvt || hasOrphan) {
      return { ok: false, error: "payment_proof_without_card", status: 400 };
    }
    return { ok: false, error: "payment_proof_not_required", status: 400 };
  }
  if (!hasZvt && !hasOrphan) {
    return { ok: false, error: "payment_proof_required_for_card", status: 400 };
  }
  if (hasZvt && hasOrphan) {
    return { ok: false, error: "payment_proof_ambiguous", status: 400 };
  }

  if (hasOrphan) {
    const id = Math.floor(body.orphanPaymentId!);
    const [row] = db
      .select()
      .from(schema.orphanPayments)
      .where(
        and(
          eq(schema.orphanPayments.id, id),
          eq(schema.orphanPayments.status, "unresolved"),
        ),
      )
      .limit(1)
      .all();
    if (!row) {
      return { ok: false, error: "orphan_not_found_or_not_unresolved", status: 400 };
    }
    if (row.amountCents !== cardAmountCents) {
      return {
        ok: false,
        error: "orphan_amount_mismatch",
        status: 400,
      };
    }
    if (row.matchedInvoiceId != null) {
      return { ok: false, error: "orphan_already_matched", status: 409 };
    }
    return { ok: true, proof: { kind: "orphan", row } };
  }

  const z = body.zvt!;
  const amount = Math.floor(Number(z.amountCents));
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "zvt_amount_invalid", status: 400 };
  }
  if (amount !== cardAmountCents) {
    return { ok: false, error: "zvt_amount_mismatch", status: 400 };
  }
  const terminalId = String(z.terminalId ?? "").trim();
  if (!terminalId) {
    return { ok: false, error: "zvt_terminal_required", status: 400 };
  }
  const auth = parseAuthAt(z.authorizedAt);
  const zvtReceiptId =
    z.zvtReceiptId != null
      ? String(z.zvtReceiptId).trim() || null
      : z.rawZvtReference != null
        ? String(z.rawZvtReference).trim() || null
        : null;

  return {
    ok: true,
    proof: {
      kind: "zvt_direct",
      amountCents: amount,
      terminalId,
      zvtReceiptId,
      authorizedAt: auth,
    },
  };
}

function parseAuthAt(v: number | string | undefined): Date {
  if (v == null) return new Date();
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(v);
  }
  const t = Date.parse(String(v));
  if (Number.isNaN(t)) return new Date();
  return new Date(t);
}
