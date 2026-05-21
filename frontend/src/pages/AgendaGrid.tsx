import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ComponentPropsWithoutRef,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { motion } from "framer-motion";
import { luxurySpring } from "../lib/motionPresets";
import { apiGet, apiPut } from "../api";
import { MiniBookingModal } from "../components/agenda/MiniBookingModal";
import {
  GRID_BERLIN,
  QUICK_BOOK_DURATION_MS,
  SANITIZATION_BUFFER_MS,
  SLOT_COUNT,
  liveAgendaNowTopPct,
  isGrayOfflineReason,
  isSlotInAvailabilityWindow,
  layoutAppointmentInGrid,
  resolveQuickBookingWindow,
  slotIndexToLabel,
  slotStartMsBerlin,
} from "../lib/agendaGridUtils";
import { BERLIN, formatBerlinTimeHHmm, startEndBerlinDayMsForYmd } from "../lib/formatTime";
import type { TodayAppointmentRow } from "../hooks/useTodayAppointments";
import { usePulseStore } from "../store/pulseStore";
import { useUiShellStore } from "../store/uiShellStore";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  agendaMoveRequiresReason,
  formatAppointmentPutError,
  parseAppointmentDragId,
  parseSlotDroppableId,
  validateAgendaDrop,
  type AgendaAvailRow,
} from "../lib/agendaDnDValidation";

export type StaffAvailabilityApiRow = {
  staffId: number;
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
};

type StaffOpt = { id: number; displayName: string; active?: boolean };

/** Taller rows + breathing room (luxury agenda — not a dense spreadsheet). */
const SLOT_HEIGHT_PX = 32;
const TOTAL_GRID_PX = SLOT_COUNT * SLOT_HEIGHT_PX;
const EMPTY_APPTS: TodayAppointmentRow[] = [];

export type AgendaDragUiState = {
  activeAptId: number | null;
  hoverStaffId: number | null;
  hoverSlotIndex: number | null;
  hoverValid: boolean | null;
  hoverMessage: string | null;
  ghostTopPct: number | null;
  ghostHeightPct: number | null;
};

function AgendaSlotWithDrop({
  staffId,
  slotIndex,
  inWin,
  onPick,
  dragUi,
  morphLayoutId,
}: {
  staffId: number;
  slotIndex: number;
  inWin: boolean;
  onPick: (slotRect: { top: number; left: number; width: number; height: number }) => void;
  dragUi: AgendaDragUiState;
  /** When set (and reduced motion off), shared Framer layoutId for mini-book morph */
  morphLayoutId?: string | null;
}) {
  const dropId = `slot-${staffId}-${slotIndex}`;
  const { setNodeRef } = useDroppable({
    id: dropId,
    disabled: !inWin,
  });
  const dragging = dragUi.activeAptId != null;
  const isHover =
    dragging &&
    dragUi.hoverStaffId === staffId &&
    dragUi.hoverSlotIndex === slotIndex;

  let cls = inWin
    ? "box-border w-full border-b border-deep-charcoal/[0.07] bg-gray-100/60 backdrop-blur-[2px] hover:bg-gray-200/55 active:bg-gray-200/70"
    : "box-border w-full cursor-default border-b border-deep-charcoal/[0.05] bg-gray-200/60";

  if (dragging && inWin) {
    /* Empty availability slots: warm champagne wash at full opacity so the grid stays readable at 60fps (class-only, no extra work per frame). */
    cls =
      "box-border w-full cursor-default border-b border-champagne-gold/20 bg-champagne-gold/[0.07] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.12)] backdrop-blur-[2px]";
    if (isHover) {
      cls =
        dragUi.hoverValid === true
          ? "box-border z-[5] w-full border-b border-champagne-gold/40 bg-champagne-gold/[0.16] shadow-[0_0_36px_rgba(212,175,55,0.32),inset_0_0_0_1px_rgba(212,175,55,0.35)] ring-2 ring-champagne-gold/45 backdrop-blur-md"
          : "box-border z-[5] w-full cursor-no-drop border-b border-red-400/35 bg-red-950/40 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.25)] ring-2 ring-red-400/40 backdrop-blur-md";
    }
  }

  const common = {
    ref: setNodeRef,
    type: "button" as const,
    className: cls,
    style: { height: SLOT_HEIGHT_PX, minHeight: SLOT_HEIGHT_PX } as const,
    disabled: !inWin,
    "aria-label": inWin
      ? (`Frei ${slotIndexToLabel(slotIndex)} — tippen zum Buchen oder Termin hierher ziehen` as const)
      : undefined,
  };
  const handleSlotClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (!inWin) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPick({ top: r.top, left: r.left, width: r.width, height: r.height });
  };

  if (morphLayoutId && inWin) {
    return (
      <motion.button
        {...common}
        onClick={handleSlotClick}
        layoutId={morphLayoutId}
        transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.75 }}
      />
    );
  }

  return (
    <button
      {...common}
      onClick={handleSlotClick}
    />
  );
}

