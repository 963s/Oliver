import rateLimit from "express-rate-limit";

/**
 * Brute-force mitigation for PIN login: count **failed** responses only
 * (`skipSuccessfulRequests`), keyed by `X-Device-Token` when present (salon iPad),
 * else fall back to IP.
 */
export const pinLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_pin_attempts" },
  keyGenerator: (req) => {
    const device = req.get("x-device-token")?.trim();
    if (device) return `pin-login:${device}`;
    const ip = req.ip ?? "unknown";
    return `pin-login:ip:${ip}`;
  },
});
