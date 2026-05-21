import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/** Staff — RBAC + PIN (GoBD-relevant audit actor). */
export const staff = sqliteTable("staff", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("stylist"),
  /** bcrypt hash of 4–6 digit PIN; never exposed via API. */
  pinHash: text("pin_hash"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /**
   * §13 — If true, up to `overbookingMaxConcurrent` **active** appointments may overlap in time
   * (emergency / senior stylist). If false, at most one.
   */
  allowOverbooking: integer("allow_overbooking", { mode: "boolean" })
    .notNull()
    .default(false),
  overbookingMaxConcurrent: integer("overbooking_max_concurrent")
    .notNull()
    .default(2),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch() * 1000 as integer))`),
});

/**
 * §26 — Trusted LAN POS devices (pairing + long-lived device secret).
 */
export const trustedDevices = sqliteTable(
  "trusted_devices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deviceName: text("device_name").notNull(),
    /** One-time installer token (cleared after successful pair). */
    pairingToken: text("pairing_token"),
    /** SHA-256 hex of the permanent device secret (never store plaintext). */
    deviceTokenHash: text("device_token_hash"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [
    uniqueIndex("trusted_devices_pairing_token_uq").on(t.pairingToken),
    uniqueIndex("trusted_devices_device_token_hash_uq").on(t.deviceTokenHash),
  ],
);

/**
 * §12 — CRM / GDPR: structured PII + consent; `name` kept as display mirror for legacy queries.
 */
export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Denormalized display: typically `firstName` + `lastName` (kept in sync in app). */
  name: text("name").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  email: text("email"),
  phone: text("phone"),
  gdprConsent: integer("gdpr_consent", { mode: "boolean" })
    .notNull()
    .default(false),
  gdprConsentDate: integer("gdpr_consent_date", { mode: "timestamp_ms" }),
  /** JSON: e.g. allergies, drink prefs, favorite services. */
  preferences: text("preferences"),
  /** Set when PII was cleared (right to erasure / Art. 17 DSGVO). */
  anonymizedAt: integer("anonymized_at", { mode: "timestamp_ms" }),
  /** Postal address (optional, GDPR-relevant — included in anonymize). */
  street: text("street"),
  houseNumber: text("house_number"),
  postalCode: text("postal_code"),
  city: text("city"),
  country: text("country"),
  /** Last professional patch / allergy test (Epikutantest) — Client 360 safety. */
  patchTestAt: integer("patch_test_at", { mode: "timestamp_ms" }),
  /** Bewirtung / silent luxury preferences (free text). */
  hospitalityDrink: text("hospitality_drink"),
  hospitalityConversation: text("hospitality_conversation"),
  hospitalitySeat: text("hospitality_seat"),
  /** Team handover note for the current Berlin calendar day (cleared at day rollover). */
  sessionHandoverNote: text("session_handover_note"),
  sessionHandoverUpdatedAt: integer("session_handover_updated_at", {
    mode: "timestamp_ms",
  }),
  /** §13 — Counters updated when linked appointment is canceled / no-show. */
  noShowTotal: integer("no_show_total").notNull().default(0),
  cancelTotal: integer("cancel_total").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch() * 1000 as integer))`),
});

/**
 * §13 — Appointments / Booking (→ Check-in → Session).
 * Status: booked | checked_in | completed | canceled | no_show (enforced in application layer).
 */
export const appointments = sqliteTable(
  "appointments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientName: text("client_name").notNull(),
    clientPhone: text("client_phone"),
    /** Optional link to CRM row (counters, history). */
    clientId: integer("client_id").references(() => clients.id),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    serviceName: text("service_name").notNull(),
    /** Source of booking creation: walk_in | phone | online | internal. */
    sourceType: text("source_type").notNull().default("internal"),
    /** Optional free-text reason when canceled from operations flow. */
    cancelReason: text("cancel_reason"),
    /** Counter for explicit reschedules on this appointment row. */
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    startAt: integer("start_at", { mode: "timestamp_ms" }).notNull(),
    endAt: integer("end_at", { mode: "timestamp_ms" }).notNull(),
    status: text("status").notNull().default("booked"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
    /** §36 — Soft delete (GoBD): row retained for Revisionssicherheit; excluded from normal listing. */
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("appointments_staff_start_idx").on(t.staffId, t.startAt),
    index("appointments_start_idx").on(t.startAt),
    index("appointments_client_idx").on(t.clientId),
  ],
);

