import type { Request } from "express";

export type StaffRole =
  | "owner"
  | "super_admin"
  | "admin"
  | "stylist"
  | "staff"
  | "cashier"
  | "manager";

const VALID_ROLES: StaffRole[] = [
  "owner",
  "super_admin",
  "admin",
  "stylist",
  "staff",
  "cashier",
  "manager",
];

/** Normalize DB / token string to a known role (default stylist / field staff). */
export function normalizeRole(raw: string | undefined | null): StaffRole {
  const r = String(raw ?? "stylist").toLowerCase();
  if (r === "staff") return "stylist";
  return VALID_ROLES.includes(r as StaffRole) ? (r as StaffRole) : "stylist";
}

export function isOwnerRole(role: StaffRole): boolean {
  return role === "owner" || role === "super_admin";
}

/** Salon financial / Chef dashboard — not for stylists or cashiers at the mirror. */
export function isSalonManagementRole(role: StaffRole): boolean {
  return (
    role === "owner" ||
    role === "super_admin" ||
    role === "admin" ||
    role === "manager"
  );
}

export function getStaffContext(req: Request): {
  staffId: number;
  role: StaffRole;
} {
  const a = req.authStaff;
  if (!a) {
    const err = new Error("Unauthorized");
    (err as { status?: number }).status = 401;
    throw err;
  }
  return { staffId: a.staffId, role: a.role };
}

export function requireOwner(req: Request): { staffId: number; role: StaffRole } {
  const c = getStaffContext(req);
  if (!isOwnerRole(c.role)) {
    const err = new Error("Owner role required");
    (err as { status?: number }).status = 403;
    throw err;
  }
  return c;
}

export function canReadTargets(
  req: Request,
  targetStaffId: number,
): boolean {
  const c = getStaffContext(req);
  if (c.staffId === targetStaffId) {
    return true;
  }
  if (
    isOwnerRole(c.role) &&
    req.header("X-Owner-View-Targets") === "1"
  ) {
    return true;
  }
  return false;
}
