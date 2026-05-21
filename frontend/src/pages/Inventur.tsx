/**
 * Inventur.tsx — Lagerverwaltung
 * ✓ Produktliste mit Bestand in ml
 * ✓ Zugang buchen: Kartons × ml/Karton
 * ✓ Neues Produkt anlegen
 */
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../api";
import { EditProductModal, type EditableProduct } from "../components/ui/EditProductModal";

type InventoryItem = {
  id: number;
  name: string;
  onHandMl: number;
  defaultUnitMl: number;
  barcodeEan: string | null;
  barcodeUpc: string | null;
  minStockThresholdMl: number | null;
  isRetail?: boolean;
  usageType?: "retail" | "salon" | "both";
  referenceNetPerMlCents?: number;
  estimateVatRateBps?: number;
};

const USAGE_LABEL: Record<"retail" | "salon" | "both", string> = {
  salon:  "Salon",
  retail: "Verkauf",
  both:   "Salon + Verkauf",
};

type View = "list" | "add-stock" | "add-product";

function mlDisplay(ml: number): string {
  if (ml >= 1000) return `${(ml / 1000).toFixed(2).replace(/\.?0+$/, "")} L`;
  return `${ml} ml`;
}

function TabBar({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const tabs: { id: View; label: string }[] = [
    { id: "list",        label: "Bestand" },
    { id: "add-stock",   label: "Zugang buchen" },
    { id: "add-product", label: "Neues Produkt" },
  ];
  return (
    <div className="flex gap-0 border border-deep-charcoal/10 bg-gray-100/60 p-0.5 w-full sm:w-fit mb-6">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`flex-1 sm:flex-none px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.14em] transition ${
            view === t.id
              ? "bg-white border border-editorial-pulse/30 text-editorial-pulse shadow-sm"
              : "text-deep-charcoal/50 hover:text-deep-charcoal/70"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Bestandsliste ─────────────────────────────────────────────────────── */
function InventoryList({
  items,
  loading,
  onRefresh,
}: {
  items: InventoryItem[];
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="py-20 text-center text-deep-charcoal/40">
        <p className="text-[12px] uppercase tracking-[0.2em]">Wird geladen…</p>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="py-20 text-center border border-dashed border-deep-charcoal/10">
        <p className="text-[12px] uppercase tracking-[0.2em] text-deep-charcoal/40">
          Keine Produkte vorhanden — neues Produkt anlegen
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] uppercase tracking-[0.25em] text-deep-charcoal/40">
          {items.length} Produkte
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="text-[10px] uppercase tracking-[0.2em] text-deep-charcoal/35 hover:text-deep-charcoal/60 transition"
        >
          ↻ Aktualisieren
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {items
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((item) => (
            <InventoryListItem key={item.id} item={item} onRefresh={onRefresh} />
          ))}
      </div>
    </div>
  );
}

function InventoryListItem({ item, onRefresh }: { item: InventoryItem; onRefresh: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [newMl, setNewMl] = useState(String(item.onHandMl));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const usage = item.usageType ?? (item.isRetail ? "retail" : "salon");
  
  const low = item.minStockThresholdMl != null && item.onHandMl <= item.minStockThresholdMl;
  const empty = item.onHandMl <= 0;

  const handleDelete = async () => {
    if (!confirm(`Soll das Produkt "${item.name}" wirklich gelöscht werden?`)) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/inventory/${item.id}`);
      onRefresh();
    } catch (e) {
      alert("Fehler beim Löschen: " + (e instanceof Error ? e.message : "Unbekannt"));
      setDeleting(false);
    }
  };

  const handleAdjust = async () => {
    const ml = parseInt(newMl, 10);
    if (isNaN(ml) || ml < 0) {
      alert("Bitte einen gültigen Bestand in ml eingeben.");
      return;
    }
    if (ml === item.onHandMl) {
      setEditing(false);
      return;
    }
    if (!reason.trim()) {
      alert("Bitte einen Grund angeben (z.B. Zählkorrektur).");
      return;
    }
    
    setBusy(true);
    const delta = ml - item.onHandMl;
    const type = delta > 0 ? "increase" : "decrease";
    const amountMl = Math.abs(delta);
    const payload: any = { itemId: item.id, amountMl, type, reason: reason.trim() };
    if (type === "decrease") payload.category = "count_correction";

    try {
      await apiPost("/api/inventory/adjust", payload);
      setEditing(false);
      setReason("");
      onRefresh();
    } catch (e) {
      alert("Fehler beim Speichern: " + (e instanceof Error ? e.message : "Unbekannt"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`border bg-white/80 p-4 transition hover:bg-white ${
        empty ? "border-red-300/60" : low ? "border-amber-300/50" : "border-deep-charcoal/[0.07]"
      } ${deleting ? "opacity-50 pointer-events-none" : ""}`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm text-deep-charcoal/90 truncate">{item.name}</p>
          <p className="text-[10px] text-deep-charcoal/35 mt-0.5">
            <span className="inline-block px-1.5 border border-deep-charcoal/15 mr-2 font-medium uppercase tracking-wider">{USAGE_LABEL[usage]}</span>
            {item.defaultUnitMl > 0 && `Einheit: ${mlDisplay(item.defaultUnitMl)}`}
            {item.barcodeEan && <span className="ml-2 font-mono">EAN: {item.barcodeEan}</span>}
          </p>
        </div>
        
        <div className="text-right shrink-0">
          <p className={`font-mono text-lg font-medium tabular-nums ${
            empty ? "text-red-500" : low ? "text-amber-500" : "text-editorial-pulse"
          }`}>
            {mlDisplay(item.onHandMl)}
          </p>
          {low && !empty && <p className="text-[9px] uppercase tracking-wider text-amber-500/80 mt-0.5">Mindestbestand erreicht</p>}
          {empty && <p className="text-[9px] uppercase tracking-wider text-red-500/80 mt-0.5">Kein Bestand</p>}
        </div>
      </div>
      
      {/* Action Buttons */}
      {!editing && (
        <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-deep-charcoal/5">
          <button
            type="button"
            onClick={() => setEditModalOpen(true)}
            className="text-[10px] uppercase tracking-[0.15em] text-deep-charcoal/50 hover:text-editorial-pulse transition"
          >
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={() => { setEditing(true); setNewMl(String(item.onHandMl)); }}
            className="text-[10px] uppercase tracking-[0.15em] text-deep-charcoal/50 hover:text-editorial-pulse transition"
          >
            Bestand-Korrektur
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="text-[10px] uppercase tracking-[0.15em] text-red-400/80 hover:text-red-600 transition"
          >
            Löschen
          </button>
        </div>
      )}

      {/* Edit Form */}
      {editing && (
        <div className="mt-4 pt-4 border-t border-deep-charcoal/[0.07] flex flex-col sm:flex-row gap-3 items-end">
          <div className="w-full sm:flex-1">
            <p className="text-[9px] font-light uppercase tracking-wider text-deep-charcoal/50 mb-1">Neuer Bestand (ml)</p>
            <input 
              type="number" 
              min="0" 
              className="luxury-field w-full text-sm" 
              value={newMl} 
              onChange={e => setNewMl(e.target.value)} 
            />
          </div>
          <div className="w-full sm:flex-1">
            <p className="text-[9px] font-light uppercase tracking-wider text-deep-charcoal/50 mb-1">Grund (z.B. Zählkorrektur)</p>
            <input 
              type="text" 
              placeholder="Grund für Änderung" 
              className="luxury-field w-full text-sm" 
              value={reason} 
              onChange={e => setReason(e.target.value)} 
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-4 py-2 text-[10px] uppercase tracking-wider text-deep-charcoal/50 bg-gray-100 hover:bg-gray-200 transition"
              disabled={busy}
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleAdjust}
              className="px-4 py-2 text-[10px] uppercase tracking-wider text-white bg-editorial-pulse hover:bg-editorial-pulse/90 transition"
              disabled={busy}
            >
              {busy ? "..." : "Speichern"}
            </button>
          </div>
        </div>
      )}

      <EditProductModal
        open={editModalOpen}
        product={{
          id: item.id,
          name: item.name,
          barcodeEan: item.barcodeEan,
          defaultUnitMl: item.defaultUnitMl,
          onHandMl: item.onHandMl,
          isRetail: item.isRetail ?? false,
          usageType: usage,
          referenceNetPerMlCents: item.referenceNetPerMlCents ?? 0,
          estimateVatRateBps: item.estimateVatRateBps ?? 1900,
          minStockThresholdMl: item.minStockThresholdMl,
        } as EditableProduct}
        onClose={() => setEditModalOpen(false)}
        onSaved={() => onRefresh()}
      />
    </div>
  );
}

/* ─── Zugang buchen: Kartons × ml/Karton ───────────────────────────────── */
function AddStockForm({
  items,
  onSuccess,
}: {
  items: InventoryItem[];
  onSuccess: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [boxCount, setBoxCount]     = useState("");
  const [mlPerBox, setMlPerBox]     = useState("");
  const [note, setNote]             = useState("");
  const [busy, setBusy]             = useState(false);
  const [msg, setMsg]               = useState("");

  const totalMl =
    Number(boxCount) > 0 && Number(mlPerBox) > 0
      ? Math.floor(Number(boxCount)) * Math.floor(Number(mlPerBox))
      : null;

  const selectedItem = items.find((i) => String(i.id) === selectedId);

  // Wenn Produkt ausgewählt und defaultUnitMl gesetzt → vorausfüllen
  useEffect(() => {
    if (selectedItem && selectedItem.defaultUnitMl > 0 && !mlPerBox) {
      setMlPerBox(String(selectedItem.defaultUnitMl));
    }
  }, [selectedItem]);

  const submit = async () => {
    if (!selectedId)              { setMsg("Produkt auswählen");             return; }
    if (Number(boxCount) < 1)     { setMsg("Anzahl Kartons eingeben");       return; }
    if (Number(mlPerBox) < 1)     { setMsg("ml pro Karton eingeben");        return; }

    setBusy(true);
    setMsg("");
    try {
      await apiPost("/api/inventory/receive-boxes", {
        itemId:   Number(selectedId),
        boxCount: Math.floor(Number(boxCount)),
        mlPerBox: Math.floor(Number(mlPerBox)),
        note:     note.trim() || undefined,
      });
      setMsg(`✓ ${totalMl} ml erfolgreich gebucht`);
      setBoxCount("");
      setMlPerBox("");
      setNote("");
      onSuccess();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Fehler beim Speichern");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-deep-charcoal/10 bg-white/80">
      {/* Produktauswahl */}
      <div className="border-b border-deep-charcoal/[0.07] p-5">
        <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
          Produkt
        </p>
        <select
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setMlPerBox("");
          }}
          className="luxury-field w-full"
        >
          <option value="">Produkt wählen…</option>
          {items
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((it) => (
              <option key={it.id} value={String(it.id)}>
                {it.name} — Bestand: {mlDisplay(it.onHandMl)}
              </option>
            ))}
        </select>
        {selectedItem && (
          <p className="mt-1.5 text-[10px] text-editorial-pulse/80">
            ✓ Aktueller Bestand: {mlDisplay(selectedItem.onHandMl)}
          </p>
        )}
      </div>

      {/* Kartons × ml/Karton */}
      <div className="grid grid-cols-2 border-b border-deep-charcoal/[0.07]">
        <div className="border-r border-deep-charcoal/[0.07] p-5">
          <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
            Anzahl Kartons
          </p>
          <input
            type="number"
            min="1"
            step="1"
            value={boxCount}
            onChange={(e) => setBoxCount(e.target.value)}
            placeholder="z.B. 3"
            className="luxury-field w-full"
          />
        </div>
        <div className="p-5">
          <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
            ml pro Karton / Flasche
          </p>
          <input
            type="number"
            min="1"
            step="1"
            value={mlPerBox}
            onChange={(e) => setMlPerBox(e.target.value)}
            placeholder="z.B. 200"
            className="luxury-field w-full"
          />
        </div>
      </div>

      {/* Berechnetes Ergebnis */}
      {totalMl !== null && (
        <div className="border-b border-deep-charcoal/[0.07] px-5 py-3 bg-editorial-pulse/[0.04]">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-deep-charcoal/50">
              {boxCount} Karton(s) × {mlPerBox} ml =
            </p>
            <p className="font-mono text-lg font-semibold text-editorial-pulse">
              {mlDisplay(totalMl)}
            </p>
          </div>
          {selectedItem && (
            <p className="text-[10px] text-deep-charcoal/35 mt-1">
              Bestand nach Buchung:{" "}
              <span className="font-medium text-deep-charcoal/60">
                {mlDisplay(selectedItem.onHandMl + totalMl)}
              </span>
            </p>
          )}
        </div>
      )}

      {/* Notiz (optional) */}
      <div className="border-b border-deep-charcoal/[0.07] p-5">
        <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
          Notiz (optional)
        </p>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="z.B. Lieferschein Nr. 123"
          className="luxury-field w-full"
        />
      </div>

      {/* Speichern */}
      <div className="flex items-center justify-between px-5 py-4">
        {msg ? (
          <p
            className={`text-[12px] ${
              msg.startsWith("✓") ? "text-green-600" : "text-red-500/90"
            }`}
          >
            {msg}
          </p>
        ) : (
          <p className="text-[11px] text-deep-charcoal/30">
            Buchung wird im Protokoll festgehalten
          </p>
        )}
        <button
          type="button"
          disabled={busy || !selectedId || !boxCount || !mlPerBox || totalMl === null}
          onClick={() => void submit()}
          className="editorial-pulse-fill min-h-10 px-8 text-[12px] font-medium uppercase tracking-[0.22em] transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Speichern…" : "Zugang buchen"}
        </button>
      </div>
    </div>
  );
}

