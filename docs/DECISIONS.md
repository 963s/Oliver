# DECISIONS.md

This file tracks technical and product decisions, hardware selections, and policies for the Oliver Roos POS project.

## Architecture & Stack (MVP v0)
- **Backend:** Express.js + Drizzle ORM + SQLite
- **Database:** Local-first SQLite (`./data/salon.db` in Docker, or `userData` in Tauri/Electron)
- **Frontend:** React + Vite (Warm Minimalism 2.0 UI tokens)
- **Desktop Shell:** Tauri 2 (Cross-platform builds macOS/Windows/Linux)
- **Modularity:** Monolith with explicit modules (`modules/fiscal`, `modules/hardware`, `modules/booking`)
- **Toggles:** Feature flags pattern for all non-core capabilities (IoT, BNPL, Advanced CRM).

## Fiscal & Hardware
- **TSE Approach:** Hybrid TSE (10.12). Hardware TSE (e.g., Epson/Star printers via ESC/POS) as primary if discovered via Hardware Wizard, with Cloud TSE (Fiskaly) as fallback and for DSFinV-K exports.
- **Terminal:** ZVT integration isolated in backend `modules/hardware`. React UI remains agnostic.
- **Amounts:** All monetary values stored as integer cents (e.g., 6050 for 60.50 €).
- **Inventory:** Liquid inventory tracked as integer milliliters (ml).

## UI/UX Rules
- **Chunky UI / Wet-Hands:** Minimum touch target `48px`, avoiding dropdowns in fast-paths (Quick Checkout, Formula Builder).
- **Global Event Listeners:** Bluetooth HID barcode scanners integrated via global keydown listeners in React.

## Open Decisions (To be finalized with Owner/Steuerberater)
- DATEV / DSFinV-K exact export intervals and format variations.
- Handling of "TSE-Ausfall" printed receipt wording.
- Legal wording for GDPR anonymization vs GoBD retention.
