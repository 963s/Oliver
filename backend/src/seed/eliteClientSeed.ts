/**
 * eliteClientSeed.ts — Phase 1 Elite Data Seed
 * Injects 15 premium German client profiles with:
 *  - Deep appointment history (3-5 completed visits each)
 *  - Detailed colour formulas
 *  - Micro-preferences (drink, conversation, seat)
 *  - Loyalty points
 *  - Debt flags for 2 clients
 *  - 8 upcoming appointments this week
 *
 * SAFE TO RE-RUN: idempotent on phone number as key.
 */
import { eq, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";

/* ── helpers ── */
const DAY_MS = 86_400_000;
const now = Date.now();
function daysAgo(d: number) { return new Date(now - d * DAY_MS); }
function daysFromNow(d: number) { return new Date(now + d * DAY_MS); }
function todayAt(h: number, m = 0) {
  const d = new Date(); d.setHours(h, m, 0, 0); return d;
}

/* ── 15 elite client profiles ── */
const ELITE_CLIENTS = [
  {
    firstName: "Dr. Klaus",  lastName: "Weber",     phone: "+4917612300001",
    email: "dr.weber@kanzlei-weber.de",
    drink: "Espresso, kein Zucker",
    conversation: "Stille bevorzugt — nur ansprechen wenn nötig",
    seat: "Fensterplatz links",
    patchTestDaysAgo: 45,
    formulas: [
      { text: "7/1 + 7/0 · 1:1 · 6% · 30ml · 25 min Ansatz", notes: "Grauanteil ~40%, deckend gewünscht", daysAgo: 14 },
      { text: "7/1 · 1:2 · 3% · 20ml · Refresh 15 min", notes: "Ton nach 6 Wochen aufgefrischt", daysAgo: 56 },
    ],
    history: [14, 56, 112], service: "Executive Line Cut", staffId: 1,
    loyaltyStamps: 18, loyaltyPoints: 5400, debt: false,
  },
  {
    firstName: "Sabine",    lastName: "Müller-Hartmann", phone: "+4917612300002",
    email: "s.mueller@beispiel.de",
    drink: "Grüner Tee, kein Zucker",
    conversation: "Gerne plaudern — interessiert sich für Trends",
    seat: "Sessel in der Mitte",
    patchTestDaysAgo: 30,
    formulas: [
      { text: "8/1 + 9/3 · Freihand Balayage · 3% · 55ml gesamt · 50 min", notes: "Face-framing sehr hell, Längen kühler Ash", daysAgo: 21 },
      { text: "9/1 Gloss · 1.9% · 15ml · 10 min Finish", notes: "Glanz-Refresh nach Balayage", daysAgo: 63 },
      { text: "8/1 + 0/11 · 3% · 40ml · 45 min", notes: "Ersttermin Aufhellung Stufe 1", daysAgo: 126 },
    ],
    history: [21, 63, 126, 189], service: "Venetian Light Weave", staffId: 2,
    loyaltyStamps: 24, loyaltyPoints: 8200, debt: false,
  },
  {
    firstName: "Thomas",   lastName: "Schneider",   phone: "+4917612300003",
    email: "t.schneider@beispiel.de",
    drink: "Wasser still",
    conversation: "Minimal — kurze Antworten, kein Small-Talk",
    seat: "Egal",
    patchTestDaysAgo: null,
    formulas: [
      { text: "Keine Farbe — reiner Formschnitt", notes: "Kontur trocken, Seiten sehr präzise", daysAgo: 21 },
    ],
    history: [21, 42, 63], service: "Executive Line Cut", staffId: 1,
    loyaltyStamps: 9, loyaltyPoints: 1350, debt: false,
  },
  {
    firstName: "Frau Petra", lastName: "Krüger",    phone: "+4917612300004",
    email: "petra.krueger@web.de",
    drink: "Cappuccino mit Oatmilk",
    conversation: "Entspannte Unterhaltung willkommen",
    seat: "Fensterplatz rechts, Wärme",
    patchTestDaysAgo: 20,
    formulas: [
      { text: "5/4 + 6/34 · 1:2 · 6% · 45ml · 35 min", notes: "Warmes Kupfer, empfindliche Kopfhaut — kein Direktkontakt", daysAgo: 28 },
      { text: "5/4 + 5/65 · 1:2 · 3% · 40ml · 30 min", notes: "Vorherige Formel etwas wärmer angepasst", daysAgo: 84 },
    ],
    history: [28, 84, 140, 196], service: "Saffron Pigment Treatment", staffId: 2,
    loyaltyStamps: 14, loyaltyPoints: 4200, debt: true, debtCents: 22000,
  },
  {
    firstName: "Dr. Markus", lastName: "Neumann",   phone: "+4917612300005",
    email: "m.neumann@consulting.de",
    drink: "Schwarzer Kaffee",
    conversation: "Bevorzugt schweigen — liest gerne",
    seat: "Hinten, ruhig",
    patchTestDaysAgo: null,
    formulas: [
      { text: "Keine Farbe — Formschnitt matte Produkte", notes: "Kontur nass, Finish trocken mit Paste", daysAgo: 18 },
    ],
    history: [18, 39, 60, 81], service: "Executive Line Cut", staffId: 3,
    loyaltyStamps: 22, loyaltyPoints: 6600, debt: false,
  },
  {
    firstName: "Claudia",  lastName: "Hoffmann",    phone: "+4917612300006",
    email: "claudia.hoffmann@beispiel.de",
    drink: "Espresso Macchiato",
    conversation: "Gerne über Reisen und Mode",
    seat: "Fensterplatz, vorne",
    patchTestDaysAgo: 60,
    formulas: [
      { text: "9/1 + 10/1 · Freihand · 3% · 60ml · 50 min Babylights", notes: "Sehr feine Highlights, kein Kontrast", daysAgo: 35 },
      { text: "9/3 + 0/00 · 1.9% · 20ml Gloss · 15 min", notes: "Goldton-Refresh", daysAgo: 91 },
    ],
    history: [35, 91, 147], service: "Venetian Light Weave", staffId: 2,
    loyaltyStamps: 11, loyaltyPoints: 3300, debt: false,
  },
  {
    firstName: "Jürgen",   lastName: "Becker",      phone: "+4917612300007",
    email: "j.becker@beispiel.de",
    drink: "Wasser mit Zitrone",
    conversation: "Freundlich, kurz",
    seat: "Egal",
    patchTestDaysAgo: null,
    formulas: [
      { text: "7/1 · 1:2 · 3% · 15ml · Neutralisierung 8 min", notes: "Leichte Tönung nach Schnitt", daysAgo: 30 },
    ],
    history: [30, 65, 100], service: "Architectural Silhouette Cut", staffId: 1,
    loyaltyStamps: 7, loyaltyPoints: 2100, debt: false,
  },
  {
    firstName: "Daniela",  lastName: "Wagner",      phone: "+4917612300008",
    email: "daniela.wagner@beispiel.de",
    drink: "Pfefferminztee",
    conversation: "Stille bevorzugt",
    seat: "Mitte, ruhig",
    patchTestDaysAgo: 90,
    formulas: [
      { text: "5/1 + 6/1 · 1:2 · 1.9% · 35ml · 20 min", notes: "Kühles Braun, Glanz ohne Aufhellung", daysAgo: 25 },
      { text: "6/1 + 0/11 · 1.9% · 25ml · 15 min Refresh", notes: "Ton etwas heller angepasst", daysAgo: 85 },
    ],
    history: [25, 85, 145, 205], service: "Nocturne Tonality", staffId: 3,
    loyaltyStamps: 16, loyaltyPoints: 4800, debt: false,
  },
  {
    firstName: "Stefan",   lastName: "Richter",     phone: "+4917612300009",
    email: "s.richter@beispiel.de",
    drink: "Wasser",
    conversation: "Kurz und sachlich",
    seat: "Hinten",
    patchTestDaysAgo: null,
    formulas: [
      { text: "Kein Farbauftrag — Textuurschnitt nass", notes: "Nacken tief rasiert, Oberkopf texturiert", daysAgo: 22 },
    ],
    history: [22, 43, 64, 85], service: "Executive Line Cut", staffId: 1,
    loyaltyStamps: 19, loyaltyPoints: 5700, debt: false,
  },
  {
    firstName: "Nadine",   lastName: "Koch",        phone: "+4917612300010",
    email: "n.koch@beispiel.de",
    drink: "Flat White",
    conversation: "Sehr gesprächig — Lieblingsthema: Urlaub",
    seat: "Fensterplatz",
    patchTestDaysAgo: 15,
    formulas: [
      { text: "Balayage Freehand · 3% · 80ml · 60 min + 9/1 Gloss 20 min", notes: "Face-framing sehr hell, Längen kühler lassen", daysAgo: 40 },
      { text: "9/1 + 10/1 · 3% · 50ml · 45 min Balayage Refresh", notes: "Längen nachgezogen", daysAgo: 110 },
    ],
    history: [40, 110, 180], service: "Or et Cendre Ombré", staffId: 2,
    loyaltyStamps: 8, loyaltyPoints: 2400, debt: true, debtCents: 35000,
  },
  {
    firstName: "Alexander", lastName: "Wolf",       phone: "+4917612300011",
    email: "a.wolf@beispiel.de",
    drink: "Espresso",
    conversation: "Minimal",
    seat: "Egal",
    patchTestDaysAgo: null,
    formulas: [
      { text: "Keine Farbe — klassischer Seitenscheitel", notes: "Leichte Pomade zum Finish", daysAgo: 27 },
    ],
    history: [27, 54, 81], service: "Architectural Silhouette Cut", staffId: 3,
    loyaltyStamps: 5, loyaltyPoints: 1500, debt: false,
  },
  {
    firstName: "Birgit",   lastName: "Lehmann",     phone: "+4917612300012",
    email: "birgit.lehmann@beispiel.de",
    drink: "Kamillentee",
    conversation: "Ruhig — gerne über Haarpflege sprechen",
    seat: "Bequemer Sessel",
    patchTestDaysAgo: 10,
    formulas: [
      { text: "Pflegeplan Grauhaare: 7/0 + 7/1 · 1:1 · 3% · 30ml · 20 min", notes: "Graustrategie Phase 1 — natürlicher Übergang", daysAgo: 32 },
      { text: "8/0 Aufheller Ansatz · 6% · 25ml · 25 min", notes: "Phase 2 Aufhellung", daysAgo: 95 },
    ],
    history: [32, 95, 158], service: "Private Atelier Consultation", staffId: 2,
    loyaltyStamps: 6, loyaltyPoints: 1800, debt: false,
  },
  {
    firstName: "Michael",  lastName: "Braun",       phone: "+4917612300013",
    email: "m.braun@beispiel.de",
    drink: "Latte Macchiato",
    conversation: "Lockere Unterhaltung",
    seat: "Vorne",
    patchTestDaysAgo: 55,
    formulas: [
      { text: "6/3 + 7/3 · 1:1 · 6% · 40ml · 30 min Wärme", notes: "Goldbrauner Ton, natürliche Reflexe", daysAgo: 19 },
      { text: "7/3 · 1:2 · 3% · 25ml · 15 min Ton-Refresh", notes: "Ton verblasst leicht", daysAgo: 75 },
      { text: "6/3 + 7/3 · 1:1 · 6% · 40ml Ersttermin", notes: "Wunsch: natürliches Warmbraun", daysAgo: 150 },
    ],
    history: [19, 75, 150], service: "Saffron Pigment Treatment", staffId: 1,
    loyaltyStamps: 12, loyaltyPoints: 3600, debt: false,
  },
  {
    firstName: "Ingrid",   lastName: "Meier",       phone: "+4917612300014",
    email: "i.meier@beispiel.de",
    drink: "Chai Latte",
    conversation: "Sehr kommunikativ",
    seat: "Fenster rechts",
    patchTestDaysAgo: 40,
    formulas: [
      { text: "5/5 + 6/45 · 1:1 · 6% · 50ml · 40 min intensive Kupfer", notes: "Tiefes Kupfer-Rot, sehr satt", daysAgo: 45 },
      { text: "5/5 + 5/6 · 6% · 45ml · 35 min", notes: "Ton dunkler angepasst", daysAgo: 105 },
    ],
    history: [45, 105, 165, 225], service: "Saffron Pigment Treatment", staffId: 3,
    loyaltyStamps: 15, loyaltyPoints: 4500, debt: false,
  },
  {
    firstName: "Prof. Hans", lastName: "Zimmermann", phone: "+4917612300015",
    email: "h.zimmermann@uni.de",
    drink: "Earl Grey Tee",
    conversation: "Stille absolut bevorzugt — liest Zeitung",
    seat: "Ruhig, hinten links",
    patchTestDaysAgo: null,
    formulas: [
      { text: "Keine Farbe — akademischer Formschnitt", notes: "Klassisch konservativ, nichts modernes", daysAgo: 28 },
      { text: "Keine Farbe — gleiche Länge wie immer", notes: "Ohren freischneiden, Nacken sauber", daysAgo: 84 },
    ],
    history: [28, 84, 140, 196, 252], service: "Architectural Silhouette Cut", staffId: 1,
    loyaltyStamps: 28, loyaltyPoints: 9800, debt: false,
  },
] as const;

/* ── upcoming appointments this week ── */
const UPCOMING = [
  { clientPhone: "+4917612300001", service: "Executive Line Cut",      staffId: 1, dayOffset: 0, hour: 10 },
  { clientPhone: "+4917612300002", service: "Venetian Light Weave",    staffId: 2, dayOffset: 0, hour: 13 },
  { clientPhone: "+4917612300004", service: "Saffron Pigment Treatment", staffId: 2, dayOffset: 1, hour: 11 },
  { clientPhone: "+4917612300006", service: "Venetian Light Weave",    staffId: 2, dayOffset: 1, hour: 14 },
  { clientPhone: "+4917612300008", service: "Nocturne Tonality",       staffId: 3, dayOffset: 2, hour: 9  },
  { clientPhone: "+4917612300010", service: "Or et Cendre Ombré",      staffId: 2, dayOffset: 2, hour: 13 },
  { clientPhone: "+4917612300013", service: "Saffron Pigment Treatment", staffId: 1, dayOffset: 3, hour: 10 },
  { clientPhone: "+4917612300015", service: "Architectural Silhouette Cut", staffId: 1, dayOffset: 4, hour: 11 },
];

function getServiceDuration(db: BetterSQLite3Database<typeof schema>, serviceName: string): number {
  const [svc] = db.select({ durationMinutes: schema.salonServiceCatalog.durationMinutes })
    .from(schema.salonServiceCatalog)
    .where(eq(schema.salonServiceCatalog.serviceName, serviceName))
    .limit(1).all();
  return svc?.durationMinutes ?? 60;
}

export function applyEliteClientSeed(db: BetterSQLite3Database<typeof schema>) {
  /* Step 1 — upsert clients with rich preferences */
  for (const c of ELITE_CLIENTS) {
    const [existing] = db.select().from(schema.clients)
      .where(eq(schema.clients.phone, c.phone)).limit(1).all();

    const vals = {
      name: `${c.firstName} ${c.lastName}`,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      email: c.email,
      gdprConsent: true as unknown as boolean,
      gdprConsentDate: new Date(),
      hospitalityDrink: c.drink,
      hospitalityConversation: c.conversation,
      hospitalitySeat: c.seat,
      patchTestAt: c.patchTestDaysAgo != null ? daysAgo(c.patchTestDaysAgo) : null,
      preferences: JSON.stringify({ elite: true }),
    };

    let clientId: number;
    if (existing) {
      db.update(schema.clients).set(vals).where(eq(schema.clients.id, existing.id)).run();
      clientId = existing.id;
    } else {
      const [row] = db.insert(schema.clients).values(vals).returning().all();
      if (!row) continue;
      clientId = row.id;
    }

    /* Step 2 — formulas */
    const existingFormulas = db.select({ id: schema.clientFormulas.id })
      .from(schema.clientFormulas).where(eq(schema.clientFormulas.clientId, clientId)).all();
    const existingCount = existingFormulas.length;
    for (let fi = existingCount; fi < c.formulas.length; fi++) {
      const f = c.formulas[fi]!;
      db.insert(schema.clientFormulas).values({
        clientId, formulaText: f.text, notes: f.notes,
        staffId: c.staffId, createdAt: daysAgo(f.daysAgo),
      }).run();
    }

    /* Step 3 — historical completed appointments + sessions + invoices */
    const existingAppts = db.select({ id: schema.appointments.id })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.clientId, clientId), eq(schema.appointments.status, "completed")))
      .all().length;

    const historyDays = [...c.history];
    const [svc] = db.select().from(schema.salonServiceCatalog)
      .where(eq(schema.salonServiceCatalog.serviceName, c.service)).limit(1).all();
    const durMins = svc?.durationMinutes ?? 60;
    const netCents = svc?.referenceNetCents ?? 15000;
    const vatBps = 1900;
    const lineVat = Math.round((netCents * vatBps) / 10000);
    const gross = netCents + lineVat;

    for (let hi = existingAppts; hi < historyDays.length; hi++) {
      const d = historyDays[hi]!;
      const startAt = daysAgo(d);
      const endAt = new Date(startAt.getTime() + durMins * 60000);

      const [appt] = db.insert(schema.appointments).values({
        clientName: vals.name, clientPhone: c.phone, clientId,
        staffId: c.staffId, serviceName: c.service, sourceType: "internal",
        startAt, endAt, status: "completed", updatedAt: endAt,
      }).returning().all();
      if (!appt) continue;

      const [sess] = db.insert(schema.sessions).values({
        clientId, staffId: c.staffId, appointmentId: appt.id,
        status: "closed", consultationStatus: "approved",
        consultationApprovedAt: startAt, createdAt: startAt, closedAt: endAt,
      }).returning().all();
      if (!sess) continue;

      const [inv] = db.insert(schema.invoices).values({
        sessionId: sess.id, totalAmountCents: gross, vatAmountCents: lineVat,
        status: "closed", tseSignature: `SEED-HISTORICAL|s=${sess.id}`,
        tseStatus: "ausfall_failed", createdAt: endAt, updatedAt: endAt,
      }).returning().all();
      if (!inv) continue;

      db.insert(schema.invoiceItems).values({
        invoiceId: inv.id, description: c.service, quantity: 1,
        unitNetCents: netCents, vatRateBps: vatBps, createdAt: endAt,
      }).run();
      db.insert(schema.invoicePayments).values({
        invoiceId: inv.id, amountCents: gross,
        method: hi % 2 === 0 ? "card" : "cash", createdAt: endAt,
      }).run();
    }

    /* Step 4 — loyalty */
    const [loyaltyRow] = db.select().from(schema.clientLoyalty)
      .where(eq(schema.clientLoyalty.clientId, clientId)).limit(1).all();
    if (!loyaltyRow) {
      db.insert(schema.clientLoyalty).values({
        clientId, stampsCount: c.loyaltyStamps,
        pointsBalance: c.loyaltyPoints, lifetimePoints: c.loyaltyPoints,
      }).run();
    }

    /* Step 5 — debt (requires a closed invoice) */
    if ("debt" in c && c.debt && "debtCents" in c) {
      const existingDebt = db.select({ id: schema.clientDebts.id })
        .from(schema.clientDebts).where(eq(schema.clientDebts.clientId, clientId)).limit(1).all();
      if (existingDebt.length === 0) {
        const [lastInv] = db.select({ id: schema.invoices.id })
          .from(schema.invoices).innerJoin(schema.sessions, eq(schema.sessions.id, schema.invoices.sessionId))
          .where(eq(schema.sessions.clientId, clientId))
          .all();
        if (lastInv) {
          db.insert(schema.clientDebts).values({
            clientId, sourceInvoiceId: lastInv.id,
            amountCents: (c as { debtCents: number }).debtCents, status: "open",
          }).run();
        }
      }
    }

    /* Step 6 — client note (operational, persistent) */
    const [noteExists] = db.select({ id: schema.clientNotes.id })
      .from(schema.clientNotes).where(eq(schema.clientNotes.clientId, clientId)).limit(1).all();
    if (!noteExists) {
      db.insert(schema.clientNotes).values({
        clientId, staffId: c.staffId,
        noteText: `Stammkunde. Präferenz: ${c.drink}. ${c.conversation}.`,
        createdAt: daysAgo(200),
      }).run();
    }
  }

  /* Step 7 — upcoming appointments this week */
  for (const u of UPCOMING) {
    const [client] = db.select().from(schema.clients)
      .where(eq(schema.clients.phone, u.clientPhone)).limit(1).all();
    if (!client) continue;

    const startAt = daysFromNow(u.dayOffset);
    startAt.setHours(u.hour, 0, 0, 0);
    const durMins = getServiceDuration(db, u.service);
    const endAt = new Date(startAt.getTime() + durMins * 60000);

    /* skip if client already has a booked appointment on that day */
    const dayStart = new Date(startAt); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(startAt); dayEnd.setHours(23, 59, 59, 999);
    const existing = db.select({ id: schema.appointments.id })
      .from(schema.appointments)
      .where(and(
        eq(schema.appointments.clientId, client.id),
        eq(schema.appointments.status, "booked"),
      )).all();
    if (existing.length > 0) continue;

    db.insert(schema.appointments).values({
      clientName: client.name, clientPhone: client.phone,
      clientId: client.id, staffId: u.staffId,
      serviceName: u.service, sourceType: "internal",
      startAt, endAt, status: "booked", updatedAt: new Date(),
    }).run();
  }

  console.log("[eliteClientSeed] ✓ Done — 15 elite clients seeded with full history.");
}
