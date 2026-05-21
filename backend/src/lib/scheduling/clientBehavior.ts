import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";

/**
 * Single CRM row for counter updates: explicit `client_id` wins, else unambiguous phone match.
 */
export function resolveClientIdForCounters(
  db: BetterSQLite3Database<typeof schema>,
  apt: { clientId: number | null; clientPhone: string | null },
): number | null {
  if (apt.clientId != null) {
    return apt.clientId;
  }
  const phone = apt.clientPhone?.trim();
  if (!phone) return null;
  const rows = db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.phone, phone))
    .limit(2)
    .all();
  if (rows.length === 1) {
    return rows[0]!.id;
  }
  return null;
}

export function incrementClientCancel(
  db: BetterSQLite3Database<typeof schema>,
  clientId: number,
): void {
  const [c] = db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1)
    .all();
  if (!c) return;
  db.update(schema.clients)
    .set({ cancelTotal: c.cancelTotal + 1 })
    .where(eq(schema.clients.id, clientId))
    .run();
}

export function incrementClientNoShow(
  db: BetterSQLite3Database<typeof schema>,
  clientId: number,
): void {
  const [c] = db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1)
    .all();
  if (!c) return;
  db.update(schema.clients)
    .set({ noShowTotal: c.noShowTotal + 1 })
    .where(eq(schema.clients.id, clientId))
    .run();
}
