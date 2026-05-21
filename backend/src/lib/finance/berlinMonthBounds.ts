import { berlinYmdFromMs } from "../../services/availabilityService.js";

/**
 * Smallest UTC instant such that the Europe/Berlin calendar date is >= `ymd`.
 */
export function lowerBoundMsBerlinYmd(ymd: string): number {
  let lo = 0;
  let hi = 4102444800000;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (berlinYmdFromMs(mid).localeCompare(ymd) < 0) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Inclusive start, exclusive end — UTC ms — for all instants with Berlin date in `YYYY-MM`. */
export function berlinCalendarMonthUtcRange(ym: string): {
  startMs: number;
  endMsExclusive: number;
} {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) throw new Error("invalid_month");
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error("invalid_month");

  const pad = (n: number) => String(n).padStart(2, "0");
  const first = `${year}-${pad(month)}-01`;
  let ny = year;
  let nm = month + 1;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  const firstNext = `${ny}-${pad(nm)}-01`;

  return {
    startMs: lowerBoundMsBerlinYmd(first),
    endMsExclusive: lowerBoundMsBerlinYmd(firstNext),
  };
}
