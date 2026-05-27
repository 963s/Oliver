import { and, desc, eq, max, min, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { computeReliabilityScore } from "./clientCrm.js";
import { logger } from "./logger.js";

/**
 * §12 — Client stats cache service (Phase 4).
 *
 * The Client 360° header asks for ~6 aggregates per client (visits, spend,
 * reliability, days-since-last-visit). Computing them live on every request
 * means 4–6 SQL queries per page load. The `client_stats_cache` table
 * pre-computes these once and is refreshed on the write paths that mutate
 * the inputs:
 *
 *   - Session close (`checkoutPipeline`)            → totals, last visit
 *   - Appointment status change (no_show / cancel)  → counters
 *   - Debt settlement                               → no semantic impact on
 *                                                     these columns yet but
 *                                                     the hook is here for
 *                                                     future ARR fields.
 *
 * `refreshAllClientStats` is called once at app startup so a fresh install
 * doesn't return all-zeros on first page load.
 */

const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour

export interface ClientStats {
  clientId: number;
  totalVisits: number;
  totalSpentCents: number;
  avgVisitCents: number;
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  daysSinceLastVisit: number | null;
  noShowCount: number;
  cancelCount: number;
  reliabilityScore: number;
  updatedAt: Date;
}

function liveComputeStats(
  db: BetterSQLite3Database<typeof schema>,
  clientId: number,
): Omit<ClientStats, "updatedAt"> {
  const sessionsAgg = db
    .select({
      visits: sql<number>`count(*)`,
      first: min(schema.sessions.closedAt),
      last: max(schema.sessions.closedAt),
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.clientId, clientId),
        eq(schema.sessions.status, "closed"),
      ),
    )
    .all()[0];

  // Sum closed-invoice totals for this client's sessions.
  const invoiceRows = db
    .select({
      total: schema.invoices.totalAmountCents,
    })
    .from(schema.invoices)
    .innerJoin(
      schema.sessions,
      eq(schema.invoices.sessionId, schema.sessions.id),
    )
    .where(
      and(
        eq(schema.sessions.clientId, clientId),
        eq(schema.invoices.status, "closed"),
      ),
    )
    .all();
  const totalSpentCents = invoiceRows.reduce(
    (acc, r) => acc + (r.total ?? 0),
    0,
  );

  const totalVisits = sessionsAgg?.visits ?? 0;
  const avgVisitCents =
    totalVisits > 0 ? Math.round(totalSpentCents / totalVisits) : 0;
  const lastVisitAt = sessionsAgg?.last ?? null;
  const firstVisitAt = sessionsAgg?.first ?? null;
  const daysSinceLastVisit =
    lastVisitAt instanceof Date
      ? Math.floor((Date.now() - lastVisitAt.getTime()) / (24 * 3600 * 1000))
      : null;

  const [client] = db
    .select({
      noShowTotal: schema.clients.noShowTotal,
      cancelTotal: schema.clients.cancelTotal,
    })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1)
    .all();

  const noShowCount = client?.noShowTotal ?? 0;
  const cancelCount = client?.cancelTotal ?? 0;
  const reliabilityScore = computeReliabilityScore({
    noShows: noShowCount,
    cancels: cancelCount,
    completed: totalVisits,
  });

  return {
    clientId,
    totalVisits,
    totalSpentCents,
    avgVisitCents,
    firstVisitAt,
    lastVisitAt,
    daysSinceLastVisit,
    noShowCount,
    cancelCount,
    reliabilityScore,
  };
}

/**
 * Recomputes the cache row for a single client. Idempotent — safe to call
 * from any write path.
 */
export function refreshClientStats(
  db: BetterSQLite3Database<typeof schema>,
  clientId: number,
): ClientStats {
  const fresh = liveComputeStats(db, clientId);
  const now = new Date();
  const values = { ...fresh, updatedAt: now };

  const [existing] = db
    .select({ clientId: schema.clientStatsCache.clientId })
    .from(schema.clientStatsCache)
    .where(eq(schema.clientStatsCache.clientId, clientId))
    .limit(1)
    .all();

  if (existing) {
    db.update(schema.clientStatsCache)
      .set(values)
      .where(eq(schema.clientStatsCache.clientId, clientId))
      .run();
  } else {
    db.insert(schema.clientStatsCache).values(values).run();
  }
  return values;
}

/**
 * Batch refresh: walks all client IDs and rebuilds the cache.
 * Used at startup; processes in chunks so a large dataset doesn't block.
 */
export function refreshAllClientStats(
  db: BetterSQLite3Database<typeof schema>,
  chunkSize = 50,
): { processed: number; errors: number } {
  const ids = db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .all()
    .map((r) => r.id);

  let processed = 0;
  let errors = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    for (const id of slice) {
      try {
        refreshClientStats(db, id);
        processed++;
      } catch (err) {
        errors++;
        logger.warn("client_stats_refresh_failed", {
          clientId: id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  logger.info("client_stats_refresh_all_done", { processed, errors });
  return { processed, errors };
}

/**
 * Cache-first read. Falls back to a live compute when the row is missing or
 * older than `STALE_AFTER_MS`. The fallback also writes the result back so
 * subsequent calls hit the cache.
 */
export function getClientStats(
  db: BetterSQLite3Database<typeof schema>,
  clientId: number,
): ClientStats {
  const [row] = db
    .select()
    .from(schema.clientStatsCache)
    .where(eq(schema.clientStatsCache.clientId, clientId))
    .limit(1)
    .all();
  if (row && row.updatedAt instanceof Date) {
    const age = Date.now() - row.updatedAt.getTime();
    if (age < STALE_AFTER_MS) {
      return row;
    }
  }
  return refreshClientStats(db, clientId);
}

// Suppress unused-var lint until `desc` is referenced by a sort overload.
void desc;
