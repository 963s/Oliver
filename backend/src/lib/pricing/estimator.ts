import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { computeLine } from "../germanVat.js";

export type EstimateLine =
  | {
      kind: "service";
      catalogServiceId: number;
      serviceName: string;
      quantity: 1;
      unitNetCents: number;
      vatRateBps: number;
      lineNetCents: number;
      lineVatCents: number;
      lineGrossCents: number;
    }
  | {
      kind: "product";
      inventoryItemId: number;
      productName: string;
      estimatedMl: number;
      unitNetCents: number;
      vatRateBps: number;
      lineNetCents: number;
      lineVatCents: number;
      lineGrossCents: number;
    };

export type EstimateOk = {
  ok: true;
  totalNetCents: number;
  totalVatCents: number;
  /** Customer-facing total (matches checkout gross rounding rules). */
  totalEstimatedCents: number;
  lines: EstimateLine[];
};

export type EstimateErr = {
  ok: false;
  error: string;
  details?: Record<string, unknown>;
};

/**
 * §12.5.34 — Non-fiscal price estimate: fixed service net from catalog + (ml × net/ml) for products.
 * Uses the same `computeLine` / VAT rounding as checkout (`germanVat.ts`).
 */
export function calculateEstimate(
  db: BetterSQLite3Database<typeof schema>,
  input: {
    serviceIds: number[];
    estimatedProducts: { productId: number; estimatedMl: number }[];
  },
): EstimateOk | EstimateErr {
  const lines: EstimateLine[] = [];
  const seenService = new Set<number>();
  for (const rawId of input.serviceIds) {
    const id = Math.floor(Number(rawId));
    if (!Number.isFinite(id) || id < 1) {
      return { ok: false, error: "invalid_service_id", details: { rawId } };
    }
    if (seenService.has(id)) continue;
    seenService.add(id);
    const [svc] = db
      .select()
      .from(schema.salonServiceCatalog)
      .where(eq(schema.salonServiceCatalog.id, id))
      .limit(1)
      .all();
    if (!svc) {
      return { ok: false, error: "service_not_found", details: { serviceId: id } };
    }
    if (svc.referenceNetCents < 1) {
      return {
        ok: false,
        error: "service_price_not_configured",
        details: { serviceId: id, serviceName: svc.serviceName },
      };
    }
    const cl = computeLine({
      quantity: 1,
      unitNetCents: svc.referenceNetCents,
      vatRateBps: svc.vatRateBps,
    });
    if (!cl) {
      return {
        ok: false,
        error: "service_line_invalid_vat",
        details: { serviceId: id, vatRateBps: svc.vatRateBps },
      };
    }
    lines.push({
      kind: "service",
      catalogServiceId: id,
      serviceName: svc.serviceName,
      quantity: 1,
      unitNetCents: cl.unitNetCents,
      vatRateBps: cl.vatRateBps,
      lineNetCents: cl.lineNetCents,
      lineVatCents: cl.lineVatCents,
      lineGrossCents: cl.lineGrossCents,
    });
  }

  const mlByProduct = new Map<number, number>();
  for (const p of input.estimatedProducts) {
    const pid = Math.floor(Number(p.productId));
    const ml = Math.floor(Number(p.estimatedMl));
    if (!Number.isFinite(pid) || pid < 1) {
      return { ok: false, error: "invalid_product_id", details: { productId: p.productId } };
    }
    if (!Number.isFinite(ml) || ml < 1) {
      return {
        ok: false,
        error: "invalid_estimated_ml",
        details: { productId: pid, estimatedMl: p.estimatedMl },
      };
    }
    mlByProduct.set(pid, (mlByProduct.get(pid) ?? 0) + ml);
  }

  for (const [productId, totalMl] of mlByProduct) {
    const [it] = db
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, productId))
      .limit(1)
      .all();
    if (!it) {
      return { ok: false, error: "product_not_found", details: { productId } };
    }
    if (it.referenceNetPerMlCents < 1) {
      return {
        ok: false,
        error: "product_price_per_ml_not_configured",
        details: { productId, name: it.name },
      };
    }
    const lineNetCents = totalMl * it.referenceNetPerMlCents;
    if (!Number.isFinite(lineNetCents) || lineNetCents < 1) {
      return { ok: false, error: "product_line_net_invalid", details: { productId } };
    }
    const cl = computeLine({
      quantity: 1,
      unitNetCents: lineNetCents,
      vatRateBps: it.estimateVatRateBps,
    });
    if (!cl) {
      return {
        ok: false,
        error: "product_line_invalid_vat",
        details: { productId, vatRateBps: it.estimateVatRateBps },
      };
    }
    lines.push({
      kind: "product",
      inventoryItemId: productId,
      productName: it.name,
      estimatedMl: totalMl,
      unitNetCents: lineNetCents,
      vatRateBps: cl.vatRateBps,
      lineNetCents: cl.lineNetCents,
      lineVatCents: cl.lineVatCents,
      lineGrossCents: cl.lineGrossCents,
    });
  }

  let totalNetCents = 0;
  let totalVatCents = 0;
  let totalGrossCents = 0;
  for (const ln of lines) {
    totalNetCents += ln.lineNetCents;
    totalVatCents += ln.lineVatCents;
    totalGrossCents += ln.lineGrossCents;
  }

  return {
    ok: true,
    totalNetCents,
    totalVatCents,
    totalEstimatedCents: totalGrossCents,
    lines,
  };
}
