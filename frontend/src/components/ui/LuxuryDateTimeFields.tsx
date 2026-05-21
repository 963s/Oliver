import { LuxuryDatePicker } from "./LuxuryDatePicker";
import { LuxurySelectMenu } from "./LuxurySelectMenu";

const MINUTES = [0, 15, 30, 45] as const;

function hoursRange(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let h = 7; h <= 21; h++) {
    const s = String(h).padStart(2, "0");
    out.push({ value: String(h), label: `${s}:00` });
  }
  return out;
}

type Props = {
  /** yyyy-mm-dd */
  dateValue: string;
  hour: number;
  minute: number;
  onDateChange: (ymd: string) => void;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  label: string;
  idPrefix: string;
};

/**
 * Date + time grouped as two clear “Wann?” blocks — faster salon booking UX.
 */
export function LuxuryDateTimeFields({
  dateValue,
  hour,
  minute,
  onDateChange,
  onHourChange,
  onMinuteChange,
  label,
  idPrefix,
}: Props) {
  const hourOpts = hoursRange();
  const minuteOpts = MINUTES.map((m) => ({
    value: String(m),
    label: String(m).padStart(2, "0"),
  }));

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-deep-charcoal/45">{label}</p>

      <div className="rounded-2xl border border-deep-charcoal/10 bg-gray-200/40 p-4 shadow-[inset_0_1px_0_rgba(0,0,0,0.04)] ">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-deep-charcoal/35">Datum</p>
        <LuxuryDatePicker
          value={dateValue}
          onChange={onDateChange}
          label=""
          className="w-full"
          yearSpan={{ before: 1, after: 2 }}
        />
      </div>

      <div className="rounded-2xl border border-deep-charcoal/10 bg-gray-200/40 p-4 shadow-[inset_0_1px_0_rgba(0,0,0,0.04)] ">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-deep-charcoal/35">Uhrzeit</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <LuxurySelectMenu
            id={`${idPrefix}-h`}
            label="Stunde"
            value={String(hour)}
            options={hourOpts}
            onChange={(v) => onHourChange(Number(v))}
          />
          <LuxurySelectMenu
            id={`${idPrefix}-m`}
            label="Minute"
            value={String(minute)}
            options={minuteOpts}
            onChange={(v) => onMinuteChange(Number(v))}
          />
        </div>
      </div>
    </div>
  );
}

/** Build local Date from yyyy-mm-dd + hour + minute (wall clock). */
export function localDateFromParts(ymd: string, hour: number, minute: number): Date {
  const [y, mo, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date();
  dt.setFullYear(y, mo - 1, d);
  dt.setHours(hour, minute, 0, 0);
  return dt;
}
