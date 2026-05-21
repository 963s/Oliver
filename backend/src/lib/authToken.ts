import { createHmac, timingSafeEqual } from "node:crypto";
import type { StaffRole } from "./sessionAuth.js";

export type AuthTokenPayload = {
  staffId: number;
  role: string;
  exp: number;
};

function b64urlEncode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

function b64urlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

export function signAuthToken(
  payload: Omit<AuthTokenPayload, "exp">,
  secret: string,
  ttlMs = 8 * 60 * 60 * 1000,
): string {
  const full: AuthTokenPayload = {
    ...payload,
    exp: Date.now() + ttlMs,
  };
  const body = b64urlEncode(JSON.stringify(full));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAuthToken(token: string, secret: string): AuthTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const p = JSON.parse(b64urlDecode(body)) as AuthTokenPayload;
    if (typeof p.staffId !== "number" || typeof p.role !== "string" || typeof p.exp !== "number") {
      return null;
    }
    if (p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function getAuthSecret(): string {
  const s = process.env.AUTH_SECRET?.trim();
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set (min 16 chars) in production");
  }
  return "dev-insecure-auth-secret-change-me";
}
