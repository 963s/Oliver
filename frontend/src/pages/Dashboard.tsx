import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { HelpHandbuchModal } from "../components/organisms/HelpHandbuchModal";
import { AnimatedOutlet } from "../components/layout/AnimatedOutlet";
import { formatInTimeZone } from "date-fns-tz";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { BrandMotif } from "../components/brand/BrandMotif";
import { editorialPulseForPath } from "../lib/editorialTheme";
import { GlobalScanListener } from "../GlobalScanListener";
import { OrphanBanner } from "../OrphanBanner";
import { startSalonEventStream } from "../lib/sseClient";
import { FiscalHealthBanner } from "../components/FiscalHealthBanner";
import { useFiscalHealthSync } from "../hooks/useFiscalHealthSync";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import { useVisibilityWakeSync } from "../hooks/useVisibilityWakeSync";
import { useAuthStore } from "../store/authStore";
import { useCatalogStore } from "../store/catalogStore";
import { isOwnerRole, isSalonManagementRole } from "../lib/staffRoles";
import { ClientProfile } from "./ClientProfile";
import { fortressTwiceDailyTick } from "../lib/externalFortressBackup";
import { BERLIN } from "../lib/formatTime";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { AddClientModal } from "../components/ui/AddClientModal";
import { AddServiceModal } from "../components/ui/AddServiceModal";
import { AddProductModal } from "../components/ui/AddProductModal";

