import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { processLoyaltyAccumulation } from "../loyalty/processor.js";

type Tx = Pick<BetterSQLite3Database<typeof schema>, "select" | "insert" | "update">;

/**
 * Loyalty accrual inside an SQLite transaction (same atomic unit as fiscal close).
 */
export const LoyaltyService = {
  processTx(
    tx: Tx,
    opts: { clientId: number; paidTotalCents: number },
  ): ReturnType<typeof processLoyaltyAccumulation> {
    return processLoyaltyAccumulation(tx, opts);
  },
};
