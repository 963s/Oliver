import { motion } from "framer-motion";
import { luxurySpring, luxurySpringReduced } from "../../lib/motionPresets";
import { useUiShellStore } from "../../store/uiShellStore";

type LuxuryToggleProps = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
};

/**
 * iOS-style on/off — smooth thumb via Framer Motion (respects reduced motion).
 */
export function LuxuryToggle({
  checked,
  onCheckedChange,
  disabled,
  id,
  "aria-label": ariaLabel,
}: LuxuryToggleProps) {
  const reduced = useUiShellStore((s) => s.prefersReducedMotion);
  const t = reduced ? luxurySpringReduced : luxurySpring;

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={[
        "relative h-9 w-[52px] shrink-0 rounded-full border border-deep-charcoal/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] outline-none transition-colors",
        disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer active:scale-[0.98]",
        checked ? "bg-[color-mix(in_srgb,var(--editorial-pulse)_30%,black)]" : "bg-white/10",
      ].join(" ")}
    >
      <motion.span
        layout
        transition={t}
        className="absolute left-[2px] top-0.5 block h-8 w-8 rounded-full bg-white shadow-md ring-1 ring-black/10"
        initial={false}
        animate={{ x: checked ? 18 : 0 }}
        whileTap={disabled || reduced ? undefined : { scale: 0.92 }}
      />
      <span className="sr-only">{checked ? "An" : "Aus"}</span>
    </button>
  );
}
