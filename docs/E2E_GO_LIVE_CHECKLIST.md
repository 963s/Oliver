# E2E Go-Live Checklist — Oliver Roos POS

*Language: German (operator-facing) with English section headers where helpful. Last aligned with PROJECT_MEMORY Step 50.*

Diese Checkliste ist der **betriebliche Referenzlauf** vor dem ersten echten Kundenkontakt. Abhaken in der Reihenfolge — nichts überspringen, was mit **Geld, TSE oder Datenhaltung** zu tun hat.

---

## 0. Rollen klären

| Rolle | Wer unterschreibt operational „Go“ |
|-------|--------------------------------------|
| Inhaber / Verwaltung | Umgebungsvariablen, Fortress‑Pfad, Diagnose‑Grün, Tagesabschluss‑Trial |
| Rezeption / Kasse | Walk-in‑Abrechnung, EC‑Probe (wenn aktiv), Ruhe unter Last |
| Extern | Steuerberater nur bei DATEV-/Exportfragen |

---

## 1. Produktions-Umgebung (Server / Backend)

**Ziel:** Eine SQLite-Instanz pro Salon, Pfad über App-Updates stabil.

| # | Aufgabe | Erledigt |
|---|---------|----------|
| 1.1 | **`DATABASE_PATH`** zeigt auf einen **festen Ordner** (z. B. `D:\Salon Daten\salon.db` unter Windows oder `/Users/Shared/OliverRoos/salon.db` unter macOS), **nicht** in einen automatisch gelöschten Temp‑Ordner. | ☐ |
| 1.2 | Backup-Verzeichnis des OS-Kontos beschreibbar; **gleicher Maschinenkontext** wie der Prozess, der Express startet (Kiosk-Rechner). | ☐ |
| 1.3 | Firewall / LAN erlauben **SQLite nur lokal**; API nur wo beabsichtigt (127.0.0.1 vs. LAN — nach eurer Architektur). | ☐ |
| 1.4 | **`cd backend && npm run db:migrate`** (oder `npm run db:migrate -w @oliver-roos/backend` vom Monorepo-Root), **einmal** gegen die Produktions-DB — inkl. **0030_sqlite_maintenance_settings** und allen vorherigen Migrationen. | ☐ |

---

## 2. Hardware & Fiskal (Netz)

**Ziel:** Diagnosezentrum später „logisch grün“, wo echtes Gerät angebunden ist.

| # | Variable / Thema | Bedeutung | Erledigt |
|---|------------------|-----------|----------|
| 2.1 | **`TSE_PRINTER_HOST`** | IPv4 oder Hostname der **LAN-Thermo/TSE** im Salon. Pflicht für den Drucker-/TSE-TCP‑Test im Diagnose‑Zentrum. | ☐ |
| 2.2 | **`TSE_PRINTER_PORT`** | Üblich **9100**; nur ändern, wenn Gerät dokumentiert anders spricht. | ☐ |
| 2.3 | **`OLIVER_ROOS_ZVT_PROBE_HOST`** / **`OLIVER_ROOS_ZVT_PROBE_PORT`** | Optional: separater TCP‑Reachability‑Test zur EC‑Kasse (**nicht** der gleiche Stub wie `/pay`). Nur setzen, wenn dokumentiert bekannt. | ☐ |
| 2.4 | **`OLIVER_ROOS_ZVT_FORCE_FAIL`** | In Produktion **`nicht`** auf `1` setzen — sonst EC‑Pfad absichtlich tot. | ☐ |
| 2.5 | Gerätewecker | Drucker eingeschaltet, Netz‑Link OK, keine IP‑Änderung seit letztem Probe‑Druck. | ☐ |

---

## 3. Desktop-App bauen & installieren

| # | Aufgabe | Erledigt |
|---|---------|----------|
| 3.1 | Vom **Repo-Root:** `npm run desktop:build` | ☐ |
| 3.2 | Installationspaket auf **demselben Rechnertyp** testen, der später live geht (Win→Win, Mac→Mac). | ☐ |
| 3.3 | Verifizieren, dass **`VITE_API_BASE`** in der gebauten App auf eure **Produktions-API** zeigt (siehe `PROJECT_MEMORY` / `tauri.conf.json` / Build-Skripte). | ☐ |

---

## 4. Diagnose-Zentrum (vor erstem Umsatz)

Navigation: **Chef-Ansicht** → **Diagnose-Zentrum** oder **`/admin/diagnostics`**.

| # | Prüfpunkt | Erwartung | Erledigt |
|---|-----------|-----------|----------|
| 4.1 | **SQLite · Integrität** | Status **OK** (`integrity_check`). | ☐ |
| 4.2 | **Fortress-Pfad (Server-Sicht)** | Wenn ein externer Pfad konfiguriert ist: **erreichbar** vom **Backend-Prozess** (nicht nur vom USB-Client — siehe Hinweistext in der UI). | ☐ |
| 4.3 | **Drucker / LAN-TSE** | TCP zum konfigurierten Host/Port **erfolgreich**, soweit Gerät online. | ☐ |
| 4.4 | **EC / ZVT** | Kein Test-Ausfall per ENV; optional TCP-Grün, falls Probing gesetzt. | ☐ |
| 4.5 | **Fiskal** | Kein rotes Dauerbanner wegen `ausfall_failed` auf letztem Beleg ohne bekannte Korrektur; offene TSE-Lücken **verstanden** (ggf. Steuerberater). | ☐ |
| 4.6 | **Hardware-Warteschlange** | Pending-Zahl plausibel (nicht explodierend). | ☐ |

