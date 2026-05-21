import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";

/** Minimum invoice total (cents) to earn one visit stamp (Stempel). */
export const LOYALTY_STAMP_MIN_INVOICE_CENTS = 2_000;
/** Stamps required before a reward milestone (e.g. 10th visit). */
export const LOYALTY_REWARD_STAMPS_THRESHOLD = 10;

type Tx = Pick<BetterSQLite3Database<typeof schema>, "select" | "insert" | "update">;

export function accrualFromPaidTotalCents(paidTotalCents: number): {
  earnedPoints: number;
  earnedStamp: number;
} {
  const earnedPoints = Math.max(0, Math.floor(paidTotalCents / 100));
  const earnedStamp =
    paidTotalCents >= LOYALTY_STAMP_MIN_INVOICE_CENTS ? 1 : 0;
  return { earnedPoints, earnedStamp };
}

export function processLoyaltyAccumulation(
  tx: Tx,
  opts: { clientId: number; paidTotalCents: number },
) {
  const { earnedPoints, earnedStamp } = accrualFromPaidTotalCents(
    opts.paidTotalCents,
  );
  const [cur] = tx
    .select()
    .from(schema.clientLoyalty)
    .where(eq(schema.clientLoyalty.clientId, opts.clientId))
    .limit(1)
    .all();
  if (!cur) {
    const stamps = earnedStamp;
    const eligibleNow =
      stamps > 0 && stamps % LOYALTY_REWARD_STAMPS_THRESHOLD === 0;
    const [row] = tx
      .insert(schema.clientLoyalty)
      .values({
        clientId: opts.clientId,
        pointsBalance: earnedPoints,
        stampsCount: stamps,
        lifetimePoints: earnedPoints,
        lastRewardAt: eligibleNow ? new Date() : null,
        updatedAt: new Date(),
      })
      .returning()
      .all();
    return row!;
  }
  const nextStamps = cur.stampsCount + earnedStamp;
  const eligibleNow =
    nextStamps > 0 && nextStamps % LOYALTY_REWARD_STAMPS_THRESHOLD === 0;
  tx.update(schema.clientLoyalty)
    .set({
      pointsBalance: cur.pointsBalance + earnedPoints,
      stampsCount: nextStamps,
      lifetimePoints: cur.lifetimePoints + earnedPoints,
      lastRewardAt: eligibleNow ? new Date() : cur.lastRewardAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.clientLoyalty.id, cur.id))
    .run();
  const [row] = tx
    .select()
    .from(schema.clientLoyalty)
    .where(eq(schema.clientLoyalty.id, cur.id))
    .limit(1)
    .all();
  return row!;
}

/**
 * Reverses the accrual that would have been applied for a **closed** sale
 * when that invoice is legally storno’d. Does nothing if no loyalty row / client.
 */
export function reverseLoyaltyAccrualForStorno(
  tx: Tx,
  opts: { clientId: number | null; paidTotalCents: number },
): typeof schema.clientLoyalty.$inferSelect | null {
  if (opts.clientId == null) return null;
  const { earnedPoints, earnedStamp } = accrualFromPaidTotalCents(
    opts.paidTotalCents,
  );
  if (earnedPoints === 0 && earnedStamp === 0) return null;
  const [cur] = tx
    .select()
    .from(schema.clientLoyalty)
    .where(eq(schema.clientLoyalty.clientId, opts.clientId))
    .limit(1)
    .all();
  if (!cur) return null;
  const nextStamps = Math.max(0, cur.stampsCount - earnedStamp);
  const nextPoints = Math.max(0, cur.pointsBalance - earnedPoints);
  const nextLifetime = Math.max(0, cur.lifetimePoints - earnedPoints);
  const threshold = LOYALTY_REWARD_STAMPS_THRESHOLD;
  const lastRewardAt =
    nextStamps > 0 && nextStamps % threshold === 0
      ? cur.lastRewardAt
      : null;
  tx.update(schema.clientLoyalty)
    .set({
      stampsCount: nextStamps,
      pointsBalance: nextPoints,
      lifetimePoints: nextLifetime,
      lastRewardAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.clientLoyalty.id, cur.id))
    .run();
  const [row] = tx
    .select()
    .from(schema.clientLoyalty)
    .where(eq(schema.clientLoyalty.id, cur.id))
    .limit(1)
    .all();
  return row ?? null;
}

export function checkRewardEligibility(state: {
  stampsCount: number;
  lastRewardAt: Date | null;
}) {
  const threshold = LOYALTY_REWARD_STAMPS_THRESHOLD;
  const current = Math.max(0, state.stampsCount);
  const eligibleNow = current > 0 && current % threshold === 0;
  const nextRewardAtStamps = (Math.floor(current / threshold) + 1) * threshold;
  return {
    threshold,
    eligibleNow,
    nextRewardAtStamps,
    stampsUntilNext: Math.max(0, nextRewardAtStamps - current),
    lastRewardAt: state.lastRewardAt,
  };
}
