import { VAT_BPS_DE_STANDARD } from "./vatConstants";

/**
 * Single-unit Brutto (gross) to unit net for catalog VAT basis points — matches backend `computeLine`.
 */
function lineGrossFromUnitNetCents(qty: number, unitNetCents: number, vatBps: number): number {
  const lineNetCents = unitNetCents * qty;
  const lineVatCents = Math.round((lineNetCents * vatBps) / 10000);
  return lineNetCents + lineVatCents;
}

/**
 * Brutto for one unit × qty → integer unit net that reproduces gross with given VAT rate.
 */
export function unitBruttoToUnitNetCents(unitBruttoCents: number, qty: number, vatBps = VAT_BPS_DE_STANDARD): number {
  if (unitBruttoCents <= 0) return 0;
  if (qty < 1) return 0;
  const bps = vatBps > 0 ? vatBps : VAT_BPS_DE_STANDARD;
  const targetGross = unitBruttoCents * qty;
  for (let unitNet = 0; unitNet <= unitBruttoCents; unitNet++) {
    if (lineGrossFromUnitNetCents(qty, unitNet, bps) === targetGross) {
      return unitNet;
    }
  }
  return Math.max(
    0,
    Math.min(unitBruttoCents, Math.floor((targetGross * 10000) / (10000 + bps) / Math.max(1, qty))),
  );
}
