import { AnimatePresence, motion } from "framer-motion";
import { useLocation, Outlet } from "react-router-dom";
import { luxurySpring, luxurySpringReduced } from "../../lib/motionPresets";
import { useUiShellStore } from "../../store/uiShellStore";

/**
 * Soft route transitions — avoids snap cuts between POS screens.
 */
export function AnimatedOutlet() {
  const location = useLocation();
  const reduced = useUiShellStore((s) => s.prefersReducedMotion);
  const t = reduced ? luxurySpringReduced : luxurySpring;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
        transition={t}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <Outlet />
      </motion.div>
    </AnimatePresence>
  );
}
