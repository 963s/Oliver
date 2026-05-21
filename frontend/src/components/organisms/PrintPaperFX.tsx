import { AnimatePresence, motion } from "framer-motion";
import { luxurySpring, luxurySpringReduced } from "../../lib/motionPresets";
import { useUiShellStore } from "../../store/uiShellStore";

/**
 * Visual sync when a print job hits the hardware queue — gated by prefers-reduced-motion.
 */
export function PrintPaperFX() {
  const active = useUiShellStore((s) => s.printPaperActive);
  const reduced = useUiShellStore((s) => s.prefersReducedMotion);

  return (
    <AnimatePresence>
      {active && !reduced ? (
        <motion.div
          key="paper"
          className="pointer-events-none fixed bottom-0 left-[10%] right-[10%] z-[480] h-28 rounded-t-bento border border-brushed-chrome/25 bg-canvas-white/93 shadow-luxury"
          initial={{ y: "110%" }}
          animate={{ y: 0 }}
          exit={{ y: "110%" }}
          transition={reduced ? luxurySpringReduced : luxurySpring}
          aria-hidden
        />
      ) : null}
    </AnimatePresence>
  );
}
