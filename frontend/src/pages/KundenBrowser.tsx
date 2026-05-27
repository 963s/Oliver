import { useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  Keyboard,
  MoreVertical,
  Pencil,
  Delete as BackspaceIcon,
  Trash2,
  X,
} from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api";
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
 * UI rules:
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

/** German alphabet for the on-screen keyboard. Ä/Ö/Ü/ß are separate keys
 *  because German staff type them often and the physical iMac keyboard
 *  hides them behind option-combos. */
const GERMAN_ALPHABET = [
  "A", "Ä", "B", "C", "D", "E", "F", "G", "H", "I",
  "J", "K", "L", "M", "N", "O", "Ö", "P", "Q", "R",
  "S", "T", "U", "Ü", "V", "W", "X", "Y", "Z", "ß",
] as const;

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

function matchesSearch(c: ClientRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [c.name, c.firstName, c.lastName, c.phone, c.email]
    .some((v) => (v ?? "").toLowerCase().includes(needle));
}

/* ─── Page component ───────────────────────────────────────────────────── */

type DeleteState =
  | { stage: "closed" }
  | { stage: "reason"; client: ClientRow; reason: string }
  | { stage: "confirm"; client: ClientRow; reason: string }
  | { stage: "deleting"; client: ClientRow; reason: string }
  | { stage: "error"; client: ClientRow; reason: string; message: string };

