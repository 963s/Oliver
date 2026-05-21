/** Mirrors backend `isSalonManagementRole` — Chef-Ansicht / Umsatz. */
export function isSalonManagementRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return (
    r === "owner" ||
    r === "super_admin" ||
    r === "admin" ||
    r === "manager"
  );
}

/** Gesamt-Umsatz (Business Cockpit) — nur `owner`/`super_admin` (Backend `requireOwner`). */
export function isOwnerRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return r === "owner" || r === "super_admin";
}
