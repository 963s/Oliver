import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../api";
import { useClient360, type Client360Data } from "../hooks/useClient360";
import { formatEurDeFromCents } from "../lib/formatMoney";
import { formatBerlinDateTime } from "../lib/formatTime";

/**
 * KundenBrowser — offline-first client lookup for the salon front desk.
 *
 * Loads the entire active client roster once (capped at 1000), then filters
 * in-memory by free-text search and German-alphabet letter chips. The right
 * panel uses the canonical `useClient360` hook which already aggregates
 * formulas, notes, invoices, reliability, loyalty and the visit timeline.
 *
 * UI rules (per project CLAUDE.md):
 *   - Built for an elderly salon owner: text-base minimum, buttons min-h-12.
 *   - Intel iMac: no backdrop-blur, no GPU filters — solid surfaces only.
 *   - German UI strings; comments in English.
 */

/* ─── Types ────────────────────────────────────────────────────────────── */

interface ClientRow {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  anonymizedAt: string | null;
  hospitalityDrink?: string | null;
  hospitalityConversation?: string | null;
  hospitalitySeat?: string | null;
  sessionHandoverNote?: string | null;
}

interface OpsFields {
  hospitalityDrink: string;
  hospitalityConversation: string;
  hospitalitySeat: string;
  sessionHandoverNote: string;
}

/* ─── Constants & helpers ──────────────────────────────────────────────── */

const GERMAN_ALPHABET = [
  "A", "Ä", "B", "C", "D", "E", "F", "G", "H", "I",
  "J", "K", "L", "M", "N", "O", "Ö", "P", "Q", "R",
  "S", "T", "U", "Ü", "V", "W", "X", "Y", "Z",
] as const;

const LETTER_ALL = "Alle";

function normalizeForSort(s: string): string {
  return s
    .toUpperCase()
    .replace(/Ä/g, "AE")
    .replace(/Ö/g, "OE")
    .replace(/Ü/g, "UE")
    .replace(/ß/g, "SS");
}

function displayName(c: ClientRow): string {
  const fl = [c.firstName ?? "", c.lastName ?? ""].map((s) => s.trim()).filter(Boolean);
  if (fl.length > 0) return fl.join(" ");
  return c.name?.trim() || "—";
}

function firstLetterForSort(c: ClientRow): string {
  const name = displayName(c);
  if (!name) return "";
  const first = name.charAt(0).toUpperCase();
  return first;
}

function matchesLetter(c: ClientRow, letter: string): boolean {
  if (letter === LETTER_ALL) return true;
  const first = firstLetterForSort(c);
  if (letter === "A") return first === "A" && c.name.charAt(0).toUpperCase() !== "Ä";
  if (letter === "O") return first === "O" && c.name.charAt(0).toUpperCase() !== "Ö";
  if (letter === "U") return first === "U" && c.name.charAt(0).toUpperCase() !== "Ü";
  return first === letter;
}

function matchesSearch(c: ClientRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [c.name, c.firstName, c.lastName, c.phone, c.email]
    .some((v) => (v ?? "").toLowerCase().includes(needle));
}

/* ─── Page component ───────────────────────────────────────────────────── */

export default function KundenBrowser(): JSX.Element {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [letter, setLetter] = useState<string>(LETTER_ALL);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Load once, cache for the session. Subsequent letter/search interactions
  // are free of network round-trips — important when the salon WiFi flaps.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setListLoading(true);
      setListError(null);
      try {
        const rows = await apiGet<ClientRow[]>("/api/clients/search?limit=1000");
        if (!cancelled) setClients(rows);
      } catch (e) {
        if (!cancelled) {
          setListError(e instanceof Error ? e.message : "load_failed");
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const out = clients
      .filter((c) => matchesLetter(c, letter))
      .filter((c) => matchesSearch(c, search));
    out.sort((a, b) =>
      normalizeForSort(displayName(a)).localeCompare(
        normalizeForSort(displayName(b)),
        "de",
      ),
    );
    return out;
  }, [clients, letter, search]);

  const client360 = useClient360(selectedId);

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-[var(--app-bg)]">
      <LeftPanel
        clients={filtered}
        totalCount={clients.length}
        loading={listLoading}
        error={listError}
        search={search}
        onSearch={setSearch}
        letter={letter}
        onLetter={setLetter}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <RightPanel
        selectedId={selectedId}
        data={client360.data}
        loading={client360.loading}
        error={client360.error}
        refresh={client360.refresh}
      />
    </div>
  );
}

/* ─── Left panel ───────────────────────────────────────────────────────── */

