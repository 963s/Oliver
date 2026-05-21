import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { apiPost } from "../../api";
import { formatBerlinTimeHHmm } from "../../lib/formatTime";
import { luxurySpring, luxurySpringReduced } from "../../lib/motionPresets";
import { usePulseStore } from "../../store/pulseStore";
import { useUiShellStore } from "../../store/uiShellStore";
import { MotionModal } from "../organisms/MotionModal";
import { ClientSearchInput, type ClientSearchResult } from "../ui/ClientSearchInput";

type MiniBookingModalProps = {
  open: boolean;
  onClose: () => void;
  staffId: number;
  staffDisplayName: string;
  /** Unix-ms Start (already Europe/Berlin calendar day correct) */
  startAtMs: number;
  /** Unix-ms End — used as fallback if user hasn't changed duration */
  endAtMs: number;
  onBooked: () => void;
  /** Shared layoutId with originating agenda slot for morph */
  layoutId?: string;
  /** Anchor rect for contextual popover mode (Agenda slots). */
  anchorRect?: { top: number; left: number; width: number; height: number } | null;
};

const DEFAULT_SERVICE = "Schnitt + Beratung";

// Duration presets in minutes
const DURATION_PRESETS = [
  { label: "15 Min", minutes: 15 },
  { label: "30 Min", minutes: 30 },
  { label: "45 Min", minutes: 45 },
  { label: "1 Std", minutes: 60 },
  { label: "1:15", minutes: 75 },
  { label: "1:30", minutes: 90 },
  { label: "2 Std", minutes: 120 },
  { label: "2:30", minutes: 150 },
  { label: "3 Std", minutes: 180 },
  { label: "4 Std", minutes: 240 },
];

function msToDurationMinutes(ms: number): number {
  return Math.round(ms / 60_000);
}

/**
 * Full-featured booking form — launched from agenda grid slot tap.
 * Supports: client search, flexible duration, service name, historical dates.
 */
