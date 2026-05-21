import type { Express, NextFunction, Request, Response } from "express";
import { getAuthSecret, verifyAuthToken } from "./authToken.js";
import { normalizeRole } from "./sessionAuth.js";

function isPublicRoute(method: string, path: string): boolean {
  if (method === "GET" && path === "/api/health") return true;
  if (method === "POST" && path === "/api/auth/login") return true;
  if (method === "POST" && path === "/api/auth/pin-login") return true;
  if (method === "GET" && path === "/api/auth/directory") return true;
  if (method === "POST" && path === "/api/auth/pair") return true;
  if (method === "POST" && path === "/api/auth/dev-pair-browser") return true;
  /** Hardware callback — no user session; tighten later with HMAC or API key if needed. */
  if (method === "POST" && path === "/api/hardware/zvt/authorization-success") return true;
  return false;
}

export function registerAuthGuard(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api")) {
      next();
      return;
    }
    if (isPublicRoute(req.method, req.path)) {
      next();
      return;
    }
    const header = req.headers.authorization ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(header);
    const token = m?.[1]?.trim();
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const payload = verifyAuthToken(token, getAuthSecret());
    if (!payload) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    const role = normalizeRole(payload.role);
    req.authStaff = { staffId: payload.staffId, role };
    next();
  });
}
