import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { hashDeviceSecret } from "./auth/deviceAuth.js";

/**
 * Desktop shell (Tauri) passes `OLIVER_ROOS_EMBEDDED_DEVICE_TOKEN`; we persist a matching
 * `trusted_devices` row so existing device middleware + audits keep working.
 */
export function ensureEmbeddedTrustedDevice(
  db: BetterSQLite3Database<typeof schema>,
): void {
  const raw = String(process.env.OLIVER_ROOS_EMBEDDED_DEVICE_TOKEN ?? "").trim();
  if (!raw) return;

  const deviceTokenHash = hashDeviceSecret(raw);
  const [existing] = db
    .select({ id: schema.trustedDevices.id })
    .from(schema.trustedDevices)
    .where(eq(schema.trustedDevices.deviceTokenHash, deviceTokenHash))
    .limit(1)
    .all();
  if (existing) return;

  db.insert(schema.trustedDevices)
    .values({
      deviceName: "Oliver Desktop (eingebettet)",
      pairingToken: null,
      deviceTokenHash,
      isActive: true,
      lastSeenAt: new Date(),
    })
    .run();
}
