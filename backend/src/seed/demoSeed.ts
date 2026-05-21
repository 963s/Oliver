import { and, eq, inArray, like, notInArray, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { hashPin } from "../lib/pin.js";

/** GS1 EAN-13 check digit (12-digit body, left-to-right weights 1,3,1,3… on positions 1–12). */
export function ean13Check(base12: string): string {
  const d = base12.replace(/\D/g, "").padStart(12, "0").slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = Number(d[i]);
    sum += i % 2 === 0 ? n : n * 3;
  }
  const c = (10 - (sum % 10)) % 10;
  return d + c;
}

const DEMO_PRODUCTS: {
  name: string;
  ean12: string;
  onHandMl: number;
  defaultUnitMl: number;
}[] = [
  { name: "Maison Noir 5 — Pigment Saffron", ean12: "400401110001", onHandMl: 2800, defaultUnitMl: 60 },
  { name: "Maison Noir 6 — Cendre Froid", ean12: "400401110002", onHandMl: 2600, defaultUnitMl: 60 },
  { name: "Maison Noir 7 — Champagne Ash", ean12: "400401110003", onHandMl: 2500, defaultUnitMl: 60 },
  { name: "L’Atelier Blond 8/1 — Glacier", ean12: "400401110004", onHandMl: 2400, defaultUnitMl: 60 },
  { name: "L’Atelier Blond 9/3 — Or Vénitien", ean12: "400401110005", onHandMl: 2200, defaultUnitMl: 60 },
  { name: "Archiv Essence 6 — Minuit", ean12: "400401110006", onHandMl: 1900, defaultUnitMl: 60 },
  { name: "Couture Color 7/1 — Acier", ean12: "400401110007", onHandMl: 1700, defaultUnitMl: 60 },
  { name: "Developer Archive 6 % · 1000 ml", ean12: "400401110008", onHandMl: 6200, defaultUnitMl: 100 },
  { name: "Developer Archive 9 % · 1000 ml", ean12: "400401110009", onHandMl: 6100, defaultUnitMl: 100 },
  { name: "Developer Archive 3 % · 1000 ml", ean12: "400401110010", onHandMl: 6300, defaultUnitMl: 100 },
  { name: "Ritual Shampoo — Silk Line 250 ml", ean12: "400401110011", onHandMl: 3400, defaultUnitMl: 250 },
  { name: "Ritual Masque — Velvet Seal 200 ml", ean12: "400401110012", onHandMl: 2200, defaultUnitMl: 200 },
  { name: "Huile Rituelle — Argan 100 ml", ean12: "400401110013", onHandMl: 1700, defaultUnitMl: 50 },
  { name: "Texture Dust — Edition Studio", ean12: "400401110014", onHandMl: 800, defaultUnitMl: 10 },
  { name: "Mousse Légère — Séance 200 ml", ean12: "400401110015", onHandMl: 2400, defaultUnitMl: 200 },
  { name: "Lingettes Effacement — Atelier", ean12: "400401110016", onHandMl: 0, defaultUnitMl: 0 },
  { name: "Bobine Nacrée — Couture Foil", ean12: "400401110017", onHandMl: 0, defaultUnitMl: 0 },
  { name: "Brume Capillaire — Maison Balmain 200 ml", ean12: "400401110018", onHandMl: 1900, defaultUnitMl: 200 },
  { name: "Shield Thermique — Couture Heat 120 ml", ean12: "400401110019", onHandMl: 1300, defaultUnitMl: 60 },
];

const CORE_STAFF = [
  { displayName: "OLI", role: "owner" as const, devPin: "1111" },
  { displayName: "SILKE", role: "stylist" as const, devPin: "2222" },
  { displayName: "ABDUL", role: "stylist" as const, devPin: "3333" },
];

const LEGACY_STAFF_LABELS: Record<string, string> = {
  "Oliver Roos": "OLI",
  "Isabella Schneider": "SILKE",
  "Léandre Moreau": "ABDUL",
  Silke: "SILKE",
  Abdul: "ABDUL",
};

