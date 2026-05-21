import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http } from "../lib/apiClient";
import { useAuthStore } from "../store/authStore";

type StaffDraft = {
  displayName: string;
  role: "owner" | "stylist";
  pin: string;
};

type SetupStatus = {
  needsOnboarding: boolean;
  salonName: string;
  authMode: "name_select" | "pin";
  staffCount: number;
};

type SetupResult = {
  ok: boolean;
  token: string;
  staff: { id: number; displayName: string; role: string };
};

const PIN_RE = /^\d{4,6}$/;

/**
 * Erstmaliger Setup-Assistent.
 * 4 Schritte: Willkommen → Salon → Inhaber+PIN → Team (mit PIN je Person).
 * PIN ist Pflicht — wird per bcrypt im Backend gehasht.
 */
export function OnboardingWizard() {
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const rehydrate = useAuthStore((s) => s.rehydrate);

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [salonName, setSalonName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPin,  setAdminPin]  = useState("");
  const [staff, setStaff] = useState<StaffDraft[]>([]);
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<"owner" | "stylist">("stylist");
  const [newStaffPin,  setNewStaffPin]  = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Safety: if onboarding is not needed, redirect home.
  useEffect(() => {
    void http
      .get<SetupStatus>("/api/system/setup-status")
      .then((r) => {
        if (!r.data.needsOnboarding) navigate("/", { replace: true });
      })
      .catch(() => {
        /* allow to proceed — onboarding may be the only endpoint reachable */
      });
  }, [navigate]);

  const addStaffRow = () => {
    const name = newStaffName.trim();
    const pin  = newStaffPin.trim();
    if (!name) { setErr("Name darf nicht leer sein."); return; }
    if (!PIN_RE.test(pin)) { setErr("PIN muss 4–6 Ziffern sein."); return; }
    // Check for duplicate PIN against admin or other staff
    const allPins = [adminPin, ...staff.map((s) => s.pin)];
    if (allPins.includes(pin)) {
      setErr("Dieser PIN ist schon vergeben — bitte einen anderen wählen.");
      return;
    }
    setStaff((s) => [...s, { displayName: name, role: newStaffRole, pin }]);
    setNewStaffName(""); setNewStaffPin(""); setNewStaffRole("stylist");
    setErr("");
  };

  const removeStaffRow = (idx: number) => {
    setStaff((s) => s.filter((_, i) => i !== idx));
  };

  const validateAdmin = (): string | null => {
    if (!adminName.trim()) return "Bitte deinen Namen als Inhaber eingeben.";
    if (!PIN_RE.test(adminPin)) return "PIN muss 4–6 Ziffern haben.";
    return null;
  };

  const submit = async () => {
    const adminErr = validateAdmin();
    if (adminErr) { setErr(adminErr); setStep(2); return; }

    setBusy(true);
    setErr("");
    try {
      const r = await http.post<SetupResult>("/api/system/initial-setup", {
        salonName: salonName.trim(),
        adminName: adminName.trim(),
        adminPin:  adminPin.trim(),
        authMode: "pin",
        staff: staff.map((s) => ({ displayName: s.displayName, role: s.role, pin: s.pin })),
      });
      const data = r.data;
      // Auto-login as admin
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

  /* Reusable PIN input — only allows digits, max 6 */
  const PinInput = ({ value, onChange, autoFocus = false, label }: {
    value: string;
    onChange: (v: string) => void;
    autoFocus?: boolean;
    label: string;
  }) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">
        {label}
      </label>
      <input
        autoFocus={autoFocus}
        inputMode="numeric"
        pattern="\d*"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="4–6 Ziffern"
        className="luxury-field w-full font-mono tracking-[0.5em]"
      />
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-y-auto bg-canvas-white p-6 text-deep-charcoal">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,var(--editorial-pulse-dim),transparent_55%)]" aria-hidden />

      <div className="relative z-[1] w-full max-w-2xl border border-deep-charcoal/[0.08] bg-gray-100/95 p-8 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.85)] sm:p-10">
        {/* Step indicator */}
        <div className="mb-7 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-[0.18em]">
          {stepLabels.map((label, idx) => (
            <div key={label} className="flex items-center gap-2">
              <span className={`h-1 w-8 ${idx <= step ? "bg-champagne-gold" : "bg-deep-charcoal/15"}`} />
              <span className={idx === step ? "font-semibold text-deep-charcoal" : "text-deep-charcoal/35"}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div>
            <h1 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.2em] sm:text-4xl">
              Willkommen
            </h1>
            <p className="mt-5 text-sm font-light leading-relaxed text-deep-charcoal/70">
              Erste Einrichtung deines Salons. Bitte 4 kurze Schritte durchlaufen.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-deep-charcoal/70">
              <li>1. Salon-Name</li>
              <li>2. Dein Name & PIN als Inhaber</li>
              <li>3. Team-Mitglieder mit eigenem PIN (optional)</li>
            </ul>
            <p className="mt-5 rounded border border-amber-300/50 bg-amber-50/60 p-3 text-xs text-amber-800">
              ⚠ Jede Person erhält einen 4–6-stelligen PIN. Dies erlaubt eindeutige Zuordnung im Verkauf­sprotokoll (GoBD / Revisionssicherheit).
            </p>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="editorial-pulse-fill mt-7 px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] hover:opacity-90"
            >
              Los geht's →
            </button>
          </div>
        )}

        {/* Step 1: Salon name */}
        {step === 1 && (
          <div>
            <h2 className="font-editorial-display text-2xl uppercase tracking-[0.18em] sm:text-3xl">
              Salon-Name
            </h2>
            <p className="mt-3 text-sm text-deep-charcoal/60">
              Wie heißt dein Studio? Dieser Name erscheint im Anmeldebildschirm.
            </p>
            <input
              autoFocus
              value={salonName}
              onChange={(e) => setSalonName(e.target.value)}
              placeholder="z. B. Oliver Roos Frisuren"
              className="luxury-field mt-5 w-full text-base"
            />
            <div className="mt-9 flex justify-between">
              <button type="button" onClick={() => setStep(0)} className="px-4 py-2 text-xs uppercase tracking-wider text-deep-charcoal/50 hover:text-deep-charcoal">← Zurück</button>
              <button type="button" onClick={() => setStep(2)} className="editorial-pulse-fill px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] hover:opacity-90">Weiter →</button>
            </div>
          </div>
        )}

        {/* Step 2: Admin name + PIN */}
        {step === 2 && (
          <div>
            <h2 className="font-editorial-display text-2xl uppercase tracking-[0.18em] sm:text-3xl">
              Inhaber
            </h2>
            <p className="mt-3 text-sm text-deep-charcoal/60">
              Du bist der Inhaber. Voller Zugang auf alle Funktionen.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-light uppercase tracking-[0.2em] text-deep-charcoal/50">Name</label>
                <input
                  autoFocus
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Vor- und Nachname"
                  className="luxury-field w-full text-base"
                />
              </div>
              <PinInput value={adminPin} onChange={setAdminPin} label="PIN (4–6 Ziffern)" />
            </div>

            {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

            <div className="mt-9 flex justify-between">
              <button type="button" onClick={() => setStep(1)} className="px-4 py-2 text-xs uppercase tracking-wider text-deep-charcoal/50 hover:text-deep-charcoal">← Zurück</button>
              <button
                type="button"
                disabled={!!validateAdmin()}
                onClick={() => { setErr(""); setStep(3); }}
                className="editorial-pulse-fill px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] hover:opacity-90 disabled:opacity-40"
              >
                Weiter →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Team + finish */}
        {step === 3 && (
          <div>
            <h2 className="font-editorial-display text-2xl uppercase tracking-[0.18em] sm:text-3xl">
              Team
            </h2>
            <p className="mt-3 text-sm text-deep-charcoal/60">
              Weitere Mitarbeiter hinzufügen (optional). Jeder erhält einen eigenen PIN.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_140px_140px_auto]">
              <input
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addStaffRow(); }}
                placeholder="Name"
                className="luxury-field"
              />
              <select
                value={newStaffRole}
                onChange={(e) => setNewStaffRole(e.target.value as "owner" | "stylist")}
                className="luxury-field luxury-select"
              >
                <option value="stylist">Stylist</option>
                <option value="owner">Inhaber</option>
              </select>
              <input
                inputMode="numeric"
                pattern="\d*"
                maxLength={6}
                value={newStaffPin}
                onChange={(e) => setNewStaffPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="PIN"
                className="luxury-field font-mono tracking-[0.3em]"
              />
              <button
                type="button"
                onClick={addStaffRow}
                disabled={!newStaffName.trim() || !PIN_RE.test(newStaffPin)}
                className="border border-champagne-gold bg-champagne-gold px-4 text-xs font-semibold uppercase tracking-wider text-deep-charcoal disabled:opacity-40"
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
                      <span className="ml-3 text-xs font-mono text-deep-charcoal/35">
                        PIN: {"•".repeat(s.pin.length)}
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

            <div className="mt-9 flex justify-between">
              <button type="button" onClick={() => setStep(2)} className="px-4 py-2 text-xs uppercase tracking-wider text-deep-charcoal/50 hover:text-deep-charcoal">← Zurück</button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="editorial-pulse-fill px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] hover:opacity-90 disabled:opacity-40"
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
