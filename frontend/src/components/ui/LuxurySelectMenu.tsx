/**
 * LuxurySelectMenu — Desktop-first custom select, zero-latency.
 *
 * ARCHITECTURE:
 * - panelPos computed via useLayoutEffect + setState:
 *   setState inside useLayoutEffect flushes synchronously before browser paint.
 *   No two-frame gap. No forceUpdate hack. Panel appears in a single frame.
 * - setTimeout(0) for dismiss listener — opening click never triggers dismiss.
 * - e.stopPropagation() on trigger — prevents bubbling to any parent handlers.
 * - No AnimatePresence — zero animation overhead on utility dropdowns.
 * - Pure inline styles for panel — no Tailwind class-resolution timing issues.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type LuxurySelectOption = { value: string; label: string };

type PanelPos = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
};

function computePanelPosition(triggerEl: HTMLElement | null): PanelPos | null {
  if (!triggerEl) return null;
  const r = triggerEl.getBoundingClientRect();
  const gap = 4;
  const margin = 8;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const below = viewportH - r.bottom - margin;
  const above = r.top - margin;
  const openUp = below < 200 && above > below;
  const maxHeight = Math.max(120, Math.min(360, openUp ? above - gap : below - gap));
  const width = Math.max(200, r.width);
  const left = Math.max(margin, Math.min(r.left, viewportW - width - margin));
  const top = openUp ? r.top - maxHeight - gap : r.bottom + gap;
  return { top, left, width, maxHeight, openUp };
}

type LuxurySelectMenuProps = {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: LuxurySelectOption[];
  placeholder?: string;
  className?: string;
  formatLabel?: (value: string) => string;
};

export function LuxurySelectMenu({
  id: idProp,
  label,
  value,
  onChange,
  options,
  placeholder = "Wählen",
  className = "",
  formatLabel,
}: LuxurySelectMenuProps) {
  const autoId = useId();
  const listId = `lux-sel-${idProp ?? autoId}`;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);

  /**
   * KEY: useState + useLayoutEffect for panelPos.
   * setState called inside useLayoutEffect is flushed synchronously before
   * the browser paints — making the dropdown appear in a single frame.
   */
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    // Flush synchronously — appears before browser paints this frame
    setPanelPos(computePanelPosition(triggerRef.current));

    const place = () => setPanelPos(computePanelPosition(triggerRef.current));
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  /**
   * Dismiss listener registered in setTimeout(0) — pushed to the NEXT event loop
   * tick so it never catches the same pointerdown that opened the menu.
   */
  useEffect(() => {
    if (!open) return;
    let dismissFn: ((e: PointerEvent) => void) | null = null;
    let keyFn: ((e: KeyboardEvent) => void) | null = null;
    const timerId = window.setTimeout(() => {
      dismissFn = (e: PointerEvent) => {
        const target = e.target as Node;
        if (triggerRef.current?.contains(target)) return;
        if (panelRef.current?.contains(target)) return;
        setOpen(false);
      };
      keyFn = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };
      document.addEventListener("pointerdown", dismissFn, true);
      document.addEventListener("keydown", keyFn);
    }, 0);
    return () => {
      window.clearTimeout(timerId);
      if (dismissFn) document.removeEventListener("pointerdown", dismissFn, true);
      if (keyFn) document.removeEventListener("keydown", keyFn);
    };
  }, [open]);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setOpen(false);
    },
    [onChange],
  );

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((o) => !o);
  };

  const current = options.find((o) => o.value === value);
  const shown = formatLabel && value ? formatLabel(value) : (current?.label ?? (value ? value : ""));

  const panel = open && panelPos ? (
    <ul
      ref={panelRef}
      id={listId}
      role="listbox"
      style={{
        position: "fixed",
        zIndex: 9999,
        top: panelPos.top,
        left: panelPos.left,
        width: panelPos.width,
        maxHeight: panelPos.maxHeight,
        overflowY: "auto",
        background: "#0A0A0A",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.07)",
        padding: "6px",
        margin: 0,
        listStyle: "none",
        scrollbarWidth: "none",
      }}
    >
      {options.map((o) => (
        <li key={o.value} role="presentation">
          <button
            type="button"
            role="option"
            aria-selected={o.value === value}
            onPointerDown={(e) => {
              e.preventDefault(); // prevent blur on the trigger before selection
              handleSelect(o.value);
            }}
            style={{
              width: "100%",
              padding: "7px 12px",
              textAlign: "left",
              fontSize: "13px",
              lineHeight: "1.4",
              cursor: "pointer",
              background: o.value === value ? "rgba(212,175,55,0.13)" : "transparent",
              color: o.value === value ? "rgba(212,175,55,0.95)" : "rgba(255,255,255,0.85)",
              fontWeight: o.value === value ? 600 : 400,
              border: "none",
              borderRadius: "2px",
              display: "block",
              transition: "background 0.08s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                o.value === value ? "rgba(212,175,55,0.13)" : "transparent";
            }}
          >
            {o.label}
          </button>
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <div className={`relative ${className}`}>
      {label ? (
        <span
          className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-deep-charcoal/40"
          id={`${listId}-label`}
        >
          {label}
        </span>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        id={idProp}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={label ? `${listId}-label` : undefined}
        aria-controls={open ? listId : undefined}
        onClick={toggle}
        className="flex w-full min-h-[36px] items-center justify-between gap-2 border border-deep-charcoal/10 bg-gray-100 px-3 py-2 text-left text-sm font-medium text-deep-charcoal/90 transition-colors hover:border-deep-charcoal/20 hover:bg-gray-200/50 focus:outline focus:outline-1 focus:outline-editorial-pulse"
      >
        <span className="min-w-0 truncate">{shown || placeholder}</span>
        <span className="shrink-0 text-[10px] text-deep-charcoal/40" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {createPortal(panel, document.body)}
    </div>
  );
}

/** For arbitrary React labels (e.g. icons) — same behavior */
export function LuxurySelectMenuCustomTrigger({
  label,
  open,
  onOpenChange,
  children,
  trigger,
}: {
  label?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: ReactNode;
  trigger: ReactNode;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    setPanelPos(computePanelPosition(triggerRef.current));
    const place = () => setPanelPos(computePanelPosition(triggerRef.current));
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let dismissFn: ((e: PointerEvent) => void) | null = null;
    const timerId = window.setTimeout(() => {
      dismissFn = (e: PointerEvent) => {
        const target = e.target as Node;
        if (triggerRef.current?.contains(target)) return;
        if (panelRef.current?.contains(target)) return;
        onOpenChange(false);
      };
      document.addEventListener("pointerdown", dismissFn, true);
    }, 0);
    return () => {
      window.clearTimeout(timerId);
      if (dismissFn) document.removeEventListener("pointerdown", dismissFn, true);
    };
  }, [open, onOpenChange]);

  const panel = open && panelPos ? (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        zIndex: 9999,
        top: panelPos.top,
        left: panelPos.left,
        width: panelPos.width,
        maxHeight: panelPos.maxHeight,
        overflowY: "auto",
        background: "#0A0A0A",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.12)",
        padding: "6px",
        scrollbarWidth: "none",
      }}
    >
      {children}
    </div>
  ) : null;

  return (
    <div className="relative">
      {label ? (
        <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-deep-charcoal/40">
          {label}
        </span>
      ) : null}
      <div ref={triggerRef} onClick={() => onOpenChange(!open)}>
        {trigger}
      </div>
      {createPortal(panel, document.body)}
    </div>
  );
}