const SALON_CATALOG_EDITORIAL: {
  from: string;
  to: string;
  durationMinutes: number;
  grossCents: number;
  vatBps: number;
}[] = [
  { from: "Haarschnitt", to: "Architectural Silhouette Cut", durationMinutes: 50, grossCents: 180_00, vatBps: 1900 },
  { from: "Herrenhaarschnitt", to: "Executive Line Cut", durationMinutes: 40, grossCents: 150_00, vatBps: 1900 },
  { from: "Färbung", to: "Saffron Pigment Treatment", durationMinutes: 150, grossCents: 450_00, vatBps: 1900 },
  { from: "Strähnen", to: "Venetian Light Weave", durationMinutes: 120, grossCents: 320_00, vatBps: 1900 },
  { from: "Tönung", to: "Nocturne Tonality", durationMinutes: 75, grossCents: 220_00, vatBps: 1900 },
  { from: "Balayage", to: "Or et Cendre Ombré", durationMinutes: 180, grossCents: 500_00, vatBps: 1900 },
  { from: "Beratung", to: "Private Atelier Consultation", durationMinutes: 30, grossCents: 150_00, vatBps: 1900 },
];

type GermanClientSeed = {
  salutation: "Herr" | "Frau";
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  preferredService: string;
  profileNote: string;
  formula: string;
};

const CLIENTS: GermanClientSeed[] = [
  { salutation: "Herr", firstName: "Klaus", lastName: "Weber", phone: "+491511200001", email: "klaus.weber@beispiel.de", preferredService: "Executive Line Cut", profileNote: "Kurzer Nacken, keine Kontur mit Klinge. Business-Look.", formula: "6/0 + 6% 1:1, Ansatz 25 min." },
  { salutation: "Frau", firstName: "Sabine", lastName: "Müller", phone: "+491511200002", email: "sabine.mueller@beispiel.de", preferredService: "Architectural Silhouette Cut", profileNote: "Bevorzugt weiche Kontur am Pony, Volumen am Oberkopf.", formula: "7/1 + 3% 1:2, Gloss 10 min." },
  { salutation: "Herr", firstName: "Thomas", lastName: "Schneider", phone: "+491511200003", email: "th.schneider@beispiel.de", preferredService: "Executive Line Cut", profileNote: "Alle 3 Wochen Termin, Seiten sehr präzise.", formula: "Tonality neutral, kein zusätzlicher Pigmentauftrag." },
  { salutation: "Frau", firstName: "Petra", lastName: "Krüger", phone: "+491511200004", email: "petra.krueger@beispiel.de", preferredService: "Saffron Pigment Treatment", profileNote: "Warmes Kupfer gewünscht, empfindliche Kopfhaut.", formula: "5/4 + 6/34 + 3% 1:2, 35 min." },
  { salutation: "Herr", firstName: "Markus", lastName: "Neumann", phone: "+491511200005", email: "markus.neumann@beispiel.de", preferredService: "Executive Line Cut", profileNote: "Kontur trocken nacharbeiten, matte Finish-Produkte.", formula: "Keine Farbe, nur Formschnitt." },
  { salutation: "Frau", firstName: "Claudia", lastName: "Hoffmann", phone: "+491511200006", email: "claudia.hoffmann@beispiel.de", preferredService: "Venetian Light Weave", profileNote: "Feine Babylights, keine starken Kontraste.", formula: "8/1 + 9/3 + 3%, Freihand 55 min." },
  { salutation: "Herr", firstName: "Jürgen", lastName: "Becker", phone: "+491511200007", email: "juergen.becker@beispiel.de", preferredService: "Architectural Silhouette Cut", profileNote: "Volumen am Hinterkopf erhalten.", formula: "Neutralisierung mit 7/1, 8 min." },
  { salutation: "Frau", firstName: "Daniela", lastName: "Wagner", phone: "+491511200008", email: "daniela.wagner@beispiel.de", preferredService: "Nocturne Tonality", profileNote: "Kühles Braun, Glanz statt Aufhellung.", formula: "5/1 + 6/1 + 1.9% 1:2." },
  { salutation: "Herr", firstName: "Stefan", lastName: "Richter", phone: "+491511200009", email: "stefan.richter@beispiel.de", preferredService: "Executive Line Cut", profileNote: "Nacken tief ausrasieren, Oberkopf texturiert.", formula: "Keine Farbkorrektur." },
  { salutation: "Frau", firstName: "Nadine", lastName: "Koch", phone: "+491511200010", email: "nadine.koch@beispiel.de", preferredService: "Or et Cendre Ombré", profileNote: "Face-framing heller, Längen kühl lassen.", formula: "Balayage + 9/1 Gloss, 20 min Finish." },
  { salutation: "Herr", firstName: "Alexander", lastName: "Wolf", phone: "+491511200011", email: "alex.wolf@beispiel.de", preferredService: "Architectural Silhouette Cut", profileNote: "Seitenscheitel fest, leichte Pomade.", formula: "Keine Farbe." },
  { salutation: "Frau", firstName: "Birgit", lastName: "Lehmann", phone: "+491511200012", email: "birgit.lehmann@beispiel.de", preferredService: "Private Atelier Consultation", profileNote: "Beratung zur Grauhaarstrategie und Pflegeplan.", formula: "Pflegeplan + Pigmenttest dokumentiert." },
];

