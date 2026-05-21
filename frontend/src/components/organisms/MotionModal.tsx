import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { luxurySpring, luxurySpringReduced } from "../../lib/motionPresets";
import { luxuryGlassFloat } from "../../lib/luxuryUi";
import { useUiShellStore } from "../../store/uiShellStore";

type MotionModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Optional shared layoutId for morph transitions */
  layoutId?: string;
  /** z-index layer */
  zIndex?: number;
  titleId?: string;
  className?: string;
  panelClassName?: string;
  /**
   * Replaces the default inner frame (max-w-lg, centered sheet shell).
   * Use for wide surfaces such as checkout (max-w-6xl, stretch height).
   */
  frameClassName?: string;
  /** Merged onto the motion panel (after default luxury shadow). */
  panelStyle?: CSSProperties;
};

function useSheetBreakpoint(): boolean {
  const [sheet, setSheet] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 1024px)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1024px)");
    const fn = () => setSheet(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return sheet;
}

/**
 * Universal overlay: bottom sheet on narrow/iPad, scale+spring on desktop.
 * Backdrop:  + dark tint; glass panel optional via panelClassName.
 */
export function MotionModal({
  open,
  onClose,
  children,
  layoutId,
  /** Above ClientProfile (260), below toasts (500); stops modal bleed-under. */
  zIndex = 320,
  titleId,
  className = "",
  panelClassName = "",
  frameClassName,
  panelStyle,
}: MotionModalProps) {
  const reduced = useUiShellStore((s) => s.prefersReducedMotion);
  const pushModal = useUiShellStore((s) => s.pushModal);
  const popModal = useUiShellStore((s) => s.popModal);
  const reactId = useId();
  const stackId = `motion-modal-${titleId ?? reactId}`;

  const isSheet = useSheetBreakpoint();
  const transition = reduced ? luxurySpringReduced : luxurySpring;

  useEffect(() => {
    if (open) pushModal(stackId);
    else popModal(stackId);
    return () => {
      popModal(stackId);
    };
  }, [open, popModal, pushModal, stackId]);

  const backdropVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1 },
  };

  const panelVariants = isSheet
    ? {
        hidden: { y: "100%", opacity: reduced ? 1 : 0.98 },
        show: { y: 0, opacity: 1 },
      }
    : {
        hidden: { scale: reduced ? 1 : 0.94, opacity: 0 },
        show: { scale: 1, opacity: 1 },
      };

  return (
    <AnimatePresence>
      {open ? (
        <div
          className={`fixed inset-0 flex items-end justify-center sm:items-center ${className}`}
          style={{ zIndex }}
        >
          <motion.button
            type="button"
            aria-label="Schließen"
            className="absolute inset-0 z-0 bg-gray-100/80 "
            variants={backdropVariants}
            initial="hidden"
            animate="show"
            exit="hidden"
            transition={reduced ? { duration: 0.12 } : { duration: 0.22 }}
            onClick={onClose}
          />
          <div
            className={
              frameClassName ??
              "relative z-10 flex max-h-[min(92dvh,100%)] w-full max-w-lg flex-col justify-end p-3 sm:justify-center sm:p-6"
            }
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              layoutId={layoutId && !reduced ? layoutId : undefined}
              className={`relative z-10 w-full overflow-hidden rounded-2xl text-deep-charcoal sm:max-h-[85vh] ${luxuryGlassFloat} shadow-[0_0_48px_rgba(212,175,55,0.08)] ${panelClassName}`}
              variants={panelVariants}
              initial="hidden"
              animate="show"
              exit="hidden"
              transition={transition}
              style={{
                boxShadow:
                  "0 0 0 1px rgba(212,175,55,0.06), 0 28px 64px -12px rgba(0,0,0,0.55), 0 12px 36px -8px rgba(212,175,55,0.05)",
                ...panelStyle,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </motion.div>
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
