import type { NextFunction, Request, Response } from "express";
import { getStaffContext, isSalonManagementRole } from "../lib/sessionAuth.js";

/**
 * Owner / Admin / Manager only — blocks stylists and cashiers from financial APIs.
 * (JWT `role` from `staff.role`.)
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    const c = getStaffContext(req);
    if (!isSalonManagementRole(c.role)) {
      res.status(403).json({
        error: "forbidden",
        reason: "admin_or_owner_role_required",
      });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}
