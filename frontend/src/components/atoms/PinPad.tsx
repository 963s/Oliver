import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { luxurySpring, luxurySpringReduced } from "../../lib/motionPresets";
import { useUiShellStore } from "../../store/uiShellStore";

type PinPadProps = {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  onClear: () => void;
  disabled?: boolean;
  /** Shown for accessibility; PIN not echoed as digits. */
  pinLength: number;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⏎"] as const;

/**
 * Large touch targets + physical keyboard: 0–9, Enter, Backspace.
 */
export function PinPad({
  onDigit,
  onBackspace,
  onSubmit,
  onClear,
  disabled = false,
  pinLength,
}: PinPadProps) {
  const reduced = useUiShellStore((s) => s.prefersReducedMotion);
  const [glowKey, setGlowKey] = useState<string | null>(null);
  const tapTransition = reduced ? luxurySpringReduced : luxurySpring;

  const keyHandler = useCallback(
    (e: KeyboardEvent) => {
      if (disabled) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        onDigit(e.key);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onSubmit();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        onBackspace();
        return;
      }
    },
    [disabled, onDigit, onBackspace, onSubmit],
  );

  useEffect(() => {
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, [keyHandler]);

  const flashGlow = (key: string) => {
    if (reduced) return;
    setGlowKey(key);
    window.setTimeout(() => setGlowKey(null), 220);
  };

  return (
    <div className="w-full max-w-sm">
      <div
        className="mb-3 min-h-10 text-center text-2xl font-light tracking-[0.4em] text-deep-charcoal"
        aria-live="polite"
        aria-label="PIN-Länge"
      >
        {pinLength > 0 ? "•".repeat(Math.min(pinLength, 6)) : "—"}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <motion.button
            key={k}
            type="button"
            disabled={disabled}
            className={`min-h-[56px] rounded-bento border border-deep-charcoal/14 bg-transparent text-2xl font-light text-deep-charcoal active:bg-gray-300/80 disabled:opacity-50 ${
              glowKey === k ? "border-editorial-pulse shadow-[0_0_18px_var(--editorial-pulse-dim)] text-editorial-pulse" : ""
            }`}
            whileTap={reduced ? undefined : { scale: 0.96, filter: "brightness(1.15)" }}
            transition={tapTransition}
            onClick={() => {
              flashGlow(k);
              if (k === "C") onClear();
              else if (k === "⏎") onSubmit();
              else onDigit(k);
            }}
          >
            {k}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
