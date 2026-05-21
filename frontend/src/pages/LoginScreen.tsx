import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { http } from "../lib/apiClient";
import { luxurySpring, luxurySpringReduced } from "../lib/motionPresets";
import { useAuthStore } from "../store/authStore";
import { useUiShellStore } from "../store/uiShellStore";
import { PinPad } from "../components/ui/PinPad";

type DirRow = { id: number; displayName: string; role: string };
type AuthMode = "name_select" | "pin";

type LoginRes = {
  token: string;
  staff: { id: number; displayName: string; role: string };
};

type SetupStatus = {
  needsOnboarding: boolean;
  salonName: string;
  authMode: AuthMode;
  staffCount: number;
};

/**
 * Two modes (configured in onboarding / admin settings):
 *   name_select — Click your name, you're in (no PIN).
 *   pin         — Click your name, enter 4–6 digit PIN.
 */
export function LoginScreen() {
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const rehydrate = useAuthStore((s) => s.rehydrate);
  const reduced = useUiShellStore((s) => s.prefersReducedMotion);
  const tapTransition = reduced ? luxurySpringReduced : luxurySpring;

  const [dir, setDir] = useState<DirRow[]>([]);
  const [pick, setPick] = useState<DirRow | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("name_select");
  const [salonName, setSalonName] = useState("");

  useEffect(() => {
    document.documentElement.dataset.pulse = "saffron";
    return () => { delete document.documentElement.dataset.pulse; };
  }, []);

  useEffect(() => {
    // Setup status determines auth mode and salon name
    void http.get<SetupStatus>("/api/system/setup-status").then((r) => {
      setAuthMode(r.data.authMode);
      setSalonName(r.data.salonName || "");
    }).catch(() => { /* keep defaults */ });

    void http
      .get<DirRow[]>("/api/auth/directory")
      .then((r) => setDir(r.data))
      .catch((e: Error) => {
        if (e.message === "trusted_device_required") {
          setErr("Gerät nicht vertrauenswürdig — zuerst koppeln (Pairing).");
        } else {
          setErr("Verzeichnis nicht erreichbar.");
        }
      });
  }, []);

  const append = (d: string) => {
    if (pin.length >= 6) return;
    setPin((p) => p + d);
    setErr("");
  };
  const backspace = () => { setPin((p) => p.slice(0, -1)); setErr(""); };
  const clear     = () => { setPin(""); setErr(""); };

  const finishLogin = (data: LoginRes) => {
    localStorage.setItem("or:authToken", data.token);
    localStorage.setItem("or:staffId", String(data.staff.id));
    localStorage.setItem("or:staffRole", data.staff.role);
    localStorage.setItem("or:staffDisplayName", data.staff.displayName);
    setAuthenticated(true);
    rehydrate();
    navigate("/", { replace: true });
  };

  const submitPin = () => {
    if (!pick) { setErr("Mitarbeiter wählen."); return; }
    if (pin.length < 4) { setErr("PIN mindestens 4 Ziffern."); return; }
    setBusy(true);
    setErr("");
    void http
      .post<LoginRes>("/api/auth/pin-login", { staffId: pick.id, pin })
      .then((r) => finishLogin(r.data))
      .catch((e: Error) => {
        if (e.message === "too_many_pin_attempts") {
          setErr("Zu viele Fehlversuche — 15 Min. warten.");
        } else {
          setErr("PIN falsch oder Konto inaktiv.");
        }
      })
      .finally(() => setBusy(false));
  };

  /** Name-select mode: one-tap login. */
  const selectStaff = (staff: DirRow) => {
    if (authMode === "pin") {
      setPick(staff); setPin(""); setErr("");
      return;
    }
    setBusy(true); setErr("");
    void http
      .post<LoginRes>("/api/auth/select-staff", { staffId: staff.id })
      .then((r) => finishLogin(r.data))
      .catch((e: Error) => {
        setErr(e.message === "invalid_staff" ? "Mitarbeiter inaktiv." : "Anmeldung fehlgeschlagen.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-y-auto bg-canvas-white p-6 text-deep-charcoal">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,var(--editorial-pulse-dim),transparent_55%)]" aria-hidden />
      <div className="relative z-[1] w-full max-w-md border border-deep-charcoal/[0.08] bg-gray-100/90 p-10 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.85)]">
        <h1 className="font-editorial-display text-4xl font-normal uppercase tracking-[0.22em] text-deep-charcoal">
          {salonName || "Studio"}
        </h1>
        <p className="mt-6 max-w-[16rem] text-xs font-light uppercase leading-loose tracking-[0.4em] text-deep-charcoal/40">
          {authMode === "pin"
            ? "Anmeldung mit PIN"
            : "Bitte Namen wählen"}
        </p>

        {!pick ? (
          <div className="mt-8">
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
              {dir.length === 0 && !err && (
                <p className="text-sm text-deep-charcoal/40">Lade Mitarbeiter ...</p>
              )}
              {dir.map((s) => (
                <motion.button
                  key={s.id}
                  type="button"
                  className="flex min-h-16 items-center justify-between rounded-bento border border-brushed-chrome/35 bg-gray-100/80 px-5 text-left text-lg text-deep-charcoal disabled:opacity-50"
                  whileTap={reduced ? undefined : { scale: 0.98 }}
                  transition={tapTransition}
                  disabled={busy}
                  onClick={() => selectStaff(s)}
                >
                  <strong>{s.displayName}</strong>
                  <span className="text-sm uppercase tracking-wider text-deep-charcoal/40">
                    {s.role === "owner" ? "Inhaber" : "Stylist"}
                  </span>
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          // PIN entry — only reached when authMode='pin'
          <div className="mt-6">
            <button
              type="button"
              className="text-champagne-gold/90 hover:text-champagne-gold"
              onClick={() => { setPick(null); clear(); }}
            >
              ← Andere Person
            </button>
            <p className="mt-4 text-lg text-deep-charcoal">
              PIN für <strong>{pick.displayName}</strong>
            </p>
            <div className="mt-4 flex justify-center">
              <PinPad
                pinLength={pin.length}
                onDigit={append}
                onBackspace={backspace}
                onSubmit={submitPin}
                onClear={clear}
                disabled={busy}
              />
            </div>
          </div>
        )}

        {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
      </div>
    </div>
  );
}
