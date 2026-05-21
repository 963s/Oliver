/**
 * ClientSearchInput — lightning-fast, debounced client search.
 *
 * Searches by name, phone, and email via GET /api/clients?q=...
 * Renders a borderless search field with instant dropdown results.
 * Clicking a result calls onSelect({ id, name, phone, email }).
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiGet } from "../../api";

type ClientHit = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
};

type PanelPos = { top: number; left: number; width: number };

function computePos(el: HTMLElement | null): PanelPos | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.bottom + 4, left: r.left, width: Math.max(r.width, 320) };
}

export type ClientSearchResult = { id: number; name: string; phone: string | null; email: string | null };

type Props = {
  placeholder?: string;
  onSelect: (client: ClientSearchResult) => void;
  /** Optional: pre-filled value to display */
  value?: string;
  onChange?: (val: string) => void;
  /** If true, clear input after selection */
  clearOnSelect?: boolean;
  className?: string;
};

export function ClientSearchInput({
  placeholder = "Name, Telefon oder E-Mail…",
  onSelect,
  value: externalValue,
  onChange,
  clearOnSelect = false,
  className = "",
}: Props) {
  const [query, setQuery] = useState(externalValue ?? "");
  const [results, setResults] = useState<ClientHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep in sync with external value changes
  useEffect(() => {
    if (externalValue !== undefined) setQuery(externalValue);
  }, [externalValue]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await apiGet<ClientHit[]>(`/api/clients/search?q=${encodeURIComponent(q)}&limit=8`);
        setResults(hits);
        setOpen(hits.length > 0);
        setActiveIdx(-1);
      } catch {
        setResults([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 160);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Panel position tracking
  useEffect(() => {
    if (!open) { setPanelPos(null); return; }
    const place = () => setPanelPos(computePos(inputRef.current));
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Click-outside dismiss
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: PointerEvent) => {
      if (inputRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [open]);

  const commit = useCallback((hit: ClientHit) => {
    onSelect(hit);
    if (clearOnSelect) {
      setQuery("");
    } else {
      setQuery(hit.name);
    }
    setOpen(false);
    setResults([]);
  }, [onSelect, clearOnSelect]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      const hit = results[activeIdx];
      if (hit) commit(hit);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Search input */}
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-3 text-deep-charcoal/30" aria-hidden>
          {loading
            ? <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border border-deep-charcoal/20 border-t-editorial-pulse" />
            : "⌕"
          }
        </span>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (onChange) onChange(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          className="w-full border border-deep-charcoal/10 bg-gray-100 pl-8 pr-3 py-2.5 text-sm text-deep-charcoal/90 placeholder:text-deep-charcoal/25 outline-none transition focus:border-editorial-pulse/50 focus:bg-gray-100"
        />
        {query.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              setQuery("");
              if (onChange) onChange("");
              setResults([]);
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute right-2 flex h-5 w-5 items-center justify-center rounded-full text-deep-charcoal/25 hover:text-deep-charcoal/60 transition"
            aria-label="Suche löschen"
          >
            ✕
          </button>
        )}
      </div>

      {/* Results portal */}
      {open && panelPos && results.length > 0 && createPortal(
        <ul
          ref={panelRef}
          role="listbox"
          className="fixed z-[9999] overflow-y-auto border border-deep-charcoal/[0.1] bg-gray-100 py-1 shadow-[0_16px_48px_rgba(0,0,0,0.12)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width, maxHeight: 280 }}
        >
          {results.map((hit, idx) => (
            <li key={hit.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={idx === activeIdx}
                onPointerDown={(e) => { e.preventDefault(); commit(hit); }}
                className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition hover:bg-gray-200/50 ${
                  idx === activeIdx ? "bg-editorial-pulse/10" : ""
                }`}
              >
                {/* Avatar initial */}
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-editorial-pulse/20 text-[11px] font-bold uppercase text-editorial-pulse">
                  {hit.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-deep-charcoal/90">{hit.name}</span>
                  <span className="block truncate text-[11px] text-deep-charcoal/35">
                    {[hit.phone, hit.email].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 self-center text-[10px] text-deep-charcoal/20">→</span>
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
