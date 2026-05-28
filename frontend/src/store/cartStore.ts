import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = {
  /** Stable line id within the cart. */
  id: string;
  serviceKey: string;
  label: string;
  unitPriceCents: number;
  qty: number;
  /** Matches `salon_service_catalog.vat_rate_bps` / product estimate VAT. */
  vatRateBps: number;
  /** Optional: when both set, POST /checkout applies Lager-Abzug (§8). */
  inventoryItemId?: number | null;
  deductMl?: number | null;
};

type CartState = {
  /** Keyed by sessionId string; survives navigation & optional full reload via persist. */
  carts: Record<string, CartItem[]>;
  addItem: (
    sessionId: string,
    line: {
      serviceKey: string;
      label: string;
      unitPriceCents: number;
      vatRateBps: number;
      inventoryItemId?: number | null;
      deductMl?: number | null;
    },
  ) => void;
  /**
   * Ad-hoc line: free-form label + price + VAT, never merged with existing
   * catalog rows (gets a unique serviceKey per call). Used by the "Eigene
   * Position" button in ChunkyCart for one-off services / products that
   * aren't yet in the catalog.
   */
  addCustomLine: (
    sessionId: string,
    line: { label: string; unitPriceCents: number; vatRateBps: number },
  ) => void;
  /** Overrides the line's unit price (in cents) — used by inline price edit. */
  setUnitPrice: (
    sessionId: string,
    itemId: string,
    unitPriceCents: number,
  ) => void;
  updateQty: (sessionId: string, itemId: string, delta: number) => void;
  removeItem: (sessionId: string, itemId: string) => void;
  clearCart: (sessionId: string) => void;
};

function newLineId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Local-only cart — no network until checkout. One cart per open session.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      carts: {},

      addItem(sessionId, line) {
        const key = String(sessionId);
        set((state) => {
          const prev = state.carts[key] ?? [];
          const i = prev.findIndex((c) => c.serviceKey === line.serviceKey);
          if (i >= 0) {
            const next = prev.slice();
            const row = next[i];
            if (row) {
              next[i] = {
                ...row,
                qty: row.qty + 1,
                inventoryItemId: line.inventoryItemId ?? row.inventoryItemId,
                deductMl: line.deductMl ?? row.deductMl,
                vatRateBps: line.vatRateBps,
              };
            }
            return { carts: { ...state.carts, [key]: next } };
          }
          const lineItem: CartItem = {
            id: newLineId(),
            serviceKey: line.serviceKey,
            label: line.label,
            unitPriceCents: line.unitPriceCents,
            qty: 1,
            vatRateBps: line.vatRateBps,
            inventoryItemId: line.inventoryItemId ?? null,
            deductMl: line.deductMl ?? null,
          };
          return { carts: { ...state.carts, [key]: [...prev, lineItem] } };
        });
      },

      addCustomLine(sessionId, line) {
        const key = String(sessionId);
        const uniqueKey = `custom:${newLineId()}`;
        set((state) => {
          const prev = state.carts[key] ?? [];
          const lineItem: CartItem = {
            id: newLineId(),
            serviceKey: uniqueKey,
            label: line.label,
            unitPriceCents: Math.max(0, Math.floor(line.unitPriceCents)),
            qty: 1,
            vatRateBps: line.vatRateBps,
            inventoryItemId: null,
            deductMl: null,
          };
          return { carts: { ...state.carts, [key]: [...prev, lineItem] } };
        });
      },

      setUnitPrice(sessionId, itemId, unitPriceCents) {
        const key = String(sessionId);
        const safeCents = Math.max(0, Math.floor(unitPriceCents));
        set((state) => {
          const prev = state.carts[key] ?? [];
          return {
            carts: {
              ...state.carts,
              [key]: prev.map((c) =>
                c.id === itemId ? { ...c, unitPriceCents: safeCents } : c,
              ),
            },
          };
        });
      },

      updateQty(sessionId, itemId, delta) {
        const key = String(sessionId);
        set((state) => {
          const prev = state.carts[key] ?? [];
          const next: CartItem[] = [];
          for (const c of prev) {
            if (c.id !== itemId) {
              next.push(c);
              continue;
            }
            const q = c.qty + delta;
            if (q > 0) {
              next.push({ ...c, qty: q });
            }
            /* else drop — qty hit zero */
          }
          return { carts: { ...state.carts, [key]: next } };
        });
      },

      removeItem(sessionId, itemId) {
        const key = String(sessionId);
        set((state) => {
          const prev = state.carts[key] ?? [];
          return {
            carts: {
              ...state.carts,
              [key]: prev.filter((c) => c.id !== itemId),
            },
          };
        });
      },

      clearCart(sessionId) {
        const key = String(sessionId);
        set((state) => {
          const { [key]: _, ...rest } = state.carts;
          return { carts: rest };
        });
      },
    }),
    { name: "or:session-carts", partialize: (s) => ({ carts: s.carts }) },
  ),
);

export function getCartSubtotalCents(cart: CartItem[] | undefined): number {
  if (!cart || cart.length === 0) return 0;
  return cart.reduce((s, c) => s + c.unitPriceCents * c.qty, 0);
}
