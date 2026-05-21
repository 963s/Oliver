/**
 * Mandatory idle window after each appointment (cleaning / turnover).
 * Must match frontend `SANITIZATION_BUFFER_MS` in agendaGridUtils.ts.
 */
export const SANITIZATION_BUFFER_MS = 15 * 60 * 1000;

/** Two intervals [a0,a1) and [b0,b1) extended by buffer after each end — overlap test. */
export function appointmentsOverlapWithBuffer(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  bufferMs: number = SANITIZATION_BUFFER_MS,
): boolean {
  const aEff = aEnd + bufferMs;
  const bEff = bEnd + bufferMs;
  return aStart < bEff && bStart < aEff;
}
