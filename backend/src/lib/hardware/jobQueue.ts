import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { eventBus } from "../events/bus.js";

/** Stop retrying after this many failed attempts (device unplugged, paper jam, …). */
export const HARDWARE_JOB_MAX_RETRIES = 5;

type Tx = Pick<BetterSQLite3Database<typeof schema>, "insert">;

/**
 * Enqueue work **inside the same SQLite transaction** as fiscal close (atomic with invoice row).
 */
export function enqueueHardwareJobTx(
  tx: Tx,
  opts: {
    jobType: schema.HardwareJobType;
    payload: Record<string, unknown>;
  },
): void {
  tx.insert(schema.hardwareJobs)
    .values({
      jobType: opts.jobType,
      payloadJson: JSON.stringify(opts.payload),
      status: "pending",
      retryCount: 0,
      errorLog: null,
    })
    .run();
}

function simulateDeviceWork(
  kind: schema.HardwareJobType,
  payload: Record<string, unknown>,
): void {
  if (process.env.OLIVER_ROOS_HARDWARE_CHAOS_REJECT === "1") {
    throw new Error("chaos: simulated printer offline");
  }
  // Placeholder until ESC/POS / ZVT SDK wiring — must never throw in happy path.
  // eslint-disable-next-line no-console
  console.log(`[hardware_jobs] simulated ${kind}`, {
    invoiceId: payload.invoiceId,
    sessionId: payload.sessionId,
  });
}

/**
 * Worker loop (cron / setInterval / Electron background): drain pending jobs.
 * Failures increment `retry_count`; after max retries → `failed` (DB stays consistent).
 */
export function processJobs(
  db: BetterSQLite3Database<typeof schema>,
  opts?: { limit?: number },
): {
  examined: number;
  completed: number;
  stillPendingOrFailed: number;
} {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 25));
  const pending = db
    .select()
    .from(schema.hardwareJobs)
    .where(eq(schema.hardwareJobs.status, "pending"))
    .orderBy(asc(schema.hardwareJobs.id))
    .limit(limit)
    .all();

  let completed = 0;
  let problems = 0;

  for (const job of pending) {
    db.update(schema.hardwareJobs)
      .set({ status: "processing" })
      .where(eq(schema.hardwareJobs.id, job.id))
      .run();

    try {
      const payload = JSON.parse(job.payloadJson) as Record<string, unknown>;
      simulateDeviceWork(job.jobType as schema.HardwareJobType, payload);
      db.update(schema.hardwareJobs)
        .set({ status: "completed", errorLog: null })
        .where(eq(schema.hardwareJobs.id, job.id))
        .run();
      completed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const nextRetry = job.retryCount + 1;
      const terminal = nextRetry >= HARDWARE_JOB_MAX_RETRIES;
      db.update(schema.hardwareJobs)
        .set({
          status: terminal ? "failed" : "pending",
          retryCount: nextRetry,
          errorLog: msg.slice(0, 4000),
        })
        .where(eq(schema.hardwareJobs.id, job.id))
        .run();
      if (terminal) {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(job.payloadJson) as Record<string, unknown>;
        } catch {
          payload = {};
        }
        eventBus.emit("hardware_job_failed", {
          jobId: job.id,
          jobType: String(job.jobType),
          retryCount: nextRetry,
          errorMessage: msg.slice(0, 4000),
          payload,
        });
      }
      problems++;
    }
  }

  return {
    examined: pending.length,
    completed,
    stillPendingOrFailed: problems,
  };
}

const DEFAULT_DRAIN_INTERVAL_MS = 30_000;

/**
 * Run `processJobs` once at startup (crash recovery for pending rows) and on an
 * interval so newly enqueued jobs drain without requiring another restart.
 */
export function startHardwareJobDrainLoop(
  db: BetterSQLite3Database<typeof schema>,
  opts?: { intervalMs?: number },
): () => void {
  const ms = opts?.intervalMs ?? DEFAULT_DRAIN_INTERVAL_MS;
  processJobs(db);
  const id = setInterval(() => {
    processJobs(db);
  }, ms);
  return () => clearInterval(id);
}