const RINGS_PRESETS = [
  { targetRevenueCents: 128_000, targetRetailUnitCount: 22, progressRevenueCents: 74_200, progressRetailUnits: 9 },
  { targetRevenueCents: 112_000, targetRetailUnitCount: 18, progressRevenueCents: 81_500, progressRetailUnits: 11 },
  { targetRevenueCents: 138_000, targetRetailUnitCount: 20, progressRevenueCents: 62_400, progressRetailUnits: 8 },
];

function netFromGrossCents(grossCents: number, vatBps: number): number {
  return Math.round((grossCents * 10_000) / (10_000 + vatBps));
}

function applySalonCatalogEditorialUpgrade(db: BetterSQLite3Database<typeof schema>) {
  for (const row of SALON_CATALOG_EDITORIAL) {
    db.update(schema.staffServiceDurations)
      .set({ serviceName: row.to })
      .where(eq(schema.staffServiceDurations.serviceName, row.from))
      .run();

    const net = netFromGrossCents(row.grossCents, row.vatBps);
    db.update(schema.salonServiceCatalog)
      .set({
        serviceName: row.to,
        durationMinutes: row.durationMinutes,
        referenceNetCents: net,
        vatRateBps: row.vatBps,
      })
      .where(or(eq(schema.salonServiceCatalog.serviceName, row.from), eq(schema.salonServiceCatalog.serviceName, row.to)))
      .run();
  }
}

function seedInventory(db: BetterSQLite3Database<typeof schema>) {
  for (const p of DEMO_PRODUCTS) {
    const ean = ean13Check(p.ean12);
    const [existing] = db
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.barcodeEan, ean))
      .limit(1)
      .all();

    if (existing) {
      db.update(schema.inventoryItems)
        .set({
          name: p.name,
          onHandMl: Math.max(existing.onHandMl, p.onHandMl),
          defaultUnitMl: p.defaultUnitMl,
        })
        .where(eq(schema.inventoryItems.id, existing.id))
        .run();
      continue;
    }

    db.insert(schema.inventoryItems)
      .values({
        name: p.name,
        barcodeEan: ean,
        barcodeUpc: null,
        onHandMl: p.onHandMl,
        defaultUnitMl: p.defaultUnitMl,
      })
      .run();
  }
}

function ensureCoreStaff(db: BetterSQLite3Database<typeof schema>) {
  for (const [legacy, target] of Object.entries(LEGACY_STAFF_LABELS)) {
    db.update(schema.staff).set({ displayName: target }).where(eq(schema.staff.displayName, legacy)).run();
  }

  for (const s of CORE_STAFF) {
    const [existing] = db
      .select({ id: schema.staff.id })
      .from(schema.staff)
      .where(eq(schema.staff.displayName, s.displayName))
      .limit(1)
      .all();

    if (existing) {
      db.update(schema.staff)
        .set({ role: s.role, active: true, pinHash: hashPin(s.devPin) })
        .where(eq(schema.staff.id, existing.id))
        .run();
      continue;
    }

    db.insert(schema.staff)
      .values({
        displayName: s.displayName,
        role: s.role,
        active: true,
        pinHash: hashPin(s.devPin),
      })
      .run();
  }

  db.update(schema.staff)
    .set({ active: false })
    .where(notInArray(schema.staff.displayName, CORE_STAFF.map((s) => s.displayName)))
    .run();
}

function seedGermanClients(db: BetterSQLite3Database<typeof schema>) {
  for (const c of CLIENTS) {
    const [existing] = db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(eq(schema.clients.phone, c.phone))
      .limit(1)
      .all();

    const firstName = `${c.salutation} ${c.firstName}`;
    const name = `${firstName} ${c.lastName}`;

    if (existing) {
      db.update(schema.clients)
        .set({
          name,
          firstName,
          lastName: c.lastName,
          email: c.email,
          gdprConsent: true,
          preferences: JSON.stringify({
            preferredService: c.preferredService,
            profile: c.profileNote,
          }),
        })
        .where(eq(schema.clients.id, existing.id))
        .run();
      continue;
    }

    db.insert(schema.clients)
      .values({
        name,
        firstName,
        lastName: c.lastName,
        phone: c.phone,
        email: c.email,
        gdprConsent: true,
        preferences: JSON.stringify({
          preferredService: c.preferredService,
          profile: c.profileNote,
        }),
      })
      .run();
  }
}

