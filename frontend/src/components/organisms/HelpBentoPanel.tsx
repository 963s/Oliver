import { motion } from "framer-motion";
import { luxurySpring, luxurySpringReduced } from "../../lib/motionPresets";
import { useUiShellStore } from "../../store/uiShellStore";

const TOPICS: { title: string; accent: string; bullets: string[] }[] = [
  {
    title: "Tagesabschluss",
    accent: "Kassensturz",
    bullets: [
      "Keine offenen Sessions — Rezeption zuerst abschließen.",
      "Bargeld blind zählen, dann Soll‑Anzeige.",
      "Abweichung mit Grund — dann buchen & Z‑Bericht.",
    ],
  },
  {
    title: "Storno",
    accent: "Fiskal",
    bullets: [
      "Nur mit gültiger TSE‑Kette — nie „still“ löschen.",
      "Grund konkret im Audit (Person + Sachverhalt).",
      "Bei TSE pending nicht hart abschalten.",
    ],
  },
  {
    title: "Anonymisierung",
    accent: "Art. 17 DSGVO",
    bullets: [
      "Nur Verwaltungsrolle in der Kundenakte.",
      "Belege bleichen anonymisiert — Klartext wird entfernt.",
      "„Anonymisiert“ gilt auch im Terminraster.",
    ],
  },
  {
    title: "Backup",
    accent: "Notfall",
    bullets: [
      "Chef‑Ansicht: SQLite‑Export oder Desktop‑Pfad.",
      "Systemkonfiguration → externes Backup nach Ordnerwahl.",
      "Diagnose‑Zentrum bei Zweifeln am Standort.",
    ],
  },
  {
    title: "Rezeption",
    accent: "60 Sek.",
    bullets: [
      "TSE‑Ampel · EC an · Agenda geladen.",
      "Inventar kritisch · Backup‑Pfad erreichbar.",
      "Ruhe bewahren — Klartext vor dem Gast.",
    ],
  },
];

/**
 * Bento-style help tiles — used in floating modal (and optional full page).
 */
export function HelpBentoPanel({ className = "" }: { className?: string }) {
  const reduced = useUiShellStore((s) => s.prefersReducedMotion);
  const t = reduced ? luxurySpringReduced : luxurySpring;

  return (
    <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {TOPICS.map((topic, i) => (
        <motion.article
          key={topic.title}
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...t, delay: reduced ? 0 : i * 0.04 }}
          whileHover={reduced ? undefined : { scale: 1.05, y: -2 }}
          className="flex flex-col rounded-2xl border border-deep-charcoal/10 bg-gradient-to-br from-[#2a2826]/95 via-[#1f1d1c]/95 to-[#181616]/98 p-5 shadow-[0_0_40px_rgba(212,175,55,0.06)] ring-1 ring-inset ring-white/[0.05]"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-champagne-gold/75">{topic.accent}</p>
          <h3 className="mt-2 font-heading text-lg font-bold tracking-tight text-deep-charcoal">{topic.title}</h3>
          <ul className="mt-4 space-y-2 text-sm leading-snug text-deep-charcoal/55">
            {topic.bullets.map((b, j) => (
              <li key={`${topic.title}-${j}`} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-champagne-gold/50" aria-hidden />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </motion.article>
      ))}
    </div>
  );
}
