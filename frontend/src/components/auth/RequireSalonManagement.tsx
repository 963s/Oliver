import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { isSalonManagementRole } from "../../lib/staffRoles";
import { useAuthStore } from "../../store/authStore";

type Props = { children: React.ReactNode };

/**
 * Blocks stylists / cashiers from management routes (403-safe + no nav link).
 */
export function RequireSalonManagement({ children }: Props) {
  const staffRole = useAuthStore((s) => s.staffRole);
  const rehydrate = useAuthStore((s) => s.rehydrate);

  useEffect(() => {
    rehydrate();
  }, [rehydrate]);

  if (!isSalonManagementRole(staffRole)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