interface LeftPanelProps {
  clients: ClientRow[];
  totalCount: number;
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (s: string) => void;
  letter: string;
  onLetter: (l: string) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function LeftPanel(p: LeftPanelProps): JSX.Element {
  return (
    <aside
      className="flex h-full w-[380px] shrink-0 flex-col overflow-hidden border-r border-[var(--app-border)] bg-[var(--app-surface)]"
      aria-label="Kunden-Browser Liste"
    >
      <div className="border-b border-[var(--app-border)] px-4 py-4">
        <label className="block text-base font-medium text-[var(--app-text)]">
          <span className="sr-only">Kunde suchen</span>
          <input
            type="search"
            placeholder="Name oder Telefon suchen…"
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
            className="h-14 w-full rounded-md border border-[var(--app-border-strong)] bg-[var(--app-bg)] px-4 text-lg text-[var(--app-text)] outline-none focus:border-[var(--editorial-pulse)]"
          />
        </label>
      </div>

      <LetterBar value={p.letter} onChange={p.onLetter} />

      <div className="flex-1 overflow-y-auto">
        {p.loading ? (
          <div className="px-4 py-6 text-base text-[var(--app-text-subtle)]">
            Lade Kundenliste…
          </div>
        ) : p.error ? (
          <div className="m-4 rounded-md border border-editorial-crimson bg-red-50 p-4 text-base text-red-900">
            Fehler beim Laden: {p.error}
          </div>
        ) : p.clients.length === 0 ? (
          <div className="px-4 py-6 text-base text-[var(--app-text-subtle)]">
            {p.totalCount === 0
              ? "Noch keine Kunden angelegt."
              : "Keine Treffer mit diesen Filtern."}
          </div>
        ) : (
          <ul role="list">
            {p.clients.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => p.onSelect(c.id)}
                  className={`flex min-h-16 w-full items-center gap-3 border-b border-[var(--app-border)] px-4 py-3 text-left desktop-hover ${
                    p.selectedId === c.id
                      ? "bg-[var(--editorial-pulse)]/15"
                      : ""
                  }`}
                  aria-current={p.selectedId === c.id ? "true" : undefined}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--app-bg)] text-lg font-medium text-[var(--app-text)]"
                  >
                    {firstLetterForSort(c) || "?"}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-base font-medium text-[var(--app-text)]">
                      {displayName(c)}
                    </span>
                    <span className="truncate text-sm text-[var(--app-text-subtle)]">
                      {c.phone || "Keine Telefonnummer"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-[var(--app-border)] px-4 py-2 text-sm text-[var(--app-text-subtle)]">
        {p.clients.length} von {p.totalCount} angezeigt
      </div>
    </aside>
  );
}

/* ─── Letter filter bar ────────────────────────────────────────────────── */

function LetterBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (l: string) => void;
}): JSX.Element {
  const cells = useMemo(() => [LETTER_ALL, ...GERMAN_ALPHABET], []);
  return (
    <div className="border-b border-[var(--app-border)] px-2 py-2">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Alphabetisch filtern">
        {cells.map((letter) => {
          const active = value === letter;
          return (
            <button
              key={letter}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(letter)}
              className={`min-h-12 min-w-12 rounded-md border px-3 text-base font-medium ${
                active
                  ? "border-[var(--editorial-pulse)] bg-[var(--editorial-pulse)] text-white"
                  : "border-[var(--app-border-strong)] bg-[var(--app-bg)] text-[var(--app-text)] desktop-hover"
              }`}
            >
              {letter}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Right panel ──────────────────────────────────────────────────────── */

interface RightPanelProps {
  selectedId: number | null;
  data: Client360Data | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function RightPanel(p: RightPanelProps): JSX.Element {
  if (p.selectedId == null) {
    return (
      <main className="flex flex-1 items-center justify-center overflow-y-auto p-12">
        <div className="max-w-lg rounded-lg border-2 border-[var(--app-border-strong)] bg-[var(--app-surface)] p-10 text-center">
          <h2 className="text-2xl font-medium text-[var(--app-text)]">
            Kein Kunde ausgewählt
          </h2>
          <p className="mt-4 text-lg text-[var(--app-text-subtle)]">
            Wählen Sie auf der linken Seite einen Kunden aus, um die Akte zu öffnen.
          </p>
        </div>
      </main>
    );
  }

  if (p.loading && !p.data) {
    return (
      <main className="flex flex-1 items-center justify-center overflow-y-auto p-12">
        <p className="text-xl text-[var(--app-text-subtle)]">Laden…</p>
      </main>
    );
  }

  if (p.error || !p.data) {
    return (
      <main className="flex-1 overflow-y-auto p-12">
        <div className="rounded-md border border-editorial-crimson bg-red-50 p-6 text-lg text-red-900">
          Fehler beim Laden des Kunden: {p.error ?? "unbekannt"}
        </div>
      </main>
    );
  }

  return <ClientDetails data={p.data} refresh={p.refresh} />;
}

/* ─── Client details ───────────────────────────────────────────────────── */

type TabKey = "rezepturen" | "notizen" | "praeferenzen";

function ClientDetails({
  data,
  refresh,
}: {
  data: Client360Data;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [tab, setTab] = useState<TabKey>("rezepturen");
  const cid = data.client.id;
  return (
    <main className="flex-1 overflow-y-auto p-8">
      <ClientHeader data={data} />
      <FormulaHero data={data} />
      <QuickStats data={data} />
      <TabBar value={tab} onChange={setTab} />
      <div className="mt-6">
        {tab === "rezepturen" && (
          <RezepturenTab cid={cid} data={data} refresh={refresh} />
        )}
        {tab === "notizen" && (
          <NotizenTab cid={cid} data={data} refresh={refresh} />
        )}
        {tab === "praeferenzen" && (
          <PraeferenzenTab cid={cid} data={data} refresh={refresh} />
        )}
      </div>
    </main>
  );
}

function ClientHeader({ data }: { data: Client360Data }): JSX.Element {
  const c = data.client;
  const name = displayName(c);
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-medium text-[var(--app-text)]">{name}</h1>
        <p className="mt-2 text-lg text-[var(--app-text-subtle)]">
          {c.phone || "Keine Telefonnummer"}
          {c.email ? ` · ${c.email}` : ""}
        </p>
      </div>
      {data.loyaltyBadgeLabel && (
        <div className="flex flex-col items-end">
          <span className="rounded-full border-2 border-[#D4AF37] bg-[#D4AF37]/15 px-5 py-2 text-lg font-medium text-[#7a6210]">
            {data.loyaltyBadgeLabel}
          </span>
          {data.loyaltyBadgeDetail && (
            <span className="mt-2 max-w-xs text-right text-sm text-[var(--app-text-subtle)]">
              {data.loyaltyBadgeDetail}
            </span>
          )}
        </div>
      )}
    </header>
  );
}

/**
 * Hero block — the salon's most-used data point. Stylists pull this open in
 * front of the chair to repeat last visit's recipe. Big monospace font, gold
 * border, with date and stylist meta below.
 */
function FormulaHero({ data }: { data: Client360Data }): JSX.Element {
  const f = data.formulas[0];
  if (!f) {
    return (
      <section
        aria-label="Letzte Rezeptur"
        className="mb-8 rounded-lg border-2 border-dashed border-[var(--app-border-strong)] bg-[var(--app-surface)] p-6"
      >
        <p className="text-lg text-[var(--app-text-subtle)]">
          Keine Rezeptur hinterlegt
        </p>
      </section>
    );
  }
  return (
    <section
      aria-label="Letzte Rezeptur"
      className="mb-8 rounded-lg border-2 border-[#D4AF37] bg-[#D4AF37]/10 p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-medium uppercase tracking-wide text-[#7a6210]">
          Letzte Rezeptur
        </h2>
        <span className="text-sm text-[var(--app-text-subtle)]">
          {formatBerlinDateTime(f.createdAt)}
        </span>
      </div>
      <p className="mt-4 whitespace-pre-wrap font-mono text-xl text-[var(--app-text)]">
        {f.formulaText}
      </p>
      {f.notes && (
        <p className="mt-3 text-base text-[var(--app-text-subtle)]">{f.notes}</p>
      )}
    </section>
  );
}

function QuickStats({ data }: { data: Client360Data }): JSX.Element {
  const cards: Array<{ label: string; value: string; sub?: string }> = [
    {
      label: "Abgeschlossene Besuche",
      value: String(data.completedVisitCount),
    },
    {
      label: "Gesamtumsatz",
      value: formatEurDeFromCents(data.totalSpendCents),
    },
    {
      label: "Zuverlässigkeit",
      value: `${data.reliabilityScore}%`,
      sub:
        data.reliabilityScore >= 80
          ? "Sehr zuverlässig"
          : data.reliabilityScore >= 50
            ? "Akzeptabel"
            : "Aufmerksam",
    },
  ];
  return (
    <section
      aria-label="Kennzahlen"
      className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3"
    >
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-5"
        >
          <p className="text-sm uppercase tracking-wide text-[var(--app-text-subtle)]">
            {c.label}
          </p>
          <p className="mt-2 text-3xl font-medium text-[var(--app-text)]">
            {c.value}
          </p>
          {c.sub && (
            <p className="mt-1 text-sm text-[var(--app-text-subtle)]">{c.sub}</p>
          )}
        </div>
      ))}
    </section>
  );
}

function TabBar({
  value,
  onChange,
}: {
  value: TabKey;
  onChange: (k: TabKey) => void;
}): JSX.Element {
  const tabs: Array<{ k: TabKey; label: string }> = [
    { k: "rezepturen", label: "Rezepturen" },
    { k: "notizen", label: "Notizen" },
    { k: "praeferenzen", label: "Besuche & Präferenzen" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Kunden-Bereiche"
      className="flex gap-2 border-b border-[var(--app-border)]"
    >
      {tabs.map((t) => {
        const active = value === t.k;
        return (
          <button
            key={t.k}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.k)}
            className={`min-h-12 px-5 text-base font-medium ${
              active
                ? "border-b-2 border-[var(--editorial-pulse)] text-[var(--app-text)]"
                : "text-[var(--app-text-subtle)] desktop-hover"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Rezepturen tab ───────────────────────────────────────────────────── */

function RezepturenTab({
  cid,
  data,
  refresh,
}: {
  cid: number;
  data: Client360Data;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    setErr(null);
    try {
      await apiPost(`/api/clients/${cid}/formulas`, {
        formulaText: trimmed,
        notes: notes.trim() || null,
      });
      setText("");
      setNotes("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-5">
        <h3 className="mb-3 text-xl font-medium text-[var(--app-text)]">
          Neue Rezeptur hinzufügen
        </h3>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="z. B. Wella 6/0 + 5/4 (1:1) + 6% — 30 Min"
          rows={3}
          className="w-full rounded-md border border-[var(--app-border-strong)] bg-[var(--app-bg)] p-3 text-lg text-[var(--app-text)] outline-none focus:border-[var(--editorial-pulse)]"
        />
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notizen (optional)"
          className="mt-3 h-12 w-full rounded-md border border-[var(--app-border-strong)] bg-[var(--app-bg)] px-3 text-base text-[var(--app-text)] outline-none focus:border-[var(--editorial-pulse)]"
        />
        {err && <p className="mt-3 text-base text-red-700">Fehler: {err}</p>}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !text.trim()}
          className="mt-4 min-h-12 rounded-md bg-[var(--editorial-pulse)] px-6 text-lg font-medium text-white disabled:opacity-50"
        >
          {saving ? "Speichere…" : "Rezeptur speichern"}
        </button>
      </div>

      <h3 className="mt-8 mb-3 text-xl font-medium text-[var(--app-text)]">
        Verlauf
      </h3>
      {data.formulas.length === 0 ? (
        <p className="text-base text-[var(--app-text-subtle)]">
          Noch keine Rezepturen erfasst.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.formulas.map((f) => (
            <li
              key={f.id}
              className="rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-4"
            >
              <div className="flex flex-wrap justify-between gap-2 text-sm text-[var(--app-text-subtle)]">
                <span>{formatBerlinDateTime(f.createdAt)}</span>
                <span>Stylist #{f.staffId}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap font-mono text-lg text-[var(--app-text)]">
                {f.formulaText}
              </p>
              {f.notes && (
                <p className="mt-2 text-base text-[var(--app-text-subtle)]">
                  {f.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─── Notizen tab ──────────────────────────────────────────────────────── */

function NotizenTab({
  cid,
  data,
  refresh,
}: {
  cid: number;
  data: Client360Data;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    setErr(null);
    try {
      await apiPost(`/api/clients/${cid}/notes`, { noteText: trimmed });
      setText("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-5">
        <h3 className="mb-3 text-xl font-medium text-[var(--app-text)]">
          Neue Notiz hinzufügen
        </h3>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Dauerhafte technische Notiz (Haartyp, Empfindlichkeiten, Wünsche)…"
          rows={3}
          className="w-full rounded-md border border-[var(--app-border-strong)] bg-[var(--app-bg)] p-3 text-lg text-[var(--app-text)] outline-none focus:border-[var(--editorial-pulse)]"
        />
        {err && <p className="mt-3 text-base text-red-700">Fehler: {err}</p>}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !text.trim()}
          className="mt-4 min-h-12 rounded-md bg-[var(--editorial-pulse)] px-6 text-lg font-medium text-white disabled:opacity-50"
        >
          {saving ? "Speichere…" : "Notiz speichern"}
        </button>
      </div>

      <h3 className="mt-8 mb-3 text-xl font-medium text-[var(--app-text)]">
        Bestehende Notizen
      </h3>
      {data.notes.length === 0 ? (
        <p className="text-base text-[var(--app-text-subtle)]">
          Noch keine Notizen erfasst.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.notes.map((n) => (
            <li
              key={n.id}
              className="rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-4"
            >
              <div className="flex flex-wrap justify-between gap-2 text-sm text-[var(--app-text-subtle)]">
                <span>{formatBerlinDateTime(n.createdAt)}</span>
                <span>Stylist #{n.staffId}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-base text-[var(--app-text)]">
                {n.noteText}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─── Präferenzen + visits tab ─────────────────────────────────────────── */

function PraeferenzenTab({
  cid,
  data,
  refresh,
}: {
  cid: number;
  data: Client360Data;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [ops, setOps] = useState<OpsFields>({
    hospitalityDrink: data.client.hospitalityDrink ?? "",
    hospitalityConversation: data.client.hospitalityConversation ?? "",
    hospitalitySeat: data.client.hospitalitySeat ?? "",
    sessionHandoverNote: data.client.sessionHandoverNote ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await apiPatch(`/api/clients/${cid}/ops-fields`, {
        hospitalityDrink: ops.hospitalityDrink.trim() || null,
        hospitalityConversation: ops.hospitalityConversation.trim() || null,
        hospitalitySeat: ops.hospitalitySeat.trim() || null,
        sessionHandoverNote: ops.sessionHandoverNote.trim() || null,
      });
      setSavedAt(Date.now());
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-5">
        <h3 className="mb-4 text-xl font-medium text-[var(--app-text)]">
          Operative Präferenzen
        </h3>
        <OpsField
          label="Lieblingsgetränk"
          value={ops.hospitalityDrink}
          onChange={(v) => setOps({ ...ops, hospitalityDrink: v })}
          placeholder="z. B. Espresso doppio, ohne Zucker"
        />
        <OpsField
          label="Gesprächswunsch"
          value={ops.hospitalityConversation}
          onChange={(v) => setOps({ ...ops, hospitalityConversation: v })}
          placeholder="z. B. ruhig, kein Smalltalk"
        />
        <OpsField
          label="Lieblingsplatz"
          value={ops.hospitalitySeat}
          onChange={(v) => setOps({ ...ops, hospitalitySeat: v })}
          placeholder="z. B. Fensterplatz"
        />
        <OpsField
          label="Tages-Übergabe-Notiz"
          value={ops.sessionHandoverNote}
          onChange={(v) => setOps({ ...ops, sessionHandoverNote: v })}
          placeholder="Wird am Tagesende automatisch zurückgesetzt"
          multiline
        />
        {err && <p className="mt-3 text-base text-red-700">Fehler: {err}</p>}
        {savedAt && !err && (
          <p className="mt-3 text-base text-green-700">Gespeichert.</p>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="mt-4 min-h-12 rounded-md bg-[var(--editorial-pulse)] px-6 text-lg font-medium text-white disabled:opacity-50"
        >
          {saving ? "Speichere…" : "Präferenzen speichern"}
        </button>
      </div>

      <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-5">
        <h3 className="mb-4 text-xl font-medium text-[var(--app-text)]">
          Besuchsverlauf
        </h3>
        {data.timeline.length === 0 ? (
          <p className="text-base text-[var(--app-text-subtle)]">
            Noch keine Aktivität.
          </p>
        ) : (
          <ul className="space-y-3">
            {data.timeline.slice(0, 30).map((t) => (
              <li
                key={t.id}
                className="border-b border-[var(--app-border)] pb-3 last:border-b-0"
              >
                <div className="flex flex-wrap justify-between gap-2 text-sm text-[var(--app-text-subtle)]">
                  <span>{formatBerlinDateTime(new Date(t.ts))}</span>
                  <span>{t.staffName ?? "—"}</span>
                </div>
                <p className="mt-1 text-base text-[var(--app-text)]">
                  <span className="font-medium">{t.title}</span> — {t.subtitle}
                  {t.amountCents != null && (
                    <span className="ml-2 text-[var(--app-text-subtle)]">
                      ({formatEurDeFromCents(t.amountCents)})
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function OpsField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}): JSX.Element {
  return (
    <label className="mt-3 block">
      <span className="block text-base font-medium text-[var(--app-text)]">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="mt-1 w-full rounded-md border border-[var(--app-border-strong)] bg-[var(--app-bg)] p-3 text-base text-[var(--app-text)] outline-none focus:border-[var(--editorial-pulse)]"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1 h-12 w-full rounded-md border border-[var(--app-border-strong)] bg-[var(--app-bg)] px-3 text-base text-[var(--app-text)] outline-none focus:border-[var(--editorial-pulse)]"
        />
      )}
    </label>
  );
}
