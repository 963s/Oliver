import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { SessionCard } from "../components/ui/SessionCard";
import { SkeletonCard } from "../components/molecules/SkeletonCard";
import { useLiveSessions } from "../hooks/useLiveSessions";
import { luxurySpring, luxurySpringReduced } from "../lib/motionPresets";
import { useUiShellStore } from "../store/uiShellStore";
import { cancelOpenSession } from "../lib/sessionCancelApi";
import { usePulseStore } from "../store/pulseStore";

function formatElapsed(createdMs: number, nowTick: number): string {
  void nowTick;
  if (!Number.isFinite(createdMs)) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - createdMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h} h ${rm} min`;
}

/**
 * Live queue — desktop-first density.
 */
export function DashboardHome() {
  const navigate = useNavigate();
  const { items, revalidating, error, nowTick } = useLiveSessions();
  const reduced = useUiShellStore((s) => s.prefersReducedMotion);
  const bumpPulse = usePulseStore((s) => s.incrementGlobalRefreshCounter);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const list = useMemo(() => items ?? [], [items]);

  const handleForceCancel = async (sessionId: number) => {
    const ok = window.confirm(
      "Session wirklich abbrechen? Offene Sitzung wird beendet (kein Kassenbeleg). Entwürfe werden verworfen — Tagesabschluss wird dadurch frei.",
    );
    if (!ok) return;
    setCancellingId(sessionId);
    try {
      await cancelOpenSession(sessionId);
      bumpPulse();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCancellingId(null);
    }
  };

  const transition = reduced ? luxurySpringReduced : luxurySpring;
  const container = {
    hidden: {},
    show: {
      transition: { staggerChildren: reduced ? 0 : 0.04, delayChildren: reduced ? 0 : 0.02 },
    },
  };
  const item = {
    hidden: { opacity: reduced ? 1 : 0, y: reduced ? 0 : 6 },
    show: { opacity: 1, y: 0, transition },
  };

  return (
    <div className="relative px-6 py-6">
      {/* Compact header */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl uppercase tracking-wider text-deep-charcoal/90">
            Salon <span className="text-editorial-pulse">Laufend</span>
          </h1>
          <p className="mt-1 text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/35">
            Aktive Sitzungen · älteste zuerst
          </p>
        </div>
        {revalidating && items != null && (
          <span className="text-xs text-editorial-pulse" title="Aktualisiere">
            ●
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 border border-red-900/40 bg-red-950/30 px-3 py-1.5 text-xs text-red-300" role="alert">
          {error}
          {items && items.length > 0 && (
            <span className="ml-2 text-red-400/70">— vorherige Daten sichtbar.</span>
          )}
        </div>
      )}

      {items === null && !error && (
        <div className="grid grid-cols-2 gap-3 py-4 lg:grid-cols-4" aria-live="polite">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {items !== null && items.length === 0 && (
        <p className="py-16 text-center text-xs uppercase tracking-[0.25em] text-deep-charcoal/30">
          Keine aktiven Sitzungen.
        </p>
      )}

      {list.length > 0 && (
        <motion.div
          className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {list.map((s) => (
            <motion.div key={s.id} variants={item}>
              <SessionCard
                sessionId={s.id}
                clientLabel={s.clientLabel}
                staffName={s.staffName}
                queueKind={s.queueKind}
                elapsedLabel={formatElapsed(s.createdMs, nowTick)}
                onSelect={() => {
                  navigate(`/mirror?session=${s.id}`);
                }}
                onForceCancel={handleForceCancel}
                forceCancelBusy={cancellingId === s.id}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      <Link
        to="/walk-in"
        className="editorial-pulse-fill fixed bottom-6 right-6 z-20 flex h-10 items-center px-6 text-center text-[11px] font-medium uppercase tracking-[0.15em] no-underline transition hover:brightness-110"
      >
        + Gast
      </Link>
    </div>
  );
}
