import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http } from "../lib/apiClient";
import { luxuryButtonPrimary, luxuryFieldClass } from "../lib/luxuryUi";
import { useAuthStore } from "../store/authStore";

type PairRes = { deviceToken: string; deviceId: number; deviceName: string };

function isLocalhostHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

/**
 * Redeems owner-issued pairing token. On localhost + non-production API, dev browser trust is offered.
 */
export function PairingScreen() {
  const navigate = useNavigate();
  const setDeviceToken = useAuthStore((s) => s.setDeviceToken);
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("Kasse");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [devBusy, setDevBusy] = useState(false);
  const [devErr, setDevErr] = useState("");
  const autoDevTried = useRef(false);
  /** null = checking */
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);

  useEffect(() => {
    document.documentElement.dataset.pulse = "violet";
    return () => {
      delete document.documentElement.dataset.pulse;
    };
  }, []);

  useEffect(() => {
    const ping = () => {
      void fetch("/api/health", { cache: "no-store", method: "GET" })
        .then((r) => setApiReachable(r.ok))
        .catch(() => setApiReachable(false));
    };
    ping();
    const id = window.setInterval(ping, 2500);
    return () => window.clearInterval(id);
  }, []);

  const applyDevPair = () => {
    setDevBusy(true);
    setDevErr("");
    void http
      .post<PairRes>("/api/auth/dev-pair-browser", {})
      .then((res) => {
        setDeviceToken(res.data.deviceToken);
        navigate("/login", { replace: true });
      })
      .catch(() => {
        setDevErr(
          "Backend nicht erreichbar oder Produktion (NODE_ENV=production). Im Projektordner: npm run dev:backend",
        );
      })
      .finally(() => setDevBusy(false));
  };

  useEffect(() => {
    if (!import.meta.env.DEV || !isLocalhostHost() || autoDevTried.current) return;
    autoDevTried.current = true;
    void http
      .post<PairRes>("/api/auth/dev-pair-browser", {})
      .then((res) => {
        setDeviceToken(res.data.deviceToken);
        navigate("/login", { replace: true });
      })
      .catch(() => {
        /* production API or dev route disabled — user pairs manually */
      });
  }, [navigate, setDeviceToken]);

  const submit = () => {
    const pairingToken = code.trim();
    if (!pairingToken) {
      setErr("Pairing-Code eingeben (vom Inhaber).");
      return;
    }
    setBusy(true);
    setErr("");
    void http
      .post<PairRes>("/api/auth/pair", { pairingToken, deviceName: deviceName.trim() || "Kasse" })
      .then((res) => {
        setDeviceToken(res.data.deviceToken);
        navigate("/login", { replace: true });
      })
      .catch((e: Error) => {
        if (e.message === "already_paired") {
          setErr("Dieser Code wurde schon verwendet. Neuen Code vom Inhaber anfordern.");
        } else if (e.message === "invalid_pairing_token") {
          setErr("Ungültiger Code. Prüfen und erneut eingeben.");
        } else {
          setErr(
            "Kopplung fehlgeschlagen. Backend läuft? Im Projektordner: npm run dev:backend — dann Seite neu laden.",
          );
        }
      })
      .finally(() => setBusy(false));
  };

  const showLocalDev = isLocalhostHost();

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-y-auto bg-canvas-white p-6 text-deep-charcoal">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_85%_45%_at_70%_-5%,var(--editorial-pulse-dim),transparent_50%)]" />
      <div className={`relative z-[1] w-full max-w-md border border-deep-charcoal/[0.08] bg-gray-100/90 p-9 md:p-11 `}>
        <h1 className="font-editorial-display text-4xl font-normal uppercase tracking-[0.18em] text-deep-charcoal">
          Kopplung
        </h1>
        <p className="mt-6 max-w-[18rem] text-[11px] font-light uppercase leading-loose tracking-[0.4em] text-deep-charcoal/42">
          Oliver Roos Frisuren
        </p>
        <p className="mt-8 text-[13px] font-light tracking-[0.18em] text-deep-charcoal/52">
          Code vom Studio oder lokales Setup.
        </p>

        {apiReachable === false && (
          <div
            className="mt-5 rounded-luxury-md border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm leading-snug text-red-100"
            role="alert"
          >
            <strong className="font-semibold">Keine Verbindung zum API.</strong>
            <br />
            Terminal öffnen, ins Projekt wechseln (
            <code className="rounded bg-gray-300/80 px-1 text-xs">cd ~/Desktop/oliver-roos-pos</code>) und{" "}
            <code className="rounded bg-gray-300/80 px-1 text-xs">npm run dev:backend</code> starten. Danach diese Seite
            neu laden.
          </div>
        )}
        {apiReachable === true && (
          <p className="mt-4 text-xs text-emerald-400/90" role="status">
            API erreichbar — du kannst koppeln oder einloggen.
          </p>
        )}

        {showLocalDev && (
          <div className="mt-6 rounded-luxury-md border border-editorial-pulse bg-[var(--editorial-pulse-dim)] p-4 ">
            <p className="text-xs font-normal uppercase tracking-[0.35em] text-editorial-pulse">Lokal</p>
            <p className="mt-1 text-xs leading-relaxed text-deep-charcoal/45">
              Ohne Inhaber-Code — nur wenn das API{" "}
              <strong className="text-deep-charcoal/55">nicht</strong> mit{" "}
              <code className="rounded bg-gray-800/35 px-1">NODE_ENV=production</code> läuft.
            </p>
            <button
              type="button"
              disabled={devBusy || apiReachable === false}
              className={`mt-4 w-full ${luxuryButtonPrimary}`}
              onClick={applyDevPair}
            >
              {devBusy ? "…" : "Browser vertrauen (ohne Code)"}
            </button>
            {devErr && <p className="mt-2 text-xs text-red-300">{devErr}</p>}
          </div>
        )}

        <label className="mt-8 block text-sm font-medium text-deep-charcoal/50" htmlFor="pair-code">
          Pairing-Code
        </label>
        <input
          id="pair-code"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={`mt-2 ${luxuryFieldClass} font-mono`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Einfügen"
        />
        <label className="mt-5 block text-sm font-medium text-deep-charcoal/50" htmlFor="dev-name">
          Gerätename (optional)
        </label>
        <input id="dev-name" className={`mt-2 ${luxuryFieldClass}`} value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
        {err && <p className="mt-4 text-sm text-red-300">{err}</p>}
        <button
          type="button"
          disabled={busy || apiReachable === false}
          className={`mt-8 w-full ${luxuryButtonPrimary}`}
          onClick={submit}
        >
          {busy ? "…" : "Kopplung starten"}
        </button>
      </div>
    </div>
  );
}
