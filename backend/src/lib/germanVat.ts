/** German VAT rates as basis points (10000 = 100%). */
export const VAT_BPS_DE_STANDARD = 1900;
export const VAT_BPS_DE_REDUCED = 700;

export const ALLOWED_VAT_BPS: readonly number[] = [
  VAT_BPS_DE_STANDARD,
  VAT_BPS_DE_REDUCED,
];

/** Round half away from zero for monetary cents (common POS convention). */
export function roundCents(n: number): number {
  return n >= 0 ? Math.round(n) : -Math.round(-n);
}

export type LineInput = {
  quantity: number;
  unitNetCents: number;
  vatRateBps: number;
};

export type LineComputed = LineInput & {
  lineNetCents: number;
  lineVatCents: number;
  lineGrossCents: number;
};

export function computeLine(line: LineInput): LineComputed | null {
  const q = Math.floor(line.quantity);
  if (q < 1 || !Number.isFinite(q)) return null;
  const unitNet = Math.floor(line.unitNetCents);
  if (!Number.isFinite(unitNet) || unitNet < 0) return null;
  const bps = Math.floor(line.vatRateBps);
  if (!ALLOWED_VAT_BPS.includes(bps)) return null;

  const lineNetCents = q * unitNet;
  const lineVatCents = roundCents((lineNetCents * bps) / 10000);
  const lineGrossCents = lineNetCents + lineVatCents;
  return {
    quantity: q,
    unitNetCents: unitNet,
    vatRateBps: bps,
    lineNetCents,
    lineVatCents,
    lineGrossCents,
  };
}