function seedStaffTargets(db: BetterSQLite3Database<typeof schema>) {
  const businessDate = new Date().toISOString().slice(0, 10);
  const staffRows = db
    .select({ id: schema.staff.id })
    .from(schema.staff)
    .where(and(inArray(schema.staff.displayName, CORE_STAFF.map((s) => s.displayName)), eq(schema.staff.active, true)))
    .all();

  for (let i = 0; i < staffRows.length; i++) {
    const sid = staffRows[i]!.id;
    const t = RINGS_PRESETS[i] ?? RINGS_PRESETS[0]!;
    const [exists] = db
      .select({ id: schema.staffTargets.id })
      .from(schema.staffTargets)
      .where(and(eq(schema.staffTargets.staffId, sid), eq(schema.staffTargets.businessDate, businessDate)))
      .limit(1)
      .all();
    if (exists) continue;

    db.insert(schema.staffTargets)
      .values({
        staffId: sid,
        businessDate,
        targetRevenueCents: t.targetRevenueCents,
        targetRetailUnitCount: t.targetRetailUnitCount,
        progressRevenueCents: t.progressRevenueCents,
        progressRetailUnits: t.progressRetailUnits,
        status: "open",
      })
      .run();
  }
}

function linkPremiumColorService(db: BetterSQLite3Database<typeof schema>) {
  const [svc] = db
    .select()
    .from(schema.salonServiceCatalog)
    .where(
      or(
        eq(schema.salonServiceCatalog.serviceName, "Saffron Pigment Treatment"),
        eq(schema.salonServiceCatalog.serviceName, "Färbung"),
      ),
    )
    .limit(1)
    .all();
  if (!svc) return;
  if (svc.inventoryItemId != null && (svc.deductMl ?? 0) > 0) return;

  const [inv] = db
    .select()
    .from(schema.inventoryItems)
    .where(
      or(
        like(schema.inventoryItems.name, "%Maison Noir%"),
        like(schema.inventoryItems.name, "%Pigment%"),
      ),
    )
    .limit(1)
    .all();
  if (!inv) return;

  db.update(schema.salonServiceCatalog)
    .set({ inventoryItemId: inv.id, deductMl: Math.max(30, inv.defaultUnitMl || 40) })
    .where(eq(schema.salonServiceCatalog.id, svc.id))
    .run();
}

