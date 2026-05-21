import type * as schema from "../../db/schema.js";

/** Plain snapshot for audit_logs before_state_json / after_state_json (ISO instants). */
export function snapshotAppointmentRow(
  a: typeof schema.appointments.$inferSelect,
): Record<string, unknown> {
  const iso = (d: Date | null | undefined) =>
    d instanceof Date ? d.toISOString() : d ?? null;
  return {
    id: a.id,
    clientName: a.clientName,
    clientPhone: a.clientPhone,
    clientId: a.clientId,
    staffId: a.staffId,
    serviceName: a.serviceName,
    sourceType: a.sourceType,
    cancelReason: a.cancelReason,
    rescheduleCount: a.rescheduleCount,
    startAt: iso(a.startAt),
    endAt: iso(a.endAt),
    status: a.status,
    deletedAt: iso(a.deletedAt ?? null),
  };
}

const THIRTY_MIN_MS = 30 * 60 * 1000;

/**
 * Owner/staff must supply a textual Begründung for Revisionssicherheit when rescheduling
 * beyond a 30-minute delta or reassigning staff (GoBD Step 36).
 */
export function appointmentUpdateRequiresReason(
  before: typeof schema.appointments.$inferSelect,
  next: { startAt: Date; endAt: Date; staffId: number },
): boolean {
  if (before.staffId !== next.staffId) return true;
  const ds = Math.abs(next.startAt.getTime() - before.startAt.getTime());
  const de = Math.abs(next.endAt.getTime() - before.endAt.getTime());
  return ds > THIRTY_MIN_MS || de > THIRTY_MIN_MS;
}
