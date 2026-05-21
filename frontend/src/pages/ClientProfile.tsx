import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { apiPatch, apiPost } from "../api";
import { useClient360 } from "../hooks/useClient360";
import { useSalonRuntimeConfig } from "../hooks/useSalonRuntimeConfig";
import { formatBerlinDateTime } from "../lib/formatTime";
import { useClient360Store } from "../store/client360Store";
import { luxurySpring } from "../lib/motionPresets";
import { useUiShellStore } from "../store/uiShellStore";
import { LuxuryDatePicker } from "../components/ui/LuxuryDatePicker";
import { luxuryButtonGhost } from "../lib/luxuryUi";
import { EditClientModal } from "../components/ui/EditClientModal";

function formatEur(cents: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function toBerlinDateInput(patchTestAt?: string | null): string {
  if (patchTestAt == null || patchTestAt === "") return "";
  const t = new Date(patchTestAt).getTime();
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

function privacyBlur(on: boolean): string {
  return on
    ? "blur-[8px] brightness-75 select-none saturate-50"
    : "";
}

export function ClientProfile() {
  const open = useClient360Store((s) => s.open);
  const clientId = useClient360Store((s) => s.clientId);
  const sourceSessionId = useClient360Store((s) => s.sourceSessionId);
  const closeProfile = useClient360Store((s) => s.closeProfile);
  const morphAppointmentId = useUiShellStore((s) => s.morphAppointmentId);
  const prefersReducedMotion = useUiShellStore((s) => s.prefersReducedMotion);
  const { client360Features } = useSalonRuntimeConfig();
  const { data, loading, error, refresh } = useClient360(clientId);
  const [tab, setTab] = useState<"timeline" | "formulas" | "notes">("timeline");
  const [busyAnonymize, setBusyAnonymize] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [busyOps, setBusyOps] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [patchDateStr, setPatchDateStr] = useState("");
  const [hospitalityDrink, setHospitalityDrink] = useState("");
  const [hospitalityConversation, setHospitalityConversation] = useState("");
  const [hospitalitySeat, setHospitalitySeat] = useState("");
  const [sessionHandover, setSessionHandover] = useState("");

  useEffect(() => {
    if (!open) useUiShellStore.getState().setMorphAppointmentId(null);
  }, [open]);

  const clientSyncKey = data?.client
    ? [
        data.client.id,
        data.client.patchTestAt ?? "",
        data.client.hospitalityDrink ?? "",
        data.client.hospitalityConversation ?? "",
        data.client.hospitalitySeat ?? "",
        data.client.sessionHandoverNote ?? "",
      ].join("|")
    : "";

  useEffect(() => {
    if (!clientSyncKey) return;
    const c = data?.client;
    if (!c) return;
    setPatchDateStr(toBerlinDateInput(c.patchTestAt ?? null));
    setHospitalityDrink(c.hospitalityDrink ?? "");
    setHospitalityConversation(c.hospitalityConversation ?? "");
    setHospitalitySeat(c.hospitalitySeat ?? "");
    setSessionHandover(c.sessionHandoverNote ?? "");
    /* Key: stable server-field fingerprint only — `data.client` identity can thrash on refetch */
  }, [clientSyncKey]);

  if (!open || clientId == null) return null;

  const anonymized = data?.client.anonymizedAt != null;
  const displayName = anonymized
    ? `Anonymisierter Kunde ${data?.client.id ?? clientId}`
    : (data?.client.name ?? `Kunde ${clientId}`);

  const softPreference =
    hospitalityDrink || hospitalityConversation || hospitalitySeat
      ? [hospitalityDrink, hospitalityConversation, hospitalitySeat]
          .map((s) => s.trim())
          .filter(Boolean)
          .join(" · ")
      : (data?.notes?.[0]?.noteText ?? "Keine Präferenz hinterlegt");

  const debtCents = data?.openDebtCents ?? 0;
  const balanceLabel =
    debtCents > 0
      ? `Offen: ${formatEur(debtCents)}`
      : "Keine offenen Posten";

  const saveOpsFields = async () => {
    if (!data?.client.id) return;
    setBusyOps(true);
    try {
      const body: Record<string, unknown> = {
        sessionHandoverNote: sessionHandover.trim() || null,
      };
      if (client360Features.patchTest) {
        if (patchDateStr.trim() === "") {
          body.patchTestAt = null;
        } else {
          const p = patchDateStr.trim().split("-").map(Number);
          if (p.length === 3 && p.every((n) => Number.isFinite(n))) {
            body.patchTestAt = Date.UTC(p[0], p[1] - 1, p[2], 10, 0, 0, 0);
          }
        }
      }
      if (client360Features.hospitality) {
        body.hospitalityDrink = hospitalityDrink.trim() || null;
        body.hospitalityConversation = hospitalityConversation.trim() || null;
        body.hospitalitySeat = hospitalitySeat.trim() || null;
      }
      await apiPatch(`/api/clients/${data.client.id}/ops-fields`, body);
      await refresh();
    } finally {
      setBusyOps(false);
    }
  };

  const patchAlert =
    client360Features.patchTest &&
    !anonymized &&
    data?.patchTestWarning === true;

  const morphLayoutId =
    morphAppointmentId != null && !prefersReducedMotion ? `agenda-apt-${morphAppointmentId}` : undefined;

  return (
    <div className="fixed inset-0 z-[260] flex justify-end bg-gray-100/60 p-0  sm:p-2">
      <motion.aside
        layoutId={morphLayoutId}
        transition={luxurySpring}
        className="h-full w-full max-w-2xl overflow-y-auto border-l-2 border-brushed-chrome/40 bg-gray-200/90 text-deep-charcoal shadow-luxury"
        style={{
          boxShadow:
            "0 0 0 1px rgba(212,175,55,0.06), 0 24px 64px -12px rgba(0,0,0,0.55), 0 12px 40px -8px rgba(212,175,55,0.06)",
        }}
      >
        <header className="sticky top-0 z-10 border-b border-brushed-chrome bg-gray-100/95 p-4 ">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-heading font-bold">{displayName}</h2>
              <p className="mt-1 text-sm text-brushed-chrome">
                Kundenakte 360 · Zuverlässigkeit {data?.reliabilityScore ?? 0}%
                {data?.noShowFlag ? " · Hinweis: Vorab bestätigen" : ""}
              </p>
              {client360Features.loyaltyBadge && data?.loyaltyBadgeLabel && !anonymized && (
                <p className="mt-2 inline-block border border-oak-wood/80 bg-oak-wood/25 px-3 py-1 text-xs font-bold uppercase tracking-wide text-deep-charcoal">
                  {data.loyaltyBadgeLabel}
                  <span className="ml-2 font-normal capitalize">
                    — {data.loyaltyBadgeDetail}
                  </span>
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              {client360Features.privacyToggle && (
                <button
                  type="button"
                  className={`min-h-touch border px-4 text-xs font-bold ${
                    privacyMode
                      ? "border-oak-wood bg-oak-wood text-deep-charcoal"
                      : "border-brushed-chrome text-deep-charcoal"
                  }`}
                  onClick={() => setPrivacyMode(!privacyMode)}
                >
                  {privacyMode ? "Kundenmodus: An" : "Kundenmodus: Aus"}
                </button>
              )}
              {!anonymized && (
                <button
                  type="button"
                  className="min-h-touch border border-oak-wood bg-oak-wood/20 px-4 text-sm font-semibold text-deep-charcoal"
                  onClick={() => setEditOpen(true)}
                >
                  Bearbeiten
                </button>
              )}
              <button
                type="button"
                className="min-h-touch border border-brushed-chrome px-4 text-sm font-semibold"
                onClick={closeProfile}
              >
                Schließen
              </button>
            </div>
          </div>

          {patchAlert && (
            <div className="mt-3 border border-red-900/70 bg-red-950/55 px-3 py-2 text-sm font-semibold text-red-100">
              Achtung: Allergietest erforderlich — letzter Test fehlt oder &gt; 6 Monate. Vor
              chemischen Dienstleistungen dokumentieren.
            </div>
          )}

          <div
            className={`mt-3 grid gap-2 border-t border-brushed-chrome pt-3 text-sm sm:grid-cols-3 ${privacyBlur(privacyMode && client360Features.privacyToggle)}`}
          >
            <div className="border border-brushed-chrome/40 px-3 py-2">
              <p className="text-brushed-chrome">
                {client360Features.hospitality ? "Bewirtung (Kurz)" : "Soft Preferences"}
              </p>
              <p className="line-clamp-2">{softPreference}</p>
            </div>
            <div className={`border px-3 py-2 ${debtCents > 0 ? "border-oak-wood bg-oak-wood/15" : "border-brushed-chrome/40"}`}>
              <p className="text-brushed-chrome">Kontostand</p>
              <p className="font-semibold">{balanceLabel}</p>
            </div>
            <div className="border border-brushed-chrome/40 px-3 py-2">
              <p className="text-brushed-chrome">Umsatz (letzte Belege)</p>
              <p>{formatEur(data?.totalSpendCents ?? 0)}</p>
            </div>
          </div>

          {/* Adresse & Kontakt */}
          {!anonymized && data?.client && (
            <div
              className={`mt-3 border-t border-brushed-chrome pt-3 ${privacyBlur(privacyMode && client360Features.privacyToggle)}`}
            >
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-brushed-chrome">
                Adresse & Kontakt
              </p>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="border border-brushed-chrome/40 px-3 py-2">
                  <p className="text-xs text-brushed-chrome">Telefon</p>
                  <p>{data.client.phone || "—"}</p>
                </div>
                <div className="border border-brushed-chrome/40 px-3 py-2">
                  <p className="text-xs text-brushed-chrome">E-Mail</p>
                  <p className="truncate">{data.client.email || "—"}</p>
                </div>
                <div className="border border-brushed-chrome/40 px-3 py-2 sm:col-span-2">
                  <p className="text-xs text-brushed-chrome">Anschrift</p>
                  {data.client.street || data.client.city ? (
                    <p>
                      {[data.client.street, data.client.houseNumber].filter(Boolean).join(" ")}
                      {(data.client.street || data.client.houseNumber) && (data.client.postalCode || data.client.city) && ", "}
                      {[data.client.postalCode, data.client.city].filter(Boolean).join(" ")}
                      {data.client.country ? `, ${data.client.country}` : ""}
                    </p>
                  ) : (
                    <p className="text-brushed-chrome">— Nicht erfasst —</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!anonymized && (
            <section className="mt-4 space-y-3 border-t border-brushed-chrome pt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-brushed-chrome">
                Aktenpflege · Team
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {client360Features.patchTest && (
                  <div className="flex flex-col gap-2 text-sm">
                    <span className="text-xs font-medium uppercase tracking-wider text-deep-charcoal/40">
                      Epikutantest (Datum)
                    </span>
                    {patchDateStr.length === 10 ? (
                      <>
                        <LuxuryDatePicker
                          label=""
                          value={patchDateStr}
                          onChange={setPatchDateStr}
                          yearSpan={{ before: 10, after: 2 }}
                          className="[&_button]:border-brushed-chrome/40"
                        />
                        <button
                          type="button"
                          className={`${luxuryButtonGhost} min-h-12 w-full text-sm`}
                          onClick={() => setPatchDateStr("")}
                        >
                          Datum entfernen (kein Test erfasst)
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={`${luxuryButtonGhost} min-h-touch w-full justify-center text-base`}
                        onClick={() =>
                          setPatchDateStr(new Date().toISOString().slice(0, 10))
                        }
                      >
                        Epikutantest-Datum erfassen…
                      </button>
                    )}
                  </div>
                )}
                {client360Features.hospitality && (
                  <>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-brushed-chrome">Getränk</span>
                      <input
                        value={hospitalityDrink}
                        onChange={(e) => setHospitalityDrink(e.target.value)}
                        className="min-h-touch border border-brushed-chrome bg-gray-100 px-2"
                        placeholder="z. B. Espresso ohne Zucker"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-brushed-chrome">Gespräch</span>
                      <input
                        value={hospitalityConversation}
                        onChange={(e) => setHospitalityConversation(e.target.value)}
                        className="min-h-touch border border-brushed-chrome bg-gray-100 px-2"
                        placeholder='z. B. „Quiet Service"'
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                      <span className="text-brushed-chrome">Lieblingsplatz</span>
                      <input
                        value={hospitalitySeat}
                        onChange={(e) => setHospitalitySeat(e.target.value)}
                        className="min-h-touch border border-brushed-chrome bg-gray-100 px-2"
                        placeholder="z. B. Platz am Fenster"
                      />
                    </label>
                  </>
                )}
              </div>

              <div
                className={privacyBlur(privacyMode && client360Features.privacyToggle)}
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-deep-charcoal">Übergabe dieser Sitzung</span>
                  <span className="text-xs text-brushed-chrome">
                    Zwischen Kollegen · nach Kalendertagwechsel (Europe/Berlin) verworfen.
                  </span>
                  <textarea
                    value={sessionHandover}
                    onChange={(e) => setSessionHandover(e.target.value)}
                    rows={3}
                    className="min-h-touch w-full border border-brushed-chrome bg-gray-100 px-2 py-2 text-sm text-deep-charcoal"
                    placeholder="z. B. Hinweise vom Wasch-Service"
                  />
                </label>
              </div>

              <button
                type="button"
                disabled={busyOps || loading}
                onClick={() => void saveOpsFields()}
                className="min-h-touch bg-oak-wood px-4 text-sm font-bold text-deep-charcoal disabled:opacity-50"
              >
                {busyOps ? "…" : "Aktenfelder speichern"}
              </button>
            </section>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={`min-h-touch border px-4 text-sm font-semibold ${
                tab === "timeline"
                  ? "border-oak-wood bg-oak-wood text-deep-charcoal"
                  : "border-brushed-chrome text-deep-charcoal"
              }`}
              onClick={() => setTab("timeline")}
            >
              Verlauf
            </button>
            <button
              type="button"
              className={`min-h-touch border px-4 text-sm font-semibold ${
                tab === "formulas"
                  ? "border-oak-wood bg-oak-wood text-deep-charcoal"
                  : "border-brushed-chrome text-deep-charcoal"
              }`}
              onClick={() => setTab("formulas")}
            >
              Rezepturen
            </button>
            <button
              type="button"
              className={`min-h-touch border px-4 text-sm font-semibold ${
                tab === "notes"
                  ? "border-oak-wood bg-oak-wood text-deep-charcoal"
                  : "border-brushed-chrome text-deep-charcoal"
              }`}
              onClick={() => setTab("notes")}
            >
              Notizen
            </button>
            {!anonymized && client360Features.anonymizeButton && (
              <button
                type="button"
                disabled={busyAnonymize}
                className="min-h-touch border border-oak-wood bg-oak-wood px-4 text-sm font-bold text-deep-charcoal disabled:opacity-50"
                onClick={async () => {
                  if (!data) return;
                  const c1 = window.confirm(
                    "Kundendaten anonymisieren? Belege und Belegnummern bleiben stehen (GoBD). Persönliche Daten werden entfernt und Suchtreffer unmöglich.",
                  );
                  if (!c1) return;
                  const c2 = window.confirm(
                    "Letzte Bestätigung: DSGVO-Anonymisierung jetzt ausführen?",
                  );
                  if (!c2) return;
                  setBusyAnonymize(true);
                  try {
                    await apiPost(`/api/clients/${data.client.id}/anonymize`, {});
                    await refresh();
                  } finally {
                    setBusyAnonymize(false);
                  }
                }}
              >
                {busyAnonymize ? "…" : "Anonymisieren (DSGVO)"}
              </button>
            )}
          </div>
        </header>

        <div className="p-4">
          {loading && <p className="text-brushed-chrome">Lade Kundenakte…</p>}
          {error && (
            <p className="border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          {!loading && data && tab === "timeline" && (
            <ul className={`space-y-3 ${privacyBlur(privacyMode && client360Features.privacyToggle)}`}>
              {data.timeline.map((row) => (
                <li key={row.id} className="border-l-2 border-brushed-chrome pl-3">
                  <p className="text-xs text-brushed-chrome">{formatBerlinDateTime(row.ts)}</p>
                  <p className="font-semibold">{row.title}</p>
                  <p className="text-sm text-canvas/90">{row.subtitle}</p>
                  <p className="text-xs text-brushed-chrome">
                    {row.staffName ? `Mitarbeiter: ${row.staffName}` : "Mitarbeiter: —"}
                    {row.amountCents != null ? ` · ${formatEur(row.amountCents)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {!loading && data && tab === "formulas" && (
            <div className="space-y-3">
              {data.formulas.length === 0 && (
                <p className="text-brushed-chrome">Keine Rezepturen vorhanden.</p>
              )}
              {data.formulas.map((f) => (
                <article key={f.id} className="border border-brushed-chrome/40 p-3">
                  <p className="font-mono text-sm">{f.formulaText}</p>
                  {f.notes ? <p className="mt-1 text-sm text-canvas/85">{f.notes}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-brushed-chrome">{formatBerlinDateTime(f.createdAt)}</p>
                    <button
                      type="button"
                      className="min-h-touch border border-oak-wood bg-oak-wood px-3 text-sm font-bold text-deep-charcoal"
                      onClick={() => {
                        if (sourceSessionId) {
                          localStorage.setItem(
                            `or:formula-template:${sourceSessionId}`,
                            JSON.stringify({
                              formulaText: f.formulaText,
                              notes: f.notes,
                              createdAt: f.createdAt,
                            }),
                          );
                        }
                        void navigator.clipboard
                          ?.writeText(`${f.formulaText}${f.notes ? `\n${f.notes}` : ""}`)
                          .catch(() => {});
                      }}
                    >
                      Als Vorlage verwenden
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!loading && data && tab === "notes" && (
            <div
              className={`space-y-3 ${privacyBlur(privacyMode && client360Features.privacyToggle)}`}
            >
              {data.notes.length === 0 ? (
                <p className="text-brushed-chrome">Keine Notizen gespeichert.</p>
              ) : (
                data.notes.map((n) => (
                  <article key={n.id} className="border border-brushed-chrome/40 p-3">
                    <p className="text-sm">{n.noteText}</p>
                    <p className="mt-2 text-xs text-brushed-chrome">
                      {formatBerlinDateTime(n.createdAt)}
                    </p>
                  </article>
                ))
              )}
            </div>
          )}
        </div>
      </motion.aside>

      {data?.client && (
        <EditClientModal
          open={editOpen}
          client={{
            id: data.client.id,
            firstName: data.client.firstName ?? "",
            lastName: data.client.lastName ?? "",
            email: data.client.email,
            phone: data.client.phone,
            street: data.client.street,
            houseNumber: data.client.houseNumber,
            postalCode: data.client.postalCode,
            city: data.client.city,
            country: data.client.country,
          }}
          onClose={() => setEditOpen(false)}
          onSaved={() => { void refresh(); }}
        />
      )}
    </div>
  );
}
