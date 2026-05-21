import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";

type InventoryItemRow = {
  id: number;
  name: string;
  barcodeEan: string | null;
  barcodeUpc: string | null;
  defaultUnitMl: number;
  onHandMl: number;
};

type ScanLine = {
  scanBarcode: string;
  item: InventoryItemRow;
  ml: number;
};

function stepMl(item: InventoryItemRow): number {
  return item.defaultUnitMl > 0 ? item.defaultUnitMl : 60;
}

/**
 * Step 39 — Wareneingang (admin): global barcode wedge + batch POST /api/inventory/restock.
 */
export function WareneingangView() {
  const [lines, setLines] = useState<ScanLine[]>([]);
  const [belegRef, setBelegRef] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const onScan = useCallback(async (code: string) => {
    setErr("");
    setMsg("");
    try {
      const item = await apiGet<InventoryItemRow>(
        `/api/inventory/items?barcode=${encodeURIComponent(code)}`,
      );
      setLines((prev) => {
        const i = prev.findIndex((l) => l.scanBarcode === code);
        const step = stepMl(item);
        if (i >= 0) {
          const next = [...prev];
          const row = next[i]!;
          next[i] = { ...row, ml: row.ml + step };
          return next;
        }
        return [...prev, { scanBarcode: code, item, ml: step }];
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "scan_lookup_failed");
    }
  }, []);

  useBarcodeScanner({ onScan });

  const totalMl = useMemo(() => lines.reduce((s, l) => s + l.ml, 0), [lines]);

  const updateMl = (scanBarcode: string, ml: number) => {
    const v = Math.max(1, Math.floor(Number.isFinite(ml) ? ml : 0));
    setLines((prev) =>
      prev.map((l) => (l.scanBarcode === scanBarcode ? { ...l, ml: v } : l)),
    );
  };

  const removeLine = (scanBarcode: string) => {
    setLines((prev) => prev.filter((l) => l.scanBarcode !== scanBarcode));
  };

  const submit = async () => {
    const ref = belegRef.trim();
    if (!ref) {
      setErr("Lieferanten-Referenz / Beleg-Nr. ist Pflicht.");
      return;
    }
    if (lines.length === 0) {
      setErr("Keine Positionen — Barcodes scannen.");
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await apiPost("/api/inventory/restock", {
        supplierInvoiceRef: ref,
        lines: lines.map((l) => ({
          barcode: l.scanBarcode,
          quantityAdded: l.ml,
        })),
      });
      setLines([]);
      setMsg("Warenbestand gebucht — Bestände aktualisiert.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "buchung_fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 text-deep-charcoal">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-editorial-display text-5xl font-normal uppercase tracking-[0.14em] text-deep-charcoal">Wareneingang</h1>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-brushed-chrome">
            Barcode scannen (HID) — jeder Scan erhöht um Verkaufseinheit (ml). Nur Verwaltung.
          </p>
        </div>
        <Link
          to="/admin"
          className="inline-flex min-h-touch min-w-touch items-center justify-center border border-deep-charcoal/15 px-5 text-[11px] font-light uppercase tracking-[0.24em] text-deep-charcoal no-underline hover:border-editorial-pulse hover:text-editorial-pulse"
        >
          ← Chef-Ansicht
        </Link>
      </div>

      <label className="mb-6 block">
        <span className="mb-1 block text-xs font-light uppercase tracking-[0.2em] text-brushed-chrome">
          Lieferanten-Referenz / Beleg-Nr. *
        </span>
        <input
          type="text"
          className="luxury-field w-full text-lg"
          value={belegRef}
          onChange={(e) => setBelegRef(e.target.value)}
          placeholder="z. B. RE-2026-0412"
          autoComplete="off"
        />
      </label>

      {err && (
        <div className="mb-4 border border-red-400/60 bg-red-50/60 px-4 py-3 text-red-600/90" role="alert">
          {err}
        </div>
      )}
      {msg && (
        <div className="mb-4 border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/35 px-4 py-3 text-editorial-pulse">
          {msg}
        </div>
      )}

      <div className="border border-deep-charcoal/10 bg-gray-100/40 p-4">
        <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.12em] text-deep-charcoal">Scan-Liste</h2>
        <p className="mt-1 text-sm text-brushed-chrome">
          Gesamt-Zugang (ml):{" "}
          <strong className="font-mono text-deep-charcoal">{totalMl}</strong>
        </p>

        {lines.length === 0 ? (
          <p className="mt-6 text-center text-brushed-chrome">
            Noch keine Scans — Pistole auf Produkt richten und scannen.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {lines.map((l) => (
              <li
                key={l.scanBarcode}
                className="flex min-h-[52px] flex-col gap-3 border border-deep-charcoal/10 bg-gray-100/40 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-light text-deep-charcoal">{l.item.name}</p>
                  <p className="font-mono text-xs text-brushed-chrome">{l.scanBarcode}</p>
                  <p className="mt-1 text-sm text-brushed-chrome">
                    Aktueller Bestand:{" "}
                    <span className="font-mono text-deep-charcoal">{l.item.onHandMl} ml</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex min-h-touch items-center gap-2 text-sm text-brushed-chrome">
                    ml
                    <input
                      type="number"
                      min={1}
                      className="luxury-field w-28 px-3 py-3 font-mono"
                      value={l.ml}
                      onChange={(e) =>
                        updateMl(l.scanBarcode, Number.parseInt(e.target.value, 10))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="min-h-touch border border-red-400/60 px-4 py-3 text-[11px] font-light uppercase tracking-[0.2em] text-red-600/90"
                    onClick={() => removeLine(l.scanBarcode)}
                  >
                    Zeile entfernen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        disabled={busy || lines.length === 0}
        className="mt-8 min-h-touch w-full border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 py-4 text-[11px] font-light uppercase tracking-[0.24em] text-editorial-pulse disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => void submit()}
      >
        {busy ? "…" : "Warenbestand buchen"}
      </button>
    </div>
  );
}