/**
 * §13 — Default duration (minutes) for `appointments.service_name` (exact name match, trimmed).
 */
export const salonServiceCatalog = sqliteTable("salon_service_catalog", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  serviceName: text("service_name").notNull().unique(),
  durationMinutes: integer("duration_minutes").notNull(),
  /** Reference net price for Kostenvoranschlag (cents); 0 = not configured. */
  referenceNetCents: integer("reference_net_cents").notNull().default(0),
  /** VAT basis points for estimate lines (700 / 1900). */
  vatRateBps: integer("vat_rate_bps").notNull().default(1900),
  /** When false, hidden from Spiegel / Schätzung lists (soft-hide). */
  catalogActive: integer("catalog_active", { mode: "boolean" })
    .notNull()
    .default(true),
  /**
   * Optional: default material (inventory) draw for this service — one row per Stück, × `quantity` at TSE close.
   */
  inventoryItemId: integer("inventory_item_id"),
  /** Integer ml to deduct per unit; null/0 = no service-level material line. */
  deductMl: integer("deduct_ml"),
});

/**
 * §13 — Per-staff service duration override (minutes).
 * Used before the default catalog duration.
 */
export const staffServiceDurations = sqliteTable(
  "staff_service_durations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    serviceName: text("service_name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [uniqueIndex("staff_service_durations_staff_service_uq").on(t.staffId, t.serviceName)],
);

/**
 * §12.5.34 — Consultation (Kostenvoranschlag)
 */
