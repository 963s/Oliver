import { useState } from "react";
import { MotionModal } from "../organisms/MotionModal";
import { apiPost } from "../../api";
import type { CatalogService } from "../../store/catalogStore";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (service: CatalogService) => void;
};

const emptyForm = {
  serviceName:      "",
  durationMinutes:  "30",
  referenceNetEur:  "",
  vatRateBps:       "1900",
  catalogActive:    true,
};

export function AddServiceModal({ open, onClose, onCreated }: Props) {
  const [form, setForm]       = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  function field(k: keyof typeof emptyForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({
        ...f,
        [k]: e.target.type === "checkbox"
          ? (e.target as HTMLInputElement).checked
          : e.target.value,
      }));
  }

  function reset() { setForm(emptyForm); setError(null); }
  function handleClose() { reset(); onClose(); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.serviceName.trim();
    const dur  = parseInt(form.durationMinutes, 10);
    if (!name || isNaN(dur) || dur < 5) return;
    setLoading(true);
    setError(null);
    try {
      const svc = await apiPost<CatalogService>("/api/admin/catalog/services", {
        serviceName:        name,
        durationMinutes:    dur,
        referenceNetCents:  Math.round(parseFloat(form.referenceNetEur || "0") * 100),
        vatRateBps:         parseInt(form.vatRateBps, 10),
        catalogActive:      form.catalogActive,
      });
      onCreated?.(svc);
      reset();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Fehler";
      setError(msg.includes("service_name_exists") ? "Bezeichnung bereits vorhanden" : msg);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    form.serviceName.trim().length > 0 &&
    parseInt(form.durationMinutes, 10) >= 5 &&
    !loading;

  return (
    <MotionModal open={open} onClose={handleClose} titleId="add-service-title">
      <form onSubmit={submit} className="flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-deep-charcoal/[0.08] px-6 py-4">
          <div>
            <h2
              id="add-service-title"
              className="font-heading text-xl uppercase tracking-[0.08em] text-deep-charcoal"
            >
              Neue Dienstleistung
            </h2>
            <p className="mt-0.5 text-[10px] font-light uppercase tracking-[0.22em] text-deep-charcoal/40">
              Zum Katalog hinzufügen
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

          {/* Service name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="asv-name" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              Bezeichnung *
            </label>
            <input
              id="asv-name"
              autoFocus
              required
              value={form.serviceName}
              onChange={field("serviceName")}
              placeholder="Haarschnitt Damen"
              className="luxury-field w-full"
            />
          </div>

          {/* Duration + VAT */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="asv-dur" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Dauer (Min) *
              </label>
              <input
                id="asv-dur"
                type="number"
                min="5"
                max="960"
                step="5"
                value={form.durationMinutes}
                onChange={field("durationMinutes")}
                className="luxury-field w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="asv-vat" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                MwSt
              </label>
              <select
                id="asv-vat"
                value={form.vatRateBps}
                onChange={field("vatRateBps")}
                className="luxury-field luxury-select w-full"
              >
                <option value="1900">19 %</option>
                <option value="700">7 %</option>
              </select>
            </div>
          </div>

          {/* Net price */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="asv-price" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              Preis netto (€)
            </label>
            <div className="relative">
              <input
                id="asv-price"
                type="number"
                min="0"
                step="0.01"
                value={form.referenceNetEur}
                onChange={field("referenceNetEur")}
                placeholder="0.00"
                className="luxury-field w-full pr-8"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-deep-charcoal/35">
                €
              </span>
            </div>
          </div>

          {/* Catalog active */}
          <label htmlFor="asv-active" className="flex cursor-pointer items-center gap-3">
            <input
              id="asv-active"
              type="checkbox"
              checked={form.catalogActive}
              onChange={field("catalogActive")}
              className="h-4 w-4 accent-champagne-gold"
            />
            <span className="text-[11px] font-light uppercase tracking-[0.14em] text-deep-charcoal/60">
              Im Katalog sichtbar
            </span>
          </label>

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
            id="add-service-submit"
            disabled={!canSubmit}
            className="editorial-pulse-fill min-h-9 px-6 text-[11px] font-medium uppercase tracking-[0.24em] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Speichern…" : "Dienst anlegen"}
          </button>
        </div>

      </form>
    </MotionModal>
  );
}