export default function KundenBrowser(): JSX.Element {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [initialTab, setInitialTab] = useState<TabKey>("rezepturen");
  const [deleteState, setDeleteState] = useState<DeleteState>({ stage: "closed" });

  /** Only owners can hard-anonymize; backend rejects others with 403. Hide the
   *  Löschen menu entry for non-owners so the UI matches the permission. */
  const isOwner = useMemo(() => {
    try {
      const role = localStorage.getItem("or:staffRole") ?? "";
      return role === "owner" || role === "super_admin";
    } catch {
      return false;
    }
  }, []);

  /** Letter keys on the on-screen keyboard append to the search input, so the
   *  salon owner can either type with the real keyboard or tap letters. */
  function handleSearchChange(next: string) {
    setSearch(next);
  }
  function pressKey(ch: string) {
    setSearch((prev) => prev + ch);
  }
  function pressBackspace() {
    setSearch((prev) => prev.slice(0, -1));
  }
  function clearSearch() {
    setSearch("");
  }

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
    const out = clients.filter((c) => matchesSearch(c, search));
    out.sort((a, b) =>
      normalizeForSort(displayName(a)).localeCompare(
        normalizeForSort(displayName(b)),
        "de",
      ),
    );
    return out;
  }, [clients, search]);

  const client360 = useClient360(selectedId);

  function openClient(id: number, tab: TabKey = "rezepturen") {
    setSelectedId(id);
    setInitialTab(tab);
  }

  /** GoBD-style anonymize. Two stages of confirmation, then DELETE. */
  async function performDelete() {
    if (deleteState.stage !== "confirm") return;
    const { client, reason } = deleteState;
    setDeleteState({ stage: "deleting", client, reason });
    try {
      await apiDelete(
        `/api/clients/${client.id}?reason=${encodeURIComponent(reason)}`,
      );
      // Local cache eviction — anonymized client gets renamed/cleared.
      setClients((prev) =>
        prev.map((c) =>
          c.id === client.id
            ? {
                ...c,
                name: "Anonymous Client",
                firstName: "Anonymous",
                lastName: "Client",
                email: null,
                phone: null,
                anonymizedAt: new Date().toISOString(),
              }
            : c,
        ),
      );
      if (selectedId === client.id) setSelectedId(null);
      setDeleteState({ stage: "closed" });
    } catch (e) {
      setDeleteState({
        stage: "error",
        client,
        reason,
        message: e instanceof Error ? e.message : "delete_failed",
      });
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-[var(--app-bg)]">
      <LeftPanel
        clients={filtered}
        totalCount={clients.length}
        loading={listLoading}
        error={listError}
        search={search}
        onSearch={handleSearchChange}
        onClearSearch={clearSearch}
        keyboardOpen={keyboardOpen}
        onToggleKeyboard={() => setKeyboardOpen((v) => !v)}
        onPressKey={pressKey}
        onPressBackspace={pressBackspace}
        selectedId={selectedId}
        onSelect={(id) => openClient(id)}
        onEditClient={(id) => openClient(id, "bearbeiten")}
        onDeleteClient={(c) =>
          setDeleteState({ stage: "reason", client: c, reason: "" })
        }
        canDelete={isOwner}
      />
      <RightPanel
        selectedId={selectedId}
        initialTab={initialTab}
        data={client360.data}
        loading={client360.loading}
        error={client360.error}
        refresh={client360.refresh}
      />
      {deleteState.stage !== "closed" && (
        <DeleteClientDialog
          state={deleteState}
          onCancel={() => setDeleteState({ stage: "closed" })}
          onReasonChange={(r) =>
            setDeleteState((s) =>
              s.stage === "reason" ? { ...s, reason: r } : s,
            )
          }
          onContinue={() =>
            setDeleteState((s) =>
              s.stage === "reason"
                ? { stage: "confirm", client: s.client, reason: s.reason }
                : s,
            )
          }
          onBack={() =>
            setDeleteState((s) =>
              s.stage === "confirm" || s.stage === "error"
                ? { stage: "reason", client: s.client, reason: s.reason }
                : s,
            )
          }
          onConfirm={() => void performDelete()}
        />
      )}
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
  onClearSearch: () => void;
  keyboardOpen: boolean;
  onToggleKeyboard: () => void;
  onPressKey: (ch: string) => void;
  onPressBackspace: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onEditClient: (id: number) => void;
  onDeleteClient: (c: ClientRow) => void;
  canDelete: boolean;
}

function LeftPanel(p: LeftPanelProps): JSX.Element {
  return (
    <aside
      className="flex h-full w-[380px] shrink-0 flex-col overflow-hidden border-r-2 border-[var(--app-border-strong)] bg-[var(--app-surface)]"
      aria-label="Kunden-Browser Liste"
    >
      <div className="border-b-2 border-[var(--app-border-strong)] px-4 py-4">
        <label className="block text-base font-medium text-[var(--app-text)]">
          <span className="sr-only">Kunde suchen</span>
          <div className="relative">
            <input
              type="search"
              placeholder="Name oder Telefon suchen…"
              value={p.search}
              onChange={(e) => p.onSearch(e.target.value)}
              className="h-14 w-full rounded-md border-2 border-[var(--app-border-strong)] bg-[var(--app-bg)] px-4 pr-10 text-lg text-[var(--app-text)] outline-none focus:border-[var(--editorial-pulse)]"
            />
            {p.search.length > 0 && (
              <button
                type="button"
                onClick={p.onClearSearch}
                aria-label="Suche löschen"
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--app-text-subtle)] desktop-hover"
              >
                <X size={20} strokeWidth={2} />
              </button>
            )}
          </div>
        </label>
        <div className="mt-2">
          <button
            type="button"
            onClick={p.onToggleKeyboard}
            aria-expanded={p.keyboardOpen}
            aria-controls="virtual-keyboard"
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--app-border-strong)] bg-[var(--app-bg)] px-3 text-sm font-medium text-[var(--app-text)] desktop-hover"
          >
            <Keyboard size={16} strokeWidth={1.75} />
            <span>{p.keyboardOpen ? "Tastatur ausblenden" : "Tastatur einblenden"}</span>
          </button>
        </div>
      </div>

      {p.keyboardOpen && (
        <VirtualKeyboard
          onPressKey={p.onPressKey}
          onPressBackspace={p.onPressBackspace}
        />
      )}

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
              <ClientListRow
                key={c.id}
                client={c}
                selected={p.selectedId === c.id}
                onOpen={() => p.onSelect(c.id)}
                onEdit={() => p.onEditClient(c.id)}
                onDelete={() => p.onDeleteClient(c)}
                canDelete={p.canDelete}
              />
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

/**
 * VirtualKeyboard — on-screen German alphabet that types into the search input.
 * Replaces the previous "letter filter chips" — now each tap is equivalent
 * to typing the letter on a physical keyboard. The Backspace key removes the
 * last character. The salon owner can type names with the mouse alone.
 */
