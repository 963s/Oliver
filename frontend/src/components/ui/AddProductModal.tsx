import { useState } from "react";
import { MotionModal } from "../organisms/MotionModal";
import { apiPost } from "../../api";

type UsageType = "retail" | "salon" | "both";

type InventoryItem = {
  id: number;
  name: string;
  defaultUnitMl: number;
  onHandMl: number;
  isRetail: boolean;
  usageType: UsageType;
  barcodeEan: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (item: InventoryItem) => void;
};

const emptyForm = {
  name:          "",
  defaultUnitMl: "100",
  onHandMl:      "0",
  pricePerMlEur: "",
  barcodeEan:    "",
  usageType:     "salon" as UsageType,
  vatRateBps:    "1900",
};

export function AddProductModal({ open, onClose, onCreated }: Props) {
  const [form, setForm]       = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  function field(k: keyof typeof emptyForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  function reset() { setForm(emptyForm); setError(null); }
  function handleClose() { reset(); onClose(); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const item = await apiPost<InventoryItem>("/api/inventory", {
        name,
        defaultUnitMl:          Math.max(1, parseInt(form.defaultUnitMl, 10) || 100),
        onHandMl:                Math.max(0, parseInt(form.onHandMl, 10) || 0),
        referenceNetPerMlCents:  Math.round(parseFloat(form.pricePerMlEur || "0") * 100),
        estimateVatRateBps:      parseInt(form.vatRateBps, 10),
        usageType:               form.usageType,
        barcodeEan:              form.barcodeEan.trim() || null,
      });
      onCreated?.(item);
      reset();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Fehler beim Anlegen");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = form.name.trim().length > 0 && !loading;

  return (
    <MotionModal open={open} onClose={handleClose} titleId="add-product-title">
      <form onSubmit={submit} className="flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-deep-charcoal/[0.08] px-6 py-4">
          <div>
            <h2
              id="add-product-title"
              className="font-heading text-xl uppercase tracking-[0.08em] text-deep-charcoal"
            >
              Neues Produkt
            </h2>
            <p className="mt-0.5 text-[10px] font-light uppercase tracking-[0.22em] text-deep-charcoal/40">
              Lagerartikel hinzufügen
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center border border-deep-charcoal/[0.08] text-sm text-deep-charcoal/40 transition hover:bg-gray-100/60 hover:text-deep-charcoal/70"
          >
            ✕
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-col gap-5 px-6 py-6">

          {/* Product name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="apr-name" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              Produktname *
            </label>
            <input
              id="apr-name"
              autoFocus
              required
              value={form.name}
              onChange={field("name")}
              placeholder="Farbe Intensiv 6.0"
              className="luxury-field w-full"
            />
          </div>

          {/* Unit + Stock */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="apr-unit" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Einheit (ml)
              </label>
              <input
                id="apr-unit"
                type="number"
                min="1"
                value={form.defaultUnitMl}
                onChange={field("defaultUnitMl")}
                className="luxury-field w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="apr-stock" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Bestand (ml)
              </label>
              <input
                id="apr-stock"
                type="number"
                min="0"
                value={form.onHandMl}
                onChange={field("onHandMl")}
                className="luxury-field w-full"
              />
            </div>
          </div>

          {/* Price + VAT */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="apr-price" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Preis netto / ml (€)
              </label>
              <input
                id="apr-price"
                type="number"
                min="0"
                step="0.001"
                value={form.pricePerMlEur}
                onChange={field("pricePerMlEur")}
                placeholder="0.000"
                className="luxury-field w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="apr-vat" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                MwSt
              </label>
              <select
                id="apr-vat"
                value={form.vatRateBps}
                onChange={field("vatRateBps")}
                className="luxury-field luxury-select w-full"
              >
                <option value="1900">19 %</option>
                <option value="700">7 %</option>
              </select>
            </div>
          </div>

          {/* Barcode */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="apr-barcode" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              Barcode EAN (optional — bei leerem Feld wird automatisch generiert)
            </label>
            <input
              id="apr-barcode"
              value={form.barcodeEan}
              onChange={field("barcodeEan")}
              placeholder="leer lassen für Auto-Generierung"
              className="luxury-field w-full font-mono"
            />
          </div>

          {/* Usage type — 3 options */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="apr-usage" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              Verwendung *
            </label>
            <select
              id="apr-usage"
              value={form.usageType}
              onChange={field("usageType")}
              className="luxury-field luxury-select w-full"
            >
              <option value="salon">Salon-Verbrauch (intern)</option>
              <option value="retail">Verkaufsartikel (Kunde)</option>
              <option value="both">Beides (Salon + Verkauf)</option>
            </select>
          </div>

          {/* Error */}
          {error && (
            <p className="rounded-sm border border-red-400/55 bg-red-50/60 px-3 py-2 text-[12px] text-red-600/90">
              {error}
            </p>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-end gap-2 border-t border-deep-charcoal/[0.08] px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-9 px-5 text-[11px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50 transition hover:text-deep-charcoal/80"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            id="add-product-submit"
            disabled={!canSubmit}
            className="editorial-pulse-fill min-h-9 px-6 text-[11px] font-medium uppercase tracking-[0.24em] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Speichern…" : "Produkt anlegen"}
          </button>
        </div>

      </form>
    </MotionModal>
  );
}