function formatNow(): string {
  return new Date().toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Post-login shell: slim sidebar nav + workspace + optional client panel.
 * Desktop-first: dense, mouse-friendly, utilizes full monitor real estate.
 */
export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const rehydrate = useAuthStore((s) => s.rehydrate);
  const isOffline = useAuthStore((s) => s.isOffline);
  const staffRole = useAuthStore((s) => s.staffRole);
  const [clock, setClock] = useState(formatNow());
  const staffName = useMemo(() => localStorage.getItem("or:staffDisplayName") ?? "Team", []);

  const [helpOpen, setHelpOpen] = useState(false);

  // ── Quick-add modals ──────────────────────────────────────────────────────
  const [addClientOpen,  setAddClientOpen]  = useState(false);
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [addProductOpen, setAddProductOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setClock(formatNow()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const lockOut = useCallback(() => {
    logout();
    rehydrate();
    navigate("/login", { replace: true });
  }, [logout, rehydrate, navigate]);

  useIdleTimeout(lockOut, 120_000);
  useFiscalHealthSync();
  useVisibilityWakeSync();

  useEffect(() => {
    const ac = new AbortController();
    startSalonEventStream(ac.signal);
    return () => ac.abort();
  }, []);

  useEffect(() => {
    void useCatalogStore.getState().ensureLoaded().catch(() => {});
  }, []);

  useEffect(() => {
    rehydrate();
  }, [rehydrate]);

  useEffect(() => {
    if (!isSalonManagementRole(staffRole)) return;
    const tick = () => { void fortressTwiceDailyTick(); };
    tick();
    const id = window.setInterval(tick, 90_000);
    return () => window.clearInterval(id);
  }, [staffRole]);

  /** Editorial pulse — exactly one saturated accent domain-wide */
  useEffect(() => {
    const pulse = editorialPulseForPath(location.pathname);
    document.documentElement.dataset.pulse = pulse;
  }, [location.pathname]);

  /** Circadian UI tokens on the document root */
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const h = parseInt(formatInTimeZone(new Date(), BERLIN, "H"), 10);
      root.classList.remove("circadian-peak", "circadian-soft");
      if (h >= 9 && h < 19) root.classList.add("circadian-peak");
      if (h >= 20 || h <= 6) root.classList.add("circadian-soft");
    };
    apply();
    const id = window.setInterval(apply, 60_000);
    return () => {
      clearInterval(id);
      root.classList.remove("circadian-peak", "circadian-soft");
    };
  }, []);

  /* ── Nav classes ── */
  const navBase =
    "flex items-center gap-2.5 rounded-[2px] px-3 py-2 text-[11px] font-light uppercase tracking-[0.18em] text-deep-charcoal/45 no-underline transition-all hover:bg-gray-100/60 hover:text-deep-charcoal/80";
  const navActive =
    "border-l-2 border-editorial-pulse bg-gray-100/60 !text-deep-charcoal/90 font-medium";
  const navFeaturedCls = `${navBase} text-deep-charcoal/70 font-medium`;

  function SidebarLink({
    to, end, children, featured,
  }: { to: string; end?: boolean; children: ReactNode; featured?: boolean }) {
    return (
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
          [
            featured ? navFeaturedCls : navBase,
            !featured && isActive ? navActive : "",
            featured && isActive ? "border-l-2 border-editorial-pulse bg-gray-100/60" : "",
          ]
            .filter(Boolean)
            .join(" ")
        }
      >
        {children}
      </NavLink>
    );
  }

  return (
    <div className="relative z-0 flex h-full min-h-0 flex-row overflow-hidden bg-canvas-white text-deep-charcoal">
      <GlobalScanListener />

      {/* Subtle ambient gradient */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 animate-editorial-silk ambient-silk"
        style={{
          background:
            "radial-gradient(ellipse 90% 55% at 85% -10%, var(--app-accent-dim), transparent 50%), radial-gradient(ellipse 70% 50% at 10% 110%, var(--app-border), transparent 45%)",
        }}
        aria-hidden
      />

      {/* ── Slim Sidebar (220px) ── */}
      <aside
        className="relative z-[1] flex w-[220px] shrink-0 flex-col border-r border-deep-charcoal/[0.06] bg-white/95"
        aria-label="Hauptnavigation"
      >
        {/* Brand header */}
        <div className="border-b border-deep-charcoal/[0.06] px-4 py-4">
          <Link to="/" className="no-underline">
            <div className="flex items-center gap-3">
              <BrandMotif className="h-10 w-12 text-deep-charcoal/50" />
              <div>
                <p className="font-editorial-display text-lg font-normal uppercase leading-none tracking-[0.1em] text-deep-charcoal">
                  Oliver Roos
                </p>
                <p className="mt-1 text-[9px] font-light uppercase tracking-[0.4em] text-deep-charcoal/35">
                  Frisuren
                </p>
              </div>
            </div>
          </Link>
        </div>

        {/* Nav links */}
        <nav className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto px-2 py-3">
          <p className="px-3 mb-1 text-[8px] font-bold uppercase tracking-[0.4em] text-deep-charcoal/25">
            Täglich
          </p>
          <SidebarLink to="/agenda" featured>📅 Agenda</SidebarLink>
          <SidebarLink to="/bookings" featured>➕ Termin buchen</SidebarLink>
          <SidebarLink to="/inventur">📦 Lager</SidebarLink>

          <div className="my-2 border-t border-deep-charcoal/[0.06]" />

          <p className="px-3 mb-1 text-[8px] font-bold uppercase tracking-[0.4em] text-deep-charcoal/25">
            Verwaltung
          </p>
          <SidebarLink to="/" end>Live-Termine</SidebarLink>
          <SidebarLink to="/settings">Einstellungen</SidebarLink>
          <SidebarLink to="/staff-performance">Meine Zahlen</SidebarLink>

          {isSalonManagementRole(staffRole) && (
            <>
              <div className="my-2 border-t border-deep-charcoal/[0.06]" />
              <p className="px-3 mb-1 text-[8px] font-bold uppercase tracking-[0.4em] text-deep-charcoal/25">
                Chef
              </p>
              <SidebarLink to="/admin" featured>Chef-Ansicht</SidebarLink>
              {isOwnerRole(staffRole) && (
                <SidebarLink to="/admin/reports" featured>Cockpit</SidebarLink>
              )}
              <SidebarLink to="/daily-closing">Tagesabschluss</SidebarLink>
            </>
          )}
        </nav>

        {/* ── Quick-Add ─────────────────────────────────────────────────── */}
        <div className="border-t border-deep-charcoal/[0.06] px-2 pt-2 pb-1">
          <p className="mb-1 px-3 text-[9px] font-light uppercase tracking-[0.4em] text-deep-charcoal/30">
            Schnell hinzufügen
          </p>
          <button
            type="button"
            id="sidebar-add-client-btn"
            onClick={() => setAddClientOpen(true)}
            className="flex w-full items-center gap-2 rounded-[2px] px-3 py-1.5 text-[11px] font-light uppercase tracking-[0.18em] text-deep-charcoal/50 transition hover:bg-gray-100/60 hover:text-deep-charcoal/80"
          >
            <span className="text-editorial-pulse font-medium">+</span> Kunde
          </button>
          <button
            type="button"
            id="sidebar-add-service-btn"
            onClick={() => setAddServiceOpen(true)}
            className="flex w-full items-center gap-2 rounded-[2px] px-3 py-1.5 text-[11px] font-light uppercase tracking-[0.18em] text-deep-charcoal/50 transition hover:bg-gray-100/60 hover:text-deep-charcoal/80"
          >
            <span className="text-editorial-pulse font-medium">+</span> Dienst
          </button>
          <button
            type="button"
            id="sidebar-add-product-btn"
            onClick={() => setAddProductOpen(true)}
            className="flex w-full items-center gap-2 rounded-[2px] px-3 py-1.5 text-[11px] font-light uppercase tracking-[0.18em] text-deep-charcoal/50 transition hover:bg-gray-100/60 hover:text-deep-charcoal/80"
          >
            <span className="text-editorial-pulse font-medium">+</span> Produkt
          </button>
        </div>

        {/* Bottom: staff + clock */}
        <div className="border-t border-deep-charcoal/[0.06] px-4 py-3">
          <p className="truncate text-[11px] font-medium uppercase tracking-[0.1em] text-deep-charcoal/60">
            {staffName}
          </p>
          <p className="mt-1 font-mono text-[11px] tabular-nums tracking-[0.2em] text-editorial-pulse/80">
            {clock}
          </p>
        </div>
      </aside>

      {/* ── Main workspace ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <FiscalHealthBanner />
        {isOffline && (
          <div
            className="flex shrink-0 items-center justify-center border-b border-oak-wood bg-oak-wood px-4 py-1 text-xs font-semibold text-deep-charcoal"
            role="status"
          >
            Offline — Reconnecting…
          </div>
        )}

        {/* Compact topbar */}
        <header className="shrink-0 border-b border-deep-charcoal/[0.06] bg-white/80 px-5 py-2.5">
          <div className="flex items-center justify-between gap-4">
            <OrphanBanner />
            <div className="flex shrink-0 items-center gap-1.5">
              {/* Dark / light mode toggle */}
              <ThemeToggle />

              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="inline-flex h-7 w-7 items-center justify-center border border-deep-charcoal/[0.08] text-[13px] text-editorial-pulse/70 transition hover:border-deep-charcoal/20 hover:bg-gray-100/60 hover:text-editorial-pulse"
                aria-label="Kurzhandbuch öffnen"
                title="Kurzhandbuch"
              >
                ?
              </button>
              <button
                type="button"
                onClick={lockOut}
                className="inline-flex h-7 items-center border border-deep-charcoal/[0.08] px-3 text-[10px] font-medium uppercase tracking-wider text-deep-charcoal/40 transition hover:bg-gray-100/60 hover:text-deep-charcoal/70"
              >
                Lock
              </button>
            </div>
          </div>
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <AnimatedOutlet />
        </main>
      </div>

      <HelpHandbuchModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ClientProfile />

      {/* ── Quick-Add modals ── */}
      <AddClientModal  open={addClientOpen}  onClose={() => setAddClientOpen(false)}  />
      <AddServiceModal open={addServiceOpen} onClose={() => setAddServiceOpen(false)} />
      <AddProductModal open={addProductOpen} onClose={() => setAddProductOpen(false)} />
    </div>
  );
}
