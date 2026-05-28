import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, Loader2, Plus, Search, User, X } from "lucide-react";
import { apiGet, apiPost } from "../api";
import { formatBerlinTimeHHmm } from "../lib/formatTime";

/**
 * Kasse — entry point for the cashier flow.
 *
 * One screen, three ways to start a sale, in priority order:
 *   1. Walk-in (no client name needed)  — biggest button, always-available
 *   2. Pick from existing clients       — search box + recent list
 *   3. Resume an open session           — list of active sitzungen
 *
 * Selecting any of these creates / opens a session and navigates to
 * `/mirror?session=…` where the existing Spiegelkarte handles the actual
 * line-item entry and checkout.
 */

interface ClientRow {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  anonymizedAt: string | null;
}

interface SessionRow {
  id: number;
  clientId: number | null;
  staffId: number | null;
  status: string;
  createdAt: string | number | null;
}

export default function Kasse(): JSX.Element {
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [walkInName, setWalkInName] = useState("");
  const [showWalkInForm, setShowWalkInForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [cs, ss] = await Promise.all([
          apiGet<ClientRow[]>("/api/clients/search?limit=1000"),
          apiGet<SessionRow[]>("/api/sessions"),
        ]);
        if (!cancelled) {
          setClients(cs);
          setSessions(ss);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients.slice(0, 20);
    return clients
      .filter((c) => {
        const fields = [c.name, c.firstName, c.lastName, c.phone, c.email];
        return fields.some((v) => (v ?? "").toLowerCase().includes(q));
      })
      .slice(0, 30);
  }, [clients, search]);

  const openSessions = useMemo(
    () => sessions.filter((s) => s.status === "open"),
    [sessions],
  );

  const clientNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of clients) {
      const name = [c.firstName, c.lastName].filter((s) => s?.trim()).join(" ").trim() || c.name;
      m.set(c.id, name);
    }
    return m;
  }, [clients]);

  async function startSession(clientId: number | null, walkInClientName?: string) {
    setStarting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (clientId != null) body.clientId = clientId;
      if (walkInClientName) body.walkInClientName = walkInClientName;
      const res = await apiPost<{ id: number }>("/api/sessions", body);
      navigate(`/mirror?session=${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "session_start_failed");
      setStarting(false);
    }
  }

  function openExistingSession(id: number) {
    navigate(`/mirror?session=${id}`);
  }

  if (loading) {
    return (
      <main className="flex h-full items-center justify-center p-12">
        <div className="flex items-center gap-3 text-lg text-[var(--app-text-subtle)]">
          <Loader2 size={22} className="animate-spin" />
          <span>Kasse wird geladen…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-medium text-[var(--app-text)]">Kasse</h1>
        <p className="mt-2 text-base text-[var(--app-text-subtle)]">
          Verkauf starten — Walk-in oder bestehender Kunde.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-md border-2 border-editorial-crimson bg-red-50 p-4 text-base text-red-900">
          {error}
        </div>
      )}

      {/* ── 1. Walk-in (primary action) ─────────────────────────────────── */}
      <section className="mb-10">
        {!showWalkInForm ? (
          <button
            type="button"
            onClick={() => setShowWalkInForm(true)}
            disabled={starting}
            className="flex w-full min-h-20 items-center gap-4 rounded-lg border-2 border-[var(--editorial-pulse)] bg-[var(--editorial-pulse)] px-8 text-white shadow-luxury hover:opacity-95 disabled:opacity-50"
          >
            <Plus size={32} strokeWidth={2.25} />
            <div className="flex-1 text-left">
              <p className="text-2xl font-semibold">Neuer Walk-in Verkauf</p>
              <p className="mt-1 text-base opacity-90">
                Kasse für Laufkundschaft öffnen (kein Termin nötig)
              </p>
            </div>
          </button>
        ) : (
          <div className="rounded-lg border-2 border-[var(--editorial-pulse)] bg-[var(--app-surface)] p-6">
            <h2 className="text-xl font-medium text-[var(--app-text)]">
              Neuer Walk-in Verkauf
            </h2>
            <label className="mt-4 block">
              <span className="block text-base font-medium text-[var(--app-text)]">
                Kundenname (optional)
              </span>
              <input
                type="text"
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                placeholder="z. B. Anna · leer lassen für anonym"
                autoFocus
                className="mt-1.5 h-12 w-full rounded-md border-2 border-[var(--app-border-strong)] bg-[var(--app-bg)] px-3 text-base text-[var(--app-text)] outline-none focus:border-[var(--editorial-pulse)]"
              />
            </label>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void startSession(null, walkInName.trim() || undefined)}
                disabled={starting}
                className="min-h-12 rounded-md bg-[var(--editorial-pulse)] px-6 text-lg font-medium text-white disabled:opacity-50"
              >
                {starting ? "Öffne…" : "Verkauf starten"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowWalkInForm(false);
                  setWalkInName("");
                }}
                disabled={starting}
                className="min-h-12 rounded-md border-2 border-[var(--app-border-strong)] bg-[var(--app-bg)] px-5 text-base text-[var(--app-text)]"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── 2. Existing client picker ───────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-medium text-[var(--app-text)]">
          <User size={20} strokeWidth={1.75} />
          Bestehender Kunde
        </h2>
        <div className="relative">
          <Search
            size={18}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-text-subtle)]"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name oder Telefon suchen…"
            className="h-12 w-full rounded-md border-2 border-[var(--app-border-strong)] bg-[var(--app-bg)] pl-10 pr-10 text-base text-[var(--app-text)] outline-none focus:border-[var(--editorial-pulse)]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Suche löschen"
              className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-[var(--app-text-subtle)] desktop-hover"
            >
              <X size={18} strokeWidth={2} />
            </button>
          )}
        </div>

        <ul role="list" className="mt-3 divide-y divide-[var(--app-border)] rounded-md border border-[var(--app-border)] bg-[var(--app-surface)]">
          {filteredClients.length === 0 ? (
            <li className="px-4 py-6 text-base text-[var(--app-text-subtle)]">
              {search ? "Keine Treffer." : "Noch keine Kunden angelegt."}
            </li>
          ) : (
            filteredClients
              .filter((c) => c.anonymizedAt == null)
              .map((c) => {
                const displayName =
                  [c.firstName, c.lastName].filter((s) => s?.trim()).join(" ").trim() || c.name;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => void startSession(c.id)}
                      disabled={starting}
                      className="flex w-full min-h-14 items-center gap-3 px-4 py-2 text-left desktop-hover disabled:opacity-50"
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--app-bg)] text-base font-medium text-[var(--app-text)]"
                      >
                        {(displayName.charAt(0) || "?").toUpperCase()}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-base font-medium text-[var(--app-text)]">
                          {displayName}
                        </span>
                        <span className="truncate text-sm text-[var(--app-text-subtle)]">
                          {c.phone || "Keine Telefonnummer"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
          )}
        </ul>
      </section>

      {/* ── 3. Open sessions to resume ──────────────────────────────────── */}
      {openSessions.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-xl font-medium text-[var(--app-text)]">
            <CreditCard size={20} strokeWidth={1.75} />
            Offene Sitzungen ({openSessions.length})
          </h2>
          <ul role="list" className="divide-y divide-[var(--app-border)] rounded-md border border-[var(--app-border)] bg-[var(--app-surface)]">
            {openSessions.map((s) => {
              const clientName = s.clientId
                ? clientNameById.get(s.clientId) ?? `Kunde #${s.clientId}`
                : "Walk-in";
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => openExistingSession(s.id)}
                    className="flex w-full min-h-14 items-center justify-between gap-3 px-4 py-2 text-left desktop-hover"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-base font-medium text-[var(--app-text)]">
                        Sitzung #{s.id} · {clientName}
                      </span>
                      <span className="text-sm text-[var(--app-text-subtle)]">
                        {s.createdAt ? `geöffnet ${formatBerlinTimeHHmm(s.createdAt)}` : "offen"}
                      </span>
                    </span>
                    <span className="rounded-md bg-[var(--editorial-pulse)]/15 px-3 py-1 text-sm font-medium text-[var(--editorial-pulse)]">
                      Fortsetzen →
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
