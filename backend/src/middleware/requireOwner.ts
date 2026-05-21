import type { NextFunction, Request, Response } from "express";
import { getStaffContext, isOwnerRole } from "../lib/sessionAuth.js";

/**
 * Inhaber / Super-Admin only — höchste Stufe für Gesamtumsatz (Business Cockpit).
 */
export function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    const c = getStaffContext(req);
    if (!isOwnerRole(c.role)) {
      res.status(403).json({
        error: "forbidden",
        reason: "owner_role_required",
      });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}
