import { useState } from "react";
import { Pencil, Plus, Trash2, Check, X } from "lucide-react";
import { useCartStore, getCartSubtotalCents } from "../../store/cartStore";
import { luxuryPosSettleButton } from "../../lib/luxuryUi";

function formatEur(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

/** Parse "12,50" / "12.50" / "12" → cents. Empty / NaN → null. */
function parseEurInputToCents(s: string): number | null {
  const trimmed = s.replace(/\s/g, "").replace(",", ".");
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

type ChunkyCartProps = {
  sessionId: string;
  onOpenCheckout: () => void;
};

/**
 * High-contrast, large controls — all mutations go through cart store (no API here).
 *
 * v1.9.0 additions:
 *   - "Eigene Position" inline form at the top — adds an ad-hoc line with
 *     a free-form label + Brutto-Preis + MwSt 7/19% pick.
 *   - Pencil icon next to each line's unit price → opens inline edit.
 */
export function ChunkyCart({ sessionId, onOpenCheckout }: ChunkyCartProps) {
  const carts = useCartStore((s) => s.carts);
  const updateQty = useCartStore((s) => s.updateQty);
  const removeItem = useCartStore((s) => s.removeItem);
  const setUnitPrice = useCartStore((s) => s.setUnitPrice);
  const addCustomLine = useCartStore((s) => s.addCustomLine);
  const sid = String(sessionId);
  const items = carts[sid] ?? [];
  const subtotalCents = getCartSubtotalCents(items);
  const empty = items.length === 0;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [adHocOpen, setAdHocOpen] = useState(false);
  const [adHocLabel, setAdHocLabel] = useState("");
  const [adHocPrice, setAdHocPrice] = useState("");
  const [adHocVat, setAdHocVat] = useState<700 | 1900>(1900);

  function startEdit(id: string, currentCents: number) {
    setEditingId(id);
    setEditValue((currentCents / 100).toFixed(2).replace(".", ","));
  }
  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
  }
  function commitEdit(id: string) {
    const cents = parseEurInputToCents(editValue);
    if (cents != null) setUnitPrice(sid, id, cents);
    cancelEdit();
  }

  function commitAdHoc() {
    const label = adHocLabel.trim();
    const cents = parseEurInputToCents(adHocPrice);
    if (!label || cents == null) return;
    addCustomLine(sid, { label, unitPriceCents: cents, vatRateBps: adHocVat });
    setAdHocLabel("");
    setAdHocPrice("");
    setAdHocVat(1900);
    setAdHocOpen(false);
  }

  return (
    <div className="flex h-full min-h-[50vh] flex-col border-t border-deep-charcoal/10 bg-gray-50/90 lg:min-h-0 lg:border-l lg:border-t-0">
      <div className="border-b border-deep-charcoal/10 px-4 py-3">
        <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.12em] text-deep-charcoal">Ticket / Warenkorb</h2>
        <p className="text-xs font-light uppercase tracking-[0.18em] text-deep-charcoal/45">Session {sid}</p>
      </div>

      {/* ── Ad-hoc add — primary affordance for "kein Katalog" use ─────── */}
      <div className="border-b border-deep-charcoal/10 px-3 py-3">
        {!adHocOpen ? (
          <button
            type="button"
            onClick={() => setAdHocOpen(true)}
            className="flex w-full min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-editorial-pulse/55 bg-[var(--editorial-pulse-dim)]/30 px-4 text-base font-medium text-editorial-pulse"
          >
            <Plus size={18} strokeWidth={2} />
            <span>Eigene Position hinzufügen</span>
          </button>
        ) : (
          <div className="rounded-xl border-2 border-editorial-pulse bg-white p-3 space-y-3">
            <input
              type="text"
              value={adHocLabel}
              onChange={(e) => setAdHocLabel(e.target.value)}
              placeholder="Bezeichnung — z. B. Haarschnitt kurz"
              autoFocus
              className="h-12 w-full rounded-md border border-deep-charcoal/30 bg-gray-50 px-3 text-base text-deep-charcoal outline-none focus:border-editorial-pulse"
            />
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={adHocPrice}
                onChange={(e) => setAdHocPrice(e.target.value)}
                placeholder="Preis (Brutto)"
                className="h-12 w-32 rounded-md border border-deep-charcoal/30 bg-gray-50 px-3 text-base text-deep-charcoal outline-none focus:border-editorial-pulse"
              />
              <span className="self-center text-base font-medium text-deep-charcoal/60">€</span>
              <div className="ml-auto inline-flex overflow-hidden rounded-md border border-deep-charcoal/30">
                <button
                  type="button"
                  onClick={() => setAdHocVat(1900)}
                  className={`min-h-12 px-3 text-sm font-medium ${
                    adHocVat === 1900
                      ? "bg-editorial-pulse text-white"
                      : "bg-gray-50 text-deep-charcoal"
                  }`}
                >
                  19%
                </button>
                <button
                  type="button"
                  onClick={() => setAdHocVat(700)}
                  className={`min-h-12 px-3 text-sm font-medium border-l border-deep-charcoal/30 ${
                    adHocVat === 700
                      ? "bg-editorial-pulse text-white"
                      : "bg-gray-50 text-deep-charcoal"
                  }`}
                >
                  7%
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAdHocOpen(false);
                  setAdHocLabel("");
                  setAdHocPrice("");
                }}
                className="min-h-12 rounded-md border border-deep-charcoal/20 px-4 text-base text-deep-charcoal/70"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={commitAdHoc}
                disabled={!adHocLabel.trim() || parseEurInputToCents(adHocPrice) == null}
                className="min-h-12 rounded-md bg-editorial-pulse px-5 text-base font-medium text-white disabled:opacity-40"
              >
                Hinzufügen
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {empty && <p className="text-center text-lg text-deep-charcoal/45">Warenkorb leer</p>}

        {items.map((c) => {
          const editingThis = editingId === c.id;
          return (
            <div
              key={c.id}
              className="flex flex-col gap-3 rounded-2xl border border-deep-charcoal/10 bg-gray-100/40 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xl font-light tracking-[0.08em] text-deep-charcoal">{c.label}</p>
                <button
                  type="button"
                  className="shrink-0 inline-flex min-h-touch min-w-[52px] items-center justify-center gap-1 border border-red-400/55 bg-red-50/55 px-3 py-3 text-[11px] font-medium uppercase tracking-[0.18em] text-red-700"
                  aria-label={`Entfernen ${c.label}`}
                  onClick={() => removeItem(sid, c.id)}
                >
                  <Trash2 size={14} strokeWidth={1.75} />
                  <span>Entf.</span>
                </button>
              </div>

              {/* ── Inline price (editable) ─────────────────────────── */}
              {editingThis ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(c.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                    className="h-11 w-32 rounded-md border-2 border-editorial-pulse bg-white px-3 text-lg text-deep-charcoal outline-none"
                  />
                  <span className="text-base text-deep-charcoal/60">€ / Stk.</span>
                  <button
                    type="button"
                    onClick={() => commitEdit(c.id)}
                    aria-label="Preis speichern"
                    className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-editorial-pulse text-white"
                  >
                    <Check size={18} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    aria-label="Abbrechen"
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-deep-charcoal/20 text-deep-charcoal/70"
                  >
                    <X size={18} strokeWidth={2} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-lg text-deep-charcoal/70">{formatEur(c.unitPriceCents)} / Stk.</p>
                  <button
                    type="button"
                    onClick={() => startEdit(c.id, c.unitPriceCents)}
                    aria-label="Preis ändern"
                    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-deep-charcoal/14 bg-white px-2 text-xs text-deep-charcoal/70 hover:border-editorial-pulse hover:text-editorial-pulse"
                  >
                    <Pencil size={12} strokeWidth={2} />
                    <span>Ändern</span>
                  </button>
                </div>
              )}

              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  className="min-h-14 min-w-14 rounded-xl border border-deep-charcoal/14 bg-transparent text-3xl font-light text-deep-charcoal"
                  aria-label="Menge verringern"
                  onClick={() => updateQty(sid, c.id, -1)}
                >
                  −
                </button>
                <span className="min-w-[3rem] text-center text-3xl font-bold tabular-nums text-deep-charcoal">
                  {c.qty}
                </span>
                <button
                  type="button"
                  className="min-h-14 min-w-14 rounded-xl border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 text-3xl font-light text-editorial-pulse"
                  aria-label="Menge erhöhen"
                  onClick={() => updateQty(sid, c.id, 1)}
                >
                  +
                </button>
              </div>
              <p className="text-right text-lg text-deep-charcoal/70">
                Zeile: {formatEur(c.unitPriceCents * c.qty)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 z-10 border-t border-deep-charcoal/10 bg-gray-50/95 p-6 ">
        <p className="mb-4 text-center text-xl text-deep-charcoal/70">
          Summe: <span className="font-light text-deep-charcoal">{formatEur(subtotalCents)}</span>
        </p>
        <button
          type="button"
          disabled={empty}
          onClick={onOpenCheckout}
          className={
            empty
              ? "w-full min-h-[64px] cursor-not-allowed rounded-2xl border border-deep-charcoal/8 bg-transparent px-6 text-[11px] font-light uppercase tracking-[0.28em] text-deep-charcoal/35"
              : `${luxuryPosSettleButton} text-2xl`
          }
        >
          {empty ? "Kassieren" : `Kassieren · ${formatEur(subtotalCents)}`}
        </button>
        <p className="mt-2 text-center text-xs uppercase tracking-[0.14em] text-deep-charcoal/35">Öffnet Kassieren-Dialog — Server erst bei &quot;Zahlung abschließen&quot;</p>
      </div>
    </div>
  );
}
