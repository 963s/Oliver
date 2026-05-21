import { MotionModal } from "./MotionModal";
import { HelpBentoPanel } from "./HelpBentoPanel";

type HelpHandbuchModalProps = {
  open: boolean;
  onClose: () => void;
};

export function HelpHandbuchModal({ open, onClose }: HelpHandbuchModalProps) {
  return (
    <MotionModal
      open={open}
      onClose={onClose}
      titleId="help-modal-title"
      zIndex={320}
      frameClassName="relative z-10 flex max-h-[min(92dvh,100%)] w-full max-w-4xl flex-col justify-center p-3 sm:justify-center sm:p-6"
      panelClassName="!flex max-h-[min(88dvh,900px)] !flex-col overflow-hidden !rounded-2xl !p-0"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-6 sm:px-8 sm:pb-10 sm:pt-8">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-deep-charcoal/35">Kurzhandbuch</p>
        <h2 id="help-modal-title" className="mt-2 font-heading text-2xl font-bold tracking-tight text-deep-charcoal md:text-3xl">
          Das Wichtigste — immer griffbereit
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-deep-charcoal/45">
          Keine langen Textwände: Themen als Karten. Tippen Sie außerhalb oder Esc zum Schließen.
        </p>
        <div className="mt-8">
          <HelpBentoPanel />
        </div>
      </div>
    </MotionModal>
  );
}
