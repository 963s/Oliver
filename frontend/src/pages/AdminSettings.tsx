import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../api";
import { isTauriShell } from "../lib/deviceContext";
import {
  fetchExternalBackupSettings,
  patchExternalBackupSettings,
  reportExternalFortressSyncResult,
  runExternalFortressBackup,
  type ExternalBackupSchedule,
  type ExternalBackupSettings,
} from "../lib/externalFortressBackup";
import { formatBerlinDateTime } from "../lib/formatTime";
import { useCatalogStore } from "../store/catalogStore";
import { LuxuryToggle } from "../components/atoms/LuxuryToggle";
import { LuxurySelectMenu } from "../components/ui/LuxurySelectMenu";
import { luxuryGlassFloat } from "../lib/luxuryUi";
import { luxurySpring, luxurySpringReduced } from "../lib/motionPresets";
import { useUiShellStore } from "../store/uiShellStore";
import { UpdateSettingsCard } from "../components/UpdateSettingsCard";

type StaffRow = {
  id: number;
  displayName: string;
  role: string;
  active: boolean;
  createdAt?: string;
};

type CatalogRow = {
  id: number;
  serviceName: string;
  durationMinutes: number;
  referenceNetCents: number;
  vatRateBps: number;
  catalogActive: boolean;
  inventoryItemId: number | null;
  deductMl: number | null;
};

type FeatureRow = { key: string; value: string };
type HardwareSettings = {
  paymentTerminalIp: string;
  paymentTerminalPort: string;
  paymentAutoLink: boolean;
  printerIp: string;
  printerPort: string;
  printerAutoPrint: boolean;
};

/** Lesbare Bezeichnung für `system_settings` Keys (Chef-Screen). */
const FEATURE_LABEL_DE: Record<string, string> = {
  fiskaly_enabled: "Fiskaly Cloud TSE aktiv",
  tse_provider_type: "TSE-Anbieter-Typ",
  feature_zvt_verbose_logs: "ZVT ausführliche Logs",
  feature_inventory_low_stock_banner: "Banner: Mindesbestände",
  feature_client360_patch_test: "Kundenakte · Allergietest-Hinweis",
  feature_client360_privacy_toggle: "Kundenakte · Datenschutz-Modus (Unschärfe)",
  feature_client360_hospitality: "Kundenakte · Bewirtung & Präferenzen",
  feature_client360_loyalty_badge: "Kundenakte · Treue-Badge",
  feature_client360_anonymize_button: "Kundenakte · Anonymisieren-Button",
  commission_service_bps: "Provision Leistungen (bps, max. 9000)",
  commission_retail_bps: "Provision Produkt-/Retail-Zeilen (bps, max. 9000)",
};

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "stylist", label: "Stylist" },
  { value: "cashier", label: "Kasse" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Inhaber" },
];

const VAT_RATE_OPTIONS: { value: string; label: string }[] = [
  { value: "1900", label: "19 %" },
  { value: "700", label: "7 %" },
];

const TSE_PROVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: "HARDWARE_PRINTER", label: "HARDWARE_PRINTER" },
  { value: "FISKALY_CLOUD", label: "FISKALY_CLOUD" },
];

const FEATURE_ON_OFF_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "Aus" },
  { value: "1", label: "An" },
];

const BACKUP_SCHEDULE_OPTIONS: { value: ExternalBackupSchedule; label: string }[] = [
  { value: "daily_after_close", label: "Täglich nach gebuchtem Tagesabschluss (automatisch)" },
  { value: "twice_daily", label: "Zweimal täglich (Morgens & Abends, automatisch)" },
  { value: "manual", label: "Nur manuell („Jetzt synchronisieren“)" },
];

