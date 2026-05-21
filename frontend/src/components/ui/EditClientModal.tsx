import { useEffect, useState } from "react";
import { MotionModal } from "../organisms/MotionModal";
import { apiPatch } from "../../api";

export type EditableClient = {
  id: number;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
};

type Props = {
  open: boolean;
  client: EditableClient | null;
  onClose: () => void;
  onSaved?: (client: EditableClient) => void;
};

export function EditClientModal({ open, client, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    street: "",
    houseNumber: "",
    postalCode: "",
    city: "",
    country: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    setForm({
      firstName:   client.firstName ?? "",
      lastName:    client.lastName ?? "",
      phone:       client.phone ?? "",
      email:       client.email ?? "",
      street:      client.street ?? "",
      houseNumber: client.houseNumber ?? "",
      postalCode:  client.postalCode ?? "",
      city:        client.city ?? "",
      country:     client.country ?? "",
    });
    setError(null);
  }, [client]);

  function field(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    if (!form.firstName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await apiPatch<EditableClient>(`/api/clients/${client.id}/profile`, {
        firstName:   form.firstName.trim(),
        lastName:    form.lastName.trim(),
        phone:       form.phone.trim()       || null,
        email:       form.email.trim()       || null,
        street:      form.street.trim()      || null,
        houseNumber: form.houseNumber.trim() || null,
        postalCode:  form.postalCode.trim()  || null,
        city:        form.city.trim()        || null,
        country:     form.country.trim()     || null,
      });
      onSaved?.(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = form.firstName.trim().length > 0 && !loading;

  if (!client) return null;

  return (
    <MotionModal open={open} onClose={onClose} titleId="edit-client-title">
      <form onSubmit={submit} className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-deep-charcoal/[0.08] px-6 py-4">
          <div>
            <h2 id="edit-client-title" className="font-heading text-xl uppercase tracking-[0.08em] text-deep-charcoal">
              Kunde bearbeiten
            </h2>
            <p className="mt-0.5 text-[10px] font-light uppercase tracking-[0.22em] text-deep-charcoal/40">
              ID #{client.id}
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

        {/* Body */}
        <div className="flex flex-col gap-5 px-6 py-6">

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ecl-firstName" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Vorname *
              </label>
              <input
                id="ecl-firstName"
                required
                value={form.firstName}
                onChange={field("firstName")}
                className="luxury-field w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ecl-lastName" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Nachname
              </label>
              <input
                id="ecl-lastName"
                value={form.lastName}
                onChange={field("lastName")}
                className="luxury-field w-full"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ecl-phone" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              Telefon
            </label>
            <input
              id="ecl-phone"
              type="tel"
              value={form.phone}
              onChange={field("phone")}
              className="luxury-field w-full"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ecl-email" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              E-Mail
            </label>
            <input
              id="ecl-email"
              type="email"
              value={form.email}
              onChange={field("email")}
              className="luxury-field w-full"
            />
          </div>

          {/* Address */}
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ecl-street" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Straße
              </label>
              <input id="ecl-street" value={form.street} onChange={field("street")} className="luxury-field w-full" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ecl-houseNumber" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Nr.
              </label>
              <input id="ecl-houseNumber" value={form.houseNumber} onChange={field("houseNumber")} className="luxury-field w-full" />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ecl-postalCode" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                PLZ
              </label>
              <input id="ecl-postalCode" value={form.postalCode} onChange={field("postalCode")} className="luxury-field w-full" maxLength={10} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ecl-city" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
                Stadt
              </label>
              <input id="ecl-city" value={form.city} onChange={field("city")} className="luxury-field w-full" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ecl-country" className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
              Land
            </label>
            <input id="ecl-country" value={form.country} onChange={field("country")} className="luxury-field w-full" />
          </div>

          {error && (
            <p className="rounded-sm border border-red-400/55 bg-red-50/60 px-3 py-2 text-[12px] text-red-600/90">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
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