export function MiniBookingModal({
  open,
  onClose,
  staffId,
  staffDisplayName,
  startAtMs,
  endAtMs,
  onBooked,
  layoutId,
  anchorRect,
}: MiniBookingModalProps) {
  const bump = usePulseStore((s) => s.incrementGlobalRefreshCounter);
  const reduced = useUiShellStore((s) => s.prefersReducedMotion);

  const initialDuration = msToDurationMinutes(endAtMs - startAtMs);

  const [clientName, setClientName]     = useState("");
  const [clientPhone, setClientPhone]   = useState("");
  const [clientId, setClientId]         = useState<number | null>(null);
  const [serviceName, setServiceName]   = useState(DEFAULT_SERVICE);
  const [durationMin, setDurationMin]   = useState(initialDuration);
  const [customDur, setCustomDur]       = useState("");
  const [showCustom, setShowCustom]     = useState(false);
  const [busy, setBusy]                 = useState(false);
  const [msg, setMsg]                   = useState("");

  // Reset when modal opens with new slot
  useEffect(() => {
    if (open) {
      setClientName("");
      setClientPhone("");
      setClientId(null);
      setServiceName(DEFAULT_SERVICE);
      setDurationMin(msToDurationMinutes(endAtMs - startAtMs));
      setCustomDur("");
      setShowCustom(false);
      setMsg("");
    }
  }, [open, startAtMs, endAtMs]);

  const computedEndMs = startAtMs + durationMin * 60_000;

  const handleClientSelect = useCallback((hit: ClientSearchResult) => {
    setClientName(hit.name);
    setClientPhone(hit.phone ?? "");
    setClientId(hit.id);
  }, []);

  const handleDurationPreset = (minutes: number) => {
    setDurationMin(minutes);
    setShowCustom(false);
    setCustomDur("");
  };

  const handleCustomDurApply = () => {
    const v = parseInt(customDur, 10);
    if (!isNaN(v) && v >= 5 && v <= 480) {
      setDurationMin(v);
      setShowCustom(false);
    }
  };

  const submit = () => {
    const name = clientName.trim();
    if (!name) {
      setMsg("Kundenname erforderlich");
      return;
    }
    const svc = serviceName.trim() || DEFAULT_SERVICE;
    setBusy(true);
    setMsg("");
    void apiPost("/api/appointments", {
      clientName: name,
      clientPhone: clientPhone.trim() || null,
      clientId: clientId ?? undefined,
      staffId,
      serviceName: svc,
      startAt: startAtMs,
      endAt: computedEndMs,
    })
      .then(() => {
        bump();
        onBooked();
        onClose();
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : "Fehler beim Speichern"))
      .finally(() => setBusy(false));
  };

  const tapTransition = reduced ? luxurySpringReduced : luxurySpring;
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !anchorRect) {
      setPopoverPos(null);
      return;
    }
    const panelWidth = 460;
    const margin = 16;
    const centeredLeft = anchorRect.left + anchorRect.width / 2 - panelWidth / 2;
    const clampedLeft = Math.max(margin, Math.min(centeredLeft, window.innerWidth - panelWidth - margin));
    const slotCenterY = anchorRect.top + anchorRect.height / 2;
    const top = Math.max(margin, Math.min(slotCenterY - 60, window.innerHeight - 560));
    setPopoverPos({ top, left: clampedLeft });
  }, [open, anchorRect]);

  useEffect(() => {
    if (!open || !anchorRect) return;
    const onDocDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("pointerdown", onDocDown);
    return () => window.removeEventListener("pointerdown", onDocDown);
  }, [open, anchorRect, onClose]);

  const body = (
    <div className="flex flex-col gap-0">
      {/* ── Header ── */}
      <div className="flex items-start justify-between border-b border-deep-charcoal/[0.08] px-5 py-4">
        <div>
          <h2
            id="mini-book-h1"
            className="font-heading text-2xl uppercase tracking-[0.1em] text-deep-charcoal"
          >
            Termin buchen
          </h2>
          <p className="mt-1 text-[11px] font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
            {staffDisplayName} ·{" "}
            <strong className="text-deep-charcoal/80">
              {formatBerlinTimeHHmm(startAtMs)}
            </strong>
            {" – "}
            <strong className="text-editorial-pulse">
              {formatBerlinTimeHHmm(computedEndMs)}
            </strong>
            <span className="text-deep-charcoal/30"> ({durationMin} Min)</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-deep-charcoal/[0.08] text-sm text-deep-charcoal/40 transition hover:bg-gray-100/60 hover:text-deep-charcoal/70"
        >
          ✕
        </button>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: "calc(min(72dvh,560px) - 100px)" }}>
        <div className="flex flex-col gap-5 px-5 py-5">

          {/* ── Dauer / Duration ── */}
          <div>
            <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
              Dauer
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((p) => (
                <button
                  key={p.minutes}
                  type="button"
                  onClick={() => handleDurationPreset(p.minutes)}
                  className={`h-8 px-3 text-[11px] font-medium uppercase tracking-[0.1em] transition ${
                    durationMin === p.minutes && !showCustom
                      ? "border border-editorial-pulse bg-editorial-pulse/10 text-editorial-pulse"
                      : "border border-deep-charcoal/10 bg-gray-100/50 text-deep-charcoal/60 hover:border-deep-charcoal/20 hover:text-deep-charcoal/80"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              {/* Custom duration */}
              <button
                type="button"
                onClick={() => setShowCustom((v) => !v)}
                className={`h-8 px-3 text-[11px] font-medium uppercase tracking-[0.1em] transition ${
                  showCustom
                    ? "border border-champagne-gold/60 bg-champagne-gold/10 text-champagne-gold"
                    : "border border-dashed border-deep-charcoal/15 text-deep-charcoal/40 hover:border-deep-charcoal/25 hover:text-deep-charcoal/60"
                }`}
              >
                Individuell
              </button>
            </div>

            {showCustom && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min="5"
                  max="480"
                  step="5"
                  value={customDur}
                  onChange={(e) => setCustomDur(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCustomDurApply()}
                  placeholder="z.B. 110"
                  className="luxury-field w-28"
                  autoFocus
                />
                <span className="text-[11px] text-deep-charcoal/40">Min</span>
                <button
                  type="button"
                  onClick={handleCustomDurApply}
                  className="h-8 px-3 text-[11px] uppercase tracking-[0.12em] border border-deep-charcoal/15 text-deep-charcoal/60 hover:bg-gray-100/60 transition"
                >
                  OK
                </button>
              </div>
            )}
          </div>

          {/* ── Client search ── */}
          <div>
            <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
              Kunde
            </p>
            <ClientSearchInput
              placeholder="Name, Telefon oder E-Mail suchen…"
              value={clientName}
              onChange={(v) => {
                setClientName(v);
                setClientId(null);
              }}
              onSelect={handleClientSelect}
            />
            {/* Fallback: manual name entry shown only if no match selected */}
            {!clientId && clientName && (
              <p className="mt-1.5 text-[10px] text-deep-charcoal/35">
                Kein bestehender Kunde — Name wird neu angelegt
              </p>
            )}
            {clientId && (
              <p className="mt-1.5 flex items-center gap-1 text-[10px] text-editorial-pulse/80">
                <span>✓</span> Bestehender Kunde verknüpft
              </p>
            )}
          </div>

          {/* Phone (auto-filled from search, can be edited) */}
          <div>
            <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
              Telefon
            </p>
            <input
              type="tel"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="+49 170 …"
              className="luxury-field w-full"
            />
          </div>

          {/* Service */}
          <div>
            <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
              Service
            </p>
            <input
              type="text"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              className="luxury-field w-full"
            />
          </div>

          {/* Error */}
          {msg && (
            <p className="rounded-sm border border-red-400/55 bg-red-50/60 px-3 py-2 text-[12px] text-red-600/90">
              {msg}
            </p>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-end gap-2 border-t border-deep-charcoal/[0.08] px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="min-h-9 px-4 text-[11px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50 transition hover:text-deep-charcoal/80"
        >
          Abbrechen
        </button>
        <button
          type="button"
          disabled={busy || !clientName.trim()}
          onClick={submit}
          className="editorial-pulse-fill min-h-9 px-6 text-[11px] font-medium uppercase tracking-[0.24em] transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Speichern…" : "Termin anlegen"}
        </button>
      </div>
    </div>
  );

  // ── Popover mode (from agenda slot) ──────────────────────────────────────
  if (anchorRect && popoverPos && open) {
    return (
      <motion.div
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mini-book-h1"
        className="fixed z-[335] w-[min(96vw,460px)] overflow-hidden border border-deep-charcoal/10 bg-canvas-white text-deep-charcoal shadow-[0_24px_64px_-16px_rgba(0,0,0,0.18)] "
        style={{ top: popoverPos.top, left: popoverPos.left }}
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.97 }}
        transition={tapTransition}
      >
        {body}
      </motion.div>
    );
  }

  // ── Modal mode (no anchor) ────────────────────────────────────────────────
  return (
    <MotionModal
      open={open}
      onClose={onClose}
      layoutId={reduced ? undefined : layoutId}
      titleId="mini-book-h1"
      zIndex={320}
    >
      {body}
    </MotionModal>
  );
}