**Hinweis:** „Grün“ ersetzt keine **gesetzliche** Abnahme — sie ist technische Einsatzbereitschaft.

---

## 5. Zentrale Einstellungen (system_settings / Admin-UI)

In **`/admin/settings`** (Tabs Team, Leistungen, System, Externes Backup):

| # | Thema | Erledigt |
|---|--------|----------|
| 5.1 | **Puffer / Raster** — Laufzeit aus `GET /api/system/runtime-config` (Sanitization) entspricht Öffnungskonzept. | ☐ |
| 5.2 | **Provision** (`commission_service_bps` / `commission_retail_bps`) — final mit Inhaber abgestimmt. | ☐ |
| 5.3 | **Client-360-Featureflags** — wie gewünscht (Datenschutz, Hospitality, etc.). | ☐ |
| 5.4 | **Externes Backup** — Ordner gewählt, Rhythmus gesetzt, **„Jetzt synchronisieren“** einmal Probe (Desktop). | ☐ |
| 5.5 | **`/handbuch`** mit Team kurz durchgegangen (Tagesabschluss / Storno / Anonym / Notfall‑Backup). | ☐ |

---

## 6. End-to-End Tagesablauf (Probe wie im Salon)

*Als wäret ihr am ersten Arbeitstag — mit **Testkunde** oder minimaler Bewegungsdatenschicht.*

### 6.1 Rezeption & Termin / Walk-in

| # | Schritt | Erledigt |
|---|---------|----------|
| R1 | Login (PIN korrekt, Rolle korrekt). | ☐ |
| R2 | Agenda / Walk-in öffnen, **eine** verkaufsnahe Bewegung (Service ± Produkt wenn nutzbar). | ☐ |
| R3 | Checkout: Zahlarten wie später live (**Bar**/Karte wenn ZVT angebunden). | ☐ |
| R4 | **Beleg** physisch drucken, wenn Drucker Teil des Go-live ist — **Hands-on-„Warheit“**. | ☐ |

### 6.2 Inhaber / Verwaltung

| # | Schritt | Erledigt |
|---|---------|----------|
| V1 | Chef-Briefing Umsatz plausibel. | ☐ |
| V2 | Optional: SQLite-Download oder Fortress‑Ordner geprüft (Dateigröße, Zeitstempel). | ☐ |
| V3 | **Kein** Produktivkunde vor finaler Datenbank-Sicherungsstrategie. | ☐ |

### 6.3 Tagesabschluss (kritischer Pfad)

| # | Schritt | Erledigt |
|---|---------|----------|
| Z1 | **Keine offenen Sessions** mehr. | ☐ |
| Z2 | **Blinder** Kassensturz → Soll-Anzeige → bei Differenz **Grund**. | ☐ |
| Z3 | `Tagesabschluss buchen` Erfolg. | ☐ |
| Z4 | Z‑Bericht drucken (wenn angebunden). | ☐ |
| Z5 | Fortress automatisch/mitgelaufen (bei Konfiguration) bestätigt (Zeit/Letzte Sync falls sichtbar). | ☐ |

### 6.4 Storno / Anonym — nur wenn angeordnet

Storno-/Anonym-Tests **nicht auf echten geschützten Daten** ohne Freigabe. Lieber Schulungsdatum mit Sandbox-Datenkopie.

| # | Schritt | Erledigt |
|---|---------|----------|
| S1 | GoBD-Prozess Storno dokumentiert im Team nachvollziehbar. | ☐ |
| S2 | Anonymisierung Doppel-Freigabe verstanden. | ☐ |

---

## 7. Support & Incident (nach Live)

| # | Aufgabe | Erledigt |
|---|---------|----------|
| 7.1 | **`OLIVER_ROOS_SUPPORT_SECRET`** (≥24 Zeichen) nur auf Server setzen, wenn **verschlüsselte** Debug-Pakete nötig; sonst JSON-Export. | ☐ |
| 7.2 | Eskalationsweg: Wer ruft wen bei `TSE ausfall` / geschlossenen Belegen ohne Signatur-Lesbarkeit an? | ☐ |

---

## 8. Finale Freigabe (Unterschrift / Datum)

```
Salon/Ort: _________________________  

Datum Probe-Go-Live: ______________  

„Diagnosezentrum kritische Punkte geprüft (Abschnitte 4–5):“  Ja ☐  

„Erste echte Bewegungsdatenschicht ohne Showstopper:“        Ja ☐  

Unterschrift Inhaber: _________________________  
```

---

*Verweise: `docs/PROJECT_MEMORY.md` (technische Tiefe), In-App **Handbuch** `/handbuch`.*
