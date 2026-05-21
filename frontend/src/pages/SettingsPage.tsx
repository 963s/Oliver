import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPatch, apiPut } from "../api";
import { isSalonManagementRole } from "../lib/staffRoles";
import { useAuthStore } from "../store/authStore";
import { LuxuryDatePicker } from "../components/ui/LuxuryDatePicker";
import { LuxurySelectMenu } from "../components/ui/LuxurySelectMenu";
import { luxuryFieldClass } from "../lib/luxuryUi";

type StaffRow = {
  id: number;
  displayName: string;
  role: string;
  active?: boolean;
};

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-deep-charcoal/[0.06] pt-6">
      <h3 className="mb-4 font-heading text-base uppercase tracking-wider text-deep-charcoal/80">
        {title}
      </h3>
      {children}
    </section>
  );
}

function HardwareSettingsPanel() {
  const [zvtIp, setZvtIp] = useState("");
  const [zvtPort, setZvtPort] = useState("20007");
  const [zvtAutoLink, setZvtAutoLink] = useState(false);
  const [printerIp, setPrinterIp] = useState("");
  const [printerPort, setPrinterPort] = useState("9100");
  const [printerAutoPrint, setPrinterAutoPrint] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiGet<{
      paymentTerminalIp: string;
      paymentTerminalPort: string;
      paymentAutoLink: boolean;
      printerIp: string;
      printerPort: string;
      printerAutoPrint: boolean;
    }>("/api/admin/settings/hardware")
      .then((hw) => {
        setZvtIp(hw.paymentTerminalIp || "");
        setZvtPort(hw.paymentTerminalPort || "20007");
        setZvtAutoLink(hw.paymentAutoLink);
        setPrinterIp(hw.printerIp || "");
        setPrinterPort(hw.printerPort || "9100");
        setPrinterAutoPrint(hw.printerAutoPrint);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const saveHardware = async () => {
    setMsg("");
    try {
      await apiPatch("/api/admin/settings/hardware", {
        paymentTerminalIp: zvtIp.trim(),
        paymentTerminalPort: zvtPort.trim() || "20007",
        paymentAutoLink: zvtAutoLink,
        printerIp: printerIp.trim(),
        printerPort: printerPort.trim() || "9100",
        printerAutoPrint: printerAutoPrint,
      });
      setMsg("Hardware-Einstellungen gespeichert.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Fehler beim Speichern.");
    }
  };

  if (loading) {
    return <p className="text-xs text-deep-charcoal/30">Lade Hardware-Konfiguration…</p>;
  }

  return (
    <div className="space-y-6">
      {/* ZVT Payment Terminal */}
      <div className="border border-deep-charcoal/[0.06] bg-gray-100/40 p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-8 w-8 items-center justify-center bg-editorial-pulse/10 text-editorial-pulse text-sm">
            💳
          </div>
          <div>
            <p className="text-sm font-medium text-deep-charcoal/80">EC-Kartenterminal (ZVT)</p>
            <p className="text-[10px] text-deep-charcoal/35">
              Ingenico / Verifone — ZVT-Protokoll über TCP/IP
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-xs text-deep-charcoal/40">
            IP-Adresse
            <input
              value={zvtIp}
              onChange={(e) => setZvtIp(e.target.value)}
              className={`mt-1 ${luxuryFieldClass}`}
              placeholder="192.168.1.100"
            />
          </label>
          <label className="block text-xs text-deep-charcoal/40">
            Port
            <input
              value={zvtPort}
              onChange={(e) => setZvtPort(e.target.value)}
              className={`mt-1 max-w-[8rem] font-mono ${luxuryFieldClass}`}
              placeholder="20007"
            />
          </label>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-deep-charcoal/50">
          <input
            type="checkbox"
            checked={zvtAutoLink}
            onChange={(e) => setZvtAutoLink(e.target.checked)}
            className="h-4 w-4 min-h-0 min-w-0 accent-editorial-pulse"
          />
          Auto-Payment Link aktivieren (Checkout → Terminal automatisch auslösen)
        </label>
      </div>

      {/* ESC/POS Receipt Printer */}
      <div className="border border-deep-charcoal/[0.06] bg-gray-100/40 p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-8 w-8 items-center justify-center bg-editorial-pulse/10 text-editorial-pulse text-sm">
            🖨️
          </div>
          <div>
            <p className="text-sm font-medium text-deep-charcoal/80">Bondrucker (ESC/POS)</p>
            <p className="text-[10px] text-deep-charcoal/35">
              Epson TM-T88 / Star TSP100 — LAN-Drucker mit TSE
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-xs text-deep-charcoal/40">
            IP-Adresse
            <input
              value={printerIp}
              onChange={(e) => setPrinterIp(e.target.value)}
              className={`mt-1 ${luxuryFieldClass}`}
              placeholder="192.168.1.200"
            />
          </label>
          <label className="block text-xs text-deep-charcoal/40">
            Port
            <input
              value={printerPort}
              onChange={(e) => setPrinterPort(e.target.value)}
              className={`mt-1 max-w-[8rem] font-mono ${luxuryFieldClass}`}
              placeholder="9100"
            />
          </label>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-deep-charcoal/50">
          <input
            type="checkbox"
            checked={printerAutoPrint}
            onChange={(e) => setPrinterAutoPrint(e.target.checked)}
            className="h-4 w-4 min-h-0 min-w-0 accent-editorial-pulse"
          />
          Auto-Print (Beleg nach Checkout automatisch drucken)
        </label>
      </div>

      <button
        type="button"
        onClick={() => void saveHardware()}
        className="h-9 border border-editorial-pulse bg-editorial-pulse/10 px-6 text-[11px] uppercase tracking-wider text-editorial-pulse transition hover:bg-editorial-pulse/20"
      >
        Hardware speichern
      </button>
      {msg && <p className="text-xs text-editorial-pulse/80">{msg}</p>}
    </div>
  );
}

export function SettingsPage() {
  const role = localStorage.getItem("or:staffRole") ?? "";
  const staffRole = useAuthStore((s) => s.staffRole);
  const isOwner = role === "owner" || role === "super_admin";
  const canManageBackup = isSalonManagementRole(staffRole ?? role);

  const [me, setMe] = useState<StaffRow | null>(null);
  const [terminal, setTerminal] = useState(localStorage.getItem("or:terminalId") ?? "T-ING-01");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rev, setRev] = useState(40000);
  const [retail, setRetail] = useState(6);
  const [staffTarget, setStaffTarget] = useState("2");
  const [viewAllTargets, setViewAllTargets] = useState(
    localStorage.getItem("or:viewAllTargets") === "true",
  );
  const [ringsViewStaffId, setRingsViewStaffId] = useState(
    localStorage.getItem("or:ringsViewStaffId") ?? "1",
  );
  const [msg, setMsg] = useState("");

  const [allStaff, setAllStaff] = useState<StaffRow[]>([]);
  const [pinStaffId, setPinStaffId] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinMsg, setPinMsg] = useState("");

  useEffect(() => {
    void apiGet<StaffRow>("/api/auth/me")
      .then((m) => setMe(m))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    void apiGet<StaffRow[]>("/api/staff")
      .then((rows) => {
        setAllStaff(rows);
        if (rows.length) {
          setPinStaffId((prev) => prev || String(rows[0]!.id));
        }
      })
      .catch(() => {});
  }, [isOwner]);

  const saveTerminal = () => {
    localStorage.setItem("or:terminalId", terminal);
    localStorage.setItem("or:viewAllTargets", viewAllTargets ? "true" : "false");
    localStorage.setItem("or:ringsViewStaffId", ringsViewStaffId);
    setMsg("Gespeichert");
  };

  const saveTargets = () => {
    if (!isOwner) {
      setMsg("Nur Inhaber kann Ziele setzen.");
      return;
    }
    void apiPut(`/api/admin/staff/${staffTarget}/targets`, {
      targetDate: date,
      serviceTargetCents: Math.round(rev * 100),
      retailTargetCents: 0,
    })
      .then(() => setMsg("Ziele gespeichert"))
      .catch((e) => setMsg(String(e)));
  };

  const savePin = () => {
    if (!isOwner) {
      setPinMsg("Nur Inhaber (OLI) darf PINs ändern.");
      return;
    }
    const id = Number(pinStaffId);
    if (!Number.isFinite(id) || id < 1) {
      setPinMsg("Mitarbeiter wählen.");
      return;
    }
    if (!/^\d{4,6}$/.test(newPin.trim())) {
      setPinMsg("Neue PIN: 4–6 Ziffern.");
      return;
    }
    void apiPatch(`/api/staff/${id}/pin`, { newPin: newPin.trim() })
      .then(() => {
        setPinMsg("PIN aktualisiert.");
        setNewPin("");
      })
      .catch((e) => setPinMsg(String(e)));
  };

  return (
    <div className="mx-auto max-w-5xl overflow-y-auto px-6 py-6 text-deep-charcoal">
      <h2 className="font-heading text-2xl uppercase tracking-wider text-deep-charcoal/90">
        Einstellungen
      </h2>
      <p className="mt-1 text-xs text-deep-charcoal/40">
        Angemeldet:{" "}
        <strong className="text-deep-charcoal/70">
          {me ? `${me.displayName} (#${me.id}, ${me.role})` : "—"}
        </strong>
      </p>

      {canManageBackup && (
        <p className="mt-3 border-l-2 border-editorial-pulse/30 pl-3 text-xs text-deep-charcoal/40">
          <Link to="/admin/settings" className="text-editorial-pulse/80 hover:text-editorial-pulse">
            Systemkonfiguration → Externes Backup
          </Link>
          {" · "}
          <Link to="/admin/diagnostics" className="text-editorial-pulse/80 hover:text-editorial-pulse">
            Diagnose-Zentrum
          </Link>
        </p>
      )}

      <p className="mt-2 text-xs text-deep-charcoal/35">
        <Link to="/handbuch" className="text-editorial-pulse/70 hover:text-editorial-pulse">
          Handbuch öffnen
        </Link>{" "}
        (Tagesabschluss, Storno, Anonymisierung, Backup)
      </p>

      <div className="mt-6 space-y-6">
        {/* ── Hardware & Peripherals ── */}
        <SettingsSection title="Hardware & Peripheriegeräte">
          <HardwareSettingsPanel />
        </SettingsSection>

        {/* ── Terminal & Targets ── */}
        <SettingsSection title="Terminal & Ziele (Rings)">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block text-xs text-deep-charcoal/40">
              EC-Terminal-ID (ZVT-Orphan-Filter)
              <input
                value={terminal}
                onChange={(e) => setTerminal(e.target.value)}
                className={`mt-1 ${luxuryFieldClass}`}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-deep-charcoal/45">
              <input
                type="checkbox"
                checked={viewAllTargets}
                onChange={(e) => setViewAllTargets(e.target.checked)}
                className="h-4 w-4 min-h-0 min-w-0 accent-editorial-pulse"
              />
              Inhaber: fremde Mitarbeiter-Ziele lesen
            </label>
            <label className="block text-xs text-deep-charcoal/40">
              Rings-Ansicht Mitarbeiter-ID
              <input
                value={ringsViewStaffId}
                onChange={(e) => setRingsViewStaffId(e.target.value)}
                className={`mt-1 max-w-[8rem] font-mono ${luxuryFieldClass}`}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={saveTerminal}
            className="mt-4 h-9 border border-editorial-pulse bg-editorial-pulse/10 px-6 text-[11px] uppercase tracking-wider text-editorial-pulse transition hover:bg-editorial-pulse/20"
          >
            Terminal speichern
          </button>
        </SettingsSection>

        {/* ── PIN Management ── */}
        {isOwner && (
          <SettingsSection title="PIN verwalten (nur Inhaber · GoBD-Audit)">
            <p className="mb-3 text-[10px] text-deep-charcoal/35">
              SILKE / ABDUL können ihre PIN nicht selbst ändern — nur OLI über diese Maske.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <LuxurySelectMenu
                label="Mitarbeiter"
                value={pinStaffId}
                onChange={setPinStaffId}
                options={allStaff.map((s) => ({
                  value: String(s.id),
                  label: `${s.displayName} (${s.role})`,
                }))}
                placeholder="Team wählen"
              />
              <label className="block text-xs text-deep-charcoal/40">
                Neue PIN (4–6 Ziffern)
                <input
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="off"
                  className={`mt-1 max-w-[10rem] ${luxuryFieldClass}`}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={savePin}
              className="mt-4 h-9 border border-editorial-pulse bg-editorial-pulse/10 px-6 text-[11px] uppercase tracking-wider text-editorial-pulse transition hover:bg-editorial-pulse/20"
            >
              PIN speichern
            </button>
            {pinMsg && <p className="mt-2 text-xs text-editorial-pulse/80">{pinMsg}</p>}
          </SettingsSection>
        )}

        {/* ── Daily Targets ── */}
        <SettingsSection title="Tagesziele (§37) — Inhaber">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <label className="block text-xs text-deep-charcoal/40">
              Mitarbeiter-ID
              <input
                value={staffTarget}
                onChange={(e) => setStaffTarget(e.target.value)}
                className={`mt-1 max-w-[8rem] font-mono ${luxuryFieldClass}`}
              />
            </label>
            <div>
              <LuxuryDatePicker label="Datum" value={date} onChange={setDate} yearSpan={{ before: 2, after: 1 }} />
            </div>
            <label className="block text-xs text-deep-charcoal/40">
              Umsatzziel (€)
              <input
                type="number"
                value={rev}
                onChange={(e) => setRev(Number(e.target.value))}
                className={`mt-1 max-w-[10rem] ${luxuryFieldClass}`}
              />
            </label>
            <label className="block text-xs text-deep-charcoal/40">
              Verkaufs-Units
              <input
                type="number"
                value={retail}
                onChange={(e) => setRetail(Number(e.target.value))}
                className={`mt-1 max-w-[10rem] ${luxuryFieldClass}`}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={saveTargets}
            className="mt-4 h-9 border border-editorial-pulse bg-editorial-pulse/10 px-6 text-[11px] uppercase tracking-wider text-editorial-pulse transition hover:bg-editorial-pulse/20"
          >
            Ziel speichern
          </button>
          {msg && <p className="mt-2 text-xs text-deep-charcoal/45">{msg}</p>}
        </SettingsSection>
      </div>
    </div>
  );
}
