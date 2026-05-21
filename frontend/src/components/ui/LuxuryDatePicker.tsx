import { useMemo } from "react";
import { LuxurySelectMenu, type LuxurySelectOption } from "./LuxurySelectMenu";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

function clampDay(y: number, m: number, d: number): number {
  const max = daysInMonth(y, m);
  return Math.min(d, max);
}

/** Short German month names — boutique readability (values stay ISO `01`…`12`). */
const DE_MONTH_SHORT: readonly string[] = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

type LuxuryDatePickerProps = {
  /** yyyy-mm-dd */
  value: string;
  onChange: (ymd: string) => void;
  label?: string;
  /** Years from current year - offsetStart .. +offsetEnd */
  yearSpan?: { before: number; after: number };
  className?: string;
};

/**
 * No native date input — three touch lists (YYYY / MM / DD).
 */
export function LuxuryDatePicker({
  value,
  onChange,
  label = "Datum",
  yearSpan = { before: 1, after: 2 },
  className = "",
}: LuxuryDatePickerProps) {
  const parsed = parseYmd(value) ?? (() => {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
  })();

  const y = parsed.y;
  const m = parsed.m;
  const d = clampDay(y, m, parsed.d);

  const years = useMemo(() => {
    const cy = new Date().getFullYear();
    const out: LuxurySelectOption[] = [];
    for (let yy = cy - yearSpan.before; yy <= cy + yearSpan.after; yy++) {
      out.push({ value: String(yy), label: String(yy) });
    }
    return out;
  }, [yearSpan.before, yearSpan.after]);

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        value: pad2(i + 1),
        label: DE_MONTH_SHORT[i] ?? pad2(i + 1),
      })),
    [],
  );

  const maxDay = daysInMonth(y, m);
  const days = useMemo(() => {
    const out: LuxurySelectOption[] = [];
    for (let dd = 1; dd <= maxDay; dd++) {
      const ps = pad2(dd);
      out.push({ value: ps, label: ps });
    }
    return out;
  }, [maxDay]);

  const emit = (nextY: number, nextM: number, nextD: number) => {
    const dd = clampDay(nextY, nextM, nextD);
    onChange(`${nextY}-${pad2(nextM)}-${pad2(dd)}`);
  };

  return (
    <div className={className}>
      {label ? <span className="mb-3 block text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">{label}</span> : null}
      <div className="grid w-full grid-cols-3 gap-2">
        <LuxurySelectMenu
          label=""
          value={String(y)}
          options={years}
          onChange={(vs) => emit(Number(vs), m, d)}
          placeholder="Jahr"
        />
        <LuxurySelectMenu
          label=""
          value={pad2(m)}
          options={months}
          onChange={(vs) => emit(y, Number(vs), d)}
          placeholder="Monat"
        />
        <LuxurySelectMenu
          label=""
          value={pad2(d)}
          options={days}
          onChange={(vs) => emit(y, m, Number(vs))}
          placeholder="TT"
        />
      </div>
    </div>
  );
}
