import { useCartStore, getCartSubtotalCents } from "../../store/cartStore";
import { luxuryPosSettleButton } from "../../lib/luxuryUi";

function formatEur(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

type ChunkyCartProps = {
  sessionId: string;
  onOpenCheckout: () => void;
};

/**
 * High-contrast, large controls — all mutations go through cart store (no API here).
 */
export function ChunkyCart({ sessionId, onOpenCheckout }: ChunkyCartProps) {
  const carts = useCartStore((s) => s.carts);
  const updateQty = useCartStore((s) => s.updateQty);
  const removeItem = useCartStore((s) => s.removeItem);
  const sid = String(sessionId);
  const items = carts[sid] ?? [];
  const subtotalCents = getCartSubtotalCents(items);
  const empty = items.length === 0;

  return (
    <div className="flex h-full min-h-[50vh] flex-col border-t border-deep-charcoal/10 bg-gray-50/90 lg:min-h-0 lg:border-l lg:border-t-0">
      <div className="border-b border-deep-charcoal/10 px-4 py-3">
        <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.12em] text-deep-charcoal">Ticket / Warenkorb</h2>
        <p className="text-xs font-light uppercase tracking-[0.18em] text-deep-charcoal/45">Session {sid}</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {empty && <p className="text-center text-lg text-deep-charcoal/45">Warenkorb leer</p>}

        {items.map((c) => (
          <div
            key={c.id}
            className="flex flex-col gap-3 rounded-2xl border border-deep-charcoal/10 bg-gray-100/40 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xl font-light tracking-[0.08em] text-deep-charcoal">{c.label}</p>
              <button
                type="button"
                className="shrink-0 min-h-touch min-w-[52px] border border-red-400/55 bg-red-50/55 px-4 py-3 text-[11px] font-light uppercase tracking-[0.2em] text-red-600/90"
                aria-label={`Entfernen ${c.label}`}
                onClick={() => removeItem(sid, c.id)}
              >
                Entf.
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-lg text-deep-charcoal/55">{formatEur(c.unitPriceCents)} / Stk.</p>
            </div>
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
        ))}
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
