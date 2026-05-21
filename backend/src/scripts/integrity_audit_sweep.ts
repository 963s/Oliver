/**
 * Lead System Auditor — deterministic checks (no DB) for scheduling + buffer math.
 * Run: `npm run build && node dist/scripts/integrity_audit_sweep.js` from `backend/`.
 */
import { berlinWeekdayFromYmd } from "../services/availabilityService.js";
import {
  appointmentsOverlapWithBuffer,
  SANITIZATION_BUFFER_MS,
} from "../lib/scheduling/sanitizationBuffer.js";
import { getHolidaysForYear } from "../services/holidayService.js";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(`ASSERT: ${m}`);
}

function main() {
  // A) Sonntag (Europe/Berlin calendar day)
  const sundayYmd = "2026-01-04";
  assert(berlinWeekdayFromYmd(sundayYmd) === 0, "2026-01-04 must be Sunday in Berlin");

  // B) Neujahr BW public
  const y2026 = getHolidaysForYear(2026);
  const neujahr = y2026.find((h) => h.date === "2026-01-01");
  assert(!!neujahr, "2026-01-01 must be a public holiday in BW (Neujahr)");

  // C) Reinigungspuffer: existing 10:00–10:30 blocks a new slot starting 10:30 (until buffer clears)
  const t = (h: number, m: number) =>
    new Date(`2026-06-10T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+02:00`).getTime();
  const a0 = t(10, 0);
  const a1 = t(10, 30);
  const b0 = t(10, 30);
  const b1 = t(10, 45);
  assert(
    appointmentsOverlapWithBuffer(a0, a1, b0, b1, SANITIZATION_BUFFER_MS),
    "10:30 new start must still overlap buffer after 10:30 service end (15 min)",
  );
  assert(SANITIZATION_BUFFER_MS === 15 * 60 * 1000, "buffer = 15 min");

  // eslint-disable-next-line no-console
  console.log("integrity_audit_sweep: OK");
}

try {
  main();
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("integrity_audit_sweep: FAILED", e);
  process.exit(1);
}
