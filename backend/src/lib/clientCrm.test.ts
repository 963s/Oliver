import { describe, expect, it } from "vitest";
import {
  buildClientDisplayName,
  computeReliabilityScore,
  escapeLikePattern,
  splitClientDisplayName,
} from "./clientCrm.js";

describe("splitClientDisplayName", () => {
  it("splits on the first space", () => {
    expect(splitClientDisplayName("Anna Schmidt")).toEqual({
      firstName: "Anna",
      lastName: "Schmidt",
    });
  });
  it("handles single names", () => {
    expect(splitClientDisplayName("Madonna")).toEqual({
      firstName: "Madonna",
      lastName: "",
    });
  });
  it("handles empty/whitespace input", () => {
    expect(splitClientDisplayName("")).toEqual({
      firstName: "Unknown",
      lastName: "",
    });
    expect(splitClientDisplayName("   ")).toEqual({
      firstName: "Unknown",
      lastName: "",
    });
  });
  it("preserves multi-word last names", () => {
    expect(splitClientDisplayName("Sophie von der Heide")).toEqual({
      firstName: "Sophie",
      lastName: "von der Heide",
    });
  });
});

describe("buildClientDisplayName", () => {
  it("joins first + last", () => {
    expect(buildClientDisplayName("Anna", "Schmidt")).toBe("Anna Schmidt");
  });
  it("falls back to Unknown when both are blank", () => {
    expect(buildClientDisplayName("", "")).toBe("Unknown");
  });
  it("trims whitespace and skips blanks", () => {
    expect(buildClientDisplayName(" Anna ", "")).toBe("Anna");
    expect(buildClientDisplayName("", " Schmidt ")).toBe("Schmidt");
  });
});

describe("escapeLikePattern", () => {
  it("escapes SQL LIKE wildcards", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });
  it("leaves plain text untouched", () => {
    expect(escapeLikePattern("Anna Schmidt")).toBe("Anna Schmidt");
  });
});

describe("computeReliabilityScore", () => {
  it("returns 100 for a fresh client with no history", () => {
    expect(computeReliabilityScore({ noShows: 0, cancels: 0, completed: 0 })).toBe(100);
  });

  it("returns 100 for a clean record with on-time bonus capped", () => {
    // 10 completions × +2 = +20 bonus, but already at 100 (clamp).
    expect(
      computeReliabilityScore({ noShows: 0, cancels: 0, completed: 10 }),
    ).toBe(100);
    expect(
      computeReliabilityScore({ noShows: 0, cancels: 0, completed: 100 }),
    ).toBe(100);
  });

  it("deducts 15 per no-show, capped at -60", () => {
    expect(computeReliabilityScore({ noShows: 1, cancels: 0, completed: 0 })).toBe(85);
    expect(computeReliabilityScore({ noShows: 2, cancels: 0, completed: 0 })).toBe(70);
    expect(computeReliabilityScore({ noShows: 4, cancels: 0, completed: 0 })).toBe(40);
    /** 5 × 15 would be -75; cap is -60 → 40. */
    expect(computeReliabilityScore({ noShows: 5, cancels: 0, completed: 0 })).toBe(40);
    expect(computeReliabilityScore({ noShows: 10, cancels: 0, completed: 0 })).toBe(40);
  });

  it("deducts 8 per cancel, capped at -32", () => {
    expect(computeReliabilityScore({ noShows: 0, cancels: 1, completed: 0 })).toBe(92);
    expect(computeReliabilityScore({ noShows: 0, cancels: 4, completed: 0 })).toBe(68);
    expect(computeReliabilityScore({ noShows: 0, cancels: 10, completed: 0 })).toBe(68);
  });

  it("combines penalties + bonus correctly", () => {
    /** noShows 1 (-15), cancels 2 (-16), completed 5 (+10) → 79 */
    expect(
      computeReliabilityScore({ noShows: 1, cancels: 2, completed: 5 }),
    ).toBe(79);
  });

  it("clamps to [0, 100]", () => {
    expect(
      computeReliabilityScore({ noShows: 100, cancels: 100, completed: 0 }),
    ).toBe(8);
    /** Math: 100 - 60 - 32 + 0 = 8 — still above zero. Force below zero next: */
    expect(
      computeReliabilityScore({ noShows: 100, cancels: 100, completed: -50 }),
    ).toBeGreaterThanOrEqual(0);
    expect(
      computeReliabilityScore({ noShows: 0, cancels: 0, completed: 9999 }),
    ).toBe(100);
  });

  it("treats negative inputs as zero (defensive)", () => {
    expect(
      computeReliabilityScore({ noShows: -5, cancels: -3, completed: -2 }),
    ).toBe(100);
  });
});