function VirtualKeyboard({
  onPressKey,
  onPressBackspace,
}: {
  onPressKey: (ch: string) => void;
  onPressBackspace: () => void;
}): JSX.Element {
  return (
    <div
      id="virtual-keyboard"
      className="border-b-2 border-[var(--app-border-strong)] bg-[var(--app-surface-2)] px-2 py-2"
      role="group"
      aria-label="Bildschirmtastatur"
    >
      <div className="flex flex-wrap gap-1.5">
        {GERMAN_ALPHABET.map((letter) => (
          <button
            key={letter}
            type="button"
            onClick={() => onPressKey(letter)}
            aria-label={`Buchstabe ${letter} einfügen`}
            className="min-h-12 min-w-[3rem] rounded-md border border-[var(--app-border-strong)] bg-[var(--app-bg)] px-3 text-base font-medium text-[var(--app-text)] desktop-hover active:bg-[var(--editorial-pulse)]/15"
          >
            {letter}
          </button>
        ))}
        <button
          type="button"
          onClick={onPressBackspace}
          aria-label="Letztes Zeichen löschen"
          className="ml-auto inline-flex min-h-12 items-center gap-1.5 rounded-md border border-[var(--app-border-strong)] bg-[var(--app-bg)] px-3 text-base font-medium text-[var(--app-text)] desktop-hover"
        >
          <BackspaceIcon size={18} strokeWidth={1.75} />
          <span>Löschen</span>
        </button>
      </div>
    </div>
  );
}

/* ─── Right panel ──────────────────────────────────────────────────────── */

interface RightPanelProps {
  selectedId: number | null;
  initialTab: TabKey;
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

  return (
    <ClientDetails
      data={p.data}
      refresh={p.refresh}
      initialTab={p.initialTab}
    />
  );
}

/* ─── Client details ───────────────────────────────────────────────────── */

type TabKey = "bearbeiten" | "rezepturen" | "notizen" | "praeferenzen";