export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").references(() => clients.id),
  staffId: integer("staff_id")
    .notNull()
    .references(() => staff.id),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  status: text("status").notNull().default("open"),
  estimatedMinPriceCents: integer("estimated_min_price_cents"),
  estimatedMaxPriceCents: integer("estimated_max_price_cents"),
  consultationStatus: text("consultation_status").notNull().default("pending"),
  consultationApprovedAt: integer("consultation_approved_at", {
    mode: "timestamp_ms",
  }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch() * 1000 as integer))`),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
});

/**
 * §14 — Invoicing / VAT (KassenSichV path to TSE).
 * gross = net + VAT; line VAT = round(net * vat_rate_bps / 10000).
 */
export const invoices = sqliteTable(
  "invoices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    totalAmountCents: integer("total_amount_cents").notNull().default(0),
    vatAmountCents: integer("vat_amount_cents").notNull().default(0),
    tipAmountCents: integer("tip_amount_cents").notNull().default(0),
    tipStaffId: integer("tip_staff_id").references(() => staff.id),
    invoiceKind: text("invoice_kind").notNull().default("normal"),
    stornoForInvoiceId: integer("storno_for_invoice_id").references(
      (): AnySQLiteColumn => invoices.id,
    ),
    status: text("status").notNull().default("draft"),
    tseSignature: text("tse_signature"),
    /** JSON: DSFinV-K–oriented export payload + fiscal metadata. */
    tseExportData: text("tse_export_data"),
    /** Hybrid TSE: transaction id from hardware or cloud signer (null in TSE-Ausfall). */
    tseTransactionId: text("tse_transaction_id"),
    tseSignatureNumber: text("tse_signature_number"),
    tseStartTime: integer("tse_start_time", { mode: "timestamp_ms" }),
    tseEndTime: integer("tse_end_time", { mode: "timestamp_ms" }),
    /** signed_hardware | signed_cloud | ausfall_failed */
    tseStatus: text("tse_status"),
    /** ZVT / EC payment proof (inline or from matched orphan) — KassenSichV Belegkette. */
    zvtAmountCents: integer("zvt_amount_cents"),
    zvtTerminalId: text("zvt_terminal_id"),
    zvtReceiptId: text("zvt_receipt_id"),
    zvtAuthorizedAt: integer("zvt_authorized_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [index("invoices_session_idx").on(t.sessionId)],
);

export const invoicePayments = sqliteTable(
  "invoice_payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amountCents: integer("amount_cents").notNull(),
    method: text("method").notNull(),
    voucherId: integer("voucher_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [index("invoice_payments_invoice_idx").on(t.invoiceId)],
);

export const vouchers = sqliteTable(
  "vouchers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull().unique(),
    initialAmountCents: integer("initial_amount_cents").notNull(),
    remainingAmountCents: integer("remaining_amount_cents").notNull(),
    isMultiPurpose: integer("is_multi_purpose", { mode: "boolean" })
      .notNull()
      .default(true),
    expiryDate: integer("expiry_date", { mode: "timestamp_ms" }),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [
    uniqueIndex("vouchers_code_uq").on(t.code),
    index("vouchers_status_idx").on(t.status),
  ],
);

export const clientLoyalty = sqliteTable(
  "client_loyalty",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id),
    pointsBalance: integer("points_balance").notNull().default(0),
    stampsCount: integer("stamps_count").notNull().default(0),
    lifetimePoints: integer("lifetime_points").notNull().default(0),
    lastRewardAt: integer("last_reward_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [uniqueIndex("client_loyalty_client_uq").on(t.clientId)],
);

export const clientDebts = sqliteTable(
  "client_debts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id),
    sourceInvoiceId: integer("source_invoice_id")
      .notNull()
      .references(() => invoices.id),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [
    index("client_debts_client_idx").on(t.clientId),
    index("client_debts_invoice_idx").on(t.sourceInvoiceId),
  ],
);

export const invoiceItems = sqliteTable(
  "invoice_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitNetCents: integer("unit_net_cents").notNull(),
    /** 700 = 7 %, 1900 = 19 % (basis points). */
    vatRateBps: integer("vat_rate_bps").notNull(),
    /** Optional: links line to `inventory_items` (FK in migration; ml deduction at TSE close). */
    inventoryItemId: integer("inventory_item_id"),
    /** Integer ml to deduct per unit`quantity` (× quantity = total drawdown). */
    deductMl: integer("deduct_ml"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [index("invoice_items_invoice_idx").on(t.invoiceId)],
);

/**
 * §12.5.33 / §11 — Product identity: **EAN-13** and **UPC** (at most one line per code when set).
 * Scanners may hit either column; both are unique in DB (partial unique via unique index on nullable).
 */
export const inventoryItems = sqliteTable(
  "inventory_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /** Primary retail scan (often EAN-13 as string). Unique when not null. */
    barcodeEan: text("barcode_ean"),
    /** Optional second symbology; unique when not null. */
    barcodeUpc: text("barcode_upc"),
    defaultUnitMl: integer("default_unit_ml").notNull().default(0),
    /** Book quantity for scan-to-deduct (ml). */
    onHandMl: integer("on_hand_ml").notNull().default(0),
    /**
     * Retail (shampoo, retail units): may go **negative** at checkout (alert in audit).
     * Salon / formula: negative balance aborts close (KassenSichV stock integrity).
     */
    isRetail: integer("is_retail", { mode: "boolean" })
      .notNull()
      .default(false),
    /**
     * Usage type — supersedes `isRetail` (kept for legacy). Values:
     *  - 'retail'  : sold to customers (stock may go negative at checkout)
     *  - 'salon'   : internal salon use only (negative blocks close per KassenSichV)
     *  - 'both'    : both retail and salon use
     */
    usageType: text("usage_type").$type<"retail" | "salon" | "both">().notNull().default("salon"),
    /** Whether the product is currently active and visible in the inventory list. */
    active: integer("active", { mode: "boolean" })
      .notNull()
      .default(true),
    /**
     * If set: when `on_hand_ml` ≤ this value, a **single** `system_alerts` row (kind `low_stock`)
     * is opened (idempotent; no new row on every repeated deduct). `NULL` = do not auto-alert.
     */
    minStockThresholdMl: integer("min_stock_threshold_ml"),
    /**
     * Net cents per **one ml** of product for consultation estimates; 0 = not used in estimator.
     */
    referenceNetPerMlCents: integer("reference_net_per_ml_cents")
      .notNull()
      .default(0),
    /** VAT bps for estimate lines using this product. */
    estimateVatRateBps: integer("estimate_vat_rate_bps").notNull().default(1900),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [
    uniqueIndex("inventory_items_barcode_ean_uq").on(t.barcodeEan),
    uniqueIndex("inventory_items_barcode_upc_uq").on(t.barcodeUpc),
  ],
);

/**
 * §12.5.14 — Historical colour / formula records per client (memory engine).
 */
export const clientFormulas = sqliteTable(
  "client_formulas",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id),
    formulaText: text("formula_text").notNull(),
    notes: text("notes"),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [
    index("client_formulas_client_created_idx").on(t.clientId, t.createdAt),
  ],
);

/** Permanent technical notes (hair type, preferences). */
export const clientNotes = sqliteTable(
  "client_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id),
    noteText: text("note_text").notNull(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [index("client_notes_client_created_idx").on(t.clientId, t.createdAt)],
);

/**
 * §12.5.57 — Signed waiver / consent for chemical or invasive treatments (tamper-evident hash).
 */
export const clientWaivers = sqliteTable(
  "client_waivers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id),
    waiverType: text("waiver_type").notNull(),
    agreedAt: integer("agreed_at", { mode: "timestamp_ms" }).notNull(),
    /** SHA-256 or similar — proves payload integrity when reviewed by counsel. */
    signatureHash: text("signature_hash").notNull(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [
    index("client_waivers_client_idx").on(t.clientId),
    index("client_waivers_type_idx").on(t.clientId, t.waiverType),
  ],
);

/**
 * Async hardware queue: receipt print, ZVT follow-ups — never blocks fiscal DB commit.
 */
export const hardwareJobs = sqliteTable(
  "hardware_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobType: text("job_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    errorLog: text("error_log"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [
    index("hardware_jobs_status_idx").on(t.status),
    index("hardware_jobs_created_idx").on(t.createdAt),
  ],
);

/**
 * §10 — Durable in-app flags for owner (e.g. low stock). One open row per (kind, item).
 */
export const systemAlerts = sqliteTable(
  "system_alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(),
    inventoryItemId: integer("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    /** JSON: name, onHandMl, thresholdMl at time of first open. */
    payloadJson: text("payload_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [
    uniqueIndex("system_alerts_kind_item_uq").on(t.kind, t.inventoryItemId),
    index("system_alerts_kind_idx").on(t.kind),
  ],
);

/**
 * §12.5.35 — Inventur: one row per line in a run (audit_run_id groups the run).
 */
export const inventoryAudits = sqliteTable(
  "inventory_audits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    auditRunId: text("audit_run_id").notNull(),
    inventoryItemId: integer("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id),
    bookQtyMl: integer("book_qty_ml").notNull(),
    countedQtyMl: integer("counted_qty_ml").notNull(),
    varianceMl: integer("variance_ml").notNull(),
    auditorStaffId: integer("auditor_staff_id")
      .notNull()
      .references(() => staff.id),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [index("inventory_audits_run_idx").on(t.auditRunId)],
);

/**
 * §12.5.36 — Orphan / Ghost ZVT
 */
export const orphanPayments = sqliteTable("orphan_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  amountCents: integer("amount_cents").notNull(),
  terminalId: text("terminal_id").notNull(),
  zvtReceiptId: text("zvt_receipt_id"),
  authorizedAt: integer("authorized_at", { mode: "timestamp_ms" }).notNull(),
  rawPayload: text("raw_payload"),
  status: text("status").notNull().default("open"), // open | reconciled (operational reconciliation only)
  // Fiscal signing is separate from reconciliation: modules/fiscal must finalize the Belegkette.
  fiscalStatus: text("fiscal_status").notNull().default("pending"), // pending | signed
  fiscalSignedAt: integer("fiscal_signed_at", { mode: "timestamp_ms" }),
  matchedSessionId: integer("matched_session_id").references(() => sessions.id),
  matchedInvoiceId: integer("matched_invoice_id").references(() => invoices.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch() * 1000 as integer))`),
});

