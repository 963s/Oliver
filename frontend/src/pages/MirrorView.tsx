import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { cancelOpenSession } from "../lib/sessionCancelApi";
import { useAuthStore } from "../store/authStore";
import { isSalonManagementRole } from "../lib/staffRoles";
import { CheckoutModal } from "../components/checkout/CheckoutModal";
import { FormulaRezepturModal } from "../components/mirror/FormulaRezepturModal";
import { useVisibilityWakeSync } from "../hooks/useVisibilityWakeSync";
import { ChunkyCart } from "../components/ui/ChunkyCart";
import {
  productCartKey,
  productInventoryForCart,
  productUnitGrossCents,
  serviceCartKey,
  serviceDisplayGrossCents,
  serviceInventoryForCart,
  useCatalogStore,
} from "../store/catalogStore";
import { useCartStore } from "../store/cartStore";
import { useClient360Store } from "../store/client360Store";

/**
 * Split Spiegel-Ansicht: Katalog lokal, Warenkorb rein clientseitig (Zustand) — kein POST bei Tap.
 * Bleibt unter DashboardLayout → SSE bleibt aktiv.
 */
export function MirrorView() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionIdRaw = params.get("session");
  const sessionId = sessionIdRaw && /^\d+$/.test(sessionIdRaw) ? sessionIdRaw : "";
  const sidNum = sessionId ? Number(sessionId) : 0;

  const [sessionOk, setSessionOk] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [rezepturOpen, setRezepturOpen] = useState(false);
  const [sessionClientId, setSessionClientId] = useState<number | null>(null);
  const [sessionClientName, setSessionClientName] = useState<string | null>(null);
  const [clientAnonymizedAt, setClientAnonymizedAt] = useState<string | null>(null);
  const [gdprBusy, setGdprBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const staffRole = useAuthStore((s) => s.staffRole);
  const addItem = useCartStore((s) => s.addItem);
  const openClientProfile = useClient360Store((s) => s.openProfile);
  const services = useCatalogStore((s) => s.services);
  const products = useCatalogStore((s) => s.products);
  const catalogStatus = useCatalogStore((s) => s.status);
  const catalogError = useCatalogStore((s) => s.error);

  const refetchOpenSession = useCallback(() => {
    if (!sidNum) {
      setSessionOk(false);
      return;
    }
    void apiGet<{ id: number; status: string; clientId: number | null }>(`/api/sessions/${sidNum}`)
      .then((row) => {
        setSessionOk(row.status === "open");
        const cid = row.clientId ?? null;
        setSessionClientId(cid);
        if (row.status !== "open") {
          setErr("Diese Session ist nicht mehr offen.");
          useCartStore.getState().clearCart(String(sidNum));
        } else {
          setErr("");
        }
        if (cid != null) {
          void apiGet<{ name: string; anonymizedAt?: string | null }>(`/api/clients/${cid}`)
            .then((c) => {
              setSessionClientName(c.name);
              setClientAnonymizedAt(c.anonymizedAt ?? null);
            })
            .catch(() => {
              setSessionClientName(null);
              setClientAnonymizedAt(null);
            });
        } else {
          setSessionClientName(null);
          setClientAnonymizedAt(null);
        }
      })
      .catch(() => {
        setSessionOk(false);
        setErr("Session nicht gefunden.");
        setSessionClientId(null);
        setSessionClientName(null);
        setClientAnonymizedAt(null);
      });
    /** sidNum only — never subscribe to cart actions here; `clearCart` updates the store and
     *  would churn this callback identity → `useEffect([refetchOpenSession])` infinite loop. */
  }, [sidNum]);

  useEffect(() => {
    refetchOpenSession();
  }, [refetchOpenSession]);

  useVisibilityWakeSync(() => {
    void refetchOpenSession();
  });

  useEffect(() => {
    void useCatalogStore.getState().ensureLoaded().catch(() => {});
  }, []);

  const canGdprAnonymize =
    isSalonManagementRole(staffRole) &&
    sessionClientId != null &&
    clientAnonymizedAt == null;

  const forceCancelThisSession = async () => {
    if (!sessionId) return;
    const ok = window.confirm(
      "Diese Session abbrechen? Kein Kassenbeleg — Warenkorb wird geleert. Bei Termin wird der Check-in zurückgesetzt.",
    );
    if (!ok) return;
    setCancelBusy(true);
    try {
      await cancelOpenSession(sidNum);
      useCartStore.getState().clearCart(sessionId);
      navigate("/", { replace: true });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelBusy(false);
    }
  };

  const runGdprAnonymize = async () => {
    if (sessionClientId == null || !canGdprAnonymize) return;
    const ok = window.confirm(
      "Kundendaten gemäß Art. 17 DSGVO anonymisieren? Rezepturen und Kontaktdaten werden entfernt; Belege bleiben aus steuerlichen Gründen erhalten. Dieser Vorgang ist in der Regel unwiderruflich.",
    );
    if (!ok) return;
    setGdprBusy(true);
    try {
      await apiPost(`/api/clients/${sessionClientId}/anonymize`, {});
      setClientAnonymizedAt(new Date().toISOString());
      setSessionClientName("Anonymisiert");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Anonymisierung fehlgeschlagen.");
    } finally {
      setGdprBusy(false);
    }
  };

  if (!sessionId || sessionOk === false) {
    return (
      <div className="flex min-h-[min(100dvh,720px)] flex-col items-center justify-center gap-10 px-6 py-12">
        <div className="flex max-w-xl flex-col items-center text-center">
          <div
            className="flex h-24 w-24 items-center justify-center rounded-full border border-editorial-pulse/40 bg-canvas-white font-editorial-display text-xl tracking-[0.35em] text-editorial-pulse shadow-[0_0_48px_var(--editorial-pulse-dim)]"
            aria-hidden
          >
            OR
          </div>
          <h1 className="mt-10 font-editorial-display text-4xl font-normal uppercase tracking-[0.2em] text-deep-charcoal/92">
            Spiegel
          </h1>
          <p className="mt-8 max-w-sm text-[11px] font-light uppercase leading-loose tracking-[0.42em] text-deep-charcoal/35">
            Oliver Roos Frisuren
          </p>
          <p className="mt-6 max-w-md text-xs font-light leading-relaxed tracking-[0.2em] text-deep-charcoal/46">
            Gültige Sitzung erforderlich — aus Live-Termin öffnen, Parameter{" "}
            <code className="rounded border border-deep-charcoal/12 bg-gray-400/70 px-1.5 py-0.5 font-mono text-[11px] text-editorial-pulse">
              ?session=
            </code>
            .
          </p>
          {err ? (
            <p className="mt-4 rounded-xl border border-red-400/60 bg-red-50/60 px-4 py-3 text-sm text-red-600/90 ">
              {err}
            </p>
          ) : null}
        </div>

        <div className="grid w-full max-w-lg gap-6 sm:grid-cols-2 sm:gap-8">
          <Link
            to="/walk-in"
            className="group flex min-h-[120px] flex-col justify-center border border-deep-charcoal/[0.08] bg-gray-100/40 p-8 text-left  transition hover:border-editorial-pulse hover:shadow-[0_0_48px_var(--editorial-pulse-dim)]"
          >
            <span className="text-[10px] font-light uppercase tracking-[0.45em] text-deep-charcoal/48">Studio</span>
            <span className="mt-3 font-editorial-display text-2xl uppercase tracking-[0.14em] text-deep-charcoal/92">
              Walk-in
            </span>
            <span className="mt-4 text-[11px] font-light uppercase tracking-[0.28em] text-editorial-pulse">Öffnen →</span>
          </Link>
          <Link
            to="/"
            className="group flex min-h-[120px] flex-col justify-center border border-deep-charcoal/[0.08] bg-gray-100/40 p-8 text-left  transition hover:border-editorial-pulse hover:shadow-[0_0_48px_var(--editorial-pulse-dim)]"
          >
            <span className="text-[10px] font-light uppercase tracking-[0.45em] text-deep-charcoal/48">Kalender</span>
            <span className="mt-3 font-editorial-display text-2xl uppercase tracking-[0.14em] text-deep-charcoal/92">
              Live
            </span>
            <span className="mt-4 text-[11px] font-light uppercase tracking-[0.28em] text-editorial-pulse">
              ← Zurück
            </span>
          </Link>
        </div>
      </div>
    );
  }

  if (sessionOk === null) {
    return (
      <div className="p-10 font-light uppercase tracking-[0.4em] text-deep-charcoal/42" aria-live="polite">
        Sitzung wird geprüft…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <p className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 pb-4 text-[12px] font-light uppercase tracking-[0.35em] text-deep-charcoal/52">
        Sitzung <strong className="font-normal text-editorial-pulse">#{sessionId}</strong> ·{" "}
        <Link
          to="/"
          className="inline-flex min-h-touch items-center border-b border-transparent px-2 text-editorial-pulse hover:border-editorial-pulse"
        >
          Live
        </Link>{" "}
        ·{" "}
        <Link
          to={`/estimate?session=${sessionId}`}
          className="inline-flex min-h-touch items-center border-b border-transparent px-2 text-editorial-pulse hover:border-editorial-pulse"
        >
          Kostenvorschau
        </Link>
        <button
          type="button"
          className="ml-1 inline-flex min-h-touch min-w-touch items-center justify-center border border-editorial-pulse bg-transparent px-5 text-[11px] font-normal tracking-[0.3em] text-editorial-pulse"
          onClick={() => setRezepturOpen(true)}
        >
          Rezeptur
        </button>
        {sessionClientName && (
          <button
            type="button"
            className="inline-flex min-h-touch items-center px-3 text-sm font-light uppercase tracking-[0.14em] text-canvas underline-offset-4 hover:underline"
            onClick={() => {
              if (sessionClientId == null) return;
              openClientProfile(sessionClientId, { sourceSessionId: sidNum });
            }}
          >
            — {sessionClientName}
          </button>
        )}
        {canGdprAnonymize && (
          <button
            type="button"
            disabled={gdprBusy}
            className="ml-2 inline-flex min-h-touch min-w-touch max-w-full items-center justify-center border border-deep-charcoal/14 bg-transparent px-4 py-3 text-center text-[11px] font-light uppercase tracking-[0.2em] leading-snug text-canvas underline-offset-2 hover:border-editorial-pulse hover:text-editorial-pulse hover:underline disabled:opacity-50"
            onClick={() => void runGdprAnonymize()}
          >
            {gdprBusy ? "…" : "Kundendaten anonymisieren (DSGVO)"}
          </button>
        )}
        <button
          type="button"
          disabled={cancelBusy}
          title="Serverseitig beenden — hängengebliebene Sitzung, kein Beleg"
          className="ml-auto inline-flex min-h-[52px] min-w-0 shrink-0 items-center justify-center rounded-xl border border-red-400/60 bg-red-50/60 px-5 text-[11px] font-light uppercase tracking-[0.22em] text-red-600/90 shadow-[0_0_24px_rgba(220,38,38,0.12)]  hover:bg-red-50/80 hover:text-red-500 disabled:opacity-50"
          onClick={() => void forceCancelThisSession()}
        >
          {cancelBusy ? "…" : "Session abbrechen"}
        </button>
      </p>

      <div className="grid flex-1 grid-cols-1 gap-0 lg:grid-cols-12">
        <section className="border-b border-deep-charcoal/[0.06] p-5 lg:col-span-7 lg:border-b-0 lg:border-r lg:border-deep-charcoal/[0.06] lg:pr-8 lg:pt-12">
          <p className="text-[10px] font-light uppercase tracking-[0.55em] text-deep-charcoal/42">Akte</p>
          <h1 className="mt-2 font-editorial-display text-[clamp(2rem,4vw,3.25rem)] font-normal uppercase leading-none tracking-[0.1em] text-deep-charcoal/93">
            Leistungen
          </h1>
          <p className="mb-6 mt-8 max-w-sm text-[12px] font-light leading-relaxed tracking-[0.24em] text-deep-charcoal/52">
            Katalog Einmal laden — Auswahl durch Berührung
          </p>
          {catalogStatus === "error" && (
            <p className="mb-3 text-sm text-red-600/90" role="alert">
              {catalogError ?? "Katalog nicht erreichbar."}
            </p>
          )}
          {catalogStatus === "loading" && <p className="mb-3 text-sm text-stone-500">Katalog wird geladen…</p>}
          {catalogStatus === "ready" && services.length === 0 && products.length === 0 && (
            <p className="mb-3 text-stone-500">Keine Katalogeinträge — bitte Katalog in der Zentrale pflegen.</p>
          )}

          <h2 className="mb-6 text-[10px] font-light uppercase tracking-[0.52em] text-editorial-pulse">Cour</h2>
          <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {services.map((row) => {
              const g = serviceDisplayGrossCents(row);
              const { inventoryItemId, deductMl } = serviceInventoryForCart(row);
              return (
                <button
                  key={row.id}
                  type="button"
                  className="group min-h-[96px] border border-editorial-pulse bg-gradient-to-br from-transparent to-[color-mix(in_srgb,var(--editorial-pulse)_8%,transparent)] px-6 py-5 text-left  transition-[transform,border-color,box-shadow] duration-500 hover:shadow-[0_0_40px_var(--editorial-pulse-dim)] active:scale-[0.99]"
                  onClick={() =>
                    addItem(sessionId, {
                      serviceKey: serviceCartKey(row),
                      label: row.serviceName,
                      unitPriceCents: g,
                      vatRateBps: row.vatRateBps,
                      inventoryItemId,
                      deductMl,
                    })
                  }
                >
                  <span className="font-editorial-display text-xl uppercase tracking-[0.08em] text-deep-charcoal/93">
                    {row.serviceName}
                  </span>
                  {g > 0 && (
                    <span className="mt-3 block font-mono text-sm font-light tabular-nums tracking-[0.12em] text-editorial-pulse">
                      {(g / 100).toFixed(2).replace(".", ",")} €
                    </span>
                  )}
                  {g === 0 && (
                    <span className="mt-3 block text-[11px] font-light tracking-[0.25em] text-deep-charcoal/52">
                      Orientierung
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <h2 className="mb-6 text-[10px] font-light uppercase tracking-[0.45em] text-deep-charcoal/53">Hauslinie · Einheit</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {products.map((row) => {
              const g = productUnitGrossCents(row);
              const disabled = g < 1;
              const { inventoryItemId, deductMl } = productInventoryForCart(row);
              return (
                <button
                  key={row.id}
                  type="button"
                  disabled={disabled}
                  className="min-h-[88px] border border-deep-charcoal/[0.08] bg-gray-100/50 px-5 py-4 text-left text-sm font-light tracking-[0.18em] text-deep-charcoal/73 transition-colors duration-300 hover:border-deep-charcoal/25 hover:text-deep-charcoal disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => {
                    if (disabled) return;
                    addItem(sessionId, {
                      serviceKey: productCartKey(row),
                      label: row.name,
                      unitPriceCents: g,
                      vatRateBps: row.estimateVatRateBps,
                      inventoryItemId,
                      deductMl,
                    });
                  }}
                >
                  {row.name}
                  {!disabled && (
                    <span className="mt-2 block font-mono text-xs tabular-nums text-deep-charcoal/55">
                      {(g / 100).toFixed(2).replace(".", ",")} €
                      {row.defaultUnitMl > 0 && (
                        <span className="ml-2 font-sans font-light uppercase tracking-[0.2em] text-deep-charcoal/45">
                          · {row.defaultUnitMl} ml
                        </span>
                      )}
                    </span>
                  )}
                  {disabled && (
                    <span className="mt-2 block text-[11px] font-light uppercase tracking-[0.15em] text-deep-charcoal/53">
                      ohne Listenpreis
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="min-h-[40vh] lg:col-span-5">
          <ChunkyCart sessionId={sessionId} onOpenCheckout={() => setCheckoutOpen(true)} />
        </section>
      </div>

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        sessionId={sessionId}
        onSuccess={() => {
          setCheckoutOpen(false);
          navigate("/", { replace: true });
        }}
      />

      <FormulaRezepturModal
        open={rezepturOpen}
        onClose={() => setRezepturOpen(false)}
        clientId={sessionClientId}
        clientName={sessionClientName}
      />
    </div>
  );
}
