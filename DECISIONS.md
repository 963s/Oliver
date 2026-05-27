# Oliver Roos — DECISIONS (MVP v0+)

**Locked stack:** **Express + Drizzle + SQLite** + `modules/fiscal` (stub / future) + **`modules/hardware`** (ZVT / orphan) + PWA in `frontend/`. **Single tenant, local-first.**

## Canonical workflow (Reihenfolge nicht umkehren)

1. **Buchung oder Walk-in** → **Session geöffnet** (Check-in aus Termin sobald §13 existiert; bis dahin **`/walk-in`**).
2. **Spiegelkarte** (`/mirror?session=`) → optional Kund:innen-Daten → **Kostenvoranschlag**.
3. **Checkout / TSE / Inventur-Logik** gemäß Roadmap — nicht vor Abschluss der Session- und Fiscal-Pfade.

**Spiegelkarte ist keine Startseite** und legt **keine** Session mehr an.

## Development policy (Platinum freeze)

Bis **TSE-Signierung** den KassenSichV-Pfad **produktionsreif** abschließt: **§33–§37** nur **Bugfixes** — siehe **PROJECT_MEMORY.md** „Development freeze“. **Auth/PIN**, **Booking/Check-in** und **§14 Checkout (Backend, Draft bis Signatur)** sind live.

---

## Phase 1 MVP Pivot — Effective 2026-05-06

**Owner directive:** Hardware (ZVT, ESC/POS Printers) and Fiscal Compliance (TSE, Formal Invoicing) are **Phase 2**. Phase 1 focus is exclusively:

1. **Booking Engine** (Agenda, §13)
2. **Deep Client Memory / CRM** (Customer 360°, §12)
3. **Basic Inventory** tracking

### Feature Flag Contract

- `fiscal_active` stored in `system_settings` (default `"0"`).
- When `fiscal_active = 0`: the UI hides TSE/ZVT triggers; `POST /api/sessions/:id/soft-complete` is available to close sessions without fiscal pipeline.
- When `fiscal_active = 1` (Phase 2): soft-complete returns HTTP 403; full checkout pipeline is required.
- **Backend fiscal code is never deleted** — it stays in `lib/checkoutPipeline.ts` and `modules/fiscal/` but is not triggered until the flag flips.

### Client Brain (Client360Panel)

`frontend/src/components/agenda/Client360Panel.tsx` replaces the old `ContextPanel`.

Sections:
- **Appointment header** with status chip + ✓ Abschließen button (soft-complete, fiscal-gated)
- **Micro-preferences**: `hospitalityDrink`, `hospitalityConversation`, `hospitalitySeat` — inline edit via `PATCH /api/clients/:id/ops-fields`
- **Session handover note** — today-scoped, auto-cleared at Berlin day rollover
- **Last formula** — highlighted monospace hero with relative date; inline add via `POST /api/clients/:id/formulas`
- **Quick stats**: completed visits, total spend, reliability score, open debt
- **Loyalty badge** + no-show warning
- **Inline note add** via `POST /api/clients/:id/notes`
- **Visit timeline** (last 5 entries, colour-coded by kind)

## Auth / PIN (GoBD-Audit-Actor)

- **Schema:** `staff.pin_hash` (bcrypt via **bcryptjs**), `staff.active` (boolean). PIN wird nie per API zurückgegeben.
- **Login:** `POST /api/auth/login` mit `{ staffId, pin }` (4–6 Ziffern) → **`Authorization: Bearer`** Token (HMAC unter **`AUTH_SECRET`**, mindestens 16 Zeichen in Production; unsicherer Dev-Fallback nur lokal).
- **Directory:** `GET /api/auth/directory` — nur aktive Mitarbeiter für das Keypad (öffentlich im vertrauten LAN; später optional zusätzlich absichern).
- **API:** fast alle **`/api/*`‑Routen** verlangen Bearer-Token; die Identität kommt aus dem Token (keine alleinige Verlässlichkeit auf `X-Staff-*` mehr).
- **PIN ändern:** `PATCH /api/staff/:id/pin` mit `{ newPin }` — nur **`owner`** / **`super_admin`** (`requireOwner`), mit **`audit_logs`** `pin_change`.
- **ZVT-Callback:** `POST /api/hardware/zvt/authorization-success` bleibt ohne Nutzer-Session erreichbar; Audit-Actor = **`ZVT_SYSTEM_STAFF_ID`** (Default **1**), falls kein Token gesetzt ist.
- **Demo-PINs (nach Migration/Seed):** OLI **1111**, Silke **2222**, Abdul **3333**; fehlende Legacy-Hashes erhalten **9999** (Warnung in der Konsole).

