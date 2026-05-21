import { useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { useClient360Store } from "../store/client360Store";
import { luxurySpring, luxurySpringReduced } from "../lib/motionPresets";
import { useUiShellStore } from "../store/uiShellStore";
import { luxuryButtonPrimary, luxuryFieldClass, luxuryGlassPanel } from "../lib/luxuryUi";

type ClientSearchRow = {
  id: number;
  name: string;
  phone: string | null;
};

/**
 * Spontaner Gast: optional Anzeigename, eine große Startfläche — danach Spiegelkarte.
 */
export function WalkInView() {
  const navigate = useNavigate();
  const openClientProfile = useClient360Store((s) => s.openProfile);
  const reduced = useUiShellStore((s) => s.prefersReducedMotion);
  const transition = reduced ? luxurySpringReduced : luxurySpring;
  const listVariants = {
    hidden: {},
    show: { transition: { staggerChildren: reduced ? 0 : 0.05 } },
  };
  const rowVariants = {
    hidden: { opacity: reduced ? 1 : 0, x: reduced ? 0 : -6 },
    show: { opacity: 1, x: 0, transition },
  };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ClientSearchRow[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

  const start = () => {
    setBusy(true);
    setErr("");
    const trimmed = name.trim();
    void apiPost<{ id?: number }>("/api/sessions", {
      walkInClientName: trimmed.length > 0 ? trimmed : undefined,
    })
      .then((row) => {
        const sid = row != null && typeof row === "object" && typeof row.id === "number" ? row.id : null;
        if (sid == null) {
          setErr("Server-Antwort ohne Session-ID.");
          return;
        }
        navigate(`/mirror?session=${sid}`, { replace: true });
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };

  const runSearch = () => {
    const q = query.trim();
    if (q.length < 1) return;
    setSearchBusy(true);
    setErr("");
    void apiGet<ClientSearchRow[]>(`/api/clients/search?q=${encodeURIComponent(q)}`)
      .then((rows) => setMatches(rows))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setSearchBusy(false));
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <div className={`p-6 md:p-8 ${luxuryGlassPanel}`}>
        <p className="text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">Empfang</p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-deep-charcoal">Walk-in</h1>
        <p className="mt-3 text-base leading-relaxed text-deep-charcoal/45">
          Spontaner Kunde: optional Name, dann Sitzung starten — sofort in die Spiegelkarte.
          Mit <strong className="text-deep-charcoal/80">Termin</strong> zuerst unter{" "}
          <Link to="/bookings" className="font-semibold text-champagne-gold/90 no-underline hover:text-champagne-gold">
            Termine
          </Link>{" "}
          einchecken.
        </p>

        <label htmlFor="wi-name" className="mt-10 block text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">
          Name des Kunden (optional)
        </label>
        <input
          id="wi-name"
          className={`mt-3 min-h-[72px] w-full rounded-2xl px-5 py-4 text-2xl font-semibold text-deep-charcoal placeholder:text-deep-charcoal/25 ${luxuryFieldClass}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) start();
          }}
          autoComplete="off"
          autoCapitalize="words"
          placeholder="z. B. Maria"
          maxLength={200}
          disabled={busy}
          aria-label="Name des Kunden, optional"
        />

        {err && (
          <p className="mt-4 rounded-xl border border-red-800/80 bg-red-950/45 px-4 py-3 text-sm text-red-100" role="alert">
            {err}
          </p>
        )}

        <button
          type="button"
          className={`mt-10 flex w-full min-h-[72px] items-center justify-center ${luxuryButtonPrimary} text-xl font-bold`}
          disabled={busy}
          onClick={start}
        >
          {busy ? "…" : "Sitzung starten"}
        </button>
      </div>

      <section className={`mt-8 p-6 md:p-8 ${luxuryGlassPanel}`}>
        <p className="text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">CRM</p>
        <h2 className="mt-2 font-heading text-xl font-bold text-deep-charcoal">Kundenakte öffnen</h2>
        <p className="mt-2 text-sm text-deep-charcoal/45">
          Kontextsprung: bestehende Kunden direkt öffnen (Slide-over).
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <input
            className={`min-h-touch min-w-0 flex-1 rounded-2xl px-4 py-3 text-base ${luxuryFieldClass}`}
            placeholder="Name, Telefon, E-Mail"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !searchBusy) runSearch();
            }}
          />
          <button
            type="button"
            className={`min-h-touch shrink-0 px-8 ${luxuryButtonPrimary}`}
            disabled={searchBusy || query.trim().length < 1}
            onClick={runSearch}
          >
            {searchBusy ? "…" : "Suchen"}
          </button>
        </div>
        {matches.length > 0 && (
          <motion.ul
            className="mt-5 space-y-3"
            variants={listVariants}
            initial="hidden"
            animate="show"
          >
            {matches.map((m) => (
              <motion.li
                key={m.id}
                variants={rowVariants}
                className="flex min-h-touch flex-wrap items-center justify-between gap-3 rounded-2xl border border-deep-charcoal/10 bg-gray-200/50 px-4 py-4 shadow-[0_0_40px_rgba(212,175,55,0.06)] backdrop-blur-2xl"
              >
                <div>
                  <p className="text-lg font-bold text-deep-charcoal">{m.name}</p>
                  <p className="text-xs uppercase tracking-wider text-deep-charcoal/40">{m.phone ?? "—"}</p>
                </div>
                <button
                  type="button"
                  className="min-h-touch rounded-2xl border border-deep-charcoal/15 bg-gray-200/50 px-5 text-sm font-semibold text-deep-charcoal backdrop-blur-md"
                  onClick={() => openClientProfile(m.id)}
                >
                  Kundenakte
                </button>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </section>

      <p className="mt-8 text-sm text-deep-charcoal/40 no-print">
        <Link to="/" className="font-medium text-champagne-gold/90 no-underline hover:text-champagne-gold">
          ← Live-Termine
        </Link>
      </p>
    </div>
  );
}
