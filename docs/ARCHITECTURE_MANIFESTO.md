# Oliver Roos POS — Architecture manifesto (internal)

**Purpose:** This document is the project’s **internal constitution**: rules that keep fiscal, inventory, and session data correct when the API, PWA, and Electron shell evolve. **Read it before any non-trivial backend or data-layer change.** The human team and automated agents should treat it as binding for *how* we change the system, not as a product spec.

---

## 1. Engineering maturity (errors & observability)

- **Unified errors:** Use `AppError` from `backend/src/lib/errors/AppError.ts` for any **HTTP-facing** failure that should return a **stable `error` code** (e.g. `INSERT_INVOICE_FAILED`, `VOUCHER_NOT_ACTIVE`) plus optional `details`. Do not rely on ad-hoc `throw new Error("string")` in checkout or money paths.
- **Fiscal / TSE layer:** `tseProvider` and hardware signers **return** `FiscalSignResult` (including `tseError`); they **do not throw** for provider/network failure. TSE “failure” is modeled in the result, then the checkout pipeline decides draft vs close.
- **Express:** The **global error handler** (`registerGlobalErrorHandler` in `backend/src/lib/errors/expressErrorHandler.ts`) serializes `AppError` to JSON: `{ error, message, details? }`. Add new route handlers with `asyncRoute` so rejections reach this handler.

---

## 2. Transactions & invariants (non-negotiable)

- **One atomic close:** Invoice close, session close, ZVT/orphan link updates, inventory deduction, loyalty, and `hardware_jobs` enqueue for print **must stay inside the same SQLite transaction** as documented in `checkoutPipeline` and `jobQueue` — no “fix up later” for money or stock.
- **No silent closed invoice:** A `closed` invoice must have a **non-empty** `tse_signature` (real TSE, cloud, or **TSE-Ausfall marker string**). If the signing pipeline would leave the row closed without that, the code path is wrong.
- **Salon stock:** Non-retail (`is_retail = 0`) lines must not drive `on_hand_ml` negative; retail may go negative **only** with the existing audit trail (`retail_negative_balance`). The **integrity checker** enforces non-negative salon stock.
- **Payments total:** For every `closed` invoice, `sum(invoice_payments.amount_cents) === total_amount_cents` must hold; multi-line and mixed methods are not an exception.
- **Audit:** `tse_ausfall_detected` in `audit_logs` is required for the business-defined Ausfall path alongside the marker signature. Do not remove or bypass without legal/product review.

---

## 3. Operational tools

- **Integrity checker:** `npm run integrity:check` in `backend/` (after build) — run on backups, before releases, or when investigating strange POS behaviour. Expects a **migrated** SQLite file (same as production); if tables are missing, the script exits **2** with instructions. It does not invoke the Drizzle migrator, to avoid multi-statement journal issues and to keep checks read-only.
- **Chaos / hardening:** `npm run chaos:test` validates rollback, DB durability scenarios, and hardware job failure **without** blocking the event loop. Keep it green after structural changes to `jobQueue` or SQLite pragmas.

---

## 4. How to extend this file

When you add a new invariant, migration, or cross-cutting concern (e.g. device trust, Storno, DATEV), append a **short subsection** here: the rule, the owning module, and the script or test that enforces it. Favour **one source of truth** in code (`AppError` codes, `PROJECT_MEMORY` for product scope) and a pointer here, not a duplicate essay.

---

*Version: 2026 — aligned with `PROJECT_MEMORY.md` and backend hardening (WAL, rate limits, job drain, unified errors, integrity checker).*
