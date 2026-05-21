import { useEffect, useState } from "react";
import { MotionModal } from "../organisms/MotionModal";
import { apiPatch } from "../../api";

export type EditableProduct = {
  id: number;
  name: string;
  barcodeEan: string | null;
  defaultUnitMl: number;
  onHandMl: number;
  isRetail: boolean;
  usageType: "retail" | "salon" | "both";
  referenceNetPerMlCents: number;
  estimateVatRateBps: number;
  minStockThresholdMl: number | null;
};

type Props = {
  open: boolean;
  product: EditableProduct | null;
  onClose: () => void;
  onSaved?: (product: EditableProduct) => void;
};

export function EditProductModal({ open, product, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: "",
    barcodeEan: "",
    defaultUnitMl: "0",
    usageType: "salon" as "retail" | "salon" | "both",
    pricePerMlEur: "",
    vatRateBps: "1900",
    minStockThresholdMl: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;
    setForm({
      name:              product.name ?? "",
      barcodeEan:        product.barcodeEan ?? "",
      defaultUnitMl:     String(product.defaultUnitMl ?? 0),
      usageType:         product.usageType ?? (product.isRetail ? "retail" : "salon"),
      pricePerMlEur:     ((product.referenceNetPerMlCents ?? 0) / 100).toFixed(3),
      vatRateBps:        String(product.estimateVatRateBps ?? 1900),
      minStockThresholdMl: product.minStockThresholdMl == null ? "" : String(product.minStockThresholdMl),
    });
    setError(null);
  }, [product]);

  function field(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    const name = form.name.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const thresholdRaw = form.minStockThresholdMl.trim();
      const updated = await apiPatch<EditableProduct>(`/api/inventory/${product.id}`, {
        name,
        barcodeEan:              form.barcodeEan.trim() || null,
        defaultUnitMl:           Math.max(0, parseInt(form.defaultUnitMl, 10) || 0),
        usageType:               form.usageType,
        referenceNetPerMlCents:  Math.round(parseFloat(form.pricePerMlEur || "0") * 100),
        estimateVatRateBps:      parseInt(form.vatRateBps, 10),
        minStockThresholdMl:     thresholdRaw === "" ? null : Math.max(0, parseInt(thresholdRaw, 10) || 0),
      });
      onSaved?.(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = form.name.trim().length > 0 && !loading;

  if (!product) return null;

  return (
    <MotionModal open={open} onClose={onClose} titleId="edit-product-title">
      <form onSubmit={submit} className="flex flex-col">
        <div className="flex items-center justify-between border-b border-deep-charcoal/[0.08] px-6 py-4">
          <div>
            <h2 id="edit-product-title" className="font-heading text-xl uppercase tracking-[0.08em] text-deep-charcoal">
              Produkt bearbeiten
            </h2>
            <p className="mt-0.5 text-[10px] font-light uppercase tracking-[0.22em] text-deep-charcoal/40">
              Lagerartikel #{product.id} · Bestand: {product.onHandMl} ml
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center border border-deep-charcoal/[0.08] text-sm text-deep-charcoal/40 transition hover:bg-gray-100/60 hover:text-deep-charcoal/70"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-5 px-6 py-6">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="epr-name" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              Produktname *
            </label>
            <input id="epr-name" required value={form.name} onChange={field("name")} className="luxury-field w-full" />
          </div>

          {/* Unit + threshold */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="epr-unit" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Einheit (ml)
              </label>
              <input id="epr-unit" type="number" min="0" value={form.defaultUnitMl} onChange={field("defaultUnitMl")} className="luxury-field w-full" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="epr-threshold" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Niedrigbestand-Schwelle (ml, leer = aus)
              </label>
              <input id="epr-threshold" type="number" min="0" value={form.minStockThresholdMl} onChange={field("minStockThresholdMl")} placeholder="leer = keine Warnung" className="luxury-field w-full" />
            </div>
          </div>

          {/* Price + VAT */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="epr-price" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Preis netto / ml (€)
              </label>
              <input id="epr-price" type="number" min="0" step="0.001" value={form.pricePerMlEur} onChange={field("pricePerMlEur")} className="luxury-field w-full" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="epr-vat" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                MwSt
              </label>
              <select id="epr-vat" value={form.vatRateBps} onChange={field("vatRateBps")} className="luxury-field luxury-select w-full">
                <option value="1900">19 %</option>
                <option value="700">7 %</option>
              </select>
            </div>
          </div>

          {/* Barcode */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="epr-barcode" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              Barcode EAN
            </label>
            <input id="epr-barcode" value={form.barcodeEan} onChange={field("barcodeEan")} placeholder="leer lassen für keinen Barcode" className="luxury-field w-full font-mono" />
          </div>

          {/* Usage type */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="epr-usage" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              Verwendung
            </label>
            <select id="epr-usage" value={form.usageType} onChange={field("usageType")} className="luxury-field luxury-select w-full">
              <option value="salon">Salon-Verbrauch (intern)</option>
              <option value="retail">Verkaufsartikel (Kunde)</option>
              <option value="both">Beides (Salon + Verkauf)</option>
            </select>
          </div>

          {error && (
            <p className="rounded-sm border border-red-400/55 bg-red-50/60 px-3 py-2 text-[12px] text-red-600/90">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-deep-charcoal/[0.08] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 px-5 text-[11px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50 transition hover:text-deep-charcoal/80"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="editorial-pulse-fill min-h-9 px-6 text-[11px] font-medium uppercase tracking-[0.24em] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Speichern…" : "Speichern"}
          </button>
        </div>
      </form>
    </MotionModal>
  );
}
