import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../../api";

type FormulaRow = {
  id: number;
  clientId: number;
  formulaText: string;
  notes: string | null;
  staffId: number;
  createdAt: number;
};

type FormulaRezepturModalProps = {
  open: boolean;
  onClose: () => void;
  clientId: number | null;
  clientName?: string | null;
};

/**
 * §12.5.14 — Rezeptur / Farbmischung am Spiegel (dauerhafte Kundenhistorie).
 */
export function FormulaRezepturModal({
  open,
  onClose,
  clientId,
  clientName,
}: FormulaRezepturModalProps) {
  const [rows, setRows] = useState<FormulaRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [formulaText, setFormulaText] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    if (clientId == null) return;
    setLoadErr(null);
    try {
      const list = await apiGet<FormulaRow[]>(`/api/clients/${clientId}/formulas`);
      setRows(list);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "load_failed");
    }
  }, [clientId]);

  useEffect(() => {
    if (!open) return;
    setFormulaText("");
    setNotes("");
    setSaveErr(null);
    if (clientId != null) {
      void load();
    }
  }, [open, clientId, load]);

  const onSave = async () => {
    if (clientId == null) return;
    const t = formulaText.trim();
    if (!t) {
      setSaveErr("Rezeptur-Text fehlt.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      await apiPost<FormulaRow>(`/api/clients/${clientId}/formulas`, {
        formulaText: t,
        notes: notes.trim() || null,
      });
      setFormulaText("");
      setNotes("");
      await load();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[340] flex items-stretch justify-center bg-gray-400/70 p-2 backdrop-blur-[20px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rezeptur-title"
    >
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-deep-charcoal/10 bg-gray-50/95 text-deep-charcoal shadow-2xl">
        <div className="border-b border-deep-charcoal/10 px-4 py-3">
          <h2 id="rezeptur-title" className="font-editorial-display text-3xl font-normal uppercase tracking-[0.14em] text-editorial-pulse">
            Rezeptur
          </h2>
          <p className="mt-2 text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
            Mischung für{" "}
            {clientName ? (
              <span className="font-semibold text-deep-charcoal/80">{clientName}</span>
            ) : (
              "Kunde"
            )}{" "}
            (§12.5.14)
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {clientId == null && (
            <div
              className="border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/35 p-4 text-editorial-pulse"
              role="status"
            >
              <p className="text-sm font-light uppercase tracking-[0.2em]">Kein Kunde an der Session verknüpft.</p>
              <p className="mt-2 text-sm text-deep-charcoal/70">
                Bitte Kunde wählen (Walk-in / CRM) und Session zuordnen, damit Rezepturen gespeichert
                werden können.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  to="/walk-in"
                  className="inline-flex min-h-12 items-center border border-editorial-pulse bg-transparent px-4 text-[11px] font-light uppercase tracking-[0.24em] text-editorial-pulse no-underline"
                >
                  Walk-in
                </Link>
                <Link
                  to="/bookings"
                  className="inline-flex min-h-12 items-center border border-deep-charcoal/15 px-4 text-[11px] font-light uppercase tracking-[0.24em] text-deep-charcoal/78 no-underline"
                >
                  Termine
                </Link>
              </div>
            </div>
          )}

          {clientId != null && loadErr && (
            <p className="mb-3 border border-red-400/55 bg-red-50/60 p-2 text-sm text-red-600/90">
              {loadErr}
            </p>
          )}

          {clientId != null && (
            <>
              {rows.length > 0 && (
                <div className="mb-4 space-y-2">
                  <p className="text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
                    Bisherige Einträge
                  </p>
                  <ul className="max-h-40 space-y-2 overflow-y-auto text-sm">
                    {rows.map((r) => (
                      <li
                        key={r.id}
                        className="border border-deep-charcoal/10 bg-gray-100/40 p-2 font-mono text-deep-charcoal/80"
                      >
                        {r.formulaText}
                        {r.notes && (
                          <span className="mt-1 block text-xs text-deep-charcoal/45">{r.notes}</span>
                        )}
                        <span className="mt-1 block text-[10px] text-deep-charcoal/35">
                          {new Date(r.createdAt).toLocaleString("de-DE")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <label className="block">
                <span className="mb-1 block text-sm font-light uppercase tracking-[0.22em] text-deep-charcoal/78">Neue Rezeptur *</span>
                <textarea
                  className="min-h-[120px] w-full border-b border-deep-charcoal/16 bg-transparent p-3 text-base font-light text-stone-50 outline-none"
                  value={formulaText}
                  onChange={(e) => setFormulaText(e.target.value)}
                  placeholder="z. B. 7/0 + 9/1 · Entwickler 6 %, Einwirkzeit 30 Min …"
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">Notiz (optional)</span>
                <input
                  type="text"
                  className="w-full border-b border-deep-charcoal/16 bg-transparent p-2 text-deep-charcoal outline-none"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              {saveErr && (
                <p className="mt-2 text-sm text-red-600/90" role="alert">
                  {saveErr}
                </p>
              )}
            </>
          )}
        </div>

        <div className="border-t border-deep-charcoal/10 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-12 flex-1 border border-deep-charcoal/15 py-2 text-[11px] font-light uppercase tracking-[0.24em] text-deep-charcoal/70"
              onClick={onClose}
            >
              Schließen
            </button>
            {clientId != null && (
              <button
                type="button"
                disabled={saving}
                className="min-h-12 flex-[2] border border-editorial-pulse bg-transparent py-2 text-[11px] font-light uppercase tracking-[0.32em] text-editorial-pulse disabled:opacity-50"
                onClick={() => void onSave()}
              >
                {saving ? "…" : "Speichern"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
