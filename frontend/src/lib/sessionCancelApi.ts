import { apiPost } from "../api";

/** Abandons an open session (no checkout). Draft invoices removed; closed invoice blocks cancel. */
export function cancelOpenSession(sessionId: number, body?: { reason?: string }): Promise<unknown> {
  return apiPost(`/api/sessions/${sessionId}/cancel`, body ?? {});
}
