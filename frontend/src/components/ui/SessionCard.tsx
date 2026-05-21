import type { SessionQueueKind } from "../../hooks/useLiveSessions";

const KIND_LABEL: Record<SessionQueueKind, string> = {
  walk_in: "Walk-in",
  checked_in: "Termin",
  in_progress: "Aktiv / Beratung",
};

/** Soft gradients — no flat orange/green borders */
const KIND_GRADIENT: Record<SessionQueueKind, string> = {
  walk_in: "from-[#3d3428]/95 via-[#2a2520]/90 to-[#1f1c18]/95",
  checked_in: "from-[#2a2830]/95 via-[#242230]/90 to-[#1a1822]/95",
  in_progress: "from-[#283038]/95 via-[#222830]/90 to-[#181c22]/95",
};

type SessionCardProps = {
  sessionId: number;
  clientLabel: string;
  staffName: string;
  elapsedLabel: string;
  queueKind: SessionQueueKind;
  onSelect: () => void;
  /** When set, shows “Session abbrechen” (force-cancel open session). */
  onForceCancel?: (sessionId: number) => void | Promise<void>;
  forceCancelBusy?: boolean;
};

/**
 * Glass-adjacent session tile — premium gradient fill, champagne halo on hover.
 */
export function SessionCard({
  sessionId,
  clientLabel,
  staffName,
  elapsedLabel,
  queueKind,
  onSelect,
  onForceCancel,
  forceCancelBusy,
}: SessionCardProps) {
  const gradient = KIND_GRADIENT[queueKind] ?? KIND_GRADIENT.walk_in;
  const kindLabel = KIND_LABEL[queueKind] ?? "Session";

  return (
    <div
      className={[
        "group relative w-full min-h-[132px] overflow-hidden rounded-2xl border border-deep-charcoal/10 bg-gradient-to-br text-left shadow-[0_0_44px_rgba(212,175,55,0.1)] backdrop-blur-2xl transition",
        "ring-1 ring-inset ring-white/[0.06]",
        "hover:border-champagne-gold/30 hover:shadow-[0_0_52px_rgba(212,175,55,0.18)]",
        gradient,
      ].join(" ")}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 90% 55% at 85% 0%, rgba(212,175,55,0.12), transparent 55%)",
        }}
        aria-hidden
      />
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Session öffnen: ${clientLabel}, ${kindLabel}`}
        className="relative w-full p-5 pb-3 text-left focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-champagne-gold/40 active:scale-[0.995]"
      >
        <div className="flex items-start justify-between gap-3">
          <span
            className="inline-block rounded-full border border-deep-charcoal/12 bg-gray-200/70 px-3 py-1.5 text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/90 backdrop-blur-md"
            aria-hidden
          >
            {kindLabel}
          </span>
          <span className="font-mono text-lg font-light tabular-nums tracking-tight text-editorial-pulse/90 drop-shadow-[0_0_14px_rgba(212,175,55,0.35)]">
            {elapsedLabel}
          </span>
        </div>
        <p className="mt-4 break-words text-2xl font-light leading-tight tracking-tight text-deep-charcoal">
          {clientLabel}
        </p>
        <p className="mt-2 text-lg text-deep-charcoal/55">
          <span className="text-xs font-medium uppercase tracking-wider text-deep-charcoal/35">Mitarbeiter</span>{" "}
          <span className="text-deep-charcoal/55">· {staffName}</span>
        </p>
      </button>
      {onForceCancel ? (
        <div className="relative border-t border-deep-charcoal/10 px-4 pb-4 pt-2">
          <button
            type="button"
            disabled={forceCancelBusy}
            className="flex min-h-[52px] w-full items-center justify-center rounded-xl border border-red-400/55 bg-red-50/55 px-4 text-[11px] font-light uppercase tracking-[0.22em] text-red-600/90 backdrop-blur-md transition hover:bg-red-50/75 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void onForceCancel(sessionId);
            }}
          >
            {forceCancelBusy ? "…" : "Session abbrechen"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
