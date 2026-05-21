import type { Transition } from "framer-motion";

/** Shared spring for luxury surfaces — gate with prefersReducedMotion in components. */
export const luxurySpring: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
  mass: 0.8,
};

export const luxurySpringReduced: Transition = {
  type: "tween",
  duration: 0.15,
  ease: "easeOut",
};