## Booking / Check-in (§13)

- **`appointments`** + **`sessions.appointment_id`**; Status `booked` → **`POST …/check-in`** erzeugt **`clients`**, öffnet **`sessions`**, setzt `checked_in`, **`audit_logs`** `check_in`.
- **Listing:** `GET /api/appointments?from=&to=` (ISO oder ms); ohne Parameter = **aktueller lokaler Kalendertag** (Server-Uhr).
- **UI:** `/bookings`; Walk-in bleibt **`/walk-in`**.

## Checkout / Rechnung / USt (§14, Backend)

- **Schema:** `invoices` (`tse_signature`, `tse_export_data`); `invoice_items` Netto + `vat_rate_bps`; **`system_settings`** (Migration **0006**) — **`tse_provider_type`** (Default **`HARDWARE_PRINTER`**, alternativ **`FISKALY_CLOUD`**), **`fiskaly_enabled`** (`0`/`1`).
- **Hybrid TSE (Offline-first):** Signatur-Pfad = **`signInvoiceFiscal(db, input)`** (`tseAdapter.ts`). **Standard:** **Hardware** — ESC/POS-Frame + Raw-Socket an Thermodrucker (**LAN**, typ. Port **9100**, Env **`TSE_PRINTER_HOST`**, **`TSE_PRINTER_PORT`**, optional **`TSE_LAN_READ_MS`**). **Fiskaly** nur, wenn in der DB bewusst **`FISKALY_CLOUD` + fiskaly_enabled=1`** — **kein** automatischer Wechsel von Hardware-Fehlern zur Cloud.
- **ZVT / EC (§16):** Checkout verlangt **Zahlungsnachweis** — entweder **`zvt: { amountCents, terminalId, … }`** (Summe = Brutto der Positionen) **oder** **`orphanPaymentId`** passend zu einem offenen `orphan_payments`. Zuerst Zahlung auf der Rechnung speichern, dann TSE, dann **atomar** schließen (Rechnung, Session, ggf. Termin `completed`, Orphan fiscal).
- **API:** **`POST /api/sessions/:id/checkout`** — **Kein** `closed` ohne **`tse_signature`** (und nicht ohne ZVT-Nachweis). Harte TSE-Fehler → **`audit_logs` `tse_error`**, Antwort **202** mit `fiscal.tseError` (lokal, datenschutzfreundlich).
- **HTTP:** **202** + `fiscal.state: pending` solange keine Signatur; **200** nur mit Signatur; **Frontend** in dieser Schicht unverändert.

## Audit / GoBD (§15)

- **`audit_logs`:** `before_state_json` / `after_state_json` (Migration **0005**); **`writeAudit`** zwingt **`reason`** für feste High-risk-Aktionen (Storno, manuelle Preisänderung an `invoice_items`, …).
- **Checkout / TSE:** dazu **`checkout_failed`**, **`checkout_draft`**, **`checkout_closed`**, und bei harten Signaturproblemen **`tse_error`**.
- **Invariante:** kein API-**DELETE**/Walz-**UPDATE** auf `audit_logs` oder freies Editieren von `invoices` außerhalb definierter Fiscal-Flows.

## Electron desktop shell (wrap)

- **Entry:** `electron/main.mjs` spawns the **Node backend** on launch (`tsx` in dev, compiled `backend/dist/index.js` in production with `ELECTRON_RUN_AS_NODE=1` on the Electron binary).
- **Launch (exact):** from the **repo root** run **`npm run electron:dev`** (requires `npm install` at root so workspaces and `backend/node_modules/tsx` exist). This starts the API, then Vite in dev, then opens the window. For browser-only PWA dev: **`npm run dev:backend`** and **`npm run dev:frontend`** in two terminals (root scripts proxy to the workspaces). **Package installer:** `npm run electron:pack` (builds backend+frontend, prunes backend devDependencies, runs electron-builder; output under `release/` per `package.json` `build.directories.output`).
- **DB path:** set via `DATABASE_PATH` in the child env; default = `<repoRoot>/backend/data/salon.db` (Electron also accepts `SALON_DB_PATH` resolved to an absolute path). The plain **`tsx`/CLI backend** (without Electron) uses `backend/src/db/index.ts` — same default file under **`backend/data/salon.db`** relative to the backend package unless `DATABASE_PATH` overrides.
- **UI:** **Dev** loads Vite at `http://127.0.0.1:5173` (Vite still proxies `/api` → :3000). **Packaged** app serves the built UI from the backend with `SERVE_SPA=1` at `http://127.0.0.1:3000/`.
- **Global barcode (HID):** the renderer’s `GlobalScanListener` (keydown capture) is the “Global Listener” for USB/BT pistol scanners, per §12.5.39 + Privacy (skip when focus in inputs); **Rings/Orphan** stay in the same shell.

