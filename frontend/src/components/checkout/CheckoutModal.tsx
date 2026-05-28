import axios from "axios";
import { useUiShellStore } from "../../store/uiShellStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "../../api";
import { pullFiscalHealthIntoStore } from "../../lib/fiscalHealthApi";
import { FiscalHealthBanner } from "../FiscalHealthBanner";
import { MotionModal } from "../organisms/MotionModal";
import { luxuryGlassFloat, luxuryPosSettleButton } from "../../lib/luxuryUi";
import { unitBruttoToUnitNetCents } from "../../lib/checkoutGrossToNet";
import { VAT_BPS_DE_STANDARD } from "../../lib/vatConstants";
import type { CartItem } from "../../store/cartStore";

const EMPTY_CART: CartItem[] = [];
import { getCartSubtotalCents, useCartStore } from "../../store/cartStore";

type LocalPayRow = {
  id: string;
  method: "cash" | "card" | "voucher";
  amountCents: number;
  voucherCode?: string;
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.random()}`;

}

function buildInvoiceItemsFromCart(items: CartItem[]) {
  return items
    .filter((c) => c.qty > 0)
    .map((c) => {
      const vatBps = c.vatRateBps ?? VAT_BPS_DE_STANDARD;
      const unitNetCents = unitBruttoToUnitNetCents(c.unitPriceCents, c.qty, vatBps);
      const out: {
        description: string;
        quantity: number;
        unitNetCents: number;
        vatRateBps: number;
        inventoryItemId?: number;
        deductMl?: number;
      } = {
        description: c.label,
        quantity: c.qty,
        unitNetCents,
        vatRateBps: vatBps === 700 || vatBps === 1900 ? vatBps : VAT_BPS_DE_STANDARD,
      };
      const inv = c.inventoryItemId;
      const ml = c.deductMl;
      if (inv != null && inv > 0 && ml != null && ml >= 1) {
        out.inventoryItemId = inv;
        out.deductMl = Math.floor(ml);
      }
      return out;
    });
}

type VoucherInfo = {
  code: string;
  remainingAmountCents: number;
  status: string;
};

type CheckoutModalProps = {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  onSuccess: () => void;
};

/**
 * Local split payments + restbetrag; POST only on submit (single isSubmitting gate).
 */
export function CheckoutModal({ open, onClose, sessionId, onSuccess }: CheckoutModalProps) {
  const clearCart = useCartStore((s) => s.clearCart);
  const [payments, setPayments] = useState<LocalPayRow[]>([]);
  const [tipCents, setTipCents] = useState(0);
  const [tipOn, setTipOn] = useState(false);
  const [voucherCodeInput, setVoucherCodeInput] = useState("");
  const [voucherInfo, setVoucherInfo] = useState<VoucherInfo | null>(null);
  const [voucherCheckBusy, setVoucherCheckBusy] = useState(false);
  const [voucherError, setVoucherError] = useState("");
  const [voucherAmountInput, setVoucherAmountInput] = useState("");
  const [partialEur, setPartialEur] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [completedInvoiceId, setCompletedInvoiceId] = useState<number | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [printMsg, setPrintMsg] = useState("");
  const checkoutAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      checkoutAbortRef.current?.abort();
      checkoutAbortRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setPayments([]);
      setTipCents(0);
      setTipOn(false);
      setVoucherCodeInput("");
      setVoucherInfo(null);
      setVoucherError("");
      setVoucherAmountInput("");
      setPartialEur("");
      setSubmitError("");
      setCompletedInvoiceId(null);
      setPrintBusy(false);
      setPrintMsg("");
      void pullFiscalHealthIntoStore();
    }
  }, [open]);

  const items = useCartStore((s) => s.carts[String(sessionId)] ?? EMPTY_CART);
  const grossCents = getCartSubtotalCents(items);
  const totalDueCents = grossCents + (tipOn ? tipCents : 0);
  const paidCents = useMemo(
    () => payments.reduce((s, p) => s + p.amountCents, 0),
    [payments],
  );
  const remainingCents = totalDueCents - paidCents;
  const sidNum = Number(sessionId);
  const staffId = useMemo(
    () => {
      const raw = localStorage.getItem("or:staffId");
      const n = raw != null ? Number.parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    [],
  );

  const cardCentsPlanned = useMemo(
    () => payments.filter((p) => p.method === "card").reduce((s, p) => s + p.amountCents, 0),
    [payments],
  );
  const zvtInFlight = isSubmitting && cardCentsPlanned > 0;

  const applyFull = useCallback(
    (method: "cash" | "card") => {
      if (method === "cash" || method === "card") {
        setSubmitError("");
        setPayments((prev) => {
          const others = prev.filter((p) => p.method !== method);
          const othersSum = others.reduce((s, p) => s + p.amountCents, 0);
          const tip = tipOn ? tipCents : 0;
          const tot = grossCents + tip;
          const rem = tot - othersSum;
          if (rem <= 0) return others;
          return [
            ...others,
            { id: newId(), method, amountCents: rem },
          ];
        });
      }
    },
    [grossCents, tipCents, tipOn],
  );

  const removeRow = (id: string) => {
    setPayments((prev) => prev.filter((p) => p.id !== id));
  };

  const checkVoucher = () => {
    const code = voucherCodeInput.trim();
    if (!code) {
      setVoucherError("Code eingeben.");
      return;
    }
    setVoucherCheckBusy(true);
    setVoucherError("");
    setVoucherInfo(null);
    void apiGet<{
      code: string;
      remainingAmountCents: number;
      status: string;
    }>(`/api/vouchers/${encodeURIComponent(code)}`)
      .then((o) => {
        setVoucherInfo({
          code: o.code,
          remainingAmountCents: o.remainingAmountCents,
          status: o.status,
        });
        const eur = (Math.min(remainingCents, o.remainingAmountCents) / 100).toFixed(2);
        setVoucherAmountInput(eur);
      })
      .catch((e) => {
        setVoucherError(e instanceof Error ? e.message : "Gutschein ungültig");
        setVoucherInfo(null);
      })
      .finally(() => setVoucherCheckBusy(false));
  };

  const addVoucherPart = () => {
    if (!voucherInfo) return;
    const eur = Number.parseFloat(String(voucherAmountInput).replace(",", "."));
    if (!Number.isFinite(eur) || eur < 0) {
      setVoucherError("Betrag ungültig");
      return;
    }
    const want = Math.min(
      Math.round(eur * 100),
      voucherInfo.remainingAmountCents,
      Math.max(0, remainingCents),
    );
    if (want < 0) {
      return;
    }
    if (want === 0) {
      setVoucherError("Betrag 0");
      return;
    }
    setVoucherError("");
    setPayments((p) => [
      ...p,
      {
        id: newId(),
        method: "voucher",
        amountCents: want,
        voucherCode: voucherInfo.code,
      },
    ]);
  };

  const canSubmit =
    !isSubmitting && items.length > 0 && totalDueCents > 0 && remainingCents === 0;

  const cancelZvtOrCheckout = useCallback(() => {
    checkoutAbortRef.current?.abort();
  }, []);

  const handleDismiss = useCallback(() => {
    cancelZvtOrCheckout();
    if (completedInvoiceId != null) {
      onClose();
      setCompletedInvoiceId(null);
      setPrintMsg("");
      return;
    }
    onClose();
    setSubmitError("");
    setPayments([]);
  }, [cancelZvtOrCheckout, completedInvoiceId, onClose]);

  const onSubmit = async () => {
    if (!canSubmit) return;
    checkoutAbortRef.current?.abort();
    const ac = new AbortController();
    checkoutAbortRef.current = ac;
    setIsSubmitting(true);
    setSubmitError("");
    const invoiceItems = buildInvoiceItemsFromCart(items);
    if (invoiceItems.length === 0) {
      setSubmitError("Keine Rechnungspositionen");
      setIsSubmitting(false);
      checkoutAbortRef.current = null;
      return;
    }
    const tipAmountCents = tipOn ? Math.max(0, tipCents) : 0;
    const cardCents = cardCentsPlanned;
    const body: Record<string, unknown> = {
      items: invoiceItems,
      payments: payments.map((p) => {
        if (p.method === "voucher") {
          return {
            method: p.method,
            amountCents: p.amountCents,
            voucherCode: p.voucherCode ?? "",
          };
        }
        return { method: p.method, amountCents: p.amountCents };
      }),
      tipAmountCents,
      tipStaffId: tipAmountCents > 0 ? staffId : null,
    };
    if (cardCents > 0) {
      const terminal = import.meta.env.VITE_CHECKOUT_ZVT_TERMINAL as string | undefined;
      const zvtPay = await apiPost<{
        amountCents: number;
        terminalId: string;
        zvtReceiptId: string;
        authorizedAt: string;
      }>(
        "/api/hardware/zvt/pay",
        {
          amountCents: cardCents,
          terminalId: (terminal && terminal.trim()) || "SALON-EC-LOCAL",
        },
        { signal: ac.signal },
      );
      body.zvt = {
        amountCents: cardCents,
        terminalId: zvtPay.terminalId,
        zvtReceiptId: zvtPay.zvtReceiptId,
        authorizedAt: zvtPay.authorizedAt,
      };
    }
    try {
      const res = await apiPost<{
        session?: { status: string } | null;
        fiscal?: { state?: string };
        invoice?: { id: number; status: string } | null;
      }>(`/api/sessions/${sidNum}/checkout`, body, { signal: ac.signal });
      if (res.session?.status === "open" && res.fiscal?.state === "pending") {
        // 202: Zahlung erfasst, TSE offen — trotzdem Warenkorb leeren, keine doppelte Buchung
        void res;
      }
      clearCart(sessionId);
      onSuccess();
      if (res.invoice?.id != null && Number.isFinite(res.invoice.id)) {
        setCompletedInvoiceId(res.invoice.id);
        setPrintMsg("");
      } else {
        onClose();
      }
    } catch (e) {
      if (axios.isCancel(e)) {
        setSubmitError("Vorgang am Kartenlesegerät abgebrochen.");
      } else {
        setSubmitError(e instanceof Error ? e.message : "checkout_failed");
      }
    } finally {
      if (checkoutAbortRef.current === ac) {
        checkoutAbortRef.current = null;
      }
      setIsSubmitting(false);
    }
  };

  const [printError, setPrintError] = useState<string | null>(null);

  /**
   * Try to print the saved invoice via the hardware service. If no TSE
   * printer is reachable (the common case for the salon today — no signed
   * printer yet), we surface a friendly explanation instead of the raw
   * "druck_failed" / API error string. The invoice itself is already
   * saved server-side, so this is purely about telling the operator what
   * happened.
   */
  const printReceipt = async () => {
    if (completedInvoiceId == null) return;
    setPrintBusy(true);
    setPrintMsg("");
    setPrintError(null);
    useUiShellStore.getState().triggerPrintPaper(true);
    try {
      await apiPost(`/api/hardware/print/invoice/${completedInvoiceId}`, {});
      setPrintMsg("Beleg wurde an die Druckwarteschlange gesendet.");
    } catch (e) {
      const raw = e instanceof Error ? e.message : "druck_failed";
      setPrintError(raw);
    } finally {
      setPrintBusy(false);
      window.setTimeout(() => useUiShellStore.getState().triggerPrintPaper(false), 900);
    }
  };

  return (
    <MotionModal
      open={open}
      onClose={handleDismiss}
      titleId="checkout-title"
      zIndex={320}
      className="!items-stretch justify-center sm:!items-center"
      frameClassName="relative z-10 flex h-full min-h-0 w-full max-w-[min(100vw,1280px)] flex-col justify-center p-3 sm:h-auto sm:max-h-[min(96dvh,100%)] sm:p-6"
      panelClassName="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden !rounded-2xl !border-0 !bg-transparent !p-0 !shadow-none sm:!max-h-[min(94dvh,100%)]"
      panelStyle={{ boxShadow: "none" }}
    >
      <div
        className={`flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl text-deep-charcoal ${luxuryGlassFloat}`}
      >
        <FiscalHealthBanner />
        {completedInvoiceId != null ? (
          <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <h2 className="font-editorial-display text-5xl font-normal uppercase tracking-[0.14em] text-editorial-pulse">Zahlung abgeschlossen</h2>
            <p className="text-deep-charcoal/70">
              Rechnung #{completedInvoiceId} wurde gespeichert.
            </p>
            <button
              type="button"
              className="min-h-14 min-w-[280px] rounded-2xl border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-6 text-[11px] font-light uppercase tracking-[0.3em] text-editorial-pulse disabled:opacity-50"
              onClick={() => void printReceipt()}
              disabled={printBusy}
            >
              {printBusy ? "Drucke…" : "Beleg drucken"}
            </button>
            {printMsg && <p className="text-sm text-deep-charcoal/60">{printMsg}</p>}
            {printError && (
              <div className="mt-2 w-full max-w-xl rounded-xl border-2 border-amber-500/80 bg-amber-50 p-4 text-left">
                <p className="text-base font-semibold text-amber-900">
                  Drucken nicht möglich
                </p>
                <p className="mt-2 text-sm text-amber-900/85">
                  Keine TSE-Drucker erkannt oder Verbindung gestört.
                  Der Beleg <strong>#{completedInvoiceId}</strong> ist
                  im System gespeichert und kann später gedruckt werden
                  (Einstellungen → Belege).
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-amber-900/60">
                    Technisches Detail
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-amber-900/70">
                    {printError}
                  </pre>
                </details>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPrintError(null)}
                    className="min-h-11 rounded-md border border-amber-700/40 bg-white px-4 text-sm font-medium text-amber-900"
                  >
                    Verstanden
                  </button>
                  <button
                    type="button"
                    onClick={() => void printReceipt()}
                    disabled={printBusy}
                    className="min-h-11 rounded-md bg-amber-700 px-4 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Erneut versuchen
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              className="min-h-12 min-w-[220px] rounded-2xl border border-deep-charcoal/14 bg-transparent px-5 text-[11px] font-light uppercase tracking-[0.24em] text-deep-charcoal/85 "
              onClick={() => {
                onClose();
                setCompletedInvoiceId(null);
                setPrintMsg("");
                setPrintError(null);
              }}
            >
              Fertig
            </button>
          </section>
        ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 overflow-hidden lg:grid-cols-3 lg:gap-8">
        <section className="order-1 flex min-h-0 min-w-0 flex-col overflow-y-auto border-b border-deep-charcoal/10 bg-gray-100/60 p-6 md:p-8 lg:order-2 lg:col-span-1 lg:border-b-0 lg:border-l lg:border-deep-charcoal/10">
          <p className="text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">Ticket · Positionen</p>
          <h2 className="mt-1 font-heading text-2xl font-bold tracking-tight text-deep-charcoal/95">Kasse</h2>
          <p className="mt-2 text-sm text-deep-charcoal/40">Summe · Brutto (Anzeige)</p>
          <ul className="mt-6 space-y-2">
            {items.map((c) => (
              <li
                key={c.id}
                className="flex justify-between gap-4 border-b border-deep-charcoal/10 py-4 text-base font-medium"
              >
                <span className="min-w-0 text-deep-charcoal/90">
                  {c.label} ×{c.qty}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-deep-charcoal">
                  {((c.unitPriceCents * c.qty) / 100).toFixed(2).replace(".", ",")} €
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-right text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">Waren</p>
          <p className="text-right font-mono text-3xl font-bold tabular-nums text-deep-charcoal">
            {(grossCents / 100).toFixed(2).replace(".", ",")} €
          </p>
          {tipOn && (
            <p className="mt-3 text-right text-sm font-light uppercase tracking-[0.18em] text-editorial-pulse/90">
              Trinkgeld: +{(tipCents / 100).toFixed(2).replace(".", ",")} €
            </p>
          )}
          <p className="mt-8 text-right text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">Fällig gesamt</p>
          <p className="text-right font-mono text-4xl font-black tabular-nums tracking-tight text-champagne-gold/95 drop-shadow-[0_0_24px_rgba(212,175,55,0.12)]">
            {(totalDueCents / 100).toFixed(2).replace(".", ",")} €
          </p>
        </section>

        <section className="order-2 flex min-h-0 min-w-0 flex-col overflow-y-auto border-t border-deep-charcoal/10 p-6 md:p-8 lg:order-1 lg:col-span-2 lg:border-l-0 lg:border-t-0 lg:border-r lg:border-deep-charcoal/10">
          <p className="text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">Zahlungsausgleich</p>
          <h3 id="checkout-title" className="mt-1 font-heading text-3xl font-bold tracking-tight">
            Zahlung
          </h3>
          <div className="mb-6 mt-6 rounded-2xl border border-deep-charcoal/10 bg-gray-200/45 p-6 text-lg shadow-[0_0_32px_rgba(212,175,55,0.05)] ">
            <div className="flex justify-between gap-3 text-sm text-deep-charcoal/45">
              <span>Erfasst (Zeilen)</span>
              <span className="font-mono text-lg font-semibold tabular-nums text-deep-charcoal">
                {(paidCents / 100).toFixed(2).replace(".", ",")} €
              </span>
            </div>
            <div
              className={`mt-3 flex justify-between gap-3 border-t border-deep-charcoal/10 pt-3 ${
                remainingCents === 0 ? "text-editorial-pulse" : "text-red-600/90"
              }`}
            >
              <span className="text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">Restbetrag</span>
              <span className="font-mono text-3xl font-black tabular-nums">
                {(remainingCents / 100).toFixed(2).replace(".", ",")} €
              </span>
            </div>
          </div>

          <div className="mb-6 flex flex-wrap gap-4">
            <button
              type="button"
              className="min-h-[56px] min-w-[160px] flex-1 rounded-2xl border border-deep-charcoal/14 bg-transparent px-6 py-4 text-[11px] font-light uppercase tracking-[0.24em] text-deep-charcoal shadow-[0_0_28px_rgba(212,175,55,0.06)] "
              onClick={() => applyFull("cash")}
              disabled={isSubmitting || zvtInFlight || remainingCents <= 0}
            >
              Bar (voll)
            </button>
            <button
              type="button"
              className="min-h-[56px] min-w-[160px] flex-1 rounded-2xl border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-6 py-4 text-[11px] font-light uppercase tracking-[0.24em] text-editorial-pulse shadow-[0_0_28px_rgba(56,189,248,0.12)] "
              onClick={() => applyFull("card")}
              disabled={isSubmitting || zvtInFlight || remainingCents <= 0}
            >
              EC-Karte (voll)
            </button>
          </div>
          <p className="mb-2 text-xs text-deep-charcoal/35">
            EC: Hardware-Flow via Backend (`/api/hardware/zvt/pay`) mit Terminal-Proof.
          </p>

          {zvtInFlight && (
            <div
              className="mb-3 rounded-xl border border-editorial-pulse bg-gray-50/90 px-3 py-3 text-deep-charcoal/82"
              role="status"
            >
              <p className="text-xs font-light uppercase tracking-[0.24em] leading-snug text-editorial-pulse">EC-Karte / Terminal</p>
              <p className="mt-2 text-sm text-deep-charcoal/75">
                Warten auf Terminal… Bitte Gast zum Kartenlesegerät führen. PIN/Chip kann einen
                Moment dauern — warten, bis der Backend-Call bestätigt.
              </p>
              <button
                type="button"
                className="mt-3 min-h-12 w-full rounded-lg border border-red-400/55 bg-red-50/60 px-3 text-[11px] font-light uppercase tracking-[0.24em] text-red-600/90"
                onClick={cancelZvtOrCheckout}
                disabled={!isSubmitting}
              >
                Vorgang am Terminal abbrechen
              </button>
            </div>
          )}

          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col">
              <label className="text-xs font-medium uppercase tracking-wider text-deep-charcoal/40" htmlFor="partial-eur">
                Teilbetrag (€)
              </label>
              <input
                id="partial-eur"
                className="luxury-field min-h-12 rounded-2xl border border-deep-charcoal/10 bg-gray-200/50 px-4 py-3 text-deep-charcoal "
                type="number"
                min={0.01}
                step={0.5}
                value={partialEur}
                disabled={isSubmitting || zvtInFlight}
                onChange={(e) => setPartialEur(e.target.value)}
                placeholder="z. B. 50"
              />
            </div>
            <button
              type="button"
                className="min-h-12 rounded-2xl border border-deep-charcoal/14 bg-transparent px-4 text-[11px] font-light uppercase tracking-[0.2em] text-deep-charcoal "
              disabled={isSubmitting || zvtInFlight || remainingCents <= 0}
              onClick={() => {
                const n = Number.parseFloat(String(partialEur).replace(",", "."));
                if (!Number.isFinite(n) || n <= 0) {
                  return;
                }
                const want = Math.min(remainingCents, Math.round(n * 100));
                if (want < 1) {
                  return;
                }
                setSubmitError("");
                setPayments((p) => [
                  ...p,
                  { id: newId(), method: "cash", amountCents: want },
                ]);
                setPartialEur("");
              }}
            >
              + Bar
            </button>
            <button
              type="button"
              className="min-h-12 rounded-2xl border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-4 text-[11px] font-light uppercase tracking-[0.2em] text-editorial-pulse"
              disabled={isSubmitting || zvtInFlight || remainingCents <= 0}
              onClick={() => {
                const n = Number.parseFloat(String(partialEur).replace(",", "."));
                if (!Number.isFinite(n) || n <= 0) {
                  return;
                }
                const want = Math.min(remainingCents, Math.round(n * 100));
                if (want < 1) {
                  return;
                }
                setSubmitError("");
                setPayments((p) => [
                  ...p,
                  { id: newId(), method: "card", amountCents: want },
                ]);
                setPartialEur("");
              }}
            >
              + EC
            </button>
          </div>

          <div className="mb-3 flex items-center gap-2">
            <input
              type="checkbox"
              id="tip-on"
              className="h-6 w-6"
              checked={tipOn}
              disabled={isSubmitting || zvtInFlight}
              onChange={(e) => {
                const on = e.target.checked;
                setTipOn(on);
                if (!on) setTipCents(0);
                setPayments([]);
              }}
            />
            <label htmlFor="tip-on" className="text-lg">
              Trinkgeld
            </label>
            {tipOn && (
              <input
                className="ml-2 w-32 rounded-2xl border border-deep-charcoal/10 bg-gray-200/50 px-3 py-2 text-right text-lg text-deep-charcoal "
                type="number"
                min={0}
                step={0.5}
                value={tipCents / 100}
                disabled={isSubmitting || zvtInFlight}
                onChange={(e) => {
                  const n = Number.parseFloat(e.target.value);
                  if (Number.isFinite(n) && n >= 0) {
                    setTipCents(Math.round(n * 100));
                    setPayments([]);
                  }
                }}
                aria-label="Trinkgeld in EUR"
              />
            )}
            {tipOn && <span>€</span>}
          </div>

          <div className="mb-4 border-t border-deep-charcoal/10 pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">Gutschein</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="luxury-field min-h-12 flex-1 rounded-2xl border border-deep-charcoal/10 bg-gray-200/50 px-4 py-3 font-mono text-deep-charcoal "
                value={voucherCodeInput}
                disabled={isSubmitting || zvtInFlight}
                onChange={(e) => {
                  setVoucherCodeInput(e.target.value);
                  setVoucherInfo(null);
                }}
                placeholder="CODE"
                autoComplete="off"
                spellCheck={false}
              />
            <button
              type="button"
                  className="min-h-12 rounded-lg border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-3 text-[11px] font-light uppercase tracking-[0.22em] text-editorial-pulse"
                onClick={checkVoucher}
                disabled={voucherCheckBusy || isSubmitting || zvtInFlight}
              >
                {voucherCheckBusy ? "…" : "Prüfen"}
              </button>
            </div>
            {voucherInfo && (
              <div className="mt-2 text-sm text-deep-charcoal/75">
                Rest: {(voucherInfo.remainingAmountCents / 100).toFixed(2).replace(".", ",")} € ·
                Zahlbar jetzt: max. {(Math.min(remainingCents, voucherInfo.remainingAmountCents) / 100).toFixed(2).replace(".", ",")} €
                <div className="mt-1 flex items-center gap-2">
                  <input
                    className="luxury-field w-32 rounded-2xl border border-deep-charcoal/10 bg-gray-200/50 px-3 py-2 text-deep-charcoal"
                    value={voucherAmountInput}
                    disabled={isSubmitting || zvtInFlight}
                    onChange={(e) => setVoucherAmountInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded-xl border border-deep-charcoal/14 bg-transparent px-3 py-2 text-[11px] font-light uppercase tracking-[0.2em] text-deep-charcoal"
                    onClick={addVoucherPart}
                    disabled={remainingCents <= 0 || isSubmitting || zvtInFlight}
                  >
                    Gutschein buchen
                  </button>
                </div>
              </div>
            )}
            {voucherError && <p className="mt-1 text-sm text-red-600/90">{voucherError}</p>}
          </div>

          {payments.length > 0 && (
            <ul className="mb-2 space-y-1 text-deep-charcoal/80">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span>
                    {p.method === "cash" ? "Bar" : p.method === "card" ? "EC" : "Gutschein"}{" "}
                    {p.voucherCode ? p.voucherCode : ""} —{" "}
                    {(p.amountCents / 100).toFixed(2).replace(".", ",")} €
                  </span>
                  <button
                    type="button"
                    className="text-red-600/90"
                    onClick={() => removeRow(p.id)}
                    disabled={isSubmitting || zvtInFlight}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {submitError && <p className="mb-2 text-red-600/90">{submitError}</p>}

          <div className="mt-auto flex flex-wrap gap-4 pt-8">
            <button
              type="button"
              className="min-h-[56px] min-w-[140px] flex-1 rounded-2xl border border-deep-charcoal/15 bg-gray-100/60 px-6 text-deep-charcoal/80 "
              onClick={() => {
                cancelZvtOrCheckout();
                onClose();
                setSubmitError("");
                setPayments([]);
              }}
            >
              Abbrechen
            </button>
            <button
              type="button"
              className={`min-h-[50px] min-w-0 flex-[2] ${luxuryPosSettleButton} text-sm`}
              onClick={onSubmit}
              disabled={!canSubmit}
            >
              {isSubmitting && (
                <span
                  className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-deep-charcoal/25 border-t-white/80"
                  aria-hidden
                />
              )}
              Zahlung abschließen
            </button>
          </div>
        </section>
        </div>
        )}
      </div>
    </MotionModal>
  );
}