/**
 * §12.5.37 — Silent gamification (rings / targets)
 */
export const staffTargets = sqliteTable(
  "staff_targets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    targetDate: text("target_date"), // YYYY-MM-DD (admin reporting date)
    businessDate: text("business_date").notNull(), // YYYY-MM-DD
    serviceTargetCents: integer("service_target_cents"),
    retailTargetCents: integer("retail_target_cents"),
    targetRevenueCents: integer("target_revenue_cents"),
    targetRetailUnitCount: integer("target_retail_unit_count"),
    progressRevenueCents: integer("progress_revenue_cents").default(0),
    progressRetailUnits: integer("progress_retail_units").default(0),
    status: text("status").notNull().default("open"),
    bonusEligible: integer("bonus_eligible", { mode: "boolean" }).default(false),
    bonusCents: integer("bonus_cents"),
  },
  (t) => [index("staff_targets_staff_date_uq").on(t.staffId, t.businessDate)],
);

/**
 * §12.0 — System settings (key/value, local-first; TSE / feature flags).
 * Keys: `tse_provider_type` (HARDWARE_PRINTER | FISKALY_CLOUD), `fiskaly_enabled` (0|1).
 */
export const systemSettings = sqliteTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch() * 1000 as integer))`),
});

/**
 * §12.5.11 — Operational adjustments; Inventur (35) may post rows with reason inventur.
 */
export const inventoryAdjustments = sqliteTable("inventory_adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  inventoryItemId: integer("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id),
  deltaMl: integer("delta_ml").notNull(),
  reason: text("reason").notNull(),
  sourceAuditId: integer("source_audit_id").references(() => inventoryAudits.id),
  invoiceId: integer("invoice_id").references(() => invoices.id),
  staffId: integer("staff_id")
    .notNull()
    .references(() => staff.id),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch() * 1000 as integer))`),
});