function seedDeepClientHistory(db: BetterSQLite3Database<typeof schema>) {
  const existingCompleted = db
    .select({ id: schema.appointments.id })
    .from(schema.appointments)
    .where(eq(schema.appointments.status, "completed"))
    .all().length;
  if (existingCompleted >= 12) return;

  const staffRows = db
    .select({ id: schema.staff.id, displayName: schema.staff.displayName })
    .from(schema.staff)
    .where(and(inArray(schema.staff.displayName, CORE_STAFF.map((s) => s.displayName)), eq(schema.staff.active, true)))
    .all();
  if (staffRows.length === 0) return;

  const serviceRows = db
    .select()
    .from(schema.salonServiceCatalog)
    .where(eq(schema.salonServiceCatalog.catalogActive, true))
    .all();
  if (serviceRows.length === 0) return;

  const inventoryRows = db
    .select()
    .from(schema.inventoryItems)
    .all()
    .filter((r) => r.defaultUnitMl > 0);

  const clients = db
    .select()
    .from(schema.clients)
    .all()
    .filter((c) => c.phone != null && CLIENTS.some((seed) => seed.phone === c.phone));

  const now = Date.now();

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i]!;
    const seed = CLIENTS.find((c) => c.phone === client.phone);
    if (!seed) continue;

    const service = serviceRows.find((s) => s.serviceName === seed.preferredService) ?? serviceRows[i % serviceRows.length]!;
    const staff = staffRows[i % staffRows.length]!;
    const visits = i < 6 ? 2 : 1;

    for (let v = 0; v < visits; v++) {
      const daysAgo = 21 + i * 4 + v * 31;
      const startAt = now - daysAgo * 24 * 60 * 60 * 1000;
      const endAt = startAt + Math.max(15, service.durationMinutes) * 60 * 1000;
      const inventory = inventoryRows[(i + v) % Math.max(1, inventoryRows.length)];
      const deductMl = service.deductMl ?? (inventory ? Math.max(30, inventory.defaultUnitMl || 40) : null);
      const vatRateBps = service.vatRateBps === 700 || service.vatRateBps === 1900 ? service.vatRateBps : 1900;
      const unitNetCents = Math.max(10_000, service.referenceNetCents || 15_000);
      const lineVat = Math.round((unitNetCents * vatRateBps) / 10_000);
      const gross = unitNetCents + lineVat;

      const [appointment] = db
        .insert(schema.appointments)
        .values({
          clientName: client.name,
          clientPhone: client.phone,
          clientId: client.id,
          staffId: staff.id,
          serviceName: service.serviceName,
          sourceType: "internal",
          startAt: new Date(startAt),
          endAt: new Date(endAt),
          status: "completed",
          updatedAt: new Date(endAt),
        })
        .returning()
        .all();
      if (!appointment) continue;

      const [session] = db
        .insert(schema.sessions)
        .values({
          clientId: client.id,
          staffId: staff.id,
          appointmentId: appointment.id,
          status: "closed",
          consultationStatus: "approved",
          consultationApprovedAt: new Date(startAt),
          createdAt: new Date(startAt),
          closedAt: new Date(endAt),
        })
        .returning()
        .all();
      if (!session) continue;

      const [invoice] = db
        .insert(schema.invoices)
        .values({
          sessionId: session.id,
          totalAmountCents: gross,
          vatAmountCents: lineVat,
          status: "closed",
          tseSignature: `TSE-AUSFALL|historical_seed|session=${session.id}`,
          tseStatus: "ausfall_failed",
          createdAt: new Date(endAt),
          updatedAt: new Date(endAt),
        })
        .returning()
        .all();
      if (!invoice) continue;

      db.insert(schema.invoiceItems)
        .values({
          invoiceId: invoice.id,
          description: service.serviceName,
          quantity: 1,
          unitNetCents,
          vatRateBps,
          inventoryItemId: service.inventoryItemId ?? inventory?.id ?? null,
          deductMl: deductMl ?? null,
          createdAt: new Date(endAt),
        })
        .run();

      db.insert(schema.invoicePayments)
        .values({
          invoiceId: invoice.id,
          amountCents: gross,
          method: i % 2 === 0 ? "card" : "cash",
          createdAt: new Date(endAt),
        })
        .run();

      if (inventory && deductMl != null && deductMl > 0) {
        db.update(schema.inventoryItems)
          .set({ onHandMl: Math.max(0, inventory.onHandMl - deductMl) })
          .where(eq(schema.inventoryItems.id, inventory.id))
          .run();

        db.insert(schema.inventoryAdjustments)
          .values({
            inventoryItemId: inventory.id,
            deltaMl: -deductMl,
            reason: "usage_session",
            invoiceId: invoice.id,
            staffId: staff.id,
            note: JSON.stringify({
              clientId: client.id,
              clientName: client.name,
              visitDaysAgo: daysAgo,
              serviceName: service.serviceName,
            }),
            createdAt: new Date(endAt),
          })
          .run();
      }

      const [noteExists] = db
        .select({ id: schema.clientNotes.id })
        .from(schema.clientNotes)
        .where(eq(schema.clientNotes.clientId, client.id))
        .limit(1)
        .all();
      if (!noteExists) {
        db.insert(schema.clientNotes)
          .values({
            clientId: client.id,
            noteText: seed.profileNote,
            staffId: staff.id,
            createdAt: new Date(endAt),
          })
          .run();
      }

      const [formulaExists] = db
        .select({ id: schema.clientFormulas.id })
        .from(schema.clientFormulas)
        .where(eq(schema.clientFormulas.clientId, client.id))
        .limit(1)
        .all();
      if (!formulaExists) {
        db.insert(schema.clientFormulas)
          .values({
            clientId: client.id,
            formulaText: seed.formula,
            notes: `Historie: letzter Besuch vor ${Math.max(1, Math.round(daysAgo / 7))} Wochen.`,
            staffId: staff.id,
            createdAt: new Date(endAt),
          })
          .run();
      }
    }
  }
}

export function applyDemoSeed(db: BetterSQLite3Database<typeof schema>) {
  applySalonCatalogEditorialUpgrade(db);
  seedInventory(db);
  ensureCoreStaff(db);
  seedGermanClients(db);
  seedStaffTargets(db);
  linkPremiumColorService(db);
  seedDeepClientHistory(db);
}