const DraggableAgendaAppointmentCard = memo(function DraggableAgendaAppointmentCard({
  apt,
  topPct,
  heightPct,
  serviceHeightFraction,
  onClientOpen,
  onAppointmentSelect,
  morphAppointmentId,
  prefersReducedMotion,
}: {
  apt: TodayAppointmentRow;
  topPct: number;
  heightPct: number;
  serviceHeightFraction: number;
  onClientOpen?: (clientId: number) => void;
  onAppointmentSelect?: (apt: TodayAppointmentRow) => void;
  morphAppointmentId: number | null;
  prefersReducedMotion: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `appointment-${apt.id}`,
  });
  const cardMorphLayoutId =
    !isDragging && !prefersReducedMotion && morphAppointmentId === apt.id ? `agenda-apt-${apt.id}` : undefined;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`pointer-events-auto absolute left-0.5 right-0.5 z-[15] touch-manipulation ${
        isDragging ? "opacity-[0.35]" : ""
      }`}
      style={{ top: `${topPct}%`, height: `${heightPct}%`, minHeight: 64 }}
      onClick={() => {
        const cid = apt.clientId;
        if (isDragging) return;
        onAppointmentSelect?.(apt);
        if (cid == null || !Number.isFinite(cid)) return;
        onClientOpen?.(cid);
      }}
    >
      <motion.div layoutId={cardMorphLayoutId} className="h-full min-h-[64px] w-full" transition={luxurySpring}>
        <AgendaAppointmentCard
          apt={apt}
          topPct={0}
          heightPct={100}
          serviceHeightFraction={serviceHeightFraction}
          fillParent
        />
      </motion.div>
    </div>
  );
},
(prev, next) =>
  prev.apt === next.apt &&
  prev.topPct === next.topPct &&
  prev.heightPct === next.heightPct &&
  prev.serviceHeightFraction === next.serviceHeightFraction &&
  prev.onClientOpen === next.onClientOpen &&
  prev.morphAppointmentId === next.morphAppointmentId &&
  prev.prefersReducedMotion === next.prefersReducedMotion);

type StaffColumnProps = {
  staffId: number;
  displayName: string;
  dateYmd: string;
  availability: StaffAvailabilityApiRow;
  appointments: TodayAppointmentRow[];
  onAvailableSlotClick: (staffId: number, slotIndex: number) => void;
  onAvailableSlotPick: (
    staffId: number,
    slotIndex: number,
    slotRect: { top: number; left: number; width: number; height: number },
  ) => void;
  onAppointmentClientOpen?: (clientId: number) => void;
  onAppointmentSelect?: (apt: TodayAppointmentRow) => void;
  dragUi: AgendaDragUiState;
  /** Mini-book modal open target — scalars for stable memo compare */
  miniBookStaffId: number | null;
  miniBookSlotIndex: number | null;
  morphAppointmentId: number | null;
  prefersReducedMotion: boolean;
};

/**
 * Eine Mitarbeiterspalte — memoisiert: SSE-Refetch ändert nur betroffene Props.
 */
