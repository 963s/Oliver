import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import {
  SETTING_FISKALY_ENABLED,
  SETTING_TSE_PROVIDER_TYPE,
  TSE_PROVIDER_DEFAULT,
  type TseProviderTypeValue,
} from "./types.js";

function getSetting(
  db: BetterSQLite3Database<typeof schema>,
  key: string,
): string | null {
  const [row] = db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1)
    .all();
  return row?.value ?? null;
}

export function getTseProviderType(
  db: BetterSQLite3Database<typeof schema>,
): TseProviderTypeValue {
  const v = getSetting(db, SETTING_TSE_PROVIDER_TYPE)?.toUpperCase();
  if (v === "FISKALY_CLOUD") return "FISKALY_CLOUD";
  return TSE_PROVIDER_DEFAULT;
}

export function isFiskalyEnabled(
  db: BetterSQLite3Database<typeof schema>,
): boolean {
  const v = getSetting(db, SETTING_FISKALY_ENABLED)?.trim();
  return v === "1" || v?.toLowerCase() === "true";
}

export { SETTING_TSE_PROVIDER_TYPE, SETTING_FISKALY_ENABLED };
