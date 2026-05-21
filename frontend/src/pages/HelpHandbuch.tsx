import { Link } from "react-router-dom";
import { HelpBentoPanel } from "../components/organisms/HelpBentoPanel";

/** Full-page handbook — same Bento content as floating Help (deep links / bookmarks). */
export function HelpHandbuch() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-8 text-deep-charcoal">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-oak-wood">Handbuch</p>
          <h1 className="mt-1 text-3xl font-bold font-heading">Das Handbuch · Kurzantworten</h1>
          <p className="mt-2 text-brushed-chrome">
            Gleiche Inhalte wie über das <strong className="text-deep-charcoal">?</strong> oben rechts — hier als Vollseite.
          </p>
        </div>
        <Link
          to="/"
          className="min-h-touch border-2 border-brushed-chrome px-8 font-semibold text-deep-charcoal no-underline transition hover:scale-[1.02]"
        >
          ← Dashboard
        </Link>
      </div>
      <HelpBentoPanel />
      <p className="mt-10 text-center text-xs text-brushed-chrome">
        Oliver Roos Salon Suite — Dokumentierte Schritte 29–50 siehe Projektakte.
      </p>
    </div>
  );
}
