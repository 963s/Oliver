import type { StaffRole } from "../lib/sessionAuth.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by auth middleware after Bearer verification. */
      authStaff?: { staffId: number; role: StaffRole };
      /** Set by `registerDeviceGuard` after `X-Device-Token` verification. */
      trustedDevice?: { id: number; deviceName: string };
    }
  }
}

export {};