/* ─── Neues Produkt anlegen ─────────────────────────────────────────────── */
function AddProductForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName]             = useState("");
  const [defaultUnitMl, setDefault] = useState("");
  const [initBoxCount, setInitBox]  = useState("");
  const [mlPerBox, setMlPerBox]     = useState("");
  const [busy, setBusy]             = useState(false);
  const [msg, setMsg]               = useState("");

  const totalMl =
    Number(initBoxCount) > 0 && Number(mlPerBox) > 0
      ? Math.floor(Number(initBoxCount)) * Math.floor(Number(mlPerBox))
      : 0;

  const submit = async () => {
    if (!name.trim()) { setMsg("Produktname eingeben"); return; }

    setBusy(true);
    setMsg("");
    try {
      const res = await apiPost<{ id: number }>("/api/inventory", {
        name: name.trim(),
        defaultUnitMl:
          Number(defaultUnitMl) > 0
            ? Math.floor(Number(defaultUnitMl))
            : undefined,
        onHandMl: totalMl,
      });

      // Anfangsbestand als separate Buchung eintragen
      if (totalMl > 0 && res && typeof res === "object" && "id" in res) {
        await apiPost("/api/inventory/receive-boxes", {
          itemId:   (res as { id: number }).id,
          boxCount: Math.floor(Number(initBoxCount)),
          mlPerBox: Math.floor(Number(mlPerBox)),
          note:     "Anfangsbestand bei Produktanlage",
        }).catch(() => {});
      }

      setMsg(`✓ Produkt "${name.trim()}" wurde angelegt`);
      setName("");
      setDefault("");
      setInitBox("");
      setMlPerBox("");
      onSuccess();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Fehler beim Anlegen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-deep-charcoal/10 bg-white/80">
      {/* Produktname */}
      <div className="border-b border-deep-charcoal/[0.07] p-5">
        <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
          Produktname *
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Wella Farbe 5/0"
          className="luxury-field w-full"
          autoFocus
        />
      </div>

      {/* Standardeinheit */}
      <div className="border-b border-deep-charcoal/[0.07] p-5">
        <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
          Flaschengröße in ml (optional)
        </p>
        <input
          type="number"
          min="1"
          step="1"
          value={defaultUnitMl}
          onChange={(e) => setDefault(e.target.value)}
          placeholder="z.B. 200"
          className="luxury-field w-full"
        />
        <p className="mt-1.5 text-[10px] text-deep-charcoal/35">
          Wird als Vorgabe beim nächsten Zugang verwendet
        </p>
      </div>

      {/* Anfangsbestand */}
      <div className="border-b border-deep-charcoal/[0.07] p-5">
        <p className="mb-2 text-[10px] font-light uppercase tracking-[0.25em] text-deep-charcoal/50">
          Anfangsbestand (optional)
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-[9px] text-deep-charcoal/40 uppercase tracking-[0.2em]">
              Kartons
            </p>
            <input
              type="number"
              min="0"
              step="1"
              value={initBoxCount}
              onChange={(e) => setInitBox(e.target.value)}
              placeholder="0"
              className="luxury-field w-full"
            />
          </div>
          <div>
            <p className="mb-1 text-[9px] text-deep-charcoal/40 uppercase tracking-[0.2em]">
              ml / Karton
            </p>
            <input
              type="number"
              min="0"
              step="1"
              value={mlPerBox}
              onChange={(e) => setMlPerBox(e.target.value)}
              placeholder="0"
              className="luxury-field w-full"
            />
          </div>
        </div>
        {totalMl > 0 && (
          <p className="mt-2 text-[11px] text-editorial-pulse font-medium">
            Anfangsbestand: {mlDisplay(totalMl)}
          </p>
        )}
      </div>

      {/* Anlegen */}
      <div className="flex items-center justify-between px-5 py-4">
        {msg ? (
          <p
            className={`text-[12px] ${
              msg.startsWith("✓") ? "text-green-600" : "text-red-500/90"
            }`}
          >
            {msg}
          </p>
        ) : (
          <p className="text-[11px] text-deep-charcoal/30">
            Produkt wird zur Lagerliste hinzugefügt
          </p>
        )}
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void submit()}
          className="editorial-pulse-fill min-h-10 px-8 text-[12px] font-medium uppercase tracking-[0.22em] transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Speichern…" : "Produkt anlegen"}
        </button>
      </div>
    </div>
  );
}

/* ─── Hauptseite ────────────────────────────────────────────────────────── */
export function Inventur() {
  const [items, setItems]     = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView]       = useState<View>("list");

  const loadItems = useCallback(() => {
    setLoading(true);
    void apiGet<InventoryItem[]>("/api/inventory")
      .then((raw) => {
        if (Array.isArray(raw)) setItems(raw as InventoryItem[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleSuccess = () => {
    loadItems();
    setView("list");
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-24">
        {/* Seitenkopf */}
        <div className="mb-6">
          <h1 className="font-heading text-3xl uppercase tracking-[0.08em] text-deep-charcoal">
            Lagerverwaltung
          </h1>
          <p className="mt-1 text-[11px] font-light uppercase tracking-[0.2em] text-deep-charcoal/40">
            Bestand · Zugang buchen · Neues Produkt
          </p>
        </div>

        <TabBar view={view} onChange={setView} />

        {view === "list" && (
          <InventoryList items={items} loading={loading} onRefresh={loadItems} />
        )}
        {view === "add-stock" && (
          <AddStockForm items={items} onSuccess={handleSuccess} />
        )}
        {view === "add-product" && (
          <AddProductForm onSuccess={handleSuccess} />
        )}
      </div>
    </div>
  );
}
