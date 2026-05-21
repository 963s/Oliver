import { createHash, randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";

/** Stable hex digest for storing / comparing device secrets (fast path vs bcrypt). */
export function hashDeviceSecret(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Owner creates a one-time pairing token (row inserted with pending device name).
 */
export function createPairingChallenge(
  db: BetterSQLite3Database<typeof schema>,
): { pairingToken: string; id: number } {
  const pairingToken = generateOpaqueToken(24);
  const [row] = db
    .insert(schema.trustedDevices)
    .values({
      deviceName: "(pending pair)",
      pairingToken,
      deviceTokenHash: null,
      isActive: true,
      lastSeenAt: null,
    })
    .returning({ id: schema.trustedDevices.id })
    .all();
  if (!row) throw new Error("pairing_insert_failed");
  return { pairingToken, id: row.id };
}

export type PairDeviceResult =
  | { ok: true; deviceToken: string; deviceId: number; deviceName: string }
  | { ok: false; error: "invalid_pairing_token" | "already_paired" };

/**
 * First-boot iPad: redeem pairing token → receive permanent device secret (shown once).
 */
export function pairDevice(
  db: BetterSQLite3Database<typeof schema>,
  pairingTokenRaw: string,
  deviceName: string,
): PairDeviceResult {
  const pairingToken = String(pairingTokenRaw ?? "").trim();
  if (!pairingToken) return { ok: false, error: "invalid_pairing_token" };

  const [row] = db
    .select()
    .from(schema.trustedDevices)
    .where(eq(schema.trustedDevices.pairingToken, pairingToken))
    .limit(1)
    .all();

  if (!row) return { ok: false, error: "invalid_pairing_token" };
  if (row.deviceTokenHash != null && row.deviceTokenHash !== "") {
    return { ok: false, error: "already_paired" };
  }
  if (!row.isActive) return { ok: false, error: "invalid_pairing_token" };

  const deviceToken = generateOpaqueToken(32);
  const deviceTokenHash = hashDeviceSecret(deviceToken);
  const name = String(deviceName ?? "").trim() || "unnamed-device";

  db.update(schema.trustedDevices)
    .set({
      deviceName: name,
      pairingToken: null,
      deviceTokenHash,
      lastSeenAt: new Date(),
    })
    .where(eq(schema.trustedDevices.id, row.id))
    .run();

  return {
    ok: true,
    deviceToken,
    deviceId: row.id,
    deviceName: name,
  };
}

/** Resolve device from `X-Device-Token` header value; updates last_seen_at. */
export function verifyTrustedDevice(
  db: BetterSQLite3Database<typeof schema>,
  deviceTokenPlain: string | undefined,
): { id: number; deviceName: string } | null {
  const raw = String(deviceTokenPlain ?? "").trim();
  if (!raw) return null;
  const deviceTokenHash = hashDeviceSecret(raw);
  const [row] = db
    .select()
    .from(schema.trustedDevices)
    .where(eq(schema.trustedDevices.deviceTokenHash, deviceTokenHash))
    .limit(1)
    .all();
  if (!row || !row.isActive) return null;

  db.update(schema.trustedDevices)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.trustedDevices.id, row.id))
    .run();

  return { id: row.id, deviceName: row.deviceName };
}

export function readDeviceTokenHeader(headers: IncomingHttpHeaders): string | undefined {
  const raw = headers["x-device-token"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Alias for owner pairing UX (step 26). */
export function generatePairingToken(
  db: BetterSQLite3Database<typeof schema>,
): { pairingToken: string; id: number } {
  return createPairingChallenge(db);
}

const DEV_BROWSER_DEVICE_NAME = "__dev_browser__";

/** Disabled in production or when `OLIVER_ROOS_DISABLE_DEV_DEVICE=1`. */
export function isDevBrowserDeviceRouteEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.OLIVER_ROOS_DISABLE_DEV_DEVICE === "1") return false;
  return true;
}

/**
 * Idempotent: ensures a fixed LAN-dev trusted device row exists and returns its plaintext token.
 * Only call from `POST /api/auth/dev-pair-browser` when `isDevBrowserDeviceRouteEnabled()`.
 */
export function upsertDevBrowserDevice(db: BetterSQLite3Database<typeof schema>): {
  deviceToken: string;
  deviceId: number;
} {
  const deviceToken =
    process.env.OLIVER_ROOS_DEV_DEVICE_TOKEN?.trim() ||
    "or_dev_local_browser_oliver_roos_pos_not_for_production";
  const deviceTokenHash = hashDeviceSecret(deviceToken);
  const now = new Date();
  const [existing] = db
    .select()
    .from(schema.trustedDevices)
    .where(eq(schema.trustedDevices.deviceName, DEV_BROWSER_DEVICE_NAME))
    .limit(1)
    .all();
  if (existing) {
    db.update(schema.trustedDevices)
      .set({
        deviceTokenHash,
        pairingToken: null,
        isActive: true,
        lastSeenAt: now,
      })
      .where(eq(schema.trustedDevices.id, existing.id))
      .run();
  } else {
    db.insert(schema.trustedDevices)
      .values({
        deviceName: DEV_BROWSER_DEVICE_NAME,
        pairingToken: null,
        deviceTokenHash,
        isActive: true,
        lastSeenAt: now,
      })
      .run();
  }
  const [row] = db
    .select({ id: schema.trustedDevices.id })
    .from(schema.trustedDevices)
    .where(eq(schema.trustedDevices.deviceName, DEV_BROWSER_DEVICE_NAME))
    .limit(1)
    .all();
  if (!row) throw new Error("dev_browser_device_upsert_failed");
  return { deviceToken, deviceId: row.id };
}