### Dependencies (audit — `package.json`)

- **Root:** `electron`, `electron-builder` (desktop packaging only; **not** duplicated in `backend` / `frontend`).
- **Backend:** runtime — `express`, `cors`, `drizzle-orm`, **`better-sqlite3`**; dev — **`tsx`** (dev server + Electron dev spawn), `typescript`, `drizzle-kit`, `@types/*`. All listed in **`backend/package.json`**.
- **Frontend:** `react`, `react-dom`, `react-router-dom`; dev — `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `typescript`. Listed in **`frontend/package.json`**.

## Spiegelkarte / Mirror ticket (§12.5.34)

- **Purpose:** non-fiscal “laufzettel” / consultation prep **after** a session exists — **not** the POS entry point.
- **Flow:** Staff öffnet Session (**Walk-in** `/walk-in` oder später Check-in aus **Appointment**). Dann **`/mirror?session=<id>`**: optional **`POST /api/clients`** + **`PATCH /api/sessions/:id`** mit `clientId`, dann **`/estimate?session=`**. Ohne `?session=` zeigt die UI Hinweis → Walk-in. Legacy **`/session-demo` → `/walk-in`**.

---

## Barcode & camera (§12.5.33)

- **Server:** EAN/UPC stored on `inventory_items`; **UNIQUE** index per column (SQLite allows **multiple `NULL`** — treat “no code” as `NULL`, not `''`, in the app to avoid false uniqueness hits).
- **PWA (first iteration):** Prefer **`BarcodeDetector` Web API** with **manual fallback**; if a device has no `BarcodeDetector`, allow **USB / Bluetooth HID** pistol scanner via global keyboard events (see §12.5.39) in a follow-up.
- **After match:** always ask **“Wie viele ml?”** (integer ml) for deduct; **on_hand_ml** is decremented. **No silent negative stock** unless **§12.5.47** policy is later enabled in Settings.

**Library choice (if BarcodeDetector is insufficient on production iPads):** re-evaluate **ZXing-js vs html5-qrcode** vs a thin WASM build — performance on **salon lighting** and **iPad camera** is the main criterion. Record the chosen **library + version** here when the owner signs off a device matrix.

---

## Demo seed (development)

- On API startup, **`ensureSeedData`** may insert minimal staff/inventory if empty, then **`applyDemoSeed`** (`backend/src/seed/demoSeed.ts`) idempotently ensures **~20** salon products (valid **EAN-13**, **ml** stock), **5** staff, and **today’s** **`staff_targets`** (Rings) for the first five staff — for local demos and Platinum **33 / 37** smoke tests.

## Kostenvoranschlag (§12.5.34)

- **Data model (this build):** `estimated_min_price_cents` and `estimated_max_price_cents` (integer cents); `consultation_status` ∈ `pending` | `shown_to_client` | `approved`.
- **Client “approval”** sets **`consultation_approved_at`** (server time) with `approved` to protect the stylist at payment disputes.
- **Range vs. single + margin:** the schema allows **min/max**; a **single “mid” + explicit margin%** is **not** stored unless we add fields later; keep **one convention** in training material.

**Steuerberater (mandatory if presented as a commercial offer to consumers):** whether the on-screen estimate is **binding**, **indicative**, or **subject to change** is a **text + process** decision — **add owner-approved copy** in DE before marketing this as a formal **Kostenvoranschlag** document. This slice **does not** print a legally reviewed PDF by default.

---

## Inventur & annual archive (§12.5.35)

- **Operational adjustments** (breakage, daily shrink) use **`inventory_adjustments`** (§12.5.11); **inventur** is a **periodic run** with **`inventory_audits` lines** and optional **`inventory_audit_runs`** metadata (fiscal year, period label, close time, `archive_note`).
- **On “close”:** optional **`postAdjustments: true`** posts **`inventory_adjustments`** with `reason: inventur` and links **`source_audit_id`**.

**Steuerberater / GoBD:** the **year-end (or period) inventur** export to the accountant (CSV/PDF) should be **retained 10+ years** in the agreed **archive process**; this app stores **line-level facts** — **naming and export layout** for the “annual inventur” bundle must be **signed off** (DATEV/DSFinV-K adjacency, not a substitute for DSFinV-K).

---

## ZVT “ghost / orphan” payments (§12.5.36)

- **Event:** `POST /api/hardware/zvt/authorization-success` with **amount**, **terminalId**, and optional ZVT reference fields writes **`orphan_payments`** and **audit**.
- **PWA:** on **visibility / resume**, call **`GET /api/orphan-payments?status=open`**, with optional `terminal=<local terminal id from Settings>`; show a **red banner** until the owner/staff **reconciles** to a **session/invoice** (here: minimal **session** match) and the fiscal chain is completed **per TSE rules**.

**Beleg / TSE & Steuerberater (after orphan match):** matching an orphan to a **session/invoice** is only the **operational** step: **Fiskaly / hardware TSE / receipt number / ZVT** alignment must follow your **KassenSichV** procedure — do **not** treat “status=reconciled” in SQLite as a **signed fiscal receipt** until the **fiscal module** confirms. Document the **Belegkette** with **Steuerberater** (especially if **amount / time** differ from the original terminal payload).

---

## Staff targets / “rings” (§12.5.37)

- **Not** a replacement for **Provision / payroll**; **no cross-staff public leaderboard** unless the owner **explicitly** enables it in a future build.
- **RBAC:** **Owner** can **PUT** `/api/staff/:id/targets`; **stylists** may **GET** their **own** targets only.
- **Progress** may be **typed in** in this build; a later job can **derive** progress from `invoices` / retail lines.

**Steuerberater (bonus / prizes):** if **bonus_cents** or **eligible** flags are used for real money, document as **labor / tax** to avoid misclassification; default is **KPI / motivation only** until a written policy exists.

---

## Hardware (§12.1)

- **Node implementation path:** `backend/src/modules/hardware/zvt.ts` and `/api/hardware/zvt/authorization-success`. The **`modules/hardware/`** entry at the repo root is a **bridge pointer** to that path.

---

## PWA + LAN

- **Dev:** Vite `proxy` → `http://127.0.0.1:3000` for `/api` — in production, serve the PWA and API behind the **same host** on the **salon LAN** (TLS or trusted network per owner risk / Steuerberater for card data on **same segment** as ZVT).
- **Terminal ID in Settings** (`or:terminalId` in `localStorage`) links PWA to **ZVT-orphan** filtering; keep **device naming** and **IP/security** in the owner’s **runbook** (Guided Access §11.6 is separate from the DB).

