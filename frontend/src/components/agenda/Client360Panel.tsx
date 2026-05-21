/**
 * Client360Panel — The "Client Brain" right-column panel for the Agenda.
 *
 * Sections (in order):
 *  1. Appointment header (name, time, service, status chip, soft-complete button)
 *  2. Micro-preferences (☕ drink, 🤫 silent mode, 🌿 allergy/notes)
 *  3. Last formula — highlighted, copyable
 *  4. Quick stats (visits, spend, reliability, debt)
 *  5. Loyalty badge
 *  6. Inline note add
 *  7. Inline formula add
 *  8. Visit timeline (last 5)
 *  9. → Open full profile button
 */

import { useState, useCallback } from "react";
import { apiPatch, apiPost } from "../../api";
import { useClient360 } from "../../hooks/useClient360";
import { formatBerlinTimeHHmm } from "../../lib/formatTime";
import type { TodayAppointmentRow } from "../../hooks/useTodayAppointments";

/* ─── tiny helpers ─── */
function eur(cents: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

function relDate(ts: number | string): string {
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Heute";
  if (days === 1) return "Gestern";
  if (days < 30) return `vor ${days}d`;
  if (days < 365) return `vor ${Math.floor(days / 30)}Mo`;
  return `vor ${Math.floor(days / 365)}J`;
}

/* ─── status chip ─── */
const STATUS_COLORS: Record<string, string> = {
  booked: "text-sky-400 border-sky-400/30 bg-sky-400/10",
  checked_in: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  completed: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  canceled: "text-red-400 border-red-400/30 bg-red-400/10",
  no_show: "text-red-500 border-red-500/30 bg-red-500/10",
};

/* ─── preference pill ─── */
function PrefPill({
  icon,
  label,
  value,
  onSave,
  placeholder,
}: {
  icon: string;
  label: string;
  value: string | null | undefined;
  onSave: (v: string | null) => Promise<void>;
  placeholder: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    setSaving(true);
    await onSave(draft.trim() || null);
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-sm">{icon}</span>
        <input
          autoFocus
          className="flex-1 border-b border-editorial-pulse/50 bg-transparent text-[11px] text-deep-charcoal/80 outline-none placeholder:text-deep-charcoal/25"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") {
              setDraft(value ?? "");
              setEditing(false);
            }
          }}
        />
        <button
          type="button"
          className="text-[10px] text-editorial-pulse disabled:opacity-40"
          disabled={saving}
          onClick={() => void commit()}
        >
          {saving ? "…" : "✓"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="group flex items-center gap-1.5 text-left"
      onClick={() => {
        setDraft(value ?? "");
        setEditing(true);
      }}
      title={label}
    >
      <span className="text-sm">{icon}</span>
      <span
        className={`text-[11px] ${value ? "text-deep-charcoal/70" : "text-deep-charcoal/25 italic"} group-hover:text-deep-charcoal/90 transition`}
      >
        {value || placeholder}
      </span>
      <span className="text-[9px] text-deep-charcoal/20 group-hover:text-deep-charcoal/40">✎</span>
    </button>
  );
}

