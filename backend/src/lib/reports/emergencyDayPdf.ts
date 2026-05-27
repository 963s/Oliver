import { and, desc, eq, gte, lte } from "drizzle-orm";
import { whereNotDeleted } from "../db/softDelete.js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { berlinYmdFromMs } from "../../services/availabilityService.js";
import { lowerBoundMsBerlinYmd } from "../finance/berlinMonthBounds.js";

type ApptLite = typeof schema.appointments.$inferSelect;

function formatHm(d: Date): string {
  return d.toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fetchAppointmentsDay(
  db: BetterSQLite3Database<typeof schema>,
  berlinDayYmd: string,
): ApptLite[] {
  const startMs = lowerBoundMsBerlinYmd(berlinDayYmd);
  /** Grobes Fenster, exakter Filter ueber berlinYmdFromMs(startAt) */
  return db
    .select()
    .from(schema.appointments)
    .where(
      and(
        whereNotDeleted(schema.appointments),
        gte(schema.appointments.startAt, new Date(startMs - 7200000)),
        lte(schema.appointments.startAt, new Date(startMs + 30 * 60 * 60 * 1000)),
      ),
    )
    .all()
    .filter((a) => berlinYmdFromMs(a.startAt.getTime()) === berlinDayYmd)
    .filter((a) => a.status !== "canceled" && a.status !== "no_show")
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/**
 * Oliver Roos — Notfall-Tagesplan (PDF, A4, druckbereit ohne externe Fonts).
 */
export async function buildEmergencyDayPdfBytes(
  db: BetterSQLite3Database<typeof schema>,
  berlinDayYmd: string,
): Promise<Uint8Array> {
  const appointments = fetchAppointmentsDay(db, berlinDayYmd);

  const staffRows = db.select().from(schema.staff).all();
  const staffName = new Map(staffRows.map((s) => [s.id, s.displayName]));

  const formulasByClient = new Map<number, string>();
  for (const a of appointments) {
    const cid = a.clientId ?? null;
    if (cid == null || formulasByClient.has(cid)) continue;
    const [f] = db
      .select()
      .from(schema.clientFormulas)
      .where(eq(schema.clientFormulas.clientId, cid))
      .orderBy(desc(schema.clientFormulas.createdAt))
      .limit(1)
      .all();
    if (f?.formulaText) {
      formulasByClient.set(cid, f.formulaText);
    }
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageW = 595;
  const pageH = 842;
  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - 48;
  const margin = 40;
  const lineH = 14;
  const maxTextW = pageW - margin * 2;

  const drawWrap = (
    txt: string,
    size: number,
    opts: { bold?: boolean },
  ): number => {
    const fnt = opts.bold ? fontBold : font;
    const words = txt.split(/\s+/);
    let line = "";
    let linesUsed = 0;
    const fit = (segment: string): string => {
      let s = segment;
      while (s.length > 1 && fnt.widthOfTextAtSize(s, size) > maxTextW)
        s = `${s.slice(0, -1)}`;
      return s.slice(0, 120);
    };
    for (const wRaw of words) {
      const w = fit(wRaw);
      const probe = line ? `${line} ${w}` : w;
      if (fnt.widthOfTextAtSize(probe, size) > maxTextW && line.length > 0) {
        page.drawText(line, { x: margin, y, size, font: fnt });
        y -= lineH;
        linesUsed += 1;
        line = fit(w);
      } else {
        line = probe;
      }
      if (y < 72) {
        page = pdf.addPage([pageW, pageH]);
        y = pageH - 48;
      }
    }
      if (line) {
      const chunk =
        line.length > 140 ? `${line.slice(0, 137)}…` : line;
      page.drawText(chunk, { x: margin, y, size, font: fnt });
      y -= lineH;
      linesUsed += 1;
    }
    return linesUsed;
  };

  page.drawText(`Oliver Roos — Notfall-Tagesplan`, {
    x: margin,
    y,
    size: 14,
    font: fontBold,
  });
  y -= 22;
  page.drawText(`Datum (Europe/Berlin): ${berlinDayYmd}`, {
    x: margin,
    y,
    size: 11,
    font,
  });
  y -= lineH * 2;
  page.drawText(
    `Termine: ${appointments.length}. Druck fuer Strom-/Netzausfall. Vertraulich behandeln.`,
    { x: margin, y, size: 10, font },
  );
  y -= lineH * 2;

  for (const a of appointments) {
    if (y < 120) {
      page = pdf.addPage([pageW, pageH]);
      y = pageH - 48;
    }
    const hm = formatHm(a.startAt);
    const sn = staffName.get(a.staffId) ?? `MA ${a.staffId}`;
    const head = `${hm}  |  ${a.clientName.trim()}  |  ${a.serviceName}`;
    page.drawText(head, { x: margin, y, size: 10, font: fontBold });
    y -= lineH;
    page.drawText(`Mitarbeiter: ${sn}  Status: ${a.status}`, {
      x: margin,
      y,
      size: 9,
      font,
    });
    y -= lineH;
    if (a.clientId != null) {
      const fx = formulasByClient.get(a.clientId);
      if (fx) {
        page.drawText(`Letzte Rezeptur (Auszug):`, {
          x: margin,
          y,
          size: 9,
          font,
        });
        y -= lineH;
        drawWrap(fx.replace(/\s+/g, " ").slice(0, 800), 8, {});
      }
    }
    y -= 6;
  }

  const bytes = await pdf.save();
  return bytes;
}
