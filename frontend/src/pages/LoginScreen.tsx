import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { http } from "../lib/apiClient";
import { luxurySpring, luxurySpringReduced } from "../lib/motionPresets";
import { useAuthStore } from "../store/authStore";
import { useUiShellStore } from "../store/uiShellStore";
import { PinPad } from "../components/ui/PinPad";

type DirRow = { id: number; displayName: string; role: string };

type PinLoginRes = {
  token: string;
  staff: { id: number; displayName: string; role: string };
};

/**
 * Staff directory + PIN entry; posts to /api/auth/pin-login. Presentation only.
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

  useEffect(() => {
    document.documentElement.dataset.pulse = "saffron";
    return () => {
      delete document.documentElement.dataset.pulse;
    };
  }, []);

  useEffect(() => {
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

  const backspace = () => {
    setPin((p) => p.slice(0, -1));
    setErr("");
  };

  const clear = () => {
    setPin("");
    setErr("");
  };

  const submit = () => {
    if (!pick) {
      setErr("Mitarbeiter wählen.");
      return;
    }
    if (pin.length < 4) {
      setErr("PIN mindestens 4 Ziffern.");
      return;
    }
    setBusy(true);
    setErr("");
    void http
      .post<PinLoginRes>("/api/auth/pin-login", { staffId: pick.id, pin })
      .then((r) => {
        const data = r.data;
        localStorage.setItem("or:authToken", data.token);
        localStorage.setItem("or:staffId", String(data.staff.id));
        localStorage.setItem("or:staffRole", data.staff.role);
        localStorage.setItem("or:staffDisplayName", data.staff.displayName);
        setAuthenticated(true);
        rehydrate();
        navigate("/", { replace: true });
      })
      .catch((e: Error) => {
        if (e.message === "too_many_pin_attempts") {
          setErr("Zu viele Fehlversuche — 15 Min. warten.");
        } else {
          setErr("PIN falsch oder Konto inaktiv.");
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-y-auto bg-canvas-white p-6 text-deep-charcoal">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,var(--editorial-pulse-dim),transparent_55%)]"
        aria-hidden
      />
      <div className="relative z-[1] w-full max-w-md border border-deep-charcoal/[0.08] bg-gray-100/90 p-10 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.85)] backdrop-blur-xl">
        <h1 className="font-editorial-display text-4xl font-normal uppercase tracking-[0.22em] text-deep-charcoal">Studio</h1>
        <p className="mt-6 max-w-[16rem] text-[11px] font-light uppercase leading-loose tracking-[0.45em] text-deep-charcoal/40">
          Oliver Roos Frisuren
        </p>
        <p className="mt-10 text-[13px] font-light tracking-[0.2em] text-deep-charcoal/55">PIN · 4–6 Ziffern</p>

        {!pick ? (
          <div className="mt-6">
            <p className="text-sm text-brushed-chrome">Mitarbeiter wählen</p>
            <div className="mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto">
              {dir.map((s) => (
                <motion.button
                  key={s.id}
                  type="button"
                  className="flex min-h-14 items-center justify-between rounded-bento border border-brushed-chrome/35 bg-gray-100/80 px-4 text-left text-lg text-deep-charcoal"
                  whileTap={reduced ? undefined : { scale: 0.98 }}
                  transition={tapTransition}
                  onClick={() => {
                    setPick(s);
                    setPin("");
                    setErr("");
                  }}
                >
                  <strong>{s.displayName}</strong>
                  <span className="text-sm text-brushed-chrome">{s.role}</span>
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <button
              type="button"
              className="text-champagne-gold/90 hover:text-champagne-gold"
              onClick={() => {
                setPick(null);
                clear();
              }}
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
                onSubmit={submit}
                onClear={clear}
                disabled={busy}
              />
            </div>
          </div>
        )}

        {err && <p className="mt-4 text-sm text-red-300">{err}</p>}
      </div>
    </div>
  );
}
