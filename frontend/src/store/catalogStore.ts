import { create } from "zustand";
import { apiGet } from "../api";

/** Mirrors `salon_service_catalog` rows from GET /api/services. */
export type CatalogService = {
  id: number;
  serviceName: string;
  durationMinutes: number;
  referenceNetCents: number;
  vatRateBps: number;
  /** When false, service is hidden from GET /api/services (Spiegel / Schätzung). */
  catalogActive?: boolean;
  /** When set, checkout sends material line (KassenSichV Lager) for this Dienst. */
  inventoryItemId: number | null;
  /** ml per Stück; multiplied by Warenkorb `qty` at TSE close. */
  deductMl: number | null;
};

/** Mirrors `inventory_items` rows from GET /api/products. */
export type CatalogProduct = {
  id: number;
  name: string;
  defaultUnitMl: number;
  referenceNetPerMlCents: number;
  estimateVatRateBps: number;
  isRetail: boolean;
};

type CatalogState = {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  services: CatalogService[];
  products: CatalogProduct[];
  /**
   * Single flight: first caller loads; others await the same promise.
   * Safe to call from DashboardLayout on every mount.
   */
  ensureLoaded: () => Promise<void>;
  /** Clear cache so the next `ensureLoaded` refetches (e.g. after admin catalog edit). */
  invalidate: () => void;
};

let inFlight: Promise<void> | null = null;

function grossCentsFromNetAndVat(netCents: number, vatBps: number): number {
  if (netCents <= 0) return 0;
  const vat = Math.round((netCents * vatBps) / 10_000);
  return netCents + vat;
}

/**
 * Brutto (Katalog-Anzeige) for one Dienstleistung — reference price is net.
 */
export function serviceDisplayGrossCents(s: CatalogService): number {
  return grossCentsFromNetAndVat(s.referenceNetCents, s.vatRateBps);
}

/**
 * Brutto for one default Verkaufseinheit (ml × net/ml) at catalog VAT.
 */
export function productUnitGrossCents(p: CatalogProduct): number {
  const ml = Math.max(0, p.defaultUnitMl);
  if (ml <= 0) return 0;
  const lineNet = p.referenceNetPerMlCents * ml;
  return grossCentsFromNetAndVat(lineNet, p.estimateVatRateBps);
}

/**
 * Stable cart key: matches DB service row.
 */
export function serviceCartKey(s: CatalogService): string {
  return `service:${s.id}`;
}

export function productCartKey(p: CatalogProduct): string {
  return `product:${p.id}`;
}

/** Default material line for a Dienst — only if Zentrale set `inventoryItemId` + `deductMl`. */
export function serviceInventoryForCart(s: CatalogService): {
  inventoryItemId: number | null;
  deductMl: number | null;
} {
  const inv = s.inventoryItemId;
  const dm = s.deductMl;
  if (inv != null && inv > 0 && dm != null && dm >= 1) {
    return { inventoryItemId: inv, deductMl: Math.floor(dm) };
  }
  return { inventoryItemId: null, deductMl: null };
}

/** One Verkaufseinheit = `defaultUnitMl` Abzug aus dem Lager. */
export function productInventoryForCart(p: CatalogProduct): {
  inventoryItemId: number | null;
  deductMl: number | null;
} {
  if (p.defaultUnitMl >= 1) {
    return { inventoryItemId: p.id, deductMl: Math.floor(p.defaultUnitMl) };
  }
  return { inventoryItemId: null, deductMl: null };
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  status: "idle",
  error: null,
  services: [],
  products: [],

  invalidate: () => {
    inFlight = null;
    set({ status: "idle", error: null, services: [], products: [] });
  },

  ensureLoaded: () => {
    if (get().status === "ready") {
      return Promise.resolve();
    }
    if (inFlight) {
      return inFlight;
    }
    set({ status: "loading", error: null });
    inFlight = (async () => {
      try {
        const [servicesRaw, products] = await Promise.all([
          apiGet<CatalogService[]>("/api/services"),
          apiGet<CatalogProduct[]>("/api/products"),
        ]);
        const services = servicesRaw.map((s) => ({
          ...s,
          inventoryItemId: s.inventoryItemId ?? null,
          deductMl: s.deductMl ?? null,
        }));
        set({ status: "ready", services, products, error: null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "catalog_load_failed";
        set({ status: "error", error: msg });
        throw e;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },
}));