---

## Loyalty (Stempelkarte) — backend rules (Phase 1)

- **Schema:** `client_loyalty` (one row per `client_id`); migration **`0018_loyalty_system.sql`**.
- **Accrual:** `processLoyaltyAccumulation` runs **only inside the same DB transaction** as **TSE-ok invoice close** (`checkoutPipeline`), and **only** when `sessions.client_id` is set (registered CRM client).
- **Stamps:** one stamp per closed sale when **paid total (cents)** ≥ **`LOYALTY_STAMP_MIN_INVOICE_CENTS`** (default **2 000**); **reward tier** at **`LOYALTY_REWARD_STAMPS_THRESHOLD`** stamps (default **10**).
- **Storno:** `reverseLoyaltyAccrualForStorno` mirrors accrual using the **original** invoice `total_amount_cents`; **`loyalty_storno_reverse`** in **`audit_logs`**. Storno settlement invoices do **not** accrue stamps via checkout (no loyalty hook on negative replication beyond reversal).

---

## [Pending Tax/Legal Clarifications]

*Queue for **Steuerberater** sign-off before marketing or external audit. Do not treat app behaviour as final tax law.*

- **Anzahlung (deposit invoices):** VAT treatment and customer document wording when `invoiceKind = deposit_anzahlung` is used; whether loyalty stamps / marketing credits may accrue on deposits vs. only on final settlement; alignment with KassenSichV receipt text.
- **Unpaid / “auf Rechnung”:** How open `client_debts` and partial payments interact with **GoBD** retention, dunning, and TSE when debt is later settled (second receipt? reference to original Beleg?).
- **Gutscheine / multi-purpose vouchers:** Redemption `audit_logs` now store **balance before/after (cents)**; confirm with accountant that internal ledger + export format matches **USt** and any **Geschenkgutschein** rules in force.
- **Loyalty (Stempelkarte):** Stamps and points are **operational** (not cash); if rewards become monetary or discount-on-invoice, document **USt** and **Leistungszeitpunkt** with the Steuerberater.

*The same “pending” list is duplicated under **docs/DECISIONS.md** for external reviewers who open the `docs/` tree first.*

---