/* ─── quick textarea for inline note / formula ─── */
function InlineAdd({
  label,
  placeholder,
  mono,
  onSave,
}: {
  label: string;
  placeholder: string;
  mono?: boolean;
  onSave: (text: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await onSave(text.trim());
      setText("");
      setDone(true);
      setTimeout(() => {
        setDone(false);
        setOpen(false);
      }, 1200);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-deep-charcoal/30 hover:text-editorial-pulse transition"
      >
        <span className="text-base leading-none">+</span> {label}
      </button>
    );
  }

  return (
    <div className="mt-1 space-y-1">
      <textarea
        autoFocus
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className={`w-full resize-none border border-deep-charcoal/10 bg-gray-100/50 px-2 py-1.5 text-[11px] text-deep-charcoal/80 outline-none focus:border-editorial-pulse/40 placeholder:text-deep-charcoal/20 ${mono ? "font-mono" : ""}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
          if (e.key === "Escape") {
            setText("");
            setOpen(false);
          }
        }}
      />
      <div className="flex gap-1">
        <button
          type="button"
          className="h-6 flex-1 border border-editorial-pulse/50 bg-editorial-pulse/10 text-[10px] uppercase tracking-wider text-editorial-pulse hover:bg-editorial-pulse/20 disabled:opacity-40"
          disabled={saving || !text.trim()}
          onClick={() => void submit()}
        >
          {done ? "✓ Gespeichert" : saving ? "…" : "Speichern"}
        </button>
        <button
          type="button"
          className="h-6 border border-deep-charcoal/10 px-2 text-[10px] text-deep-charcoal/40 hover:text-deep-charcoal/70"
          onClick={() => {
            setText("");
            setOpen(false);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Empty / slot states
   ═══════════════════════════════════════════════════════════════════════ */
export function Client360EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-3xl opacity-20">✦</div>
      <p className="text-[11px] uppercase tracking-[0.2em] text-deep-charcoal/25">
        Kundenakte
      </p>
      <p className="text-[10px] text-deep-charcoal/15 leading-relaxed">
        Termin anklicken —<br />Rezepturen, Präferenzen<br />und Verlauf erscheinen hier.
      </p>
    </div>
  );
}

export function Client360SlotState({
  staffName,
  label,
}: {
  staffName: string;
  label: string;
}) {
  return (
    <div className="p-5 space-y-1">
      <p className="text-[10px] uppercase tracking-[0.2em] text-deep-charcoal/30">Freier Slot</p>
      <p className="font-heading text-xl uppercase tracking-wider text-editorial-pulse">{label}</p>
      <p className="text-xs text-deep-charcoal/40">{staffName}</p>
      <p className="pt-3 text-[10px] text-deep-charcoal/20">→ Termin direkt im Raster anlegen</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Main Client Brain panel
   ═══════════════════════════════════════════════════════════════════════ */
export function Client360Panel({
  appointment,
  staffById,
  onSessionComplete,
  onOpenProfile,
  fiscalActive,
}: {
  appointment: TodayAppointmentRow;
  staffById: Map<number, string>;
  onSessionComplete: (sessionId: number) => void;
  onOpenProfile: (clientId: number) => void;
  fiscalActive: boolean;
}) {
  const clientId = appointment.clientId ?? null;
  const { data, loading, refresh } = useClient360(clientId);

  /* ── preference save ── */
  const saveOpsField = useCallback(
    async (field: string, value: string | null) => {
      if (clientId == null) return;
      await apiPatch(`/api/clients/${clientId}/ops-fields`, { [field]: value });
      await refresh();
    },
    [clientId, refresh],
  );

  /* ── add note ── */
  const addNote = useCallback(
    async (text: string) => {
      if (clientId == null) return;
      await apiPost(`/api/clients/${clientId}/notes`, { noteText: text });
      await refresh();
    },
    [clientId, refresh],
  );

  /* ── add formula ── */
  const addFormula = useCallback(
    async (text: string) => {
      if (clientId == null) return;
      await apiPost(`/api/clients/${clientId}/formulas`, { formulaText: text });
      await refresh();
    },
    [clientId, refresh],
  );

  /* ── soft-complete session ── */
  const [completing, setCompleting] = useState(false);
  const [completeMsg, setCompleteMsg] = useState("");

  const softComplete = async () => {
    const sessionId = (appointment as unknown as { sessionId?: number }).sessionId;
    if (!sessionId) {
      setCompleteMsg("Keine aktive Session verknüpft.");
      return;
    }
    setCompleting(true);
    setCompleteMsg("");
    try {
      await apiPost(`/api/sessions/${sessionId}/soft-complete`, {});
      setCompleteMsg("✓ Abgeschlossen");
      onSessionComplete(sessionId);
    } catch (e) {
      setCompleteMsg(e instanceof Error ? e.message : "Fehler");
    } finally {
      setCompleting(false);
    }
  };

  const statusChip = STATUS_COLORS[appointment.status] ?? "text-deep-charcoal/40 border-deep-charcoal/10";
  const staffName = staffById.get(appointment.staffId) ?? `#${appointment.staffId}`;

  return (
    <div className="flex h-full flex-col overflow-y-auto text-deep-charcoal">
      {/* ── 1. Appointment header ── */}
      <div className="shrink-0 border-b border-deep-charcoal/[0.06] p-4 space-y-1">
        <p className="text-[10px] uppercase tracking-[0.2em] text-deep-charcoal/35">Termin</p>
        <p className="font-heading text-[22px] uppercase tracking-wider text-editorial-pulse leading-tight">
          {appointment.clientName}
        </p>
        <p className="text-[11px] text-deep-charcoal/50">
          {formatBerlinTimeHHmm(appointment.startAt)} – {formatBerlinTimeHHmm(appointment.endAt)}
          {" · "}
          {staffName}
        </p>
        <p className="text-[12px] text-deep-charcoal/70">{appointment.serviceName}</p>

        <div className="flex items-center justify-between pt-1">
          <span
            className={`inline-flex items-center border px-2 py-0.5 text-[9px] uppercase tracking-wider ${statusChip}`}
          >
            {appointment.status}
          </span>

          {/* Soft-complete button — shown for checked_in appointments, hidden when fiscal is active */}
          {appointment.status === "checked_in" && !fiscalActive && (
            <button
              type="button"
              disabled={completing}
              onClick={() => void softComplete()}
              className="border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-wider text-emerald-400 hover:bg-emerald-500/20 transition disabled:opacity-40"
            >
              {completing ? "…" : "✓ Abschließen"}
            </button>
          )}
        </div>
        {completeMsg && (
          <p className="text-[10px] text-emerald-400">{completeMsg}</p>
        )}
      </div>

      {/* ── 2. Micro-preferences ── */}
      {clientId != null && (
        <div className="shrink-0 border-b border-deep-charcoal/[0.06] p-4 space-y-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-deep-charcoal/30 mb-3">
            Präferenzen
          </p>

          <PrefPill
            icon="☕"
            label="Getränk"
            value={data?.client.hospitalityDrink}
            placeholder="Getränkewunsch…"
            onSave={(v) => saveOpsField("hospitalityDrink", v)}
          />
          <PrefPill
            icon="🤫"
            label="Gesprächsmodus"
            value={data?.client.hospitalityConversation}
            placeholder="z.B. Stille bevorzugt…"
            onSave={(v) => saveOpsField("hospitalityConversation", v)}
          />
          <PrefPill
            icon="💺"
            label="Sitzplatz"
            value={data?.client.hospitalitySeat}
            placeholder="z.B. Fensterplatz, Sessel…"
            onSave={(v) => saveOpsField("hospitalitySeat", v)}
          />

          {/* Session handover note — today only */}
          <div className="pt-1 border-t border-deep-charcoal/[0.04]">
            <p className="mb-1 text-[9px] uppercase tracking-wider text-deep-charcoal/20">
              Übergabenotiz (heute)
            </p>
            <PrefPill
              icon="📋"
              label="Übergabe"
              value={data?.client.sessionHandoverNote}
              placeholder="Notiz für heute…"
              onSave={(v) => saveOpsField("sessionHandoverNote", v)}
            />
          </div>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="p-4 space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-3 rounded bg-gray-100/60" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* ── 3. Last formula — hero display ── */}
          {data.formulas.length > 0 && (
            <div className="shrink-0 border-b border-deep-charcoal/[0.06] p-4">
              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-deep-charcoal/30">
                Letzte Rezeptur
              </p>
              <div className="border-l-2 border-editorial-pulse/60 pl-3 space-y-0.5">
                <p className="font-mono text-[13px] text-deep-charcoal/90 leading-snug">
                  {data.formulas[0]!.formulaText}
                </p>
                {data.formulas[0]!.notes && (
                  <p className="text-[11px] text-deep-charcoal/45">{data.formulas[0]!.notes}</p>
                )}
                <p className="text-[9px] text-deep-charcoal/25">
                  {relDate(data.formulas[0]!.createdAt as number)}
                </p>
              </div>

              {/* Previous formulas collapsed */}
              {data.formulas.length > 1 && (
                <div className="mt-2 space-y-1">
                  {data.formulas.slice(1, 3).map((f) => (
                    <div key={f.id} className="border-l border-deep-charcoal/10 pl-3">
                      <p className="font-mono text-[10px] text-deep-charcoal/45">{f.formulaText}</p>
                      <p className="text-[9px] text-deep-charcoal/20">{relDate(f.createdAt as number)}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Inline add formula */}
              <div className="mt-3">
                <InlineAdd
                  label="Rezeptur hinzufügen"
                  placeholder="z.B. 30ml 7-77 + 15ml 0-00 + 9% Oxidant"
                  mono
                  onSave={addFormula}
                />
              </div>
            </div>
          )}

          {/* Formula add when no formulas yet */}
          {data.formulas.length === 0 && clientId != null && (
            <div className="shrink-0 border-b border-deep-charcoal/[0.06] p-4">
              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-deep-charcoal/30">
                Rezeptur
              </p>
              <p className="mb-2 text-[10px] text-deep-charcoal/20 italic">Noch keine Rezeptur</p>
              <InlineAdd
                label="Erste Rezeptur anlegen"
                placeholder="z.B. 30ml 7-77 + 15ml 0-00 + 9%"
                mono
                onSave={addFormula}
              />
            </div>
          )}

          {/* ── 4. Quick stats grid ── */}
          <div className="shrink-0 grid grid-cols-2 gap-px bg-gray-100/50">
            {[
              { label: "Besuche", value: data.completedVisitCount },
              {
                label: "Umsatz",
                value: eur(data.totalSpendCents),
                red: false,
              },
              {
                label: "Zuverlässigkeit",
                value: `${data.reliabilityScore}%`,
                accent:
                  data.reliabilityScore >= 80
                    ? "text-emerald-400"
                    : data.reliabilityScore >= 50
                      ? "text-amber-400"
                      : "text-red-400",
              },
              {
                label: "Offen",
                value: eur(data.openDebtCents),
                accent: data.openDebtCents > 0 ? "text-red-400" : undefined,
              },
            ].map(({ label, value, accent }) => (
              <div key={label} className="bg-gray-100 p-3">
                <p className="text-[9px] uppercase tracking-wider text-deep-charcoal/25">{label}</p>
                <p className={`font-mono text-[15px] font-light ${accent ?? "text-deep-charcoal/75"}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* ── 5. Loyalty badge ── */}
          {data.loyaltyBadgeLabel && (
            <div className="shrink-0 border-b border-deep-charcoal/[0.06] px-4 py-2 flex items-center gap-2">
              <span className="border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
                {data.loyaltyBadgeLabel}
              </span>
              {data.loyaltyBadgeDetail && (
                <span className="text-[10px] text-deep-charcoal/30">{data.loyaltyBadgeDetail}</span>
              )}
            </div>
          )}

          {/* No-show warning */}
          {data.noShowFlag && (
            <div className="shrink-0 border-b border-red-900/30 bg-red-950/20 px-4 py-2">
              <p className="text-[10px] text-red-400">⚠ Mehrere No-Shows / Absagen</p>
            </div>
          )}

          {/* ── 6. Inline note add ── */}
          {clientId != null && (
            <div className="shrink-0 border-b border-deep-charcoal/[0.06] p-4">
              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-deep-charcoal/30">
                Notizen
              </p>
              {data.notes.slice(0, 2).map((n) => (
                <p key={n.id} className="mb-1 text-[11px] text-deep-charcoal/50 leading-snug">
                  {n.noteText}
                  <span className="ml-1 text-[9px] text-deep-charcoal/20">
                    {relDate(n.createdAt as number)}
                  </span>
                </p>
              ))}
              <InlineAdd
                label="Notiz hinzufügen"
                placeholder="Dauerhafte Kundennotiz…"
                onSave={addNote}
              />
            </div>
          )}

          {/* ── 7. Visit timeline ── */}
          {data.timeline.length > 0 && (
            <div className="shrink-0 border-b border-deep-charcoal/[0.06] p-4">
              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-deep-charcoal/30">
                Verlauf
              </p>
              <div className="space-y-2">
                {data.timeline.slice(0, 5).map((row) => (
                  <div key={row.id} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        row.kind === "formula"
                          ? "bg-editorial-pulse/70"
                          : row.kind === "invoice"
                            ? "bg-emerald-500/70"
                            : "bg-white/20"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-[11px] text-deep-charcoal/60 truncate">{row.subtitle}</p>
                      <p className="text-[9px] text-deep-charcoal/25">
                        {row.staffName ?? "—"}
                        {row.amountCents != null ? ` · ${eur(row.amountCents)}` : ""}
                        {" · "}
                        {relDate(row.ts)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── 9. Open full profile ── */}
      {clientId != null && (
        <div className="shrink-0 p-4">
          <button
            type="button"
            className="w-full border border-deep-charcoal/10 py-2 text-[10px] uppercase tracking-wider text-deep-charcoal/40 transition hover:bg-gray-100/50 hover:text-deep-charcoal/70"
            onClick={() => onOpenProfile(clientId)}
          >
            Vollständige Akte →
          </button>
        </div>
      )}
    </div>
  );
}