/**
 * §12.5.17 / §15 — Sensitive operations; immutable append-only log.
 * Use `before_state_json` / `after_state_json` for fiscal / invoice deltas.
 * `payload_json` holds ancillary metadata (no duplicate of before/after when both are set top-level).
 */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entity: text("entity").notNull(),
    entityId: integer("entity_id"),
    action: text("action").notNull(),
    beforeStateJson: text("before_state_json"),
    afterStateJson: text("after_state_json"),
    payloadJson: text("payload_json"),
    /** Required (non-empty) in application code for actions in `AUDIT_ACTIONS_REQUIRING_REASON`. */
    reason: text("reason"),
    staffId: integer("staff_id").references(() => staff.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [index("audit_logs_entity_idx").on(t.entity, t.entityId)],
);

/**
 * Annual inventur run metadata for Steuerberater / GoBD archive exports.
 */
export const inventoryAuditRuns = sqliteTable("inventory_audit_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  auditRunId: text("audit_run_id").notNull().unique(),
  fiscalYear: integer("fiscal_year").notNull(),
  periodLabel: text("period_label"),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  archiveNote: text("archive_note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch() * 1000 as integer))`),
});

/**
 * §12.5.1 / §12.5.46 — Manual cash ledger movements (opening float, petty payout, transit).
 */
