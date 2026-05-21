import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api";
import { runFortressBackupAfterClosingIfEligible } from "../lib/externalFortressBackup";

export type DailyClosingPhase =
  | "VALIDATING"
  | "COUNTING"
  | "REVIEWING"
  | "SUBMITTING"
  | "DONE";

export type OpenSessionRow = {
  id: number;
  status: string;
  clientId: number | null;
  staffId: number;
  appointmentId: number | null;
  createdAt: string | number;
};

export type DailyCloseExpectedResponse = {
  expectedCashCents: number;
  baseCashCents: number;
  cashSalesCents: number;
  journalDeltaCents: number;
  fromMs: number;
};

const MAX_MONEY_CENTS = 99_999_999;

/** Right-to-left cent entry (POS-style): 4→9→5→0→0 ⇒ 495,00 €. */
export function appendMoneyCentDigit(currentCents: number, digit: number): number {
  if (digit < 0 || digit > 9) return currentCents;
  const next = currentCents * 10 + digit;
  return Math.min(next, MAX_MONEY_CENTS);
}

export function useDailyClosing() {
  const [phase, setPhase] = useState<DailyClosingPhase>("VALIDATING");
  const [openSessions, setOpenSessions] = useState<OpenSessionRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [actualCashCents, setActualCashCents] = useState(0);
  const [expectedCashCents, setExpectedCashCents] = useState<number | null>(null);
  const [expectedMeta, setExpectedMeta] = useState<DailyCloseExpectedResponse | null>(null);
  const [differenceReason, setDifferenceReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [phaseErr, setPhaseErr] = useState<string | null>(null);
  const [closingRow, setClosingRow] = useState<Record<string, unknown> | null>(null);

  const blockedByOpenSessions = openSessions.length > 0;

  const refreshValidation = useCallback(async () => {
    setLoadErr(null);
    try {
      const rows = await apiGet<OpenSessionRow[]>("/api/sessions");
      setOpenSessions(rows.filter((s) => s.status === "open"));
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "load_failed");
    }
  }, []);

  useEffect(() => {
    if (phase === "VALIDATING") void refreshValidation();
  }, [phase, refreshValidation]);

  const startBlindCount = useCallback(() => {
    if (blockedByOpenSessions) return;
    setActualCashCents(0);
    setExpectedCashCents(null);
    setExpectedMeta(null);
    setDifferenceReason("");
    setPhaseErr(null);
    setPhase("COUNTING");
  }, [blockedByOpenSessions]);

  const appendDigit = useCallback((d: number) => {
    setActualCashCents((c) => appendMoneyCentDigit(c, d));
  }, []);

  const backspaceMoney = useCallback(() => {
    setActualCashCents((c) => Math.floor(c / 10));
  }, []);

  const clearMoney = useCallback(() => setActualCashCents(0), []);

  const append00 = useCallback(() => {
    setActualCashCents((c) =>
      appendMoneyCentDigit(appendMoneyCentDigit(c, 0), 0),
    );
  }, []);

  const cancelBlindCount = useCallback(() => {
    setPhase("VALIDATING");
    setActualCashCents(0);
    setPhaseErr(null);
  }, []);

  /** After blind entry — fetch Soll (expected cash); then show comparison. */
  const revealExpectedAndGoReview = useCallback(async () => {
    setPhaseErr(null);
    setBusy(true);
    try {
      const exp = await apiGet<DailyCloseExpectedResponse>(
        "/api/finance/daily-close-expected",
      );
      setExpectedCashCents(exp.expectedCashCents);
      setExpectedMeta(exp);
      setPhase("REVIEWING");
    } catch (e) {
      setPhaseErr(e instanceof Error ? e.message : "expected_fetch_failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const differenceCents = useMemo(() => {
    if (expectedCashCents == null) return null;
    return actualCashCents - expectedCashCents;
  }, [actualCashCents, expectedCashCents]);

  const submitClosing = useCallback(async () => {
    if (expectedCashCents == null) return;
    const diff = actualCashCents - expectedCashCents;
    const reason = differenceReason.trim();
    if (diff !== 0 && !reason) {
      setPhaseErr("difference_reason_required");
      return;
    }
    setPhaseErr(null);
    setPhase("SUBMITTING");
    setBusy(true);
    try {
      const row = await apiPost<Record<string, unknown>>("/api/finance/daily-close", {
        actualCashCents: actualCashCents,
        differenceReason: diff !== 0 ? reason : undefined,
      });
      await runFortressBackupAfterClosingIfEligible();
      setClosingRow(row);
      setPhase("DONE");
    } catch (e) {
      setPhaseErr(e instanceof Error ? e.message : "submit_failed");
      setPhase("REVIEWING");
    } finally {
      setBusy(false);
    }
  }, [actualCashCents, differenceReason, expectedCashCents]);

  const resetFlow = useCallback(() => {
    setPhase("VALIDATING");
    setActualCashCents(0);
    setExpectedCashCents(null);
    setExpectedMeta(null);
    setDifferenceReason("");
    setPhaseErr(null);
    setClosingRow(null);
  }, []);

  return {
    phase,
    openSessions,
    blockedByOpenSessions,
    loadErr,
    refreshValidation,
    startBlindCount,
    actualCashCents,
    appendDigit,
    backspaceMoney,
    clearMoney,
    append00,
    cancelBlindCount,
    revealExpectedAndGoReview,
    expectedCashCents,
    expectedMeta,
    differenceCents,
    differenceReason,
    setDifferenceReason,
    submitClosing,
    busy,
    phaseErr,
    closingRow,
    resetFlow,
  };
}
