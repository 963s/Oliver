import { and, eq, gte, isNull, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function issueVoucher(
  db: BetterSQLite3Database<typeof schema>,
  input: {
    code: string;
    initialAmountCents: number;
    isMultiPurpose?: boolean;
    expiryDateMs?: number | null;
  },
) {
  const code = normalizeCode(String(input.code ?? ""));
  const amount = Math.floor(Number(input.initialAmountCents));
  if (!code) throw new Error("voucher_code_required");
  if (!Number.isFinite(amount) || amount < 1) throw new Error("voucher_amount_invalid");
  const expiryDate =
    input.expiryDateMs == null || !Number.isFinite(input.expiryDateMs)
      ? null
      : new Date(Math.floor(input.expiryDateMs));
  const [existing] = db
    .select()
    .from(schema.vouchers)
    .where(eq(schema.vouchers.code, code))
    .limit(1)
    .all();
  if (existing) throw new Error("voucher_code_exists");
  const [row] = db
    .insert(schema.vouchers)
    .values({
      code,
      initialAmountCents: amount,
      remainingAmountCents: amount,
      isMultiPurpose: input.isMultiPurpose ?? true,
      expiryDate,
      status: "active",
    })
    .returning()
    .all();
  return row!;
}

export function validateVoucher(
  db: BetterSQLite3Database<typeof schema>,
  codeRaw: string,
) {
  const code = normalizeCode(codeRaw);
  const [row] = db
    .select()
    .from(schema.vouchers)
    .where(eq(schema.vouchers.code, code))
    .limit(1)
    .all();
  if (!row) return { ok: false as const, error: "voucher_not_found" };
  if (row.status !== "active") return { ok: false as const, error: "voucher_not_active" };
  if (row.expiryDate != null && row.expiryDate.getTime() < Date.now()) {
    return { ok: false as const, error: "voucher_expired" };
  }
  if (row.remainingAmountCents < 1) return { ok: false as const, error: "voucher_empty" };
  return { ok: true as const, voucher: row };
}

export function resolveActiveVoucherForUpdate(
  tx: Pick<BetterSQLite3Database<typeof schema>, "select">,
  codeRaw: string,
) {
  const code = normalizeCode(codeRaw);
  const [row] = tx
    .select()
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.code, code),
        eq(schema.vouchers.status, "active"),
        or(
          isNull(schema.vouchers.expiryDate),
          gte(schema.vouchers.expiryDate, new Date()),
        ),
      ),
    )
    .limit(1)
    .all();
  return row ?? null;
}