*Update this file when changing barcode libraries, **Kostenvoranschlag** legal wording, TSE path, bonus policy, or **canonical workflow** / freeze policy.*

---

## v1.7.0 — Infrastructure hardening, Client 360° engine, single-theme UI

Released 2026-05-27. Bundles four chapters of work; see commit body for the full
delta. Highlights:

### Infrastructure & reliability
- **Backend supervisor** (`electron/main.mjs`): restart loop with exponential
  backoff (max 5 crashes per 60 s → user-facing dialog) and a per-day rotating
  log file in `userData/logs/backend-YYYY-MM-DD.log` (7-day retention).
- **Winston logger** in the backend (`backend/src/lib/logger.ts`): JSON-lines
  file sink + dev-only TTY pretty-print. `LOG_DIR` env wired from Electron.
- **Error handler rewrite** (`backend/src/lib/errors/expressErrorHandler.ts`):
  production responses sanitized to `{ error, code }`; dev keeps stack+message.
  Zod-like and Drizzle/SQLite errors routed through dedicated branches.
- **Soft-delete helpers** (`backend/src/lib/db/softDelete.ts`): `whereNotDeleted`
  fragment + `softDelete()` with built-in audit pairing. Applied across all 7
  appointment query sites + defensive guard in `checkoutPipeline`.
- **SQLite tuning**: WAL, busy_timeout, synchronous=NORMAL, foreign_keys=ON,
  32 MB cache, MEMORY temp store, 128 MB mmap. Startup `PRAGMA integrity_check`
  logs `sqlite_integrity_ok` or a full corruption report.
- **Daily SQLite backup** in Electron main: VACUUM INTO with tempfile+rename
  atomic publish, 14-day retention, runs 20 s after boot and every 24 h.

### Client Memory Engine
- **Migration 0034** (`client_intelligence`): adds `client_hair_profiles`,
  `client_visit_records`, `client_preferences`, `client_tags` with
  composite indexes.
- **Migration 0035** (`client_stats_cache`): denormalized header stats for
  Client 360° + 4 partial indexes (`appointments.deleted_at IS NULL`,
  `sessions.status = 'closed'`).
- **Client 360° API** (`backend/src/routes/client360Routes.ts`): 11 endpoints
  for the full intelligence object, hair-profile upsert, visit-records,
  tags, preferences, birthday-today, at-risk segmentation.
- **Reliability score** (`backend/src/lib/clientCrm.ts`): clamp-and-cap
  formula with -15/no-show, -8/cancel, +2/on-time, hard-clamped to [0,100].

### Frontend KundenBrowser
- New page (`frontend/src/pages/KundenBrowser.tsx`, route `/kunden`).
  Offline-first: single fetch of up to 1000 active clients on mount; all
  filtering (free-text + German-alphabet letter chips) runs in-memory via
  `useMemo`. Split-view layout with the hero "letzte Rezeptur" block in
  gold + monospaced typography.
- Backend `/api/clients/search` now treats `q` as optional and returns
  alphabetically sorted rows (max 1000).
- Sidebar link `👥 Kunden` under the **Täglich** group in the dashboard.

### UI simplification — single light theme
- Dark mode removed entirely (theme hook, ThemeToggle, `html.dark` CSS,
  Tailwind `darkMode: false`). Salon owner used only one mode; the toggle
  was operator friction. Stale `or:theme` localStorage is cleared on boot.

### Testing & observability
- Vitest set up in `backend/` (config + scripts). 40 tests pass:
  `softDelete` (9), `clientCrm.reliabilityScore` + name/escape (16),
  `germanVat.computeLine` 7%/19% + rounding + invariants (15).

### Cleanup
- Deleted root-level dead files: `changeTheme[1-4].js`, empty `.gitkeep`,
  empty `PROJECT_MEMORY.md` (the canonical 191 KB version stays in `docs/`).
- **Kept** `src-tauri/` — investigation revealed live Tauri references in
  `frontend/src/hooks/useTauriSqliteBackup.ts`, `externalFortressBackup.ts`,
  `EmbeddedDesktopGate.tsx`, `AdminSettings.tsx` (deliberate cross-platform
  hook, not dead code).
- Added `backend/.env.example` and fixed `.gitignore` (`.env.*` previously
  excluded `.env.example` by mistake).

### Pending follow-ups
- PWA service worker hardening (NetworkFirst for `/api`, offline fallback page).
- `useNetworkStatus` hook + `OfflineBanner` component (Intel Mac: no blur).
- Wire `refreshClientStats` to checkout and appointment-status-change paths.
- Weekly `PRAGMA optimize` scheduler.


