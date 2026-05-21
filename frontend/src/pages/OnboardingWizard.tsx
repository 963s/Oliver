import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http } from "../lib/apiClient";
import { useAuthStore } from "../store/authStore";

type AuthMode = "name_select" | "pin";

type StaffDraft = {
  displayName: string;
  role: "owner" | "stylist";
};

type SetupStatus = {
  needsOnboarding: boolean;
  salonName: string;
  authMode: AuthMode;
  staffCount: number;
};

type SetupResult = {
  ok: boolean;
  token: string;
  staff: { id: number; displayName: string; role: string };
};

/**
 * First-launch wizard. Shown when no staff exists in the DB.
 * Steps: Welcome → Salon name → Admin name → Add staff → Done (auto-login).
 */
export function OnboardingWizard() {
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const rehydrate = useAuthStore((s) => s.rehydrate);

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [salonName, setSalonName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("name_select");
  const [staff, setStaff] = useState<StaffDraft[]>([]);
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<"owner" | "stylist">("stylist");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Safety: if onboarding is not needed (someone navigated here manually), redirect home.
  useEffect(() => {
    void http
      .get<SetupStatus>("/api/system/setup-status")
      .then((r) => {
        if (!r.data.needsOnboarding) navigate("/", { replace: true });
      })
      .catch(() => {
        /* allow to proceed — onboarding endpoint may be the only one reachable */
      });
  }, [navigate]);

  const addStaffRow = () => {
    const name = newStaffName.trim();
    if (!name) return;
    setStaff((s) => [...s, { displayName: name, role: newStaffRole }]);
    setNewStaffName("");
    setNewStaffRole("stylist");
  };

  const removeStaffRow = (idx: number) => {
    setStaff((s) => s.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (!adminName.trim()) {
      setErr("Bitte deinen Namen als Inhaber eingeben.");
      setStep(2);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await http.post<SetupResult>("/api/system/initial-setup", {
        salonName: salonName.trim(),
        adminName: adminName.trim(),
        authMode,
        staff,
      });
      const data = r.data;
      // Auto-login as the admin
      localStorage.setItem("or:authToken", data.token);
      localStorage.setItem("or:staffId", String(data.staff.id));
      localStorage.setItem("or:staffRole", data.staff.role);
      localStorage.setItem("or:staffDisplayName", data.staff.displayName);
      setAuthenticated(true);
      rehydrate();
      navigate("/", { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Setup fehlgeschlagen");
      setBusy(false);
    }
  };

  const stepLabels = ["Willkommen", "Salon", "Inhaber", "Team"];

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-y-auto bg-canvas-white p-6 text-deep-charcoal">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,var(--editorial-pulse-dim),transparent_55%)]" aria-hidden />

      <div className="relative z-[1] w-full max-w-2xl border border-deep-charcoal/[0.08] bg-gray-100/95 p-10 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.85)]">
        {/* Step indicator */}
        <div className="mb-8 flex items-center gap-2 text-xs uppercase tracking-[0.2em]">
          {stepLabels.map((label, idx) => (
            <div key={label} className="flex items-center gap-2">
              <span
                className={`h-1.5 w-12 ${
                  idx <= step ? "bg-champagne-gold" : "bg-deep-charcoal/15"
                }`}
              />
              <span
                className={
                  idx === step
                    ? "font-semibold text-deep-charcoal"
                    : "text-deep-charcoal/35"
                }
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div>
            <h1 className="font-editorial-display text-4xl font-normal uppercase tracking-[0.2em] text-deep-charcoal">
              Willkommen
            </h1>
            <p className="mt-6 text-base font-light leading-relaxed text-deep-charcoal/70">
              Dies ist die erste Einrichtung deines Salons. In wenigen Schritten ist alles bereit.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-deep-charcoal/70">
              <li>• Salon-Name (erscheint im Kopf der App)</li>
              <li>• Dein Name als Inhaber</li>
              <li>• Optional: Team-Mitglieder hinzufügen</li>
            </ul>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="editorial-pulse-fill mt-10 px-8 py-3 text-sm font-semibold uppercase tracking-[0.2em] hover:opacity-90"
            >
              Los geht's →
            </button>
          </div>
        )}

        {/* Step 1: Salon name */}
        {step === 1 && (
          <div>
            <h2 className="font-editorial-display text-3xl uppercase tracking-[0.18em]">
              Salon-Name
            </h2>
            <p className="mt-3 text-sm text-deep-charcoal/60">
              Wie heißt dein Studio? Dieser Name erscheint später überall in der App.
            </p>
            <input
              autoFocus
              value={salonName}
              onChange={(e) => setSalonName(e.target.value)}
              placeholder="z. B. Oliver Roos Frisuren"
              className="luxury-field mt-6 w-full text-lg"
            />
            <div className="mt-10 flex justify-between">
              <button type="button" onClick={() => setStep(0)} className="px-4 py-2 text-sm uppercase tracking-wider text-deep-charcoal/50 hover:text-deep-charcoal">
                ← Zurück
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="editorial-pulse-fill px-8 py-3 text-sm font-semibold uppercase tracking-[0.2em] hover:opacity-90"
              >
                Weiter →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Admin name + auth mode */}
        {step === 2 && (
          <div>
            <h2 className="font-editorial-display text-3xl uppercase tracking-[0.18em]">
              Inhaber
            </h2>
            <p className="mt-3 text-sm text-deep-charcoal/60">
              Du bist der Inhaber. Volle Berechtigung für alle Funktionen.
            </p>
            <input
              autoFocus
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              placeholder="Vor- und Nachname"
              className="luxury-field mt-6 w-full text-lg"
            />

            <div className="mt-8">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-deep-charcoal/60">
                Anmeldung
              </p>
              <div className="mt-3 space-y-3">
                <label className="flex cursor-pointer items-start gap-3 border border-deep-charcoal/10 bg-white/60 p-4 hover:bg-white">
                  <input
                    type="radio"
                    name="authMode"
                    checked={authMode === "name_select"}
                    onChange={() => setAuthMode("name_select")}
                    className="mt-1 accent-champagne-gold"
                  />
                  <div>
                    <p className="text-sm font-semibold">Name auswählen (empfohlen)</p>
                    <p className="mt-1 text-xs text-deep-charcoal/60">
                      Schnelle Anmeldung durch Antippen des eigenen Namens. Kein PIN.
                    </p>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-3 border border-deep-charcoal/10 bg-white/60 p-4 hover:bg-white">
                  <input
                    type="radio"
                    name="authMode"
                    checked={authMode === "pin"}
                    onChange={() => setAuthMode("pin")}
                    className="mt-1 accent-champagne-gold"
                  />
                  <div>
                    <p className="text-sm font-semibold">PIN erforderlich</p>
                    <p className="mt-1 text-xs text-deep-charcoal/60">
                      Jedes Teammitglied erhält einen 4–6-stelligen PIN (höhere Sicherheit). Kann später in den Einstellungen umgestellt werden.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div className="mt-10 flex justify-between">
              <button type="button" onClick={() => setStep(1)} className="px-4 py-2 text-sm uppercase tracking-wider text-deep-charcoal/50 hover:text-deep-charcoal">
                ← Zurück
              </button>
              <button
                type="button"
                disabled={!adminName.trim()}
                onClick={() => setStep(3)}
                className="editorial-pulse-fill px-8 py-3 text-sm font-semibold uppercase tracking-[0.2em] hover:opacity-90 disabled:opacity-40"
              >
                Weiter →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Team + finish */}
        {step === 3 && (
          <div>
            <h2 className="font-editorial-display text-3xl uppercase tracking-[0.18em]">
              Team
            </h2>
            <p className="mt-3 text-sm text-deep-charcoal/60">
              Füge weitere Friseure / Mitarbeiter hinzu. Du kannst diesen Schritt überspringen und sie später im Admin-Bereich anlegen.
            </p>

            <div className="mt-6 flex gap-2">
              <input
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addStaffRow(); }}
                placeholder="Name"
                className="luxury-field flex-1"
              />
              <select
                value={newStaffRole}
                onChange={(e) => setNewStaffRole(e.target.value as "owner" | "stylist")}
                className="luxury-field luxury-select min-w-[140px]"
              >
                <option value="stylist">Stylist</option>
                <option value="owner">Inhaber/Manager</option>
              </select>
              <button
                type="button"
                onClick={addStaffRow}
                disabled={!newStaffName.trim()}
                className="border border-champagne-gold bg-champagne-gold px-5 text-sm font-semibold uppercase tracking-wider text-deep-charcoal disabled:opacity-40"
              >
                + Hinzufügen
              </button>
            </div>

            {staff.length > 0 && (
              <ul className="mt-5 space-y-2">
                {staff.map((s, idx) => (
                  <li key={idx} className="flex items-center justify-between border border-deep-charcoal/10 bg-white/60 px-4 py-2">
                    <div>
                      <span className="text-sm font-semibold">{s.displayName}</span>
                      <span className="ml-3 text-xs uppercase tracking-wider text-deep-charcoal/50">
                        {s.role === "owner" ? "Inhaber" : "Stylist"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStaffRow(idx)}
                      className="text-xs uppercase tracking-wider text-red-500 hover:text-red-700"
                    >
                      Entfernen
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {err && (
              <p className="mt-4 border border-red-400/55 bg-red-50/60 px-3 py-2 text-sm text-red-600">{err}</p>
            )}

            <div className="mt-10 flex justify-between">
              <button type="button" onClick={() => setStep(2)} className="px-4 py-2 text-sm uppercase tracking-wider text-deep-charcoal/50 hover:text-deep-charcoal">
                ← Zurück
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="editorial-pulse-fill px-8 py-3 text-sm font-semibold uppercase tracking-[0.2em] hover:opacity-90 disabled:opacity-40"
              >
                {busy ? "Speichern ..." : "Fertig ✓"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