export const cashJournal = sqliteTable(
  "cash_journal",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entryType: text("entry_type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    note: text("note"),
    staffId: integer("staff_id").references(() => staff.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [index("cash_journal_created_idx").on(t.createdAt)],
);

/**
 * §12.5.13 — Daily close (Kassensturz): expected vs counted cash + difference evidence.
 */
export const dailyClosings = sqliteTable(
  "daily_closings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    expectedCashCents: integer("expected_cash_cents").notNull(),
    actualCashCents: integer("actual_cash_cents").notNull(),
    differenceCents: integer("difference_cents").notNull(),
    differenceReason: text("difference_reason"),
    snapshotJson: text("snapshot_json").notNull(),
    closedByStaffId: integer("closed_by_staff_id")
      .notNull()
      .references(() => staff.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [index("daily_closings_created_idx").on(t.createdAt)],
);

/**
 * §34 — Wochenvorlage: reguläre Arbeitszeiten pro Wochentag (keine pro-Kalendertag-Zeilen).
 * Zeiten (HH:mm) gelten in Europe/Berlin. day_of_week 0 = Sonntag; im Verfügbarkeitsmotor
 * (Phase 4) standardmäßig geschlossen, sofern nicht durch calendar_exceptions aufgehoben.
 */
export const staffWeeklySchedules = sqliteTable(
  "staff_weekly_schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    /** 0 = Sunday … 6 = Saturday (JS-like). */
    dayOfWeek: integer("day_of_week").notNull(),
    isWorking: integer("is_working", { mode: "boolean" }).notNull().default(true),
    /** "HH:mm" in Europe/Berlin; null if not working. */
    startTime: text("start_time"),
    endTime: text("end_time"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [
    uniqueIndex("staff_weekly_schedules_staff_dow_uq").on(t.staffId, t.dayOfWeek),
  ],
);

export const CALENDAR_EXCEPTION_TYPES = ["closed", "open_override"] as const;
export type CalendarExceptionType = (typeof CALENDAR_EXCEPTION_TYPES)[number];

/**
 * Tagesbasierte Ausnahmen: gesamter Salon (staff_id NULL) oder ein Mitarbeiter.
 * Unique: (exception_date, ifnull(staff_id,0)) — 0 steht für Salon-weit, kein reales staff.id.
 */
export const calendarExceptions = sqliteTable(
  "calendar_exceptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Kalendertag YYYY-MM-DD (für Europe/Berlin-Logik in der Anwendung). */
    exceptionDate: text("exception_date").notNull(),
    staffId: integer("staff_id").references(() => staff.id),
    exceptionType: text("exception_type").$type<CalendarExceptionType>().notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch() * 1000 as integer))`),
  },
  (t) => [
    index("calendar_exceptions_date_idx").on(t.exceptionDate),
    uniqueIndex("calendar_exceptions_date_scope_uq").on(
      t.exceptionDate,
      sql`ifnull(${t.staffId}, 0)`,
    ),
  ],
);

export type OrphanStatus =
  | "open"
  | "reconciled"
  | "unresolved"
  | "matched"
  | "refunded";
export type ConsultationStatus = "pending" | "shown_to_client" | "approved";
export type AppointmentStatus =
  | "booked"
  | "checked_in"
  | "completed"
  | "canceled"
  | "no_show";

export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "booked",
  "checked_in",
  "completed",
  "canceled",
  "no_show",
];

export type InvoiceStatus = "draft" | "closed" | "canceled";
export type InvoiceKind = "normal" | "deposit_anzahlung" | "final";
export type InvoicePaymentMethod =
  | "cash"
  | "card"
  | "voucher"
  | "unpaid_auf_rechnung";
export type VoucherStatus = "active" | "redeemed" | "expired";
export type CashJournalEntryType = "opening_float" | "payout" | "transit";

export type HardwareJobType = "print_receipt" | "zvt_payment";
export type HardwareJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export const INVOICE_STATUSES: InvoiceStatus[] = [
  "draft",
  "closed",
  "canceled",
];
