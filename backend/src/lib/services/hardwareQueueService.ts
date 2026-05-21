import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { enqueueHardwareJobTx } from "../hardware/jobQueue.js";

type Tx = Pick<BetterSQLite3Database<typeof schema>, "insert">;

/**
 * Hardware job enqueue inside an SQLite transaction (atomic with invoice close).
 */
export const HardwareQueueService = {
  enqueuePrintReceiptTx(
    tx: Tx,
    payload: Record<string, unknown>,
  ): void {
    enqueueHardwareJobTx(tx, {
      jobType: "print_receipt",
      payload,
    });
  },
};
