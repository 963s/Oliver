import { useCallback } from "react";

type LuxuryTouchMlInputProps = {
  id?: string;
  value: number;
  onChange: (next: number) => void;
  /** Primary +/- step (ml). */
  step?: number;
  min?: number;
  max?: number;
  /** Optional finer step row */
  fineStep?: number;
};

/**
 * Salon-scale quantity control: no `type="number"` spinners — large − / + and optional numeric text entry.
 */
export function LuxuryTouchMlInput({
  id,
  value,
  onChange,
  step = 10,
  min = 0,
  max = 99_999_999,
  fineStep = 1,
}: LuxuryTouchMlInputProps) {
  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(min, Math.floor(n))),
    [min, max],
  );

  const bump = (delta: number) => {
    onChange(clamp(value + delta));
  };

  const onText = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 9);
    if (digits === "") {
      onChange(min);
      return;
    }
    const n = Number.parseInt(digits, 10);
    if (Number.isFinite(n)) onChange(clamp(n));
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-label={`${step} ml weniger`}
          className="flex min-h-[56px] min-w-[56px] shrink-0 items-center justify-center rounded-xl border border-deep-charcoal/10 bg-gray-200/55 text-3xl font-light leading-none text-deep-charcoal shadow-[0_0_28px_rgba(212,175,55,0.08)]  transition hover:border-champagne-gold/25 hover:shadow-[0_0_36px_rgba(212,175,55,0.14)] active:scale-[0.97]"
          onClick={() => bump(-step)}
        >
          −
        </button>
        <div className="flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center rounded-xl border border-deep-charcoal/10 bg-gray-200/50 px-2 py-2 text-center shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] ">
          <span className="font-mono text-3xl font-black tabular-nums tracking-tight text-deep-charcoal">{value}</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-deep-charcoal/35">ml</span>
        </div>
        <button
          type="button"
          aria-label={`${step} ml mehr`}
          className="flex min-h-[56px] min-w-[56px] shrink-0 items-center justify-center rounded-xl border border-deep-charcoal/10 bg-gray-200/55 text-3xl font-light leading-none text-deep-charcoal shadow-[0_0_28px_rgba(212,175,55,0.08)]  transition hover:border-champagne-gold/25 hover:shadow-[0_0_36px_rgba(212,175,55,0.14)] active:scale-[0.97]"
          onClick={() => bump(step)}
        >
          +
        </button>
      </div>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-label={`${fineStep} ml weniger`}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-deep-charcoal/10 bg-gray-200/40 text-lg font-semibold text-deep-charcoal/90  transition hover:bg-gray-200/70 active:scale-[0.98]"
          onClick={() => bump(-fineStep)}
        >
          −{fineStep}
        </button>
        <button
          type="button"
          aria-label={`${fineStep} ml mehr`}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-deep-charcoal/10 bg-gray-200/40 text-lg font-semibold text-deep-charcoal/90  transition hover:bg-gray-200/70 active:scale-[0.98]"
          onClick={() => bump(fineStep)}
        >
          +{fineStep}
        </button>
      </div>
      <label className="block text-[10px] font-medium uppercase tracking-wider text-deep-charcoal/40" htmlFor={id}>
        Direkt (ml)
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={String(value)}
        onChange={(e) => onText(e.target.value)}
        className="min-h-[52px] w-full rounded-xl border border-deep-charcoal/10 bg-gray-200/50 px-4 py-3 text-center font-mono text-xl font-semibold tabular-nums text-deep-charcoal shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]  outline-none transition focus:border-champagne-gold/35 focus:shadow-[0_0_24px_rgba(212,175,55,0.12)]"
      />
    </div>
  );
}