function eurosInputToNetCents(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function netCentsToEurosLabel(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function isBinaryFlagSetting(f: FeatureRow): boolean {
  if (f.key === "tse_provider_type" || f.key.startsWith("commission_")) return false;
  return f.value === "0" || f.value === "1";
}

export function AdminSettings() {
  const [tab, setTab] = useState<"team" | "services" | "system" | "hardware" | "backup">("team");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [staffErr, setStaffErr] = useState<string | null>(null);
  const [staffBusy, setStaffBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("stylist");
  const [newPin, setNewPin] = useState("");

  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [catErr, setCatErr] = useState<string | null>(null);
  const [catBusy, setCatBusy] = useState(false);
  const [svcName, setSvcName] = useState("");
  const [svcDur, setSvcDur] = useState("30");
  const [svcNetEur, setSvcNetEur] = useState("");
  const [svcVat, setSvcVat] = useState<"1900" | "700">("1900");

  const [editId, setEditId] = useState<number | null>(null);
  const [editNetEur, setEditNetEur] = useState("");
  const [editDur, setEditDur] = useState("");
  const [editVat, setEditVat] = useState<"1900" | "700">("1900");
  const [editActive, setEditActive] = useState(true);

  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [featErr, setFeatErr] = useState<string | null>(null);

  const [bk, setBk] = useState<ExternalBackupSettings | null>(null);
  const [bkErr, setBkErr] = useState<string | null>(null);
  const [bkBusy, setBkBusy] = useState(false);
  const [hw, setHw] = useState<HardwareSettings>({
    paymentTerminalIp: "",
    paymentTerminalPort: "",
    paymentAutoLink: false,
    printerIp: "",
    printerPort: "",
    printerAutoPrint: false,
  });
  const [hwBusy, setHwBusy] = useState(false);
  const [hwErr, setHwErr] = useState<string | null>(null);
  const [hwMsg, setHwMsg] = useState<string | null>(null);

  const invalidateCatalog = useCatalogStore((s) => s.invalidate);
  const reduced = useUiShellStore((s) => s.prefersReducedMotion);
  const tabTransition = reduced ? luxurySpringReduced : luxurySpring;

  const loadStaff = useCallback(async () => {
    setStaffErr(null);
    try {
      const rows = await apiGet<StaffRow[]>("/api/staff");
      setStaff(rows);
    } catch (e) {
      setStaffErr(e instanceof Error ? e.message : "load_failed");
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatErr(null);
    setCatBusy(true);
    try {
      const rows = await apiGet<CatalogRow[]>("/api/admin/catalog/services");
      setCatalog(rows);
    } catch (e) {
      setCatErr(e instanceof Error ? e.message : "load_failed");
    } finally {
      setCatBusy(false);
    }
  }, []);

  const loadFeatures = useCallback(async () => {
    setFeatErr(null);
    try {
      const rows = await apiGet<FeatureRow[]>("/api/admin/settings/features");
      setFeatures(rows);
    } catch (e) {
      setFeatErr(e instanceof Error ? e.message : "load_failed");
    }
  }, []);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    if (tab === "services") void loadCatalog();
  }, [tab, loadCatalog]);

  useEffect(() => {
    if (tab === "system") void loadFeatures();
  }, [tab, loadFeatures]);

  const loadBackup = useCallback(async () => {
    setBkErr(null);
    try {
      const s = await fetchExternalBackupSettings();
      setBk(s);
    } catch (e) {
      setBkErr(e instanceof Error ? e.message : "load_failed");
    }
  }, []);

  useEffect(() => {
    if (tab === "backup") void loadBackup();
  }, [tab, loadBackup]);

  const loadHardware = useCallback(async () => {
    setHwErr(null);
    try {
      const r = await apiGet<HardwareSettings>("/api/admin/settings/hardware");
      setHw(r);
    } catch (e) {
      setHwErr(e instanceof Error ? e.message : "load_failed");
    }
  }, []);

  useEffect(() => {
    if (tab === "hardware") void loadHardware();
  }, [tab, loadHardware]);

  const createStaff = async () => {
    setStaffBusy(true);
    setStaffErr(null);
    try {
      await apiPost("/api/admin/staff", {
        displayName: newName.trim(),
        role: newRole,
        pin: newPin.trim(),
      });
      setNewName("");
      setNewPin("");
      await loadStaff();
    } catch (e) {
      setStaffErr(e instanceof Error ? e.message : "create_failed");
    } finally {
      setStaffBusy(false);
    }
  };

  const toggleStaffActive = async (row: StaffRow) => {
    setStaffBusy(true);
    setStaffErr(null);
    try {
      await apiPatch(`/api/admin/staff/${row.id}`, {
        active: !row.active,
      });
      await loadStaff();
    } catch (e) {
      setStaffErr(e instanceof Error ? e.message : "update_failed");
    } finally {
      setStaffBusy(false);
    }
  };

  const createService = async () => {
    const net = eurosInputToNetCents(svcNetEur);
    if (net == null) {
      setCatErr("Nettopreis ungültig.");
      return;
    }
    const dm = Math.floor(Number.parseInt(svcDur, 10));
    if (!Number.isFinite(dm) || dm < 5) {
      setCatErr("Dauer ungültig (min. 5 Min).");
      return;
    }
    setCatBusy(true);
    setCatErr(null);
    try {
      await apiPost("/api/admin/catalog/services", {
        serviceName: svcName.trim(),
        durationMinutes: dm,
        referenceNetCents: net,
        vatRateBps: Number(svcVat),
        catalogActive: true,
      });
      setSvcName("");
      setSvcNetEur("");
      await loadCatalog();
      invalidateCatalog();
      await useCatalogStore.getState().ensureLoaded();
    } catch (e) {
      setCatErr(e instanceof Error ? e.message : "create_failed");
    } finally {
      setCatBusy(false);
    }
  };

  const openEdit = (row: CatalogRow) => {
    setEditId(row.id);
    setEditNetEur(netCentsToEurosLabel(row.referenceNetCents));
    setEditDur(String(row.durationMinutes));
    setEditVat(row.vatRateBps === 700 ? "700" : "1900");
    setEditActive(row.catalogActive);
  };

  const saveEdit = async () => {
    if (editId == null) return;
    const net = eurosInputToNetCents(editNetEur);
    if (net == null) {
      setCatErr("Nettopreis ungültig.");
      return;
    }
    const dm = Math.floor(Number.parseInt(editDur, 10));
    if (!Number.isFinite(dm) || dm < 5) {
      setCatErr("Dauer ungültig.");
      return;
    }
    setCatBusy(true);
    setCatErr(null);
    try {
      await apiPatch(`/api/admin/catalog/services/${editId}`, {
        durationMinutes: dm,
        referenceNetCents: net,
        vatRateBps: Number(editVat),
        catalogActive: editActive,
      });
      setEditId(null);
      await loadCatalog();
      invalidateCatalog();
      await useCatalogStore.getState().ensureLoaded();
    } catch (e) {
      setCatErr(e instanceof Error ? e.message : "save_failed");
    } finally {
      setCatBusy(false);
    }
  };

  const saveFeature = async (key: string, value: string) => {
    setFeatErr(null);
    try {
      await apiPatch("/api/admin/settings/features", { key, value });
      await loadFeatures();
    } catch (e) {
      setFeatErr(e instanceof Error ? e.message : "save_failed");
    }
  };

  const tabCls = (t: typeof tab) =>
    `rounded-lg border px-4 py-2 text-[11px] font-light uppercase tracking-[0.2em] ${
      tab === t
        ? "border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 text-editorial-pulse"
        : "border-deep-charcoal/12 bg-transparent text-deep-charcoal/70 hover:border-editorial-pulse hover:text-editorial-pulse"
    }`;

  const chooseExternalBackupFolder = async () => {
    if (!isTauriShell()) {
      setBkErr("Ordnerwahl ist nur in der Desktop-App (Tauri) verfügbar.");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected: string | string[] | null = await open({
        directory: true,
        multiple: false,
        title: "Externes Backup — Zielordner wählen",
      });
      let pathRaw: string | null = null;
      if (typeof selected === "string") pathRaw = selected;
      else if (Array.isArray(selected) && selected[0]) pathRaw = selected[0];

      if (!pathRaw?.trim()) return;

      await patchExternalBackupSettings({ backupPath: pathRaw.trim() });
      await loadBackup();
    } catch (e) {
      setBkErr(e instanceof Error ? e.message : "dialog_failed");
    }
  };

  const saveBackupSchedule = async (schedule: ExternalBackupSchedule) => {
    try {
      await patchExternalBackupSettings({ schedule });
      await loadBackup();
    } catch (e) {
      setBkErr(e instanceof Error ? e.message : "schedule_save_failed");
    }
  };

  const runBackupNow = async () => {
    setBkBusy(true);
    setBkErr(null);
    try {
      const r = await runExternalFortressBackup({
        backupPath: bk?.backupPath,
        trigger: "manual_ui",
      });
      await reportExternalFortressSyncResult(r.ok, r.ok ? "manual_ok" : r.detail);
      await loadBackup();
    } catch (e) {
      await reportExternalFortressSyncResult(false, "manual_exception").catch(() => {});
      setBkErr(e instanceof Error ? e.message : "sync_failed");
      await loadBackup();
    } finally {
      setBkBusy(false);
    }
  };

  const isIpv4 = (v: string) =>
    /^(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(
      v.trim(),
    );
  const isPort = (v: string) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= 1 && n <= 65535;
  };
  const paymentReady = isIpv4(hw.paymentTerminalIp) && isPort(hw.paymentTerminalPort);
  const printerReady = isIpv4(hw.printerIp) && isPort(hw.printerPort);

  const saveHardware = async () => {
    setHwBusy(true);
    setHwErr(null);
    setHwMsg(null);
    try {
      await apiPatch("/api/admin/settings/hardware", hw);
      setHwMsg("Hardware-Konfiguration gespeichert.");
    } catch (e) {
      setHwErr(e instanceof Error ? e.message : "save_failed");
    } finally {
      setHwBusy(false);
    }
  };

  const probeHardware = async () => {
    setHwBusy(true);
    setHwErr(null);
    setHwMsg(null);
    try {
      const r = await apiPost<{ zvt: { ok: boolean; detail: string }; printer: { ok: boolean; detail: string } }>(
        "/api/admin/settings/hardware/probe",
        {},
      );
      setHwMsg(
        `ZVT: ${r.zvt.ok ? "OK" : "NOK"} (${r.zvt.detail}) · Printer: ${r.printer.ok ? "OK" : "NOK"} (${r.printer.detail})`,
      );
    } catch (e) {
      setHwErr(e instanceof Error ? e.message : "probe_failed");
    } finally {
      setHwBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-editorial-display text-5xl font-normal uppercase tracking-[0.14em] text-deep-charcoal">Systemkonfiguration</h1>
          <p className="mt-3 text-xs font-light uppercase tracking-[0.2em] text-stone-500">
            Mitarbeiter, Leistungskatalog und Systemflags — nur Verwaltung / Inhaber.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/diagnostics"
            className="min-h-11 rounded-lg border border-deep-charcoal/12 px-4 py-2 text-[11px] font-light uppercase tracking-[0.2em] text-champagne-gold/90 no-underline hover:border-editorial-pulse"
          >
            Diagnose-Zentrum
          </Link>
          <Link
            to="/handbuch"
            className="min-h-11 rounded-lg border border-deep-charcoal/12 px-4 py-2 text-[11px] font-light uppercase tracking-[0.2em] text-deep-charcoal/80 no-underline"
          >
            Handbuch
          </Link>
          <Link
            to="/admin"
            className="min-h-11 rounded-lg border border-editorial-pulse px-4 py-2 text-[11px] font-light uppercase tracking-[0.2em] text-editorial-pulse no-underline"
          >
            ← Chef-Ansicht
          </Link>
        </div>
      </div>

      {/* Update card always visible at the top — independent of tabs */}
      <div className="mb-6">
        <UpdateSettingsCard />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <button type="button" className={tabCls("team")} onClick={() => setTab("team")}>
          Team (Mitarbeiter)
        </button>
        <button type="button" className={tabCls("services")} onClick={() => setTab("services")}>
          Leistungen (Katalog)
        </button>
        <button type="button" className={tabCls("system")} onClick={() => setTab("system")}>
          System (Features)
        </button>
        <button type="button" className={tabCls("hardware")} onClick={() => setTab("hardware")}>
          Hardware
        </button>
        <button type="button" className={tabCls("backup")} onClick={() => setTab("backup")}>
          Externes Backup
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          role="tabpanel"
          initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
          transition={tabTransition}
        >
      {tab === "team" && (
        <section className="rounded-2xl border border-deep-charcoal/10 bg-gray-100/40 p-6">
          <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.12em] text-deep-charcoal">Mitarbeiterverwaltung</h2>
          <p className="mt-2 text-xs font-light uppercase tracking-[0.2em] text-stone-500">
            Neue Accounts mit PIN (4–6 Ziffern). Deaktivieren statt löschen (GoBD / Nachvollziehbarkeit).
          </p>
          {staffErr && (
            <p className="mt-3 text-sm text-red-300" role="alert">
              {staffErr}
            </p>
          )}

          <div className="mt-6 grid gap-4 rounded-xl border border-deep-charcoal/10 p-4 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-deep-charcoal/70">
              <span>Anzeigename</span>
              <input
                className="luxury-field"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="flex flex-col gap-1 text-sm text-deep-charcoal/70">
              <LuxurySelectMenu
                label="Rolle"
                value={newRole}
                onChange={setNewRole}
                options={ROLE_OPTIONS}
                placeholder="Rolle"
              />
            </div>
            <label className="flex flex-col gap-1 text-sm text-deep-charcoal/70 md:col-span-2">
              <span>PIN (4–6 Ziffern)</span>
              <input
                className="luxury-field max-w-xs font-mono"
                inputMode="numeric"
                autoComplete="new-password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </label>
            <div className="md:col-span-2">
              <button
                type="button"
                disabled={staffBusy || newName.trim().length < 1 || !/^\d{4,6}$/.test(newPin)}
                className="min-h-[52px] rounded-xl border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-8 text-[11px] font-light uppercase tracking-[0.26em] text-editorial-pulse shadow-luxury  transition disabled:opacity-40"
                onClick={() => void createStaff()}
              >
                Mitarbeiter anlegen
              </button>
            </div>
          </div>

          <ul className="mt-8 divide-y divide-stone-700">
            {staff.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4 text-deep-charcoal/80"
              >
                <div>
                  <span className="font-medium">{s.displayName}</span>
                  <span className="ml-2 text-xs uppercase tracking-[0.16em] text-stone-500">
                    {s.role} · ID {s.id}
                  </span>
                  {!s.active && (
                    <span className="ml-2 rounded bg-red-900/50 px-2 text-xs text-red-200">
                      inaktiv
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={staffBusy}
                  className="rounded-lg border border-deep-charcoal/14 px-3 py-2 text-[11px] font-light uppercase tracking-[0.18em] text-deep-charcoal/80 disabled:opacity-40"
                  onClick={() => void toggleStaffActive(s)}
                >
                  {s.active ? "Deaktivieren" : "Aktivieren"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "services" && (
        <section className="rounded-2xl border border-deep-charcoal/10 bg-gray-100/40 p-6">
          <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.12em] text-editorial-pulse">Leistungskatalog</h2>
          <p className="mt-2 text-xs font-light uppercase tracking-[0.2em] text-stone-500">
            Nettopreis und Steuersatz (7 % / 19 %). Aus Spiegel ausgeblendete Leistungen bleiben in der Datenbank.
          </p>
          {catErr && (
            <p className="mt-3 text-sm text-red-300" role="alert">
              {catErr}
            </p>
          )}

          <div className="mt-6 grid gap-4 rounded-xl border border-deep-charcoal/10 p-4 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-deep-charcoal/70 md:col-span-3">
              <span>Bezeichnung (wie im Termin / Katalog)</span>
              <input
                className="luxury-field"
                value={svcName}
                onChange={(e) => setSvcName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-deep-charcoal/70">
              <span>Dauer (Min.)</span>
              <input
                className="luxury-field font-mono"
                inputMode="numeric"
                value={svcDur}
                onChange={(e) => setSvcDur(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-deep-charcoal/70">
              <span>Netto (€)</span>
              <input
                className="luxury-field font-mono"
                placeholder="z. B. 54,62"
                value={svcNetEur}
                onChange={(e) => setSvcNetEur(e.target.value)}
              />
            </label>
            <div className="flex flex-col gap-1 text-sm text-deep-charcoal/70">
              <LuxurySelectMenu
                label="Steuersatz"
                value={svcVat}
                onChange={(v) => setSvcVat(v as "1900" | "700")}
                options={VAT_RATE_OPTIONS}
                placeholder="MwSt."
              />
            </div>
            <div className="md:col-span-3">
              <button
                type="button"
                disabled={catBusy || svcName.trim().length < 1}
                className="min-h-11 rounded-lg border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-6 text-[11px] font-light uppercase tracking-[0.22em] text-editorial-pulse disabled:opacity-40"
                onClick={() => void createService()}
              >
                Leistung hinzufügen
              </button>
            </div>
          </div>

          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-deep-charcoal/12 text-stone-400">
                  <th className="py-2 pr-3">Leistung</th>
                  <th className="py-2 pr-3">Dauer</th>
                  <th className="py-2 pr-3">Netto</th>
                  <th className="py-2 pr-3">MwSt.</th>
                  <th className="py-2 pr-3">Sichtbar</th>
                  <th className="py-2">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((row) => (
                  <tr key={row.id} className="border-b border-deep-charcoal/8 text-deep-charcoal/80">
                    <td className="py-3 pr-3 font-medium">{row.serviceName}</td>
                    <td className="py-3 pr-3 font-mono">{row.durationMinutes} min</td>
                    <td className="py-3 pr-3 font-mono">
                      {netCentsToEurosLabel(row.referenceNetCents)} €
                    </td>
                    <td className="py-3 pr-3">
                      {row.vatRateBps === 700 ? "7 %" : "19 %"}
                    </td>
                    <td className="py-3 pr-3">{row.catalogActive ? "ja" : "nein"}</td>
                    <td className="py-3">
                      <button
                        type="button"
                        className="text-editorial-pulse underline"
                        onClick={() => openEdit(row)}
                      >
                        Bearbeiten
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {editId != null && (
            <div
              className="fixed inset-0 z-[330] flex items-center justify-center bg-gray-100/80 p-4 "
              role="dialog"
              aria-modal="true"
            >
              <div className={`max-h-[90vh] w-full max-w-lg overflow-y-auto p-6 md:p-8 ${luxuryGlassFloat}`}>
                <h3 className="text-lg font-bold text-deep-charcoal">Leistung bearbeiten</h3>
                <label className="mt-4 flex flex-col gap-1 text-sm text-deep-charcoal/70">
                  Netto (€)
                  <input
                    className="luxury-field font-mono"
                    value={editNetEur}
                    onChange={(e) => setEditNetEur(e.target.value)}
                  />
                </label>
                <label className="mt-3 flex flex-col gap-1 text-sm text-deep-charcoal/70">
                  Dauer (Min.)
                  <input
                    className="luxury-field font-mono"
                    value={editDur}
                    onChange={(e) => setEditDur(e.target.value)}
                  />
                </label>
                <div className="mt-3 flex flex-col gap-1 text-sm text-deep-charcoal/70">
                  <LuxurySelectMenu
                    label="Steuersatz"
                    value={editVat}
                    onChange={(v) => setEditVat(v as "1900" | "700")}
                    options={VAT_RATE_OPTIONS}
                    placeholder="MwSt."
                  />
                </div>
                <label className="mt-4 flex items-center gap-2 text-sm text-deep-charcoal/70">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(e) => setEditActive(e.target.checked)}
                  />
                  Im Katalog / Spiegel sichtbar
                </label>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="rounded-lg border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-5 py-2 text-[11px] font-light uppercase tracking-[0.2em] text-editorial-pulse"
                    disabled={catBusy}
                    onClick={() => void saveEdit()}
                  >
                    Speichern
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-deep-charcoal/14 px-5 py-2 text-[11px] font-light uppercase tracking-[0.2em] text-deep-charcoal/70"
                    onClick={() => setEditId(null)}
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === "system" && (
        <section className="rounded-2xl border border-deep-charcoal/10 bg-gray-100/40 p-6 shadow-[0_0_40px_rgba(0,0,0,0.25)]">
          <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.12em] text-editorial-pulse">Feature-Schalter</h2>
          <p className="mt-2 text-xs font-light uppercase tracking-[0.2em] text-stone-500">
            Lokale Systemflags (`system_settings`). Änderungen werden protokolliert.
          </p>
          {featErr && (
            <p className="mt-3 text-sm text-red-300" role="alert">
              {featErr}
            </p>
          )}
          <ul className="mt-6 space-y-3">
            {features.map((f) => (
              <li
                key={f.key}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-deep-charcoal/10 bg-gray-100/40 px-4 py-3"
              >
                <div className="text-sm text-deep-charcoal/70">
                  <span className="font-medium text-deep-charcoal">
                    {FEATURE_LABEL_DE[f.key] ?? f.key}
                  </span>
                  <span className="mt-1 block font-mono text-xs text-stone-500">{f.key}</span>
                </div>
                {f.key === "tse_provider_type" ? (
                  <div className="min-w-[min(100%,16rem)]">
                    <LuxurySelectMenu
                      label=""
                      value={f.value}
                      onChange={(v) => void saveFeature(f.key, v)}
                      options={TSE_PROVIDER_OPTIONS}
                      placeholder="TSE-Typ"
                    />
                  </div>
                ) : f.key.startsWith("commission_") ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      key={`${f.key}-${f.value}`}
                      id={`setting-${f.key}`}
                      type="number"
                      min={0}
                      max={9000}
                      step={50}
                      defaultValue={f.value}
                      className="luxury-field w-36 font-mono text-deep-charcoal"
                      aria-label={f.key}
                    />
                    <span className="text-xs text-stone-500">Max. 9000 (= 90 % vom Zeilen-Netto)</span>
                    <button
                      type="button"
                      className="rounded-lg border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-3 py-2 text-[11px] font-light uppercase tracking-[0.2em] text-editorial-pulse"
                      onClick={() => {
                        const el = document.getElementById(
                          `setting-${f.key}`,
                        ) as HTMLInputElement | null;
                        if (!el) return;
                        let n = Number.parseInt(el.value, 10);
                        if (!Number.isFinite(n)) n = 0;
                        n = Math.min(9000, Math.max(0, n));
                        void saveFeature(f.key, String(n));
                      }}
                    >
                      Speichern
                    </button>
                  </div>
                ) : isBinaryFlagSetting(f) ? (
                  <LuxuryToggle
                    checked={f.value === "1"}
                    onCheckedChange={(on) => void saveFeature(f.key, on ? "1" : "0")}
                    aria-label={FEATURE_LABEL_DE[f.key] ?? f.key}
                  />
                ) : (
                  <div className="min-w-[min(100%,12rem)]">
                    <LuxurySelectMenu
                      label=""
                      value={f.value}
                      onChange={(v) => void saveFeature(f.key, v)}
                      options={FEATURE_ON_OFF_OPTIONS}
                      placeholder="—"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "backup" && (
        <section className="rounded-none border border-deep-charcoal/10 bg-gray-100/40 p-8 text-deep-charcoal">
          <h2 className="font-editorial-display text-4xl font-normal uppercase tracking-[0.12em] text-deep-charcoal">
            Externes Backup &amp; Synchronisation
          </h2>
          <p className="mt-3 max-w-prose border-l border-editorial-pulse bg-transparent pl-4 text-base text-brushed-chrome leading-relaxed">
            Diese Funktion sichert eine vollständige SQLite-Kopie Ihrer Datenbank (inkl.{" "}
            <span className="text-deep-charcoal">audit_logs</span> und{" "}
            <span className="text-deep-charcoal">system_settings</span>) automatisch auf ein externes
            Laufwerk — z.&nbsp;B. USB-Stick oder externe Platte über die Ordnerwahl. Bereits
            anonymisierte Kundenprofile bleiben anonym; es gibt keine „Rück-Identifizierung“ aus der
            Sicherungsdatei.
          </p>
          <p className="mt-2 text-sm text-brushed-chrome">
            Nur die Desktop-Installation kann direkt auf den gewählten Ordner schreiben; Browser-Tabs
            bleiben auf manuellen Download beschränkt.
          </p>

          {bkErr && (
            <p className="mt-4 border border-red-400/60 bg-red-50/60 px-4 py-3 text-sm text-red-600/90" role="alert">
              {bkErr}
            </p>
          )}

          <div className="mt-8 space-y-6">
            <div>
              <p className="text-sm font-semibold text-brushed-chrome">Zielordner (extern)</p>
              <p className="mt-2 break-all font-mono text-sm text-deep-charcoal">
                {(bk?.backupPath ?? "").trim() ? bk!.backupPath : "— noch nicht gewählt —"}
              </p>
              <button
                type="button"
                disabled={bkBusy}
                className="mt-4 min-h-touch border border-deep-charcoal/15 px-6 text-[11px] font-light uppercase tracking-[0.2em] text-deep-charcoal disabled:opacity-50"
                onClick={() => void chooseExternalBackupFolder()}
              >
                Ordner wählen…
              </button>
            </div>

            <div className="block max-w-xl">
              <LuxurySelectMenu
                label="Häufigkeit"
                value={bk?.schedule ?? "manual"}
                onChange={(v) => void saveBackupSchedule(v as ExternalBackupSchedule)}
                options={BACKUP_SCHEDULE_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                placeholder="Plan wählen"
                className={bkBusy || !bk ? "pointer-events-none opacity-50" : ""}
              />
            </div>

            <div>
              <button
                type="button"
                disabled={bkBusy || !(bk?.backupPath ?? "").trim()}
                className="min-h-touch border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-8 text-[11px] font-light uppercase tracking-[0.24em] text-editorial-pulse disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void runBackupNow()}
              >
                {bkBusy ? "Synchronisiert …" : "Jetzt synchronisieren"}
              </button>
            </div>

            <div className="border border-deep-charcoal/10 p-4">
              <p className="text-sm font-light uppercase tracking-[0.2em] text-brushed-chrome">
                Letzte Synchronisation
              </p>
              <ul className="mt-3 space-y-2 text-base">
                <li>
                  <span className="text-brushed-chrome">Status: </span>
                  {bk?.lastOk === true ? (
                    <span className="font-bold text-oak-wood">OK</span>
                  ) : bk?.lastOk === false ? (
                    <span className="font-bold text-red-400">Fehlgeschlagen</span>
                  ) : (
                    <span className="text-brushed-chrome">— noch keine —</span>
                  )}
                </li>
                {bk?.lastAtMs != null && (
                  <li className="text-brushed-chrome">
                    Zeit (Europe/Berlin):{" "}
                    <span className="text-deep-charcoal">
                      {formatBerlinDateTime(new Date(bk.lastAtMs))}
                    </span>
                  </li>
                )}
                {(bk?.lastDetail ?? "").trim() !== "" && (
                  <li className="font-mono text-sm text-brushed-chrome">{bk!.lastDetail}</li>
                )}
              </ul>
            </div>
          </div>
        </section>
      )}
      {tab === "hardware" && (
        <section className="rounded-2xl border border-deep-charcoal/10 bg-gray-100/40 p-6">
          <h2 className="font-editorial-display text-3xl font-normal uppercase tracking-[0.12em] text-editorial-pulse">
            Payment & Printer
          </h2>
          <p className="mt-2 text-xs font-light uppercase tracking-[0.2em] text-stone-500">
            Desktop-Workstation Hardware-Basis für ZVT und Netzwerkdrucker.
          </p>
          {hwErr && (
            <p className="mt-4 border border-red-400/60 bg-red-50/60 px-4 py-3 text-sm text-red-600/90">
              {hwErr}
            </p>
          )}
          {hwMsg && (
            <p className="mt-4 border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/35 px-4 py-3 text-sm text-editorial-pulse">
              {hwMsg}
            </p>
          )}

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <section className="border border-deep-charcoal/10 bg-gray-100/40 p-5">
              <h3 className="font-editorial-display text-2xl font-normal uppercase tracking-[0.1em] text-deep-charcoal/92">
                Payment Terminal (ZVT)
              </h3>
              <label className="mt-4 block text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
                Terminal IP
              </label>
              <input
                className="luxury-field mt-2"
                value={hw.paymentTerminalIp}
                onChange={(e) => setHw((s) => ({ ...s, paymentTerminalIp: e.target.value }))}
                placeholder="192.168.1.120"
              />
              <label className="mt-4 block text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
                Port
              </label>
              <input
                className="luxury-field mt-2 font-mono"
                value={hw.paymentTerminalPort}
                onChange={(e) => setHw((s) => ({ ...s, paymentTerminalPort: e.target.value }))}
                placeholder="20007"
              />
              <label className="mt-4 flex items-center gap-3 text-sm text-deep-charcoal/75">
                <LuxuryToggle
                  checked={hw.paymentAutoLink}
                  disabled={!paymentReady}
                  onCheckedChange={(on) => setHw((s) => ({ ...s, paymentAutoLink: on }))}
                />
                Enable Auto-Payment Link
              </label>
            </section>

            <section className="border border-deep-charcoal/10 bg-gray-100/40 p-5">
              <h3 className="font-editorial-display text-2xl font-normal uppercase tracking-[0.1em] text-deep-charcoal/92">
                Receipt Printer
              </h3>
              <label className="mt-4 block text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
                Printer IP
              </label>
              <input
                className="luxury-field mt-2"
                value={hw.printerIp}
                onChange={(e) => setHw((s) => ({ ...s, printerIp: e.target.value }))}
                placeholder="192.168.1.140"
              />
              <label className="mt-4 block text-xs font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
                Port
              </label>
              <input
                className="luxury-field mt-2 font-mono"
                value={hw.printerPort}
                onChange={(e) => setHw((s) => ({ ...s, printerPort: e.target.value }))}
                placeholder="9100"
              />
              <label className="mt-4 flex items-center gap-3 text-sm text-deep-charcoal/75">
                <LuxuryToggle
                  checked={hw.printerAutoPrint}
                  disabled={!printerReady}
                  onCheckedChange={(on) => setHw((s) => ({ ...s, printerAutoPrint: on }))}
                />
                Auto-Print Receipt
              </label>
            </section>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={hwBusy || !(paymentReady || printerReady)}
              onClick={() => void saveHardware()}
              className="min-h-11 rounded-lg border border-editorial-pulse bg-[var(--editorial-pulse-dim)]/45 px-6 text-[11px] font-light uppercase tracking-[0.22em] text-editorial-pulse disabled:opacity-40"
            >
              Hardware speichern
            </button>
            <button
              type="button"
              disabled={hwBusy}
              onClick={() => void probeHardware()}
              className="min-h-11 rounded-lg border border-deep-charcoal/14 px-6 text-[11px] font-light uppercase tracking-[0.22em] text-deep-charcoal/80 disabled:opacity-40"
            >
              Probe Verbindung
            </button>
          </div>
        </section>
      )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
