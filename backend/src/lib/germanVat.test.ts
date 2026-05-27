import { describe, expect, it } from "vitest";
import {
  ALLOWED_VAT_BPS,
  computeLine,
  roundCents,
  VAT_BPS_DE_REDUCED,
  VAT_BPS_DE_STANDARD,
} from "./germanVat.js";

describe("roundCents", () => {
  it("rounds positive numbers half-away-from-zero", () => {
    expect(roundCents(0.4)).toBe(0);
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(0.6)).toBe(1);
    expect(roundCents(1.5)).toBe(2);
    /** Banker's (round-half-to-even) would give 2 here; we must NOT do that. */
    expect(roundCents(2.5)).toBe(3);
  });

  it("rounds negative numbers half-away-from-zero", () => {
    expect(roundCents(-0.5)).toBe(-1);
    expect(roundCents(-1.5)).toBe(-2);
    expect(roundCents(-2.5)).toBe(-3);
  });

  it("passes through whole numbers", () => {
    expect(roundCents(0)).toBe(0);
    expect(roundCents(42)).toBe(42);
    expect(roundCents(-42)).toBe(-42);
  });
});

describe("computeLine — standard 19% VAT", () => {
  it("computes a 100€ net haircut line correctly", () => {
    const result = computeLine({
      quantity: 1,
      unitNetCents: 10_000,
      vatRateBps: VAT_BPS_DE_STANDARD,
    });
    expect(result).not.toBeNull();
    expect(result!.lineNetCents).toBe(10_000);
    expect(result!.lineVatCents).toBe(1_900);
    expect(result!.lineGrossCents).toBe(11_900);
  });

  it("computes a 23€ net line with rounded VAT", () => {
    /** 2300 × 0.19 = 437.0 → 437 */
    const result = computeLine({
      quantity: 1,
      unitNetCents: 2300,
      vatRateBps: VAT_BPS_DE_STANDARD,
    });
    expect(result!.lineVatCents).toBe(437);
    expect(result!.lineGrossCents).toBe(2737);
  });

  it("multiplies the net by quantity before applying VAT", () => {
    const result = computeLine({
      quantity: 3,
      unitNetCents: 500,
      vatRateBps: VAT_BPS_DE_STANDARD,
    });
    /** 1500 × 0.19 = 285 */
    expect(result!.lineNetCents).toBe(1500);
    expect(result!.lineVatCents).toBe(285);
    expect(result!.lineGrossCents).toBe(1785);
  });
});

describe("computeLine — reduced 7% VAT (food, books, products in Germany)", () => {
  it("computes a 10€ net product line correctly", () => {
    const result = computeLine({
      quantity: 1,
      unitNetCents: 1000,
      vatRateBps: VAT_BPS_DE_REDUCED,
    });
    expect(result!.lineNetCents).toBe(1000);
    expect(result!.lineVatCents).toBe(70);
    expect(result!.lineGrossCents).toBe(1070);
  });

  it("rounds halves up (away from zero) — not banker's rounding", () => {
    /** Construct a case where naive 0.5 falls exactly on a half cent.
     * unitNet = 71 cents, bps = 700 → vat = 71 * 700 / 10000 = 4.97
     * Not a half; try 50 → 50 * 700 / 10000 = 3.5 → 4 (rounded up) */
    const result = computeLine({
      quantity: 1,
      unitNetCents: 50,
      vatRateBps: VAT_BPS_DE_REDUCED,
    });
    expect(result!.lineVatCents).toBe(4);
  });
});

describe("computeLine — invariants and edge cases", () => {
  it("upholds gross = net + vat (integer arithmetic, no floats)", () => {
    const inputs = [
      { quantity: 1, unitNetCents: 1, vatRateBps: VAT_BPS_DE_STANDARD },
      { quantity: 1, unitNetCents: 9999, vatRateBps: VAT_BPS_DE_STANDARD },
      { quantity: 7, unitNetCents: 3333, vatRateBps: VAT_BPS_DE_REDUCED },
      { quantity: 99, unitNetCents: 17, vatRateBps: VAT_BPS_DE_STANDARD },
    ];
    for (const inp of inputs) {
      const r = computeLine(inp);
      expect(r).not.toBeNull();
      expect(r!.lineGrossCents).toBe(r!.lineNetCents + r!.lineVatCents);
    }
  });

  it("returns null for invalid quantities", () => {
    expect(computeLine({ quantity: 0, unitNetCents: 100, vatRateBps: 1900 })).toBeNull();
    expect(computeLine({ quantity: -1, unitNetCents: 100, vatRateBps: 1900 })).toBeNull();
    expect(computeLine({ quantity: Number.NaN, unitNetCents: 100, vatRateBps: 1900 })).toBeNull();
  });

  it("returns null for negative net amounts", () => {
    expect(computeLine({ quantity: 1, unitNetCents: -1, vatRateBps: 1900 })).toBeNull();
  });

  it("returns null for disallowed VAT rates", () => {
    expect(computeLine({ quantity: 1, unitNetCents: 100, vatRateBps: 0 })).toBeNull();
    expect(computeLine({ quantity: 1, unitNetCents: 100, vatRateBps: 1000 })).toBeNull();
    expect(computeLine({ quantity: 1, unitNetCents: 100, vatRateBps: 2000 })).toBeNull();
  });

  it("floors fractional quantities and net amounts", () => {
    const r = computeLine({
      quantity: 2.7,
      unitNetCents: 100.9,
      vatRateBps: VAT_BPS_DE_STANDARD,
    });
    /** floor(2.7) = 2, floor(100.9) = 100 → net = 200, vat = 38 */
    expect(r!.quantity).toBe(2);
    expect(r!.unitNetCents).toBe(100);
    expect(r!.lineNetCents).toBe(200);
    expect(r!.lineVatCents).toBe(38);
  });

  it("handles zero net (free service line)", () => {
    const r = computeLine({
      quantity: 1,
      unitNetCents: 0,
      vatRateBps: VAT_BPS_DE_STANDARD,
    });
    expect(r!.lineNetCents).toBe(0);
    expect(r!.lineVatCents).toBe(0);
    expect(r!.lineGrossCents).toBe(0);
  });

  it("exposes both allowed BPS values via ALLOWED_VAT_BPS", () => {
    expect(ALLOWED_VAT_BPS).toContain(VAT_BPS_DE_STANDARD);
    expect(ALLOWED_VAT_BPS).toContain(VAT_BPS_DE_REDUCED);
  });
});
