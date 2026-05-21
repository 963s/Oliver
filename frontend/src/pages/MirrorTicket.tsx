import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../api";

/**
 * §12.5.41 — Spiegelkarte: non-fiscal prep label; runs only for an **existing** session
 * (opened via Walk-in / Check-in once booking exists).
 */
export function MirrorTicket() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionId = Number(params.get("session") ?? "0");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [service, setService] = useState("Schnitt + Beratung");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sessionOk, setSessionOk] = useState<boolean | null>(null);

  const timeStr = new Date().toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  useEffect(() => {
    if (!sessionId) {
      setSessionOk(false);
      return;
    }
    let cancelled = false;
    void apiGet<{ id: number; status: string }>(`/api/sessions/${sessionId}`)
      .then((row) => {
        if (!cancelled) {
          setSessionOk(row.status === "open");
          if (row.status !== "open") {
            setErr("Diese Session ist nicht mehr offen.");
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessionOk(false);
          setErr("Session nicht gefunden.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const continueToEstimate = () => {
    if (!sessionId || !sessionOk) return;
    const n = name.trim();
    setBusy(true);
    setErr("");
    if (!n) {
      void Promise.resolve()
        .then(() => navigate(`/estimate?session=${sessionId}`))
        .finally(() => setBusy(false));
      return;
    }
    void apiPost<{ id: number }>("/api/clients", { name: n, phone: phone.trim() || undefined })
      .then((client) =>
        apiPatch(`/api/sessions/${sessionId}`, { clientId: client.id }),
      )
      .then(() => navigate(`/estimate?session=${sessionId}`))
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  };

  const printTicket = () => {
    window.print();
  };

  if (!sessionId || sessionOk === false) {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", padding: 20 }}>
        <h1 style={{ fontSize: 26 }}>Spiegelkarte</h1>
        <p style={{ color: "#a8a29e", lineHeight: 1.6 }}>
          Die Spiegelkarte gehört zu einer <strong>bereits geöffneten Session</strong> (Check-in /
          Walk-in). Sie ist nicht der Einstieg ins System.
        </p>
        {err && <p style={{ color: "#b91c1c" }}>{err}</p>}
        <p style={{ marginTop: 24 }}>
          <Link to="/walk-in" style={{ color: "#fb923c", fontSize: 18 }}>
            → Walk-in / Session öffnen
          </Link>
        </p>
        <p style={{ marginTop: 12 }}>
          <Link to="/" style={{ color: "#78716c" }}>
            ← Start
          </Link>
        </p>
      </div>
    );
  }

  if (sessionOk === null) {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", padding: 20, color: "#a8a29e" }}>
        Session wird geprüft…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: 20 }}>
      <p style={{ fontSize: 13, color: "#78716c", marginBottom: 8 }} className="no-print">
        Session #{sessionId} ·{" "}
        <Link to="/walk-in" style={{ color: "#fb923c" }}>
          andere Session
        </Link>
      </p>
      <h1 style={{ fontSize: 26 }}>Spiegelkarte</h1>
      <p style={{ color: "#a8a29e", marginBottom: 20 }}>
        Laufzettel / Beratung vor dem Spiegel → <strong>Kostenvoranschlag</strong> (§12.5.34).{" "}
        <strong>Kein Kassenbeleg</strong> / nicht TSE-pflichtig.
      </p>

      <div id="mirror-ticket-print" style={ticketBox}>
        <div style={{ textAlign: "center", borderBottom: "1px dashed #57534e", paddingBottom: 10 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Oliver Roos Frisuren</div>
          <div style={{ fontSize: 14, color: "#57534e" }}>Laufzettel / Mirror</div>
        </div>
        <div style={{ marginTop: 12, fontSize: 18, fontWeight: 700 }}>{name.trim() || "— Kund:in —"}</div>
        {phone.trim() && <div style={{ fontSize: 16, color: "#a8a29e" }}>☎ {phone}</div>}
        <div style={{ marginTop: 8, fontSize: 15 }}>Geplant: {service || "—"}</div>
        <div style={{ marginTop: 6, fontSize: 14, color: "#78716c" }}>{timeStr}</div>
        <div style={{ marginTop: 6, fontSize: 13, color: "#57534e" }}>Session #{sessionId}</div>
        {note.trim() && (
          <div style={{ marginTop: 10, fontSize: 15, fontStyle: "italic" }}>Notiz: {note}</div>
        )}
        <p style={{ marginTop: 14, fontSize: 12, color: "#78716c" }}>
          Hinweis: Nur für Ablage am Spiegel / Team — kein umsatzsteuerlicher Beleg.
        </p>
      </div>

      <div style={{ marginTop: 20 }} className="no-print">
        <label style={lab}>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inp}
            autoComplete="name"
            placeholder="Vor- und Zuname"
          />
        </label>
        <label style={lab}>
          Telefon (optional)
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={inp}
            inputMode="tel"
          />
        </label>
        <label style={lab}>
          Geplanter Service
          <input
            value={service}
            onChange={(e) => setService(e.target.value)}
            style={inp}
            placeholder="z. B. Färben, Schnitt, …"
          />
        </label>
        <label style={lab}>
          Kurznotiz (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} style={inp} />
        </label>
        {err && <p style={{ color: "#b91c1c" }}>{err}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
          <button type="button" style={btnPrimary} disabled={busy} onClick={continueToEstimate}>
            {busy ? "…" : "Weiter → Schätzung"}
          </button>
          <button type="button" style={btnGhost} onClick={printTicket}>
            Laufzettel drucken
          </button>
        </div>
        <p style={{ marginTop: 20 }}>
          <Link to={`/estimate?session=${sessionId}`} style={{ color: "#fb923c" }}>
            Schätzung direkt öffnen (ohne Kundendaten) →
          </Link>
        </p>
      </div>

      <style>
        {`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; color: #000; }
          #mirror-ticket-print { border: 1px solid #000; }
        }
      `}
      </style>
    </div>
  );
}

const ticketBox: CSSProperties = {
  background: "#1c1917",
  color: "#fafaf9",
  borderRadius: 10,
  padding: 20,
  border: "1px solid #44403c",
  maxWidth: 320,
  margin: "0 auto 24px",
};

const lab: CSSProperties = { display: "block", marginBottom: 12, fontSize: 16 };
const inp: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: 10,
  fontSize: 18,
  borderRadius: 6,
  border: "1px solid #44403c",
  background: "#0c0a09",
  color: "#fafaf9",
};

const btnPrimary: CSSProperties = {
  padding: "12px 16px",
  fontSize: 18,
  fontWeight: 600,
  background: "#c2410c",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
};

const btnGhost: CSSProperties = {
  ...btnPrimary,
  background: "#44403c",
  color: "#fafaf9",
};
