import { and, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { invoiceBerlinYmd } from "./invoiceBerlinDate.js";

export type CockpitTotals = {
  /** Summe invoice.total_amount_cents */
  bruttoInklTrinkgeldCents: number;
  trinkgeldGesamtCents: number;
  /** Umsatz ohne Trinkgelder (kartengebühr-neutrale Zuordnung zur Leistung) */
  salonUmsatzBruttoCents: number;
  nettoCents: number;
  vat7Cents: number;
  vat19Cents: number;
  geschlosseneBelege: number;
};

export type CockpitStaffRow = {
  staffId: number;
  displayName: string;
  /** Anteil Umsatz (ohne TG) dieser Person — Session-Kasse */
  umsatzBruttoOhneTrinkgeldCents: number;
  provisionCents: number;
  trinkgeldCents: number;
  geschlosseneBelegeAlsVerkaeufer: number;
};

export type InventoryHeatRow = {
  inventoryItemId: number;
  name: string;
  onHandMl: number;
  minStockThresholdMl: number | null;
  /** Letzte 14 Kalendertage bis `toYmd` (Auswertungsfenster). */
  verkaufteMl14d: number;
  geschwindigkeitMlProTag: number;
  deckungTageSchaetzung: number | null;
  nachbestellen: boolean;
};

export type BusinessCockpitDto = {
  fromYmd: string;
  toYmd: string;
  timezone: "Europe/Berlin";
  commissionServiceBps: number;
  commissionRetailBps: number;
  totals: CockpitTotals;
  staff: CockpitStaffRow[];
  inventoryHeat: InventoryHeatRow[];
};

export type MyPerformanceDto = {
  staffId: number;
  displayName: string;
  fromYmd: string;
  toYmd: string;
  timezone: "Europe/Berlin";
  commissionServiceBps: number;
  commissionRetailBps: number;
  umsatzBruttoOhneTrinkgeldCents: number;
  provisionCents: number;
  trinkgeldCents: number;
  belegeMitAnteil: number;
};

function getSettingInt(
  db: BetterSQLite3Database<typeof schema>,
  key: string,
  fallback: number,
): number {
  const [row] = db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1)
    .all();
  const n = Number.parseInt(String(row?.value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampBps(v: number): number {
  if (!Number.isFinite(v)) return 3000;
  return Math.min(9000, Math.max(0, Math.floor(v)));
}

function dateYmdLTE(a: string, b: string): boolean {
  return a <= b;
}

function dateYmdGTE(a: string, b: string): boolean {
  return a >= b;
}

function ymdSubtractDaysUtc(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Relevante geschlossene Belege im groben Zeitfenster; Filter auf Berlin-YMD später. */
function loadInvoiceSlice(
  db: BetterSQLite3Database<typeof schema>,
): (typeof schema.invoices.$inferSelect)[] {
  const scanFrom = new Date(Date.now() - 400 * 86_400_000);
  return db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.status, "closed"),
        isNull(schema.invoices.stornoForInvoiceId),
        gte(schema.invoices.updatedAt, scanFrom),
      ),
    )
    .all();
}

export function buildBusinessCockpit(
  db: BetterSQLite3Database<typeof schema>,
  fromYmd: string,
  toYmd: string,
): BusinessCockpitDto {
  const commissionServiceBps = clampBps(
    getSettingInt(db, "commission_service_bps", 3000),
  );
  const commissionRetailBps = clampBps(
    getSettingInt(db, "commission_retail_bps", 1000),
  );

  const invoices = loadInvoiceSlice(db);
  const inRangeIds: number[] = [];
  const inRangeInvoiceById = new Map<
    number,
    typeof schema.invoices.$inferSelect
  >();
  for (const inv of invoices) {
    const ymd = invoiceBerlinYmd(inv);
    if (!dateYmdGTE(ymd, fromYmd) || !dateYmdLTE(ymd, toYmd)) continue;
    inRangeIds.push(inv.id);
    inRangeInvoiceById.set(inv.id, inv);
  }

  const staffRows = db.select().from(schema.staff).all();
  const staffNameById = new Map(staffRows.map((s) => [s.id, s.displayName]));

  type Agg = {
    saleBruttoWoTip: number;
    provision: number;
    tips: number;
    belege: number;
  };
  const byStaff = new Map<number, Agg>();

  function ensureAgg(sid: number): Agg {
    let a = byStaff.get(sid);
    if (!a) {
      a = { saleBruttoWoTip: 0, provision: 0, tips: 0, belege: 0 };
      byStaff.set(sid, a);
    }
    return a;
  }

  let bruttoInklTips = 0;
  let tipsTotal = 0;
  let salonBruttoWoTip = 0;
  let netTotal = 0;
  let vat7 = 0;
  let vat19 = 0;

  if (inRangeIds.length > 0) {
    const sessionIdArr = [
      ...new Set(
        [...inRangeInvoiceById.values()].map((inv) => inv.sessionId),
      ),
    ].filter((x) => Number.isFinite(x) && x > 0);

    const sessRows =
      sessionIdArr.length > 0
        ? db
            .select()
            .from(schema.sessions)
            .where(inArray(schema.sessions.id, sessionIdArr))
            .all()
        : [];
    const sessionById = new Map(sessRows.map((s) => [s.id, s]));
    /** invoiceId → session row */
    const sessionByInvId = new Map<number, (typeof sessRows)[0]>();
    for (const inv of inRangeInvoiceById.values()) {
      const sr = sessionById.get(inv.sessionId);
      if (sr) sessionByInvId.set(inv.id, sr);
    }

    const items = db
      .select()
      .from(schema.invoiceItems)
      .where(inArray(schema.invoiceItems.invoiceId, inRangeIds))
      .all();

    for (const inv of inRangeInvoiceById.values()) {
      const tg = Number(inv.tipAmountCents ?? 0);
      const total = Number(inv.totalAmountCents ?? 0);
      const vatAmt = Number(inv.vatAmountCents ?? 0);
      bruttoInklTips += total;
      tipsTotal += tg;
      const ohneTip = Math.max(0, total - tg);
      salonBruttoWoTip += ohneTip;
      netTotal += ohneTip - vatAmt;

      const session = sessionByInvId.get(inv.id);
      const sid = session?.staffId;
      if (sid != null && sid >= 1) {
        const a = ensureAgg(sid);
        a.saleBruttoWoTip += ohneTip;
        a.belege += 1;
      }
      if (tg > 0) {
        const tipTo = inv.tipStaffId ?? sid;
        if (tipTo != null && tipTo >= 1) {
          ensureAgg(tipTo).tips += tg;
        }
      }
    }

    /** Mehrwertsteuer über Positionen — getrennt 7 % / 19 % */
    for (const ln of items) {
      const inv = inRangeInvoiceById.get(ln.invoiceId);
      if (!inv) continue;
      const session = sessionByInvId.get(inv.id);
      const sid = session?.staffId;
      const qty = Math.max(1, Number(ln.quantity ?? 1));
      const unitNet = Number(ln.unitNetCents ?? 0);
      const lineNet = unitNet * qty;
      const vatbps = Number(ln.vatRateBps ?? 1900);
      const lineVat = Math.round((lineNet * vatbps) / 10000);
      if (vatbps <= 750) vat7 += lineVat;
      else vat19 += lineVat;

      if (sid == null || sid < 1 || lineNet <= 0) continue;
      /** Position mit Ware / Material (inventoryItemId gesetzt): niedrigere Provision. */
      const useRetailRate = ln.inventoryItemId != null;
      const bps = useRetailRate ? commissionRetailBps : commissionServiceBps;
      const provision = Math.round((lineNet * bps) / 10000);
      ensureAgg(sid).provision += provision;
    }
  }

  const staffOut: CockpitStaffRow[] = Array.from(byStaff.entries())
    .map(([staffId, a]) => ({
      staffId,
      displayName: staffNameById.get(staffId) ?? `ID ${staffId}`,
      umsatzBruttoOhneTrinkgeldCents: a.saleBruttoWoTip,
      provisionCents: a.provision,
      trinkgeldCents: a.tips,
      geschlosseneBelegeAlsVerkaeufer: a.belege,
    }))
    .sort((x, y) => y.provisionCents - x.provisionCents);

  const totals: CockpitTotals = {
    bruttoInklTrinkgeldCents: bruttoInklTips,
    trinkgeldGesamtCents: tipsTotal,
    salonUmsatzBruttoCents: salonBruttoWoTip,
    nettoCents: netTotal,
    vat7Cents: vat7,
    vat19Cents: vat19,
    geschlosseneBelege: inRangeIds.length,
  };

  /** Lager Heatmap — 14 Tage bis toYmd */
  const heatFromYmd = ymdSubtractDaysUtc(toYmd, 13);
  const heatInvoiceIds = new Set<number>();
  for (const inv of invoices) {
    const ymd = invoiceBerlinYmd(inv);
    if (
      dateYmdGTE(ymd, heatFromYmd) &&
      dateYmdLTE(ymd, toYmd) &&
      inv.status === "closed" &&
      inv.stornoForInvoiceId == null
    ) {
      heatInvoiceIds.add(inv.id);
    }
  }

  const mlByItem = new Map<number, number>();
  if (heatInvoiceIds.size > 0) {
    const heatItems = db
      .select()
      .from(schema.invoiceItems)
      .where(
        and(
          inArray(schema.invoiceItems.invoiceId, [...heatInvoiceIds]),
          isNotNull(schema.invoiceItems.inventoryItemId),
        ),
      )
      .all();
    for (const ln of heatItems) {
      const iid = ln.inventoryItemId!;
      const qty = Math.max(1, Number(ln.quantity ?? 1));
      const ml = Number(ln.deductMl ?? 0) * qty;
      if (ml <= 0) continue;
      mlByItem.set(iid, (mlByItem.get(iid) ?? 0) + ml);
    }
  }

  const invItemsCatalog = db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.isRetail, true))
    .all();
  /** Heat für alle Inventar-Artikel die Umsatz hatten oder Schwellwert haben */
  const touchedIds = new Set([
    ...mlByItem.keys(),
    ...invItemsCatalog.filter((it) => it.minStockThresholdMl != null).map((it) => it.id),
  ]);

  const inventoryHeat: InventoryHeatRow[] = [];
  for (const iid of touchedIds) {
    const row = db
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, iid))
      .limit(1)
      .all()[0];
    if (!row) continue;
    const sold14 = mlByItem.get(iid) ?? 0;
    const v = sold14 / 14;
    const cover = v > 0.0001 ? row.onHandMl / v : null;
    const threshold = row.minStockThresholdMl;
    const underThreshold =
      threshold != null && row.onHandMl <= threshold ? true : false;
    const lowCover =
      cover != null && cover < 14 && sold14 > 30 ? true : false;
    const nachbestellen = underThreshold || lowCover;
    inventoryHeat.push({
      inventoryItemId: row.id,
      name: row.name,
      onHandMl: row.onHandMl,
      minStockThresholdMl: threshold ?? null,
      verkaufteMl14d: sold14,
      geschwindigkeitMlProTag: Math.round(v * 100) / 100,
      deckungTageSchaetzung: cover != null ? Math.round(cover * 10) / 10 : null,
      nachbestellen,
    });
  }

  inventoryHeat.sort(
    (a, b) => Number(b.nachbestellen) - Number(a.nachbestellen) || b.verkaufteMl14d - a.verkaufteMl14d,
  );

  return {
    fromYmd,
    toYmd,
    timezone: "Europe/Berlin",
    commissionServiceBps,
    commissionRetailBps,
    totals,
    staff: staffOut,
    inventoryHeat,
  };
}

export function buildMyPerformance(
  db: BetterSQLite3Database<typeof schema>,
  staffId: number,
  fromYmd: string,
  toYmd: string,
): MyPerformanceDto {
  const full = buildBusinessCockpit(db, fromYmd, toYmd);
  const row = full.staff.find((s) => s.staffId === staffId);
  const staffName =
    db
      .select()
      .from(schema.staff)
      .where(eq(schema.staff.id, staffId))
      .limit(1)
      .all()[0]?.displayName ?? `ID ${staffId}`;

  return {
    staffId,
    displayName: staffName,
    fromYmd,
    toYmd,
    timezone: "Europe/Berlin",
    commissionServiceBps: full.commissionServiceBps,
    commissionRetailBps: full.commissionRetailBps,
    umsatzBruttoOhneTrinkgeldCents: row?.umsatzBruttoOhneTrinkgeldCents ?? 0,
    provisionCents: row?.provisionCents ?? 0,
    trinkgeldCents: row?.trinkgeldCents ?? 0,
    belegeMitAnteil: row?.geschlosseneBelegeAlsVerkaeufer ?? 0,
  };
}