export const StaffColumn = memo(
  function StaffColumn({
    staffId,
    displayName,
    dateYmd,
    availability,
    appointments,
    onAvailableSlotClick,
    onAvailableSlotPick,
    onAppointmentClientOpen,
    onAppointmentSelect,
    dragUi,
    miniBookStaffId,
    miniBookSlotIndex,
    morphAppointmentId,
    prefersReducedMotion,
  }: StaffColumnProps) {
    const { isAvailable, startTime, endTime, reason } = availability;

    const morphLayoutIdForSlot = useMemo(() => {
      if (
        prefersReducedMotion ||
        miniBookStaffId == null ||
        miniBookSlotIndex == null ||
        miniBookStaffId !== staffId
      ) {
        return (_slotIndex: number) => null as string | null;
      }
      const layoutId = `agenda-mini-book-${dateYmd}-${staffId}-${miniBookSlotIndex}`;
      return (slotIndex: number) => (slotIndex === miniBookSlotIndex ? layoutId : null);
    }, [prefersReducedMotion, miniBookStaffId, miniBookSlotIndex, staffId, dateYmd]);
    const grayOffline = isGrayOfflineReason(reason) && !isAvailable;
    const labeledDayOff = !isAvailable && !grayOffline;

    return (
      <div className="flex w-[9.25rem] shrink-0 flex-col rounded-luxury-md border border-deep-charcoal/10 bg-gray-200/25 sm:w-40">
        <div className="sticky top-0 z-[24] flex h-11 shrink-0 items-center justify-center rounded-t-luxury-md border-b border-deep-charcoal/10 bg-gray-200/40 px-1 text-center text-[11px] font-bold uppercase leading-tight tracking-wide text-deep-charcoal/80 backdrop-blur-xl sm:text-xs font-heading">
          <span className="line-clamp-2">{displayName}</span>
        </div>
        <div
          className="relative shrink-0 rounded-b-luxury-md bg-gray-200/40 backdrop-blur-md"
          style={{ height: TOTAL_GRID_PX }}
        >
          {dragUi.activeAptId != null &&
          dragUi.hoverStaffId === staffId &&
          dragUi.ghostTopPct != null &&
          dragUi.ghostHeightPct != null ? (
            <div
              className={`pointer-events-none absolute left-1 right-1 z-[14] border-2 px-1 py-0.5 text-[9px] font-semibold ${
                dragUi.hoverValid
                  ? "border-oak/70 bg-oak/30 text-canvas shadow-[0_0_12px_rgba(160,82,45,0.35)]"
                  : "border-brushed-chrome/70 bg-brushed-chrome/20 text-canvas/90"
              }`}
              style={{
                top: `${dragUi.ghostTopPct}%`,
                height: `${dragUi.ghostHeightPct}%`,
                minHeight: 22,
              }}
            >
              {dragUi.hoverValid ? "Frei" : (dragUi.hoverMessage ?? "Nicht möglich")}
            </div>
          ) : null}

          {isAvailable && startTime && endTime ? (
            Array.from({ length: SLOT_COUNT }, (_, slotIndex) => {
              const inWin = isSlotInAvailabilityWindow(slotIndex, startTime, endTime);
              return (
                <AgendaSlotWithDrop
                  key={slotIndex}
                  staffId={staffId}
                  slotIndex={slotIndex}
                  inWin={inWin}
                  dragUi={dragUi}
                  morphLayoutId={morphLayoutIdForSlot(slotIndex)}
                  onPick={(slotRect) => {
                    onAvailableSlotClick(staffId, slotIndex);
                    onAvailableSlotPick(staffId, slotIndex, slotRect);
                  }}
                />
              );
            })
          ) : labeledDayOff ? (
            <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 bg-chrome/10 px-1.5 py-4 text-center">
              <span className="text-[10px] font-semibold uppercase leading-snug text-oak/95 sm:text-[11px]">
                {reason ?? "—"}
              </span>
            </div>
          ) : (
            Array.from({ length: SLOT_COUNT }, (_, slotIndex) => (
              <div
                key={slotIndex}
                className="box-border w-full border-b border-chrome/10 bg-onyx/90"
                style={{ height: SLOT_HEIGHT_PX, minHeight: SLOT_HEIGHT_PX }}
              />
            ))
          )}

          {appointments.map((apt) => {
            const layout = layoutAppointmentInGrid(apt.startAt, apt.endAt, dateYmd);
            if (!layout) return null;
            return (
              <DraggableAgendaAppointmentCard
                key={apt.id}
                apt={apt}
                topPct={layout.topPct}
                heightPct={layout.heightPct}
                serviceHeightFraction={layout.serviceHeightFraction}
                onClientOpen={onAppointmentClientOpen}
                onAppointmentSelect={onAppointmentSelect}
                morphAppointmentId={morphAppointmentId}
                prefersReducedMotion={prefersReducedMotion}
              />
            );
          })}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.staffId === next.staffId &&
    prev.dateYmd === next.dateYmd &&
    prev.displayName === next.displayName &&
    prev.onAvailableSlotClick === next.onAvailableSlotClick &&
    prev.onAvailableSlotPick === next.onAvailableSlotPick &&
    prev.onAppointmentClientOpen === next.onAppointmentClientOpen &&
    prev.onAppointmentSelect === next.onAppointmentSelect &&
    prev.miniBookStaffId === next.miniBookStaffId &&
    prev.miniBookSlotIndex === next.miniBookSlotIndex &&
    prev.morphAppointmentId === next.morphAppointmentId &&
    prev.prefersReducedMotion === next.prefersReducedMotion &&
    prev.appointments === next.appointments &&
    prev.dragUi.activeAptId === next.dragUi.activeAptId &&
    prev.dragUi.hoverStaffId === next.dragUi.hoverStaffId &&
    prev.dragUi.hoverSlotIndex === next.dragUi.hoverSlotIndex &&
    prev.dragUi.hoverValid === next.dragUi.hoverValid &&
    prev.dragUi.hoverMessage === next.dragUi.hoverMessage &&
    prev.dragUi.ghostTopPct === next.dragUi.ghostTopPct &&
    prev.dragUi.ghostHeightPct === next.dragUi.ghostHeightPct &&
    prev.availability.staffId === next.availability.staffId &&
    prev.availability.isAvailable === next.availability.isAvailable &&
    prev.availability.startTime === next.availability.startTime &&
    prev.availability.endTime === next.availability.endTime &&
    prev.availability.reason === next.availability.reason,
);

type AgendaAppointmentCardProps = {
  apt: TodayAppointmentRow;
  topPct: number;
  heightPct: number;
  serviceHeightFraction: number;
  /** Parent hat Positionierung übernommen (DnD-Wrapper). */
  fillParent?: boolean;
};

/** Terminkarte — Service (blue/orange) + trailing Reinigung stripe (15 min). */
export const AgendaAppointmentCard = memo(
  function AgendaAppointmentCard({
    apt,
    topPct,
    heightPct,
    serviceHeightFraction,
    fillParent,
  }: AgendaAppointmentCardProps) {
    const checkedIn = apt.status === "checked_in";
    const shell = checkedIn
      ? "border-champagne-gold/35 bg-gradient-to-br from-champagne-gold/15 via-[#2a2520]/90 to-black/50 shadow-[0_0_24px_rgba(212,175,55,0.12)]"
      : "border-deep-charcoal/20 bg-gradient-to-br from-sky-400/15 via-[#1e2830]/95 to-black/50 shadow-[0_0_20px_rgba(125,211,252,0.08)]";
    const bufFrac = Math.max(0, Math.min(1, 1 - serviceHeightFraction));
    const showBufferStripe = bufFrac > 0.02;

    return (
      <div
        className={`pointer-events-auto z-[15] flex flex-col overflow-hidden rounded-luxury-md border ${shell} backdrop-blur-md ${
          fillParent ? "absolute inset-0" : "absolute left-1 right-1"
        }`}
        style={
          fillParent
            ? { minHeight: 22 }
            : { top: `${topPct}%`, height: `${heightPct}%`, minHeight: 22 }
        }
        data-appointment-id={apt.id}
        data-drag-handle-ready="1"
        title={`${apt.clientName} — ${apt.serviceName}`}
      >
        <div className="flex h-full min-h-0 w-full flex-col">
          <div
            className="flex min-h-0 flex-col justify-center px-3 py-3"
            style={{ flexGrow: serviceHeightFraction, flexBasis: 0 }}
          >
            <p className="truncate text-[11px] font-bold leading-tight text-deep-charcoal sm:text-xs">
              {formatBerlinTimeHHmm(apt.startAt)} {apt.clientName}
            </p>
            <p className="truncate text-[10px] text-deep-charcoal/55 sm:text-[11px]">{apt.serviceName}</p>
            <p className="text-[9px] font-semibold uppercase tracking-wide text-deep-charcoal/35">{apt.status}</p>
          </div>
          {showBufferStripe ? (
            <div
              className="flex min-h-[8px] shrink-0 items-center justify-center border-t border-stone-500/50 px-0.5 text-[7px] font-bold uppercase leading-none tracking-wide text-deep-charcoal/80/95"
              style={{
                flexGrow: bufFrac,
                flexBasis: 0,
                backgroundImage: `repeating-linear-gradient(
                  -45deg,
                  rgba(120, 113, 108, 0.55) 0px,
                  rgba(120, 113, 108, 0.55) 4px,
                  rgba(68, 64, 60, 0.5) 4px,
                  rgba(68, 64, 60, 0.5) 8px
                )`,
              }}
            >
              Reinigung
            </div>
          ) : null}
        </div>
      </div>
    );
  },
  (p, n) =>
    p.apt.id === n.apt.id &&
    p.apt.status === n.apt.status &&
    p.apt.startAt === n.apt.startAt &&
    p.apt.endAt === n.apt.endAt &&
    p.apt.clientName === n.apt.clientName &&
    p.topPct === n.topPct &&
    p.heightPct === n.heightPct &&
    p.serviceHeightFraction === n.serviceHeightFraction &&
    p.fillParent === n.fillParent,
);

type TimeRulerProps = {
  showEveryNthSlot: number;
};

function TimeRuler({ showEveryNthSlot }: TimeRulerProps) {
  return (
    <div className="sticky left-0 z-[30] flex w-14 shrink-0 self-start flex-col rounded-luxury-md border border-deep-charcoal/10 bg-gray-200/35 text-deep-charcoal/30 backdrop-blur-2xl sm:w-16">
      <div className="h-11 shrink-0 rounded-t-luxury-md border-b border-deep-charcoal/10 bg-gray-200/40 backdrop-blur-xl" aria-hidden />
      <div className="flex flex-col rounded-b-luxury-md" style={{ height: TOTAL_GRID_PX }}>
        {Array.from({ length: SLOT_COUNT }, (_, slotIndex) => (
          <div
            key={slotIndex}
            className="box-border flex shrink-0 items-start justify-end border-b border-deep-charcoal/[0.06] pr-1 pt-1 font-mono tabular-nums"
            style={{ height: SLOT_HEIGHT_PX, minHeight: SLOT_HEIGHT_PX }}
          >
            {slotIndex % showEveryNthSlot === 0 ? (
              <span className="text-[13px] font-light leading-none tracking-tight text-deep-charcoal/30 sm:text-base">
                {slotIndexToLabel(slotIndex)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export type AgendaGridProps = {
  dateYmd: string;
  /** Termine für diesen Kalendertag (Parent nutzt useDayAppointments, kein Doppel-Fetch). */
  appointments: TodayAppointmentRow[] | null;
  appointmentsError: string | null;
  onAppointmentsChange: () => void;
  onAppointmentClientOpen?: (clientId: number) => void;
  /** Fired when any appointment card is clicked — used by parent context panel */
  onAppointmentSelect?: (apt: TodayAppointmentRow) => void;
  className?: string;
} & Pick<ComponentPropsWithoutRef<"div">, "id">;

/**
 * Hochperformantes Tagesraster: Backend-Verfügbarkeit + Termine, Europe/Berlin.
 * Virtualisierung: Spalten memoisiert; Datenfetch nur bei Datum/SSE-Änderung.
 */
export function AgendaGrid({
  dateYmd,
  appointments,
  appointmentsError: apptError,
  onAppointmentsChange,
  onAppointmentClientOpen,
  onAppointmentSelect: onAppointmentSelectExternal,
  className,
  id,
}: AgendaGridProps) {
  const pulse = usePulseStore((s) => s.globalRefreshCounter);
  const morphAppointmentId = useUiShellStore((s) => s.morphAppointmentId);
  const prefersReducedMotion = useUiShellStore((s) => s.prefersReducedMotion);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollRestoredRef = useRef<{ left: number; top: number }>({ left: 0, top: 0 });
  const agendaScrollStorageKey = useMemo(() => `or:agendaScroll:${dateYmd}`, [dateYmd]);

  /** Aktualisiert die „Jetzt“-Linie höchstens einmal pro Minute (plus Re-Renders durch SSE bleiben positionsstabil zur Minute). */
  const [minuteTick, setMinuteTick] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const id = window.setInterval(() => setMinuteTick(Math.floor(Date.now() / 60_000)), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const liveNowTopPct = useMemo(
    () => liveAgendaNowTopPct(dateYmd, Date.now()),
    [minuteTick, dateYmd],
  );

  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [availRows, setAvailRows] = useState<StaffAvailabilityApiRow[] | null>(null);
  const [availError, setAvailError] = useState<string | null>(null);
  const [booking, setBooking] = useState<{
    staffId: number;
    slotIndex: number;
    startAtMs: number;
    endAtMs: number;
  } | null>(null);
  const [bookingAnchorRect, setBookingAnchorRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<TodayAppointmentRow | null>(null);
  const [selectedSlotMeta, setSelectedSlotMeta] = useState<{
    staffId: number;
    slotIndex: number;
    startAtMs: number;
    endAtMs: number;
  } | null>(null);
  const [sanitizationBufferMs, setSanitizationBufferMs] = useState<number>(SANITIZATION_BUFFER_MS);

  useLayoutEffect(() => {
    try {
      const raw = sessionStorage.getItem(agendaScrollStorageKey);
      scrollRestoredRef.current = raw
        ? (JSON.parse(raw) as { left: number; top: number })
        : { left: 0, top: 0 };
    } catch {
      scrollRestoredRef.current = { left: 0, top: 0 };
    }
  }, [agendaScrollStorageKey]);

  useLayoutEffect(() => {
    const el = scrollAreaRef.current;
    if (!el || availRows === null) return;
    el.scrollLeft = scrollRestoredRef.current.left;
    el.scrollTop = scrollRestoredRef.current.top;
  }, [pulse, availRows, appointments, dateYmd]);

  const persistScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    scrollRestoredRef.current = { left: el.scrollLeft, top: el.scrollTop };
    try {
      sessionStorage.setItem(agendaScrollStorageKey, JSON.stringify(scrollRestoredRef.current));
    } catch {
      /* ignore */
    }
  }, [agendaScrollStorageKey]);

  useEffect(() => {
    let cancel = false;
    void apiGet<StaffOpt[]>("/api/staff")
      .then((rows) => {
        if (!cancel) setStaff(rows.filter((s) => s.active !== false));
      })
      .catch(() => {
        if (!cancel) setStaff([]);
      });
    return () => {
      cancel = true;
    };
  }, [pulse]);

  useEffect(() => {
    let cancel = false;
    setAvailError(null);
    void apiGet<StaffAvailabilityApiRow[]>(
      `/api/calendar/availability?date=${encodeURIComponent(dateYmd)}`,
    )
      .then((rows) => {
        if (!cancel) {
          setAvailRows(rows);
          setAvailError(null);
        }
      })
      .catch((e) => {
        if (!cancel)
          setAvailError(e instanceof Error ? e.message : "availability_failed");
      });
    return () => {
      cancel = true;
    };
  }, [dateYmd, pulse]);

  useEffect(() => {
    let cancel = false;
    void apiGet<{ sanitizationBufferMs?: number }>("/api/system/runtime-config")
      .then((cfg) => {
        if (cancel) return;
        const raw = Number(cfg.sanitizationBufferMs ?? SANITIZATION_BUFFER_MS);
        const safe = Number.isFinite(raw) ? Math.max(0, Math.min(raw, 120 * 60 * 1000)) : SANITIZATION_BUFFER_MS;
        setSanitizationBufferMs(safe);
      })
      .catch(() => {
        if (!cancel) setSanitizationBufferMs(SANITIZATION_BUFFER_MS);
      });
    return () => {
      cancel = true;
    };
  }, [pulse]);

  const staffById = useMemo(
    () => new Map(staff.map((s) => [s.id, s.displayName] as const)),
    [staff],
  );

  const apptsByStaff = useMemo(() => {
    const m = new Map<number, TodayAppointmentRow[]>();
    for (const a of appointments ?? []) {
      const list = m.get(a.staffId);
      if (list) list.push(a);
      else m.set(a.staffId, [a]);
    }
    return m;
  }, [appointments]);

  const onAvailableSlotClick = useCallback(
    (sid: number, slotIndex: number) => {
      const slotMs = slotStartMsBerlin(dateYmd, slotIndex);
      const staffAppts = apptsByStaff.get(sid) ?? EMPTY_APPTS;
      const { startAtMs, endAtMs } = resolveQuickBookingWindow(
        slotMs,
        QUICK_BOOK_DURATION_MS,
        staffAppts,
      );
      setBooking({ staffId: sid, slotIndex, startAtMs, endAtMs });
      setSelectedAppointment(null);
      setSelectedSlotMeta({ staffId: sid, slotIndex, startAtMs, endAtMs });
    },
    [apptsByStaff, dateYmd],
  );

  const onAvailableSlotPick = useCallback(
    (
      sid: number,
      slotIndex: number,
      slotRect: { top: number; left: number; width: number; height: number },
    ) => {
      const slotMs = slotStartMsBerlin(dateYmd, slotIndex);
      setBookingAnchorRect(slotRect);
      setSelectedSlotMeta({
        staffId: sid,
        slotIndex,
        startAtMs: slotMs,
        endAtMs: slotMs + QUICK_BOOK_DURATION_MS,
      });
      setSelectedAppointment(null);
    },
    [dateYmd],
  );

  const bookingStaffName =
    booking != null ? staffById.get(booking.staffId) ?? `#${booking.staffId}` : "";

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 300, tolerance: 8 },
    }),
  );

  const [dragUi, setDragUi] = useState<AgendaDragUiState>({
    activeAptId: null,
    hoverStaffId: null,
    hoverSlotIndex: null,
    hoverValid: null,
    hoverMessage: null,
    ghostTopPct: null,
    ghostHeightPct: null,
  });
  const [overlayApt, setOverlayApt] = useState<TodayAppointmentRow | null>(null);
  const [moveErr, setMoveErr] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [flashOk, setFlashOk] = useState(false);
  const [pendingMove, setPendingMove] = useState<{
    apt: TodayAppointmentRow;
    targetStaffId: number;
    targetSlotIndex: number;
    proposedStartMs: number;
    proposedEndMs: number;
  } | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");

  const appointmentRows = appointments ?? EMPTY_APPTS;

  const executeAppointmentMove = useCallback(
    async (
      appointmentId: number,
      staffId: number,
      startMs: number,
      endMs: number,
      reason: string | undefined,
    ) => {
      setMoveBusy(true);
      setMoveErr(null);
      try {
        const localApt = appointmentRows.find((a) => a.id === appointmentId);
        const { fromMs, toMs } = startEndBerlinDayMsForYmd(dateYmd);
        const latestRows = await apiGet<TodayAppointmentRow[]>(
          `/api/appointments?from=${fromMs}&to=${toMs}`,
        );
        const latest = latestRows.find((r) => r.id === appointmentId);
        if (!latest) {
          setMoveErr("Termin wurde zwischenzeitlich geändert oder entfernt. Raster wird aktualisiert.");
          useUiShellStore.getState().pushToast("Termin entfernt oder geändert — Raster aktualisiert.", "info");
          onAppointmentsChange();
          return;
        }
        const localRevision = localApt?.updatedAt ?? null;
        const serverRevision = latest.updatedAt ?? null;
        const localSnapshot = localApt
          ? `${localApt.staffId}|${localApt.startAt}|${localApt.endAt}|${localApt.status}`
          : null;
        const serverSnapshot = `${latest.staffId}|${latest.startAt}|${latest.endAt}|${latest.status}`;
        const staleByRevision =
          localRevision != null && serverRevision != null && localRevision !== serverRevision;
        const staleBySnapshot = localSnapshot != null && localSnapshot !== serverSnapshot;
        if (staleByRevision || staleBySnapshot) {
          setMoveErr("Termin wurde auf einem anderen Gerät geändert. Bitte erneut ziehen.");
          useUiShellStore
            .getState()
            .pushToast("Ghost / Parallel: Termin wurde woanders geändert.", "info");
          onAppointmentsChange();
          return;
        }
        await apiPut(`/api/appointments/${appointmentId}`, {
          startAt: new Date(startMs).toISOString(),
          endAt: new Date(endMs).toISOString(),
          staffId,
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
        });
        setFlashOk(true);
        window.setTimeout(() => setFlashOk(false), 700);
        onAppointmentsChange();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "move_failed";
        setMoveErr(formatAppointmentPutError(msg));
      } finally {
        setMoveBusy(false);
        setPendingMove(null);
        setReasonDraft("");
      }
    },
    [appointmentRows, dateYmd, onAppointmentsChange],
  );

  const updateDragOver = useCallback(
    (activeId: string | number | null | undefined, overId: string | number | null | undefined) => {
      const aptId = parseAppointmentDragId(activeId ?? undefined);
      if (aptId == null) {
        setDragUi({
          activeAptId: null,
          hoverStaffId: null,
          hoverSlotIndex: null,
          hoverValid: null,
          hoverMessage: null,
          ghostTopPct: null,
          ghostHeightPct: null,
        });
        return;
      }
      const slot = parseSlotDroppableId(overId ?? undefined);
      if (slot == null) {
        setDragUi({
          activeAptId: aptId,
          hoverStaffId: null,
          hoverSlotIndex: null,
          hoverValid: null,
          hoverMessage: null,
          ghostTopPct: null,
          ghostHeightPct: null,
        });
        return;
      }
      const apt = appointmentRows.find((a) => a.id === aptId);
      const availRow = availRows?.find((r) => r.staffId === slot.staffId);
      if (!apt) {
        setDragUi({
          activeAptId: aptId,
          hoverStaffId: slot.staffId,
          hoverSlotIndex: slot.slotIndex,
          hoverValid: false,
          hoverMessage: "Nicht möglich",
          ghostTopPct: null,
          ghostHeightPct: null,
        });
        return;
      }
      const v = validateAgendaDrop(
        apt,
        slot.staffId,
        slot.slotIndex,
        dateYmd,
        availRow as AgendaAvailRow,
        appointmentRows,
        sanitizationBufferMs,
      );
      const durationMs = new Date(apt.endAt).getTime() - new Date(apt.startAt).getTime();
      const slotMs = slotStartMsBerlin(dateYmd, slot.slotIndex);
      const ghostLayout = layoutAppointmentInGrid(slotMs, slotMs + durationMs, dateYmd);
      setDragUi({
        activeAptId: aptId,
        hoverStaffId: slot.staffId,
        hoverSlotIndex: slot.slotIndex,
        hoverValid: v.ok,
        hoverMessage: v.ok ? "Frei" : v.messageDe,
        ghostTopPct: ghostLayout?.topPct ?? null,
        ghostHeightPct: ghostLayout?.heightPct ?? null,
      });
    },
    [appointmentRows, availRows, dateYmd, sanitizationBufferMs],
  );

  const err = apptError ?? availError;

  return (
    <div id={id} className={className}>
      {err && (
        <div
          className="mb-3 border border-red-400/55 bg-red-50/60 px-3 py-2 text-sm text-red-600/90"
          role="alert"
        >
          {err}
        </div>
      )}

      <p className="mb-2 text-xs uppercase tracking-[0.14em] text-chrome">
        Raster{" "}
        <strong className="text-canvas/95">
          {formatInTimeZone(fromZonedTime(`${dateYmd}T12:00:00.000`, GRID_BERLIN), BERLIN, "EEEE, dd.MM.yyyy")}
        </strong>{" "}
        · {GRID_BERLIN} · 08:00–20:00 · 15 min Raster —{" "}
        <span className="text-chrome/80">
          Termine ziehen zum Verschieben — Konflikte und Reinigungspuffer ({Math.round(sanitizationBufferMs / 60000)} min) werden geprüft.
        </span>
      </p>

      {moveErr && (
        <div className="mb-3 border border-red-400/55 bg-red-50/60 px-3 py-2 text-sm text-red-600/90" role="alert">
          {moveErr}
        </div>
      )}

      {availRows === null ? (
        <p className="py-16 text-center text-chrome" aria-live="polite">
          Raster laden …
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={({ active }: DragStartEvent) => {
            setMoveErr(null);
            const aid = parseAppointmentDragId(active.id);
            if (aid == null) return;
            const apt = appointmentRows.find((a) => a.id === aid);
            setOverlayApt(apt ?? null);
            if (typeof navigator !== "undefined" && "vibrate" in navigator) {
              navigator.vibrate(18);
            }
            setDragUi({
              activeAptId: aid,
              hoverStaffId: null,
              hoverSlotIndex: null,
              hoverValid: null,
              hoverMessage: null,
              ghostTopPct: null,
              ghostHeightPct: null,
            });
          }}
          onDragOver={({ active, over }: DragOverEvent) => {
            updateDragOver(active?.id, over?.id);
          }}
          onDragCancel={() => {
            setOverlayApt(null);
            setDragUi({
              activeAptId: null,
              hoverStaffId: null,
              hoverSlotIndex: null,
              hoverValid: null,
              hoverMessage: null,
              ghostTopPct: null,
              ghostHeightPct: null,
            });
          }}
          onDragEnd={({ active, over }: DragEndEvent) => {
            setOverlayApt(null);
            const aptId = parseAppointmentDragId(active.id);
            setDragUi({
              activeAptId: null,
              hoverStaffId: null,
              hoverSlotIndex: null,
              hoverValid: null,
              hoverMessage: null,
              ghostTopPct: null,
              ghostHeightPct: null,
            });
            if (aptId == null) return;
            const slot = parseSlotDroppableId(over?.id);
            if (slot == null) return;
            const apt = appointmentRows.find((a) => a.id === aptId);
            if (!apt) return;
            const availRow = availRows.find((r) => r.staffId === slot.staffId);
            const v = validateAgendaDrop(
              apt,
              slot.staffId,
              slot.slotIndex,
              dateYmd,
              availRow as AgendaAvailRow,
              appointmentRows,
              sanitizationBufferMs,
            );
            if (!v.ok) {
              setMoveErr(v.messageDe);
              return;
            }
            const unchanged =
              apt.staffId === slot.staffId &&
              new Date(apt.startAt).getTime() === v.proposedStartMs;
            if (unchanged) return;
            if (
              agendaMoveRequiresReason(apt, slot.staffId, v.proposedStartMs, v.proposedEndMs)
            ) {
              setPendingMove({
                apt,
                targetStaffId: slot.staffId,
                targetSlotIndex: slot.slotIndex,
                proposedStartMs: v.proposedStartMs,
                proposedEndMs: v.proposedEndMs,
              });
              setReasonDraft("");
              return;
            }
            void executeAppointmentMove(
              apt.id,
              slot.staffId,
              v.proposedStartMs,
              v.proposedEndMs,
              undefined,
            );
          }}
        >
          <div
            ref={scrollAreaRef}
            onScroll={persistScroll}
            className={`max-h-[min(78vh,calc(100vh-13rem))] overflow-x-auto overflow-y-auto pb-4 [-webkit-overflow-scrolling:touch] transition-shadow duration-300 ${
              flashOk ? "ring-2 ring-oak/50 ring-offset-2 ring-offset-onyx" : ""
            }`}
          >
            <div className="relative flex min-w-0 gap-4">
              <TimeRuler showEveryNthSlot={4} />
              <div className="flex min-w-max flex-1 gap-4">
                {availRows.map((row) => (
                  <StaffColumn
                    key={row.staffId}
                    staffId={row.staffId}
                    displayName={staffById.get(row.staffId) ?? `Staff #${row.staffId}`}
                    dateYmd={dateYmd}
                    availability={row}
                    appointments={apptsByStaff.get(row.staffId) ?? EMPTY_APPTS}
                    onAvailableSlotClick={onAvailableSlotClick}
                    onAvailableSlotPick={onAvailableSlotPick}
                    onAppointmentClientOpen={onAppointmentClientOpen}
                    onAppointmentSelect={(apt) => {
                      setSelectedAppointment(apt);
                      setSelectedSlotMeta(null);
                      setBooking(null);
                      setBookingAnchorRect(null);
                      onAppointmentSelectExternal?.(apt);
                    }}
                    dragUi={dragUi}
                    miniBookStaffId={booking?.staffId ?? null}
                    miniBookSlotIndex={booking?.slotIndex ?? null}
                    morphAppointmentId={morphAppointmentId}
                    prefersReducedMotion={prefersReducedMotion}
                  />
                ))}
              </div>
              {liveNowTopPct != null ? (
                <div
                  className="pointer-events-none absolute left-0 right-0 top-11 z-[20]"
                  style={{ height: TOTAL_GRID_PX }}
                  aria-hidden
                >
                  <div
                    className="absolute left-0 right-0 border-t-[2px] border-editorial-pulse shadow-[0_0_10px_color-mix(in_srgb,var(--editorial-pulse)_45%,transparent)]"
                    style={{ top: `${liveNowTopPct}%`, transform: "translateY(-1.5px)" }}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-4 border border-deep-charcoal/10 bg-gray-100/40 p-4">
            <p className="text-[10px] font-light uppercase tracking-[0.24em] text-deep-charcoal/45">
              Kontext
            </p>
            {selectedAppointment ? (
              <div className="mt-3">
                <p className="font-editorial-display text-2xl font-normal uppercase tracking-[0.1em] text-editorial-pulse">
                  {selectedAppointment.clientName}
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-deep-charcoal/55">
                  {formatBerlinTimeHHmm(selectedAppointment.startAt)} -{" "}
                  {formatBerlinTimeHHmm(selectedAppointment.endAt)} ·{" "}
                  {staffById.get(selectedAppointment.staffId) ?? `#${selectedAppointment.staffId}`}
                </p>
                <p className="mt-1 text-sm text-deep-charcoal/75">{selectedAppointment.serviceName}</p>
              </div>
            ) : selectedSlotMeta ? (
              <div className="mt-3">
                <p className="font-editorial-display text-2xl font-normal uppercase tracking-[0.1em] text-editorial-pulse">
                  Freies Zeitfenster
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-deep-charcoal/55">
                  {slotIndexToLabel(selectedSlotMeta.slotIndex)} ·{" "}
                  {staffById.get(selectedSlotMeta.staffId) ?? `#${selectedSlotMeta.staffId}`}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-deep-charcoal/50">
                Slot oder Termin antippen, um Details hier dynamisch zu sehen.
              </p>
            )}
          </div>
          <DragOverlay dropAnimation={{ duration: 220, easing: "ease-out" }}>
            {overlayApt ? (
              <div className="max-w-[10rem] border border-deep-charcoal/15 bg-gray-50/95 px-2 py-2 opacity-90 shadow-2xl">
                <p className="truncate text-[11px] font-light leading-tight text-deep-charcoal">
                  {formatBerlinTimeHHmm(overlayApt.startAt)} {overlayApt.clientName}
                </p>
                <p className="truncate text-[10px] text-deep-charcoal/70">{overlayApt.serviceName}</p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {pendingMove && (
        <div
          className="fixed inset-0 z-[330] flex items-center justify-center bg-gray-400/70 p-4 backdrop-blur-[20px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agenda-move-reason-h"
        >
          <div className="w-full max-w-md border border-deep-charcoal/12 bg-gray-50/95 p-6 text-deep-charcoal shadow-2xl">
            <h3 id="agenda-move-reason-h" className="font-editorial-display text-3xl font-normal uppercase tracking-[0.12em]">
              Begründung (GoBD)
            </h3>
            <p className="mt-2 text-xs uppercase tracking-[0.2em] text-brushed-chrome">
              Verschiebung über 30 Minuten oder anderer Mitarbeiter — Pflichtfeld für die Änderungshistorie.
            </p>
            <textarea
              className="mt-4 min-h-[120px] w-full border-b border-deep-charcoal/16 bg-transparent p-3 text-deep-charcoal outline-none"
              value={reasonDraft}
              onChange={(e) => setReasonDraft(e.target.value)}
              placeholder="z. B. Kundenwunsch, Personalengpass …"
              disabled={moveBusy}
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="min-h-touch flex-1 border border-deep-charcoal/15 px-4 text-[11px] font-light uppercase tracking-[0.22em] text-deep-charcoal disabled:opacity-50"
                disabled={moveBusy}
                onClick={() => {
                  setPendingMove(null);
                  setReasonDraft("");
                }}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="min-h-touch flex-1 border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-4 text-[11px] font-light uppercase tracking-[0.22em] text-editorial-pulse disabled:opacity-50"
                disabled={moveBusy || reasonDraft.trim().length < 3}
                onClick={() => {
                  if (!pendingMove) return;
                  void executeAppointmentMove(
                    pendingMove.apt.id,
                    pendingMove.targetStaffId,
                    pendingMove.proposedStartMs,
                    pendingMove.proposedEndMs,
                    reasonDraft,
                  );
                }}
              >
                {moveBusy ? "…" : "Verschieben"}
              </button>
            </div>
          </div>
        </div>
      )}

      {booking != null && (
        <MiniBookingModal
          open
          onClose={() => {
            setBooking(null);
            setBookingAnchorRect(null);
          }}
          staffId={booking.staffId}
          staffDisplayName={bookingStaffName}
          startAtMs={booking.startAtMs}
          endAtMs={booking.endAtMs}
          onBooked={() => onAppointmentsChange()}
          layoutId={`agenda-mini-book-${dateYmd}-${booking.staffId}-${booking.slotIndex}`}
          anchorRect={bookingAnchorRect}
        />
      )}
    </div>
  );
}
