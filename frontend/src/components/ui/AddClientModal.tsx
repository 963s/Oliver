import { useState } from "react";
import { MotionModal } from "../organisms/MotionModal";
import { apiPost } from "../../api";

type NewClient = {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (client: NewClient) => void;
};

const emptyForm = { firstName: "", lastName: "", phone: "", email: "", gdprConsent: false };

export function AddClientModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function field(k: keyof typeof emptyForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({
        ...f,
        [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
      }));
  }

  function reset() { setForm(emptyForm); setError(null); }
  function handleClose() { reset(); onClose(); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName.trim() || !form.gdprConsent) return;
    setLoading(true);
    setError(null);
    try {
      const client = await apiPost<NewClient>("/api/clients", {
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        phone:     form.phone.trim()  || null,
        email:     form.email.trim()  || null,
        gdprConsent: true,
      });
      onCreated?.(client);
      reset();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Fehler beim Anlegen");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = form.firstName.trim().length > 0 && form.gdprConsent && !loading;

  return (
    <MotionModal open={open} onClose={handleClose} titleId="add-client-title">
      <form onSubmit={submit} className="flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-deep-charcoal/[0.08] px-6 py-4">
          <div>
            <h2
              id="add-client-title"
              className="font-heading text-xl uppercase tracking-[0.08em] text-deep-charcoal"
            >
              Neuer Kunde
            </h2>
            <p className="mt-0.5 text-[10px] font-light uppercase tracking-[0.22em] text-deep-charcoal/40">
              Kundenkarte anlegen
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

          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="acl-firstName" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Vorname *
              </label>
              <input
                id="acl-firstName"
                autoFocus
                required
                value={form.firstName}
                onChange={field("firstName")}
                placeholder="Maria"
                className="luxury-field w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="acl-lastName" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Nachname
              </label>
              <input
                id="acl-lastName"
                value={form.lastName}
                onChange={field("lastName")}
                placeholder="Müller"
                className="luxury-field w-full"
              />
            </div>
          </div>

          {/* Phone */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="acl-phone" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              Telefon
            </label>
            <input
              id="acl-phone"
              type="tel"
              value={form.phone}
              onChange={field("phone")}
              placeholder="+49 170 123 456"
              className="luxury-field w-full"
            />
          </div>

          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="acl-email" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              E-Mail
            </label>
            <input
              id="acl-email"
              type="email"
              value={form.email}
              onChange={field("email")}
              placeholder="maria@beispiel.de"
              className="luxury-field w-full"
            />
          </div>

          {/* GDPR consent */}
          <label
            htmlFor="acl-gdpr"
            className="flex cursor-pointer items-start gap-3 rounded-sm border border-deep-charcoal/[0.08] bg-gray-100/40 p-4"
          >
            <input
              id="acl-gdpr"
              type="checkbox"
              checked={form.gdprConsent}
              onChange={field("gdprConsent")}
              className="mt-0.5 h-4 w-4 shrink-0 accent-champagne-gold"
            />
            <span className="text-[11px] font-light leading-relaxed text-deep-charcoal/70">
              Der Kunde hat der Speicherung seiner Daten gemäß{" "}
              <strong className="font-medium text-deep-charcoal/80">DSGVO</strong> zugestimmt.
              <span className="mt-1 block text-[10px] text-deep-charcoal/40">
                Ohne Zustimmung kann keine Kundenkarte angelegt werden.
              </span>
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
            id="add-client-submit"
            disabled={!canSubmit}
            className="editorial-pulse-fill min-h-9 px-6 text-[11px] font-medium uppercase tracking-[0.24em] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Speichern…" : "Kunde anlegen"}
          </button>
        </div>

      </form>
    </MotionModal>
  );
}
