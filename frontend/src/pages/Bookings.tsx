/**
 * Bookings.tsx — صفحة حجز المواعيد الرئيسية
 * - حجز مواعيد جديدة مع تحكم كامل في المدة
 * - إدخال مواعيد قديمة / تاريخية (للتحول الرقمي)
 * - البحث عن عملاء موجودين أو إدخال عملاء جدد
 * - عرض مواعيد اليوم مع بطاقة العميل الكاملة
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { LuxuryDatePicker } from "../components/ui/LuxuryDatePicker";
import { LuxurySelectMenu } from "../components/ui/LuxurySelectMenu";
import { ClientSearchInput, type ClientSearchResult } from "../components/ui/ClientSearchInput";
import { BERLIN, formatBerlinTimeHHmm } from "../lib/formatTime";
import { formatInTimeZone } from "date-fns-tz";
import { fromZonedTime } from "date-fns-tz";

/* ── Types ─────────────────────────────────────────────────────────────────── */
type StaffOpt = { id: number; displayName: string; role: string; active?: boolean };
type AppointmentRow = {
  id: number;
  clientName: string;
  clientPhone: string | null;
  clientId: number | null;
  staffId: number;
  serviceName: string;
  startAt: string | number | Date;
  endAt: string | number | Date;
  status: string;
};

/* ── Duration presets ────────────────────────────────────────────────────── */
const DURATION_PRESETS = [
  { label: "15 Min", minutes: 15 },
  { label: "30 Min", minutes: 30 },
  { label: "45 Min", minutes: 45 },
  { label: "1 Std", minutes: 60 },
  { label: "1:15", minutes: 75 },
  { label: "1:30", minutes: 90 },
  { label: "1:45", minutes: 105 },
  { label: "2 Std", minutes: 120 },
  { label: "2:30", minutes: 150 },
  { label: "3 Std", minutes: 180 },
  { label: "4 Std", minutes: 240 },
];

/* ── Time helpers ────────────────────────────────────────────────────────── */
function todayYmd(): string {
  return formatInTimeZone(new Date(), BERLIN, "yyyy-MM-dd");
}
function nowRoundedToQuarter(): { hour: number; minute: number } {
  // نستخدم توقيت Berlin (نفس توقيت النظام) لضمان التوافق
  const berlinHHmm = formatInTimeZone(new Date(), BERLIN, "HH:mm");
  const [hStr, mStr] = berlinHHmm.split(":");
  const totalMin = parseInt(hStr ?? "9", 10) * 60 + parseInt(mStr ?? "0", 10);
  const rounded = Math.ceil(totalMin / 15) * 15;
  return { hour: Math.floor(rounded / 60) % 24, minute: rounded % 60 };
}
function buildMs(dateYmd: string, hour: number, minute: number): number {
  return fromZonedTime(`${dateYmd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`, BERLIN).getTime();
}

const STATUS_LABELS: Record<string, string> = {
  booked:     "Gebucht",
  checked_in: "Eingecheckt",
  completed:  "Abgeschlossen",
  canceled:   "Abgesagt",
  no_show:    "No-Show",
};
const STATUS_COLORS: Record<string, string> = {
  booked:     "text-sky-600 bg-sky-50 border-sky-200",
  checked_in: "text-champagne-gold bg-champagne-gold/10 border-champagne-gold/30",
  completed:  "text-green-700 bg-green-50 border-green-200",
  canceled:   "text-red-500 bg-red-50 border-red-200",
  no_show:    "text-gray-400 bg-gray-50 border-gray-200",
};

/* ── Hours dropdown options ─────────────────────────────────────────────── */
function buildHourOptions(from = 6, to = 23) {
  const opts = [];
  for (let h = from; h <= to; h++) {
    opts.push({ value: String(h), label: `${String(h).padStart(2, "0")}:00` });
  }
  return opts;
}
const HOUR_OPTS = buildHourOptions(6, 23);
const MIN_OPTS  = [0, 15, 30, 45].map((m) => ({
  value: String(m),
  label: String(m).padStart(2, "0"),
}));