function ClientDetails({
  data,
  refresh,
  initialTab,
}: {
  data: Client360Data;
  refresh: () => Promise<void>;
  initialTab: TabKey;
}): JSX.Element {
  const [tab, setTab] = useState<TabKey>(initialTab);
  // Switching to a different client (or clicking Edit on a row) should
  // honor the freshly-passed initialTab.
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, data.client.id]);
  const cid = data.client.id;
  return (
    <main className="flex-1 overflow-y-auto p-8">
      <ClientHeader data={data} />
      <FormulaHero data={data} />
      <QuickStats data={data} />
      <TabBar value={tab} onChange={setTab} />
      <div className="mt-6">
        {tab === "bearbeiten" && (
          <BearbeitenTab cid={cid} data={data} refresh={refresh} />
        )}
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
  const tabs: Array<{ k: TabKey; icon?: React.ReactNode; label: string }> = [
    { k: "bearbeiten", icon: <Pencil size={16} strokeWidth={1.75} />, label: "Bearbeiten" },
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
            className={`inline-flex min-h-12 items-center gap-2 px-5 text-base font-medium ${
              active
                ? "border-b-2 border-[var(--editorial-pulse)] text-[var(--app-text)]"
                : "text-[var(--app-text-subtle)] desktop-hover"
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
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

/* ─── Bearbeiten (profile editor) tab ─────────────────────────────────────
   Direct edit of the GDPR-relevant PII fields backed by
   PATCH /api/clients/:id/profile. The backend already enforces
   firstName-required + anonymized-client rejection; the UI just mirrors
   the same constraints with disabled save + a clear error banner.            */

interface ProfileFields {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  country: string;
}

function fieldsFromClient(c: Client360Data["client"]): ProfileFields {
  return {
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    street: c.street ?? "",
    houseNumber: c.houseNumber ?? "",
    postalCode: c.postalCode ?? "",
    city: c.city ?? "",
    country: c.country ?? "",
  };
}

function BearbeitenTab({
  cid,
  data,
  refresh,
}: {
  cid: number;
  data: Client360Data;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [fields, setFields] = useState<ProfileFields>(() =>
    fieldsFromClient(data.client),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const dirty = useMemo(() => {
    const base = fieldsFromClient(data.client);
    return (
      Object.keys(fields) as Array<keyof ProfileFields>
    ).some((k) => fields[k] !== base[k]);
  }, [fields, data.client]);

  const canSave = fields.firstName.trim().length > 0 && dirty && !saving;

  function update<K extends keyof ProfileFields>(k: K, v: ProfileFields[K]) {
    setFields((prev) => ({ ...prev, [k]: v }));
    setSavedFlash(false);
    setErr(null);
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    try {
      await apiPatch(`/api/clients/${cid}/profile`, {
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        phone: fields.phone.trim() || null,
        email: fields.email.trim() || null,
        street: fields.street.trim() || null,
        houseNumber: fields.houseNumber.trim() || null,
        postalCode: fields.postalCode.trim() || null,
        city: fields.city.trim() || null,
        country: fields.country.trim() || null,
      });
      setSavedFlash(true);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setFields(fieldsFromClient(data.client));
    setErr(null);
    setSavedFlash(false);
  }

  return (
    <section>
      <div className="rounded-lg border-2 border-[var(--app-border-strong)] bg-[var(--app-surface)] p-6">
        <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-2xl font-medium text-[var(--app-text)]">
            Kundenakte bearbeiten
          </h3>
          <p className="text-sm text-[var(--app-text-subtle)]">
            Änderungen werden in der Änderungshistorie (Audit-Log) festgehalten.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <EditField
            label="Vorname"
            required
            value={fields.firstName}
            onChange={(v) => update("firstName", v)}
            placeholder="Pflichtfeld"
          />
          <EditField
            label="Nachname"
            value={fields.lastName}
            onChange={(v) => update("lastName", v)}
          />
          <EditField
            label="Telefon"
            value={fields.phone}
            onChange={(v) => update("phone", v)}
            placeholder="z. B. +49 30 123 456"
            inputMode="tel"
          />
          <EditField
            label="E-Mail"
            value={fields.email}
            onChange={(v) => update("email", v)}
            placeholder="z. B. anna@example.com"
            inputMode="email"
          />
        </div>

        <h4 className="mt-8 mb-3 text-lg font-medium text-[var(--app-text)]">
          Adresse
        </h4>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[2fr_1fr]">
          <EditField
            label="Straße"
            value={fields.street}
            onChange={(v) => update("street", v)}
          />
          <EditField
            label="Hausnummer"
            value={fields.houseNumber}
            onChange={(v) => update("houseNumber", v)}
          />
        </div>
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-[1fr_2fr_1fr]">
          <EditField
            label="PLZ"
            value={fields.postalCode}
            onChange={(v) => update("postalCode", v)}
            inputMode="numeric"
          />
          <EditField
            label="Stadt"
            value={fields.city}
            onChange={(v) => update("city", v)}
          />
          <EditField
            label="Land"
            value={fields.country}
            onChange={(v) => update("country", v)}
            placeholder="z. B. Deutschland"
          />
        </div>

        {err && (
          <p className="mt-5 rounded-md border-2 border-editorial-crimson bg-red-50 p-3 text-base text-red-900">
            Fehler: {err}
          </p>
        )}
        {savedFlash && !err && !dirty && (
          <p className="mt-5 rounded-md border-2 border-green-700 bg-green-50 p-3 text-base font-medium text-green-900">
            ✓ Gespeichert.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="min-h-12 rounded-md bg-[var(--editorial-pulse)] px-6 text-lg font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Speichere…" : "Änderungen speichern"}
          </button>
          {dirty && !saving && (
            <button
              type="button"
              onClick={discard}
              className="min-h-12 rounded-md border-2 border-[var(--app-border-strong)] bg-[var(--app-bg)] px-5 text-base text-[var(--app-text)] desktop-hover"
            >
              Verwerfen
            </button>
          )}
          {!fields.firstName.trim() && (
            <span className="text-sm text-red-700">
              Vorname ist Pflichtfeld
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function EditField({
  label,
  value,
  onChange,
  placeholder,
  required,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  inputMode?: "tel" | "email" | "numeric" | "text";
}): JSX.Element {
  return (
    <label className="block">
      <span className="block text-base font-medium text-[var(--app-text)]">
        {label}
        {required && <span className="ml-1 text-red-700" aria-hidden="true">*</span>}
      </span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 h-12 w-full rounded-md border-2 border-[var(--app-border-strong)] bg-[var(--app-bg)] px-3 text-base text-[var(--app-text)] outline-none focus:border-[var(--editorial-pulse)]"
      />
    </label>
  );
}

/* ─── Client list row + three-dots menu ───────────────────────────────────
   The menu hovers over the row. Click-outside listener installed only while
   the menu is open — keeps the listener cost tiny for the 1000-client list.   */

function ClientListRow({
  client,
  selected,
  onOpen,
  onEdit,
  onDelete,
  canDelete,
}: {
  client: ClientRow;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canDelete: boolean;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  const isAnonymized = client.anonymizedAt != null;

  return (
    <li ref={wrapperRef} className="relative">
      <div
        className={`flex min-h-16 items-stretch border-b border-[var(--app-border)] ${
          selected ? "bg-[var(--editorial-pulse)]/15" : ""
        }`}
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex flex-1 items-center gap-3 px-4 py-3 text-left desktop-hover"
          aria-current={selected ? "true" : undefined}
        >
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--app-bg)] text-lg font-medium text-[var(--app-text)]"
          >
            {firstLetterForSort(client) || "?"}
          </span>
          <span className="flex min-w-0 flex-col">
            <span
              className={`truncate text-base font-medium ${
                isAnonymized
                  ? "italic text-[var(--app-text-subtle)]"
                  : "text-[var(--app-text)]"
              }`}
            >
              {displayName(client)}
              {isAnonymized && " · anonymisiert"}
            </span>
            <span className="truncate text-sm text-[var(--app-text-subtle)]">
              {client.phone || "Keine Telefonnummer"}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Aktionen für diesen Kunden"
          className="flex w-11 shrink-0 items-center justify-center border-l border-[var(--app-border)] text-[var(--app-text-subtle)] desktop-hover"
        >
          <MoreVertical size={20} strokeWidth={1.75} />
        </button>
      </div>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-2 top-14 z-30 w-56 rounded-md border-2 border-[var(--app-border-strong)] bg-[var(--app-surface)] py-1 shadow-luxury"
        >
          <RowMenuItem
            onClick={() => {
              setMenuOpen(false);
              onOpen();
            }}
            icon={<Eye size={18} strokeWidth={1.75} />}
            label="Öffnen"
          />
          <RowMenuItem
            onClick={() => {
              setMenuOpen(false);
              onEdit();
            }}
            icon={<Pencil size={18} strokeWidth={1.75} />}
            label="Bearbeiten"
            disabled={isAnonymized}
          />
          {canDelete && (
            <RowMenuItem
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              icon={<Trash2 size={18} strokeWidth={1.75} />}
              label="Löschen"
              disabled={isAnonymized}
              danger
            />
          )}
        </div>
      )}
    </li>
  );
}

function RowMenuItem({
  onClick,
  icon,
  label,
  disabled,
  danger,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-base desktop-hover disabled:opacity-40 disabled:cursor-not-allowed ${
        danger ? "text-red-700" : "text-[var(--app-text)]"
      }`}
    >
      <span aria-hidden="true" className="flex w-5 justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/* ─── Delete confirmation dialog (two-stage) ──────────────────────────────
   Stage 1 — reason: salon owner types why the client is being anonymized.
            Required by §15 / Art. 17 — backend rejects empty reason with 400.
   Stage 2 — confirm: shows a clear "final" warning before the API fires.
   Stage 3 — deleting: button is disabled, shows spinner text.
   Stage 4 — error:    keeps the modal open with a retry button.            */

function DeleteClientDialog({
  state,
  onCancel,
  onReasonChange,
  onContinue,
  onBack,
  onConfirm,
}: {
  state: DeleteState;
  onCancel: () => void;
  onReasonChange: (r: string) => void;
  onContinue: () => void;
  onBack: () => void;
  onConfirm: () => void;
}): JSX.Element | null {
  if (state.stage === "closed") return null;
  const c = state.client;
  const name =
    [c.firstName, c.lastName].filter((s) => s && s.trim()).join(" ").trim() ||
    c.name ||
    "Unbekannt";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && state.stage !== "deleting") onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border-2 border-[var(--app-border-strong)] bg-[var(--app-surface)] p-6 shadow-luxury">
        {state.stage === "reason" && (
          <>
            <h2 id="delete-dialog-title" className="text-2xl font-medium text-[var(--app-text)]">
              Kunden löschen?
            </h2>
            <p className="mt-3 text-base text-[var(--app-text)]">
              <strong>{name}</strong> wird gemäß DSGVO Art. 17 anonymisiert.
              Termine bleiben fiskalisch korrekt erhalten, aber Name, Telefon
              und E-Mail werden unwiderruflich gelöscht.
            </p>
            <label className="mt-5 block">
              <span className="block text-base font-medium text-[var(--app-text)]">
                Begründung (Pflicht)
                <span className="ml-1 text-red-700" aria-hidden="true">*</span>
              </span>
              <textarea
                value={state.reason}
                onChange={(e) => onReasonChange(e.target.value)}
                placeholder="z. B. Datenschutz-Anfrage des Kunden vom 27.05.2026"
                rows={3}
                className="mt-1.5 w-full rounded-md border-2 border-[var(--app-border-strong)] bg-[var(--app-bg)] p-3 text-base text-[var(--app-text)] outline-none focus:border-[var(--editorial-pulse)]"
                autoFocus
              />
            </label>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="min-h-12 rounded-md border-2 border-[var(--app-border-strong)] bg-[var(--app-bg)] px-5 text-base text-[var(--app-text)] desktop-hover"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={onContinue}
                disabled={state.reason.trim().length < 1}
                className="min-h-12 rounded-md bg-red-700 px-5 text-base font-medium text-white disabled:opacity-40"
              >
                Weiter
              </button>
            </div>
          </>
        )}

        {(state.stage === "confirm" || state.stage === "deleting") && (
          <>
            <h2 id="delete-dialog-title" className="text-2xl font-medium text-red-800">
              Endgültige Bestätigung
            </h2>
            <p className="mt-3 text-base text-[var(--app-text)]">
              Soll der Kunde <strong>{name}</strong> wirklich anonymisiert werden?
              Diese Aktion ist <strong>unwiderruflich</strong>.
            </p>
            <p className="mt-3 rounded-md bg-[var(--app-bg)] p-3 text-sm text-[var(--app-text-subtle)]">
              Begründung: <em>{state.reason}</em>
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={onBack}
                disabled={state.stage === "deleting"}
                className="min-h-12 rounded-md border-2 border-[var(--app-border-strong)] bg-[var(--app-bg)] px-5 text-base text-[var(--app-text)] desktop-hover disabled:opacity-40"
              >
                Zurück
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={state.stage === "deleting"}
                className="min-h-12 rounded-md bg-red-700 px-5 text-base font-medium text-white disabled:opacity-40"
              >
                {state.stage === "deleting" ? "Lösche…" : "Endgültig löschen"}
              </button>
            </div>
          </>
        )}

        {state.stage === "error" && (
          <>
            <h2 id="delete-dialog-title" className="text-2xl font-medium text-red-800">
              Löschen fehlgeschlagen
            </h2>
            <p className="mt-3 rounded-md border-2 border-editorial-crimson bg-red-50 p-3 text-base text-red-900">
              {state.message}
            </p>
            <p className="mt-3 text-sm text-[var(--app-text-subtle)]">
              {/* Most common cause: non-owner role. */}
              Tipp: Nur der Inhaber-Login (Owner) darf Kunden löschen.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="min-h-12 rounded-md border-2 border-[var(--app-border-strong)] bg-[var(--app-bg)] px-5 text-base text-[var(--app-text)] desktop-hover"
              >
                Schließen
              </button>
              <button
                type="button"
                onClick={onBack}
                className="min-h-12 rounded-md bg-red-700 px-5 text-base font-medium text-white"
              >
                Erneut versuchen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

