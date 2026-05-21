import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { apiGet, headers } from "../api";
import { formatEurDeFromCents } from "../lib/formatMoney";
import { formatInTimeZone } from "date-fns-tz";
import { subMonths } from "date-fns";
import { BERLIN } from "../lib/formatTime";
import { isTauriShell } from "../lib/deviceContext";
import { isOwnerRole } from "../lib/staffRoles";
import { useAuthStore } from "../store/authStore";
import { luxurySpring, luxurySpringReduced } from "../lib/motionPresets";
import { useUiShellStore } from "../store/uiShellStore";
import { BentoCard } from "../components/molecules/BentoCard";
import { SkeletonCard } from "../components/molecules/SkeletonCard";
import { saveBlobWithTauriDialog } from "../hooks/useTauriSqliteBackup";

type ChefBriefing = {
  businessDateYmd: string;
  timezone: string;
  todayGrossCents: number;
  todayNetCents: number;
  closedInvoicesToday: number;
  appointmentCountToday: number;
  appointmentsBooked: number;
  appointmentsCheckedInOrDone: number;
  cogsEstimateNetCents: number;
  lowStockItems: {
    id: number;
    name: string;
    onHandMl: number;
    minStockThresholdMl: number | null;
  }[];
};

function useBerlinHour(): number {
  const [hour, setHour] = useState(() => parseInt(formatInTimeZone(new Date(), BERLIN, "H"), 10));
  useEffect(() => {
    const tick = () => setHour(parseInt(formatInTimeZone(new Date(), BERLIN, "H"), 10));
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return hour;
}

function heroCopy(berlinHour: number): { title: string; body: string; ctaLabel: string; ctaTo: string } {
  if (berlinHour >= 6 && berlinHour < 11) {
    return {
      title: "Start in den Tag",
      body: "Kassensturz / Tageseröffnung — Umsatz und Termine prüfen, dann ins Live-Dashboard.",
      ctaLabel: "Zum Live-Dashboard",
      ctaTo: "/",
    };
  }
  if (berlinHour >= 11 && berlinHour < 19) {
    return {
      title: "Salon in Betrieb",
      body: "Agenda und Sessions im Blick — bei Bedarf Zwischenstände im Cockpit prüfen.",
      ctaLabel: "Zur Agenda",
      ctaTo: "/agenda",
    };
  }
  return {
    title: "Tagesabschluss vorbereiten",
    body: "Exporte, Backup und Notfall-PDF — rechtzeitig vor Feierabend erledigen.",
    ctaLabel: "Tagesabschluss",
    ctaTo: "/daily-closing",
  };
}

/**
 * Chef-Ansicht — Bento grid + anticipatory hero (Europe/Berlin).
 */
export function AdminDashboard() {
  const staffRole = useAuthStore((s) => s.staffRole);
  const reducedMotion = useUiShellStore((s) => s.prefersReducedMotion);
  const berlinHour = useBerlinHour();
  const hero = useMemo(() => heroCopy(berlinHour), [berlinHour]);

  const [data, setData] = useState<ChefBriefing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [exportMonth, setExportMonth] = useState(() =>
    formatInTimeZone(subMonths(new Date(), 1), BERLIN, "yyyy-MM"),
  );
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const ymdToday = useMemo(
    () => formatInTimeZone(new Date(), BERLIN, "yyyy-MM-dd"),
    [],
  );

  const load = useCallback(async (dateYmd: string) => {
    setErr(null);
    setLoading(true);
    try {
      const q = `/api/reports/chef-briefing?date=${encodeURIComponent(dateYmd)}`;
      const j = await apiGet<ChefBriefing>(q);
      setData(j);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(ymdToday);
  }, [load, ymdToday]);

  const runKassenbuchExport = useCallback(async () => {
    setExportErr(null);
    setExportBusy(true);
    try {
      const base = import.meta.env.VITE_API_BASE ?? "";
      const h = { ...headers() };
      delete h["Content-Type"];
      const url = `${base}/api/finance/export/kassenbuch?month=${encodeURIComponent(exportMonth)}`;
      const r = await fetch(url, { headers: h });
      if (!r.ok) {
        let msg = r.statusText;
        try {
          const j = (await r.json()) as { error?: string; reason?: string };
          msg = (j.reason ?? j.error ?? msg) || msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition");
      let fname = `kassenbuch_${exportMonth.replace("-", "_")}.csv`;
      const m = cd?.match(/filename="([^"]+)"/);
      if (m?.[1]) fname = m[1];
      const urlObj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = urlObj;
      a.download = fname;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(urlObj);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "export_failed");
    } finally {
      setExportBusy(false);
    }
  }, [exportMonth]);

  const [backupBusy, setBackupBusy] = useState(false);
  const [backupErr, setBackupErr] = useState<string | null>(null);

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);

  const runEmergencyDayPdf = useCallback(async () => {
    setPdfErr(null);
    setPdfBusy(true);
    try {
      const base = import.meta.env.VITE_API_BASE ?? "";
      const h = { ...headers() };
      delete h["Content-Type"];
      const url = `${base}/api/reports/emergency-day-pdf?date=${encodeURIComponent(ymdToday)}`;
      const r = await fetch(url, { headers: h });
      if (!r.ok) {
        let msg = r.statusText;
        try {
          const j = (await r.json()) as { error?: string };
          msg = (j.error ?? msg) || msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await r.blob();
      const fname = `OliverRoos_Notfall_${ymdToday}.pdf`;
      const urlObj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = urlObj;
      a.download = fname;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(urlObj);
    } catch (e) {
      setPdfErr(e instanceof Error ? e.message : "pdf_failed");
    } finally {
      setPdfBusy(false);
    }
  }, [ymdToday]);

  const runSqliteBackup = useCallback(async () => {
    setBackupErr(null);
    setBackupBusy(true);
    try {
      const base = import.meta.env.VITE_API_BASE ?? "";
      const h = { ...headers() };
      delete h["Content-Type"];
      const url = `${base}/api/system/backup/sqlite`;
      const r = await fetch(url, { headers: h });
      if (!r.ok) {
        let msg = r.statusText;
        try {
          const j = (await r.json()) as { error?: string; reason?: string };
          msg = (j.reason ?? j.error ?? msg) || msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition");
      let fname = `salon_backup_${formatInTimeZone(new Date(), BERLIN, "yyyy_MM_dd")}.sqlite`;
      const m = cd?.match(/filename="([^"]+)"/);
      if (m?.[1]) fname = m[1];
      if (isTauriShell()) {
        const saved = await saveBlobWithTauriDialog(blob, fname);
        if (!saved) return;
      } else {
        const urlObj = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = urlObj;
        a.download = fname;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(urlObj);
      }
    } catch (e) {
      setBackupErr(e instanceof Error ? e.message : "backup_failed");
    } finally {
      setBackupBusy(false);
    }
  }, []);

  const transition = reducedMotion ? luxurySpringReduced : luxurySpring;
  const bentoContainer = {
    hidden: {},
    show: {
      transition: { staggerChildren: reducedMotion ? 0 : 0.05, delayChildren: reducedMotion ? 0 : 0.04 },
    },
  };
  const bentoItem = {
    hidden: { opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 10 },
    show: { opacity: 1, y: 0, transition },
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 text-deep-charcoal">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-deep-charcoal">Chef-Ansicht</h1>
          <p className="mt-1 text-sm text-brushed-chrome">
            Tagesbriefing (nur Inhaber / Verwaltung) — Daten bei Öffnen geladen, Europe/Berlin.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="min-h-touch rounded-bento border-2 border-brushed-chrome/40 px-5 font-semibold text-deep-charcoal disabled:opacity-50"
            disabled={loading}
            onClick={() => void load(ymdToday)}
          >
            Aktualisieren
          </button>
          <button
            type="button"
            disabled={pdfBusy}
            className="min-h-touch rounded-bento border-2 border-brushed-chrome/50 bg-gray-100/80 px-5 font-bold text-deep-charcoal disabled:opacity-50"
            onClick={() => void runEmergencyDayPdf()}
          >
            {pdfBusy ? "…" : "Tagesplan drucken (Notfall-PDF)"}
          </button>
          {isOwnerRole(staffRole) && (
            <Link
              to="/admin/reports"
              className="inline-flex min-h-touch items-center justify-center rounded-bento border-2 border-oak-wood bg-oak-wood px-6 text-base font-bold text-deep-charcoal no-underline"
            >
              Geschäfts-Cockpit
            </Link>
          )}
          <Link
            to="/admin/wareneingang"
            className="inline-flex min-h-touch items-center justify-center rounded-bento border-2 border-oak-wood/80 bg-oak-wood/15 px-5 text-base font-bold text-deep-charcoal no-underline"
          >
            Wareneingang
          </Link>
          <Link
            to="/admin/settings"
            className="inline-flex min-h-touch items-center justify-center rounded-bento border-2 border-brushed-chrome/40 bg-gray-200/80 px-5 text-base font-bold text-deep-charcoal no-underline"
          >
            Systemkonfiguration
          </Link>
          <Link
            to="/admin/diagnostics"
            className="inline-flex min-h-touch items-center justify-center rounded-bento border-2 border-oak-wood/70 bg-oak-wood/12 px-5 text-base font-bold text-deep-charcoal no-underline"
          >
            Diagnose-Zentrum
          </Link>
          <Link
            to="/"
            className="inline-flex min-h-touch items-center justify-center rounded-bento border-2 border-brushed-chrome/35 px-5 text-base font-semibold text-deep-charcoal no-underline"
          >
            ← Dashboard
          </Link>
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-busy="true" aria-live="polite">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard className="md:col-span-3" lines={4} />
        </div>
      )}

      {err && (
        <div className="mb-4 rounded-bento border border-red-800/70 bg-red-950/40 px-4 py-3 text-red-200">
          {err}
        </div>
      )}
      {pdfErr && (
        <div className="mb-4 rounded-bento border border-red-800/70 bg-red-950/40 px-4 py-3 text-red-200">{pdfErr}</div>
      )}

      {data && !loading && (
        <motion.div
          className="grid auto-rows-min grid-cols-1 gap-4 md:grid-cols-6"
          variants={bentoContainer}
          initial="hidden"
          animate="show"
        >
          <motion.div variants={bentoItem} className="md:col-span-6">
            <BentoCard className="border-champagne-gold/25 bg-gradient-to-br from-deep-charcoal/95 via-matte-black/90 to-deep-charcoal/95">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-champagne-gold/90">Heute · Berlin</p>
              <h2 className="mt-1 font-heading text-2xl font-bold tracking-tight text-deep-charcoal">{hero.title}</h2>
              <p className="mt-2 max-w-3xl text-sm text-brushed-chrome">{hero.body}</p>
              <Link
                to={hero.ctaTo}
                className="mt-4 inline-flex min-h-touch items-center justify-center rounded-bento border-2 border-oak-wood bg-oak-wood px-6 text-base font-bold text-deep-charcoal no-underline"
              >
                {hero.ctaLabel}
              </Link>
            </BentoCard>
          </motion.div>

          <motion.div variants={bentoItem} className="md:col-span-2">
            <BentoCard className="border-oak-wood/40">
              <h2 className="text-sm font-bold uppercase tracking-wide font-heading text-deep-charcoal">Tagesumsatz</h2>
              <p className="mt-1 text-xs text-brushed-chrome">Brutto / Netto (geschlossene Belege, heute)</p>
              <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-deep-charcoal">
                {formatEurDeFromCents(data.todayGrossCents)}
              </p>
              <p className="mt-2 font-mono text-xl tabular-nums text-deep-charcoal">
                {formatEurDeFromCents(data.todayNetCents)}{" "}
                <span className="text-sm text-brushed-chrome">netto</span>
              </p>
              <p className="mt-2 text-xs text-brushed-chrome">
                {data.closedInvoicesToday} Beleg(e) · {data.businessDateYmd}
              </p>
            </BentoCard>
          </motion.div>

          <motion.div variants={bentoItem} className="md:col-span-2">
            <BentoCard>
              <h2 className="text-sm font-bold uppercase tracking-wide font-heading text-deep-charcoal">Termine</h2>
              <p className="mt-1 text-xs text-brushed-chrome">Heute (nicht abgesagt / no-show)</p>
              <p className="mt-3 font-mono text-4xl font-black tabular-nums text-deep-charcoal">
                {data.appointmentCountToday}
              </p>
              <p className="mt-2 text-sm text-brushed-chrome">
                Gebucht: <strong className="text-deep-charcoal">{data.appointmentsBooked}</strong>
              </p>
              <p className="mt-1 text-sm text-brushed-chrome">
                Check-in / erledigt:{" "}
                <strong className="text-deep-charcoal">{data.appointmentsCheckedInOrDone}</strong>
              </p>
            </BentoCard>
          </motion.div>

          <motion.div variants={bentoItem} className="md:col-span-2">
            <BentoCard>
              <h2 className="text-sm font-bold uppercase tracking-wide font-heading text-deep-charcoal">
                COGS (Schätzung)
              </h2>
              <p className="mt-1 text-xs text-brushed-chrome">Netto aus Katalog ml-Preis × Verbrauch heute</p>
              <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-deep-charcoal">
                {formatEurDeFromCents(data.cogsEstimateNetCents)}
              </p>
            </BentoCard>
          </motion.div>

          <motion.div variants={bentoItem} className="md:col-span-6">
            <BentoCard className="border-red-900/50 bg-red-950/20">
              <h2 className="text-lg font-bold font-heading text-red-200">Lagerwarnungen</h2>
              <p className="mt-1 text-sm text-brushed-chrome">Artikel mit Meldeschwelle und Bestand ≤ Schwelle</p>
              {data.lowStockItems.length === 0 ? (
                <p className="mt-4 text-brushed-chrome">Keine kritischen Bestände.</p>
              ) : (
                <ul className="mt-4 divide-y divide-red-900/35">
                  {data.lowStockItems.map((row) => (
                    <li
                      key={row.id}
                      className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 py-4 text-deep-charcoal"
                    >
                      <span className="font-medium">{row.name}</span>
                      <span className="font-mono text-sm tabular-nums text-red-200/95">
                        {row.onHandMl} ml
                        {row.minStockThresholdMl != null && (
                          <span className="text-brushed-chrome"> / ≤ {row.minStockThresholdMl} ml</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </BentoCard>
          </motion.div>
        </motion.div>
      )}

      {!loading && (
        <motion.div
          className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2"
          variants={bentoContainer}
          initial="hidden"
          animate="show"
        >
          <motion.div variants={bentoItem}>
            <BentoCard aria-labelledby="steuer-export-heading">
              <h2 id="steuer-export-heading" className="text-lg font-bold font-heading text-deep-charcoal">
                Steuerberater Export
              </h2>
              <p className="mt-1 text-sm text-brushed-chrome">
                Kassenbuch als CSV (ein Kalendermonat, Europe/Berlin) — Trennzeichen Semikolon,
                Dezimalformat deutsch — für DATEV &amp; Buchhaltung.
              </p>
              <div className="mt-4 flex flex-wrap items-end gap-4">
                <label className="flex flex-col gap-1 text-sm text-brushed-chrome">
                  <span className="font-medium text-deep-charcoal">Abrechnungsmonat</span>
                  <input
                    type="month"
                    className="min-h-touch rounded-bento border-2 border-brushed-chrome/35 bg-gray-100/80 px-4 py-3 font-mono text-deep-charcoal"
                    value={exportMonth}
                    onChange={(e) => setExportMonth(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="min-h-touch min-w-[min(100%,280px)] rounded-bento border-2 border-oak-wood bg-oak-wood px-8 text-lg font-bold text-deep-charcoal disabled:opacity-50"
                  disabled={exportBusy}
                  onClick={() => void runKassenbuchExport()}
                >
                  {exportBusy ? "Export wird vorbereitet…" : "DATEV / CSV Exportieren"}
                </button>
              </div>
              {exportErr && (
                <p className="mt-3 text-sm text-red-300" role="alert">
                  {exportErr}
                </p>
              )}
            </BentoCard>
          </motion.div>

          <motion.div variants={bentoItem}>
            <BentoCard aria-labelledby="system-sicherheit-heading">
              <h2 id="system-sicherheit-heading" className="text-lg font-bold font-heading text-deep-charcoal">
                System &amp; Sicherheit
              </h2>
              <p className="mt-1 text-sm text-brushed-chrome">
                Lokales SQLite-Backup (WAL-konsistente Kopie) — für Disaster Recovery und
                Aufbewahrung außerhalb des Geräts. Nur für Inhaber / Verwaltung.
              </p>
              <button
                type="button"
                className="mt-4 min-h-touch min-w-[min(100%,320px)] rounded-bento border-2 border-oak-wood bg-oak-wood px-8 text-lg font-bold text-deep-charcoal disabled:opacity-50"
                disabled={backupBusy}
                onClick={() => void runSqliteBackup()}
              >
                {backupBusy ? "Backup wird erstellt…" : "Lokales Backup herunterladen"}
              </button>
              {backupErr && (
                <p className="mt-3 text-sm text-red-300" role="alert">
                  {backupErr}
                </p>
              )}
            </BentoCard>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