/* ── Component ────────────────────────────────────────────────────────────── */
export function Bookings() {
  const navigate = useNavigate();

  /* ── Staff list ── */
  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [staffId, setStaffId] = useState("");

  /* ── Client ── */
  const [clientName,  setClientName]  = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientId,    setClientId]    = useState<number | null>(null);

  /* ── Service ── */
  const [serviceName, setServiceName] = useState("Schnitt + Beratung");

  /* ── Date/Time start ── */
  const initTime = useMemo(nowRoundedToQuarter, []);
  const [dateYmd,     setDateYmd]     = useState(todayYmd());
  const [startHour,   setStartHour]   = useState(initTime.hour);
  const [startMinute, setStartMinute] = useState(initTime.minute);

  /* ── Duration ── */
  const [durationMin, setDurationMin]   = useState(45);
  const [customDur,   setCustomDur]     = useState("");
  const [showCustom,  setShowCustom]    = useState(false);

  /* ── Mode: new vs historical ── */
  const [isHistorical, setIsHistorical] = useState(false);

  /* ── Computed endAt ── */
  const startMs = useMemo(
    () => buildMs(dateYmd, startHour, startMinute),
    [dateYmd, startHour, startMinute],
  );
  const endMs = startMs + durationMin * 60_000;

  /* ── Appointments list (today) ── */
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [msg,  setMsg]  = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void apiGet<AppointmentRow[]>("/api/appointments")
      .then(setRows)
      .catch((e) => setMsg(String(e)));
  }, []);

  useEffect(() => {
    void apiGet<StaffOpt[]>("/api/staff")
      .then((s) => {
        const active = s.filter((x) => x.active !== false);
        setStaff(active);
        if (active.length && !staffId) setStaffId(String(active[0]!.id));
      })
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Handlers ── */
  const handleClientSelect = (hit: ClientSearchResult) => {
    setClientName(hit.name);
    setClientPhone(hit.phone ?? "");
    setClientId(hit.id);
  };

  const handleDurationPreset = (min: number) => {
    setDurationMin(min);
    setShowCustom(false);
    setCustomDur("");
  };

  const handleCustomApply = () => {
    const v = parseInt(customDur, 10);
    if (!isNaN(v) && v >= 5 && v <= 600) {
      setDurationMin(v);
      setShowCustom(false);
    }
  };

  const createAppt = () => {
    const name = clientName.trim();
    if (!name)                   { setMsg("Kundenname ist erforderlich"); return; }
    if (!staffId)                { setMsg("Mitarbeiter auswählen");       return; }
    if (durationMin < 5)         { setMsg("Dauer muss mindestens 5 Min sein"); return; }

    setBusy(true);
    setMsg("");
    void apiPost("/api/appointments", {
      clientName: name,
      clientPhone: clientPhone.trim() || null,
      clientId: clientId ?? undefined,
      staffId: Number(staffId),
      serviceName: serviceName.trim() || "Schnitt + Beratung",
      startAt: startMs,
      endAt: endMs,
    })
      .then(() => {
        setMsg("✓ Termin gespeichert");
        setClientName("");
        setClientPhone("");
        setClientId(null);
        setServiceName("Schnitt + Beratung");
        load();
        // Reset date to today if not historical
        if (!isHistorical) setDateYmd(todayYmd());
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const checkIn = (id: number) => {
    void apiPost<{ session: { id: number } }>(`/api/appointments/${id}/check-in`, {})
      .then((r) => navigate(`/mirror?session=${r.session.id}`))
      .catch((e) => setMsg(String(e)));
  };

  /* ── Group rows by staff ── */
  const staffMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of staff) m.set(s.id, s.displayName);
    return m;
  }, [staff]);

  /* ── Format duration label ── */
  const durationLabel = useMemo(() => {
    const h = Math.floor(durationMin / 60);
    const m = durationMin % 60;
    if (h === 0) return `${m} Min`;
    if (m === 0) return `${h} Std`;
    return `${h} Std ${m} Min`;
  }, [durationMin]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 pb-24">

        {/* ── Page header ── */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-heading text-3xl uppercase tracking-[0.08em] text-deep-charcoal">
              Termine buchen
            </h1>
            <p className="mt-1 text-[11px] font-light uppercase tracking-[0.2em] text-deep-charcoal/40">
              Neuer Termin · Historische Termine eintragen
            </p>
          </div>
          <Link
            to="/agenda"
            className="text-[10px] uppercase tracking-[0.2em] text-deep-charcoal/40 no-underline transition hover:text-deep-charcoal/70"
          >
            ← Agenda
          </Link>
        </div>

        {/* ── New / Historical toggle ── */}
        <div className="mb-6 flex gap-0 border border-deep-charcoal/10 bg-gray-100/60 p-0.5 w-fit">
          <button
            type="button"
            onClick={() => { setIsHistorical(false); setDateYmd(todayYmd()); }}
            className={`px-5 py-2 text-[11px] font-medium uppercase tracking-[0.14em] transition ${
              !isHistorical
                ? "bg-white border border-editorial-pulse/30 text-editorial-pulse shadow-sm"
                : "text-deep-charcoal/50 hover:text-deep-charcoal/70"
            }`}
          >
            Neuer Termin
          </button>
          <button
            type="button"
            onClick={() => setIsHistorical(true)}
            className={`px-5 py-2 text-[11px] font-medium uppercase tracking-[0.14em] transition ${
              isHistorical
                ? "bg-white border border-champagne-gold/40 text-champagne-gold shadow-sm"
                : "text-deep-charcoal/50 hover:text-deep-charcoal/70"
            }`}
          >
            Historisch eintragen
          </button>
        </div>

        {isHistorical && (
          <div className="mb-5 flex items-start gap-3 rounded-sm border border-champagne-gold/30 bg-champagne-gold/10 px-4 py-3">
            <span className="mt-0.5 text-champagne-gold/70 text-sm">📋</span>
            <p className="text-[12px] font-light leading-relaxed text-deep-charcoal/60">
              <strong className="font-medium text-deep-charcoal/80">Historischer Modus:</strong>{" "}
              Vergangene Papiermappen und Termine können hier digital erfasst werden.
              Wähle das Datum in der Vergangenheit — der Termin wird ohne Einschränkung gespeichert.
            </p>
          </div>
        )}

        {/* ── Booking form ── */}
        <div className="border border-deep-charcoal/10 bg-white/80">

          {/* Client row */}
          <div className="border-b border-deep-charcoal/[0.07] p-5">
            <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
              Kunde
            </p>
            <ClientSearchInput
              placeholder="Name, Telefon oder E-Mail suchen…"
              value={clientName}
              onChange={(v) => {
                setClientName(v);
                setClientId(null);
              }}
              onSelect={handleClientSelect}
            />
            {clientId ? (
              <p className="mt-1.5 flex items-center gap-1 text-[10px] text-editorial-pulse/80">
                <span>✓</span> Bestehender Kunde — Profil verknüpft
              </p>
            ) : clientName.trim() ? (
              <p className="mt-1.5 text-[10px] text-deep-charcoal/35">
                Kein Treffer — Name wird als neuer Gast eingetragen
              </p>
            ) : null}
          </div>

          {/* Phone + Staff row */}
          <div className="grid grid-cols-2 border-b border-deep-charcoal/[0.07]">
            <div className="border-r border-deep-charcoal/[0.07] p-5">
              <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
                Telefon
              </p>
              <input
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="+49 170 …"
                className="luxury-field w-full"
              />
            </div>
            <div className="p-5">
              <LuxurySelectMenu
                label="Mitarbeiter"
                value={staffId}
                onChange={setStaffId}
                options={staff.map((s) => ({ value: String(s.id), label: s.displayName }))}
                placeholder="Wählen…"
              />
            </div>
          </div>

          {/* Service */}
          <div className="border-b border-deep-charcoal/[0.07] p-5">
            <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
              Service / Behandlung
            </p>
            <input
              type="text"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              className="luxury-field w-full"
            />
          </div>

          {/* Date + Time row */}
          <div className="grid grid-cols-2 border-b border-deep-charcoal/[0.07]">
            <div className="border-r border-deep-charcoal/[0.07] p-5">
              <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
                {isHistorical ? "Datum (Vergangenheit möglich)" : "Datum"}
              </p>
              <LuxuryDatePicker
                label=""
                value={dateYmd}
                onChange={setDateYmd}
                yearSpan={{ before: isHistorical ? 10 : 0, after: 2 }}
              />
            </div>
            <div className="p-5">
              <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
                Uhrzeit
              </p>
              <div className="flex items-center gap-2">
                <LuxurySelectMenu
                  label="Std"
                  value={String(startHour)}
                  onChange={(v) => setStartHour(Number(v))}
                  options={HOUR_OPTS}
                />
                <span className="text-deep-charcoal/30 font-light">:</span>
                <LuxurySelectMenu
                  label="Min"
                  value={String(startMinute)}
                  onChange={(v) => setStartMinute(Number(v))}
                  options={MIN_OPTS}
                />
              </div>
            </div>
          </div>

          {/* Duration row */}
          <div className="border-b border-deep-charcoal/[0.07] p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
                Dauer
              </p>
              <p className="text-[11px] font-medium text-deep-charcoal/70">
                Ende:{" "}
                <span className="font-semibold text-editorial-pulse">
                  {formatBerlinTimeHHmm(endMs)}
                </span>
                <span className="ml-2 text-deep-charcoal/40">({durationLabel})</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((p) => (
                <button
                  key={p.minutes}
                  type="button"
                  onClick={() => handleDurationPreset(p.minutes)}
                  className={`h-8 px-3 text-[11px] font-medium uppercase tracking-[0.1em] transition ${
                    durationMin === p.minutes && !showCustom
                      ? "border border-editorial-pulse bg-editorial-pulse/10 text-editorial-pulse"
                      : "border border-deep-charcoal/10 bg-gray-100/50 text-deep-charcoal/60 hover:border-deep-charcoal/20 hover:text-deep-charcoal/80"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCustom((v) => !v)}
                className={`h-8 px-3 text-[11px] font-medium uppercase tracking-[0.1em] transition ${
                  showCustom
                    ? "border border-champagne-gold/60 bg-champagne-gold/10 text-champagne-gold"
                    : "border border-dashed border-deep-charcoal/15 text-deep-charcoal/40 hover:border-deep-charcoal/25"
                }`}
              >
                Individuell
              </button>
            </div>
            {showCustom && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min="5"
                  max="600"
                  step="5"
                  value={customDur}
                  onChange={(e) => setCustomDur(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCustomApply()}
                  placeholder="Minuten eingeben"
                  className="luxury-field w-40"
                  autoFocus
                />
                <span className="text-[11px] text-deep-charcoal/40">Min</span>
                <button
                  type="button"
                  onClick={handleCustomApply}
                  className="h-8 px-4 text-[11px] uppercase tracking-[0.12em] border border-deep-charcoal/15 text-deep-charcoal/60 hover:bg-gray-100/60 transition"
                >
                  Übernehmen
                </button>
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between px-5 py-4">
            {msg ? (
              <p className={`text-[12px] ${msg.startsWith("✓") ? "text-green-600" : "text-red-500/90"}`}>
                {msg}
              </p>
            ) : (
              <p className="text-[11px] text-deep-charcoal/30">
                {isHistorical ? "Historischer Termin — kein Check-in erforderlich" : "Termin wird sofort im Raster sichtbar"}
              </p>
            )}
            <button
              type="button"
              disabled={busy || !clientName.trim() || !staffId}
              onClick={createAppt}
              className="editorial-pulse-fill min-h-10 px-8 text-[12px] font-medium uppercase tracking-[0.22em] transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Speichern…" : isHistorical ? "Historisch speichern" : "Termin anlegen"}
            </button>
          </div>
        </div>

        {/* ── Today's appointments ── */}
        <div className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-xl uppercase tracking-[0.08em] text-deep-charcoal/80">
              Heutige Termine
            </h2>
            <button
              type="button"
              onClick={load}
              className="text-[10px] uppercase tracking-[0.2em] text-deep-charcoal/35 hover:text-deep-charcoal/60 transition"
            >
              ↻ Aktualisieren
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="border border-dashed border-deep-charcoal/10 py-16 text-center">
              <p className="text-[11px] uppercase tracking-[0.25em] text-deep-charcoal/30">
                Noch keine Termine heute
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {rows
                .slice()
                .sort((a, b) => new Date(a.startAt as string).getTime() - new Date(b.startAt as string).getTime())
                .map((a) => {
                  const start = new Date(a.startAt as string);
                  const end   = new Date(a.endAt as string);
                  const durMs = end.getTime() - start.getTime();
                  const durMins = Math.round(durMs / 60_000);
                  const h = Math.floor(durMins / 60);
                  const m = durMins % 60;
                  const durStr = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
                  const statusCls = STATUS_COLORS[a.status] ?? "text-deep-charcoal/40 bg-gray-50 border-gray-200";

                  return (
                    <div
                      key={a.id}
                      className="border border-deep-charcoal/[0.07] bg-white/80 transition hover:bg-white"
                    >
                      <div className="flex items-stretch">
                        {/* Time block */}
                        <div className="flex w-24 shrink-0 flex-col items-center justify-center border-r border-deep-charcoal/[0.07] py-4 px-2 text-center">
                          <p className="font-mono text-sm font-medium tabular-nums text-editorial-pulse">
                            {formatBerlinTimeHHmm(start.getTime())}
                          </p>
                          <p className="font-mono text-xs text-deep-charcoal/35 tabular-nums">
                            {formatBerlinTimeHHmm(end.getTime())}
                          </p>
                          <p className="mt-1 text-[9px] uppercase tracking-wider text-deep-charcoal/30">
                            {durStr}
                          </p>
                        </div>

                        {/* Client card */}
                        <div className="min-w-0 flex-1 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-sm text-deep-charcoal/90 truncate">
                                {a.clientName}
                              </p>
                              {a.clientPhone && (
                                <p className="text-[11px] text-deep-charcoal/40 truncate">
                                  {a.clientPhone}
                                </p>
                              )}
                              <p className="mt-1 text-[11px] text-deep-charcoal/55 truncate">
                                {a.serviceName}
                              </p>
                              <p className="mt-0.5 text-[10px] uppercase tracking-[0.15em] text-deep-charcoal/35">
                                {staffMap.get(a.staffId) ?? `#${a.staffId}`}
                              </p>
                            </div>
                            <span className={`shrink-0 self-start rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${statusCls}`}>
                              {STATUS_LABELS[a.status] ?? a.status}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex shrink-0 flex-col items-center justify-center border-l border-deep-charcoal/[0.07] px-3 py-3 gap-1.5">
                          {a.status === "booked" && (
                            <button
                              type="button"
                              onClick={() => checkIn(a.id)}
                              className="h-8 px-4 text-[10px] font-medium uppercase tracking-wider border border-editorial-pulse bg-editorial-pulse/10 text-editorial-pulse transition hover:bg-editorial-pulse/20"
                            >
                              Check-in
                            </button>
                          )}
                          {a.status === "checked_in" && (
                            <button
                              type="button"
                              onClick={() => checkIn(a.id)}
                              className="h-8 px-4 text-[10px] font-medium uppercase tracking-wider border border-champagne-gold bg-champagne-gold/10 text-champagne-gold transition hover:bg-champagne-gold/20"
                            >
                              → Session
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
