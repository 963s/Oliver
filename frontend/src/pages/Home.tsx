import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

const linkStyle: CSSProperties = {
  display: "block",
  padding: "16px 20px",
  marginBottom: 10,
  background: "#1c1917",
  color: "#fafaf9",
  textDecoration: "none",
  borderRadius: 10,
  fontSize: 20,
  fontWeight: 600,
};

export function Home() {
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 20 }}>
      <h1 style={{ fontSize: 28 }}>Oliver Roos</h1>
      <p style={{ color: "#a8a29e", lineHeight: 1.5 }}>
        <strong style={{ color: "#fafaf9" }}>Kritischer Pfad:</strong> Buchung / Walk-in → Session → Spiegelkarte →
        Schätzung → Checkout (siehe PROJECT_MEMORY).
      </p>
      <nav style={{ marginTop: 24 }}>
        <Link to="/bookings" style={{ ...linkStyle, border: "2px solid #c2410c" }}>
          Termine — buchen und Check-in → Session
        </Link>
        <Link to="/walk-in" style={linkStyle}>
          Empfang — Walk-in (ohne Termin)
        </Link>
        <p style={{ color: "#57534e", fontSize: 14, margin: "8px 0 16px" }}>
          Platinum §33–37: nur Bugfixes bis Checkout/TSE auf dem kritischen Pfad steht.
        </p>
        <Link to="/scan" style={linkStyle}>33 — Barcode / Scan to deduct</Link>
        <p style={{ color: "#78716c", fontSize: 15, marginBottom: 10, lineHeight: 1.4 }}>
          <strong>34 — Kostenvoranschlag:</strong> Session aus <strong>Termin-Check-in</strong> oder Walk-in, dann Spiegelkarte.
        </p>
        <Link to="/inventur" style={linkStyle}>35 — Inventur (Walk-Modus)</Link>
        <Link to="/reconcile" style={linkStyle}>36 — ZVT-Orphan ausgleichen</Link>
        <Link to="/rings" style={linkStyle}>37 — Ziele (Rings)</Link>
        <Link to="/settings" style={linkStyle}>Einstellungen (RBAC, Terminal-ID)</Link>
      </nav>
    </div>
  );
}
