import type { Express, NextFunction, Request, Response } from "express";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { readDeviceTokenHeader, verifyTrustedDevice } from "./auth/deviceAuth.js";

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()}:${path}`;
}

/**
 * Routes that must work **before** a device is paired (bootstrap + ZVT callback).
 * All other `/api/*` calls require a valid `X-Device-Token` (see `readDeviceTokenHeader`).
 */
const DEVICE_EXEMPT = new Set([
  "GET:/api/health",
  "POST:/api/auth/pair",
  "POST:/api/auth/login",
  /** Local / staging bootstrap only — handler checks env (see `deviceAuth.isDevBrowserDeviceRouteEnabled`). */
  "POST:/api/auth/dev-pair-browser",
  "POST:/api/auth/devices/pairing-token",
  "POST:/api/hardware/zvt/authorization-success",
]);

/**
 * Global device trust gate — run **before** JWT auth (`registerAuthGuard`).
 */
export function registerDeviceGuard(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api")) {
      next();
      return;
    }
    if (DEVICE_EXEMPT.has(routeKey(req.method, req.path))) {
      next();
      return;
    }
    const token = readDeviceTokenHeader(req.headers);
    const dev = verifyTrustedDevice(db, token);
    if (!dev) {
      res.status(403).json({ error: "trusted_device_required" });
      return;
    }
    req.trustedDevice = { id: dev.id, deviceName: dev.deviceName };
    next();
  });
}
