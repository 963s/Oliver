import type { Express, Request, Response } from "express";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { getStaffContext } from "../lib/sessionAuth.js";
import { createAuditLog } from "../lib/audit/logger.js";
import { whereNotDeleted } from "../lib/db/softDelete.js";
import { computeReliabilityScore } from "../lib/clientCrm.js";
import { logger } from "../lib/logger.js";

/**
 * §12 — Client 360° intelligence API.
 *
 * All endpoints require an authenticated staff context (Bearer token resolved
 * by `registerAuthGuard` upstream; `getStaffContext` throws 401 otherwise).
 *
 * Soft-delete: only `appointments` carries `deletedAt` today. Hair profiles,
 * visit records, preferences and tags are hard-rows (one-per-key, replaced
 * via upsert); auditing flows through `createAuditLog` on every write.
 */

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function parseClientId(req: Request): number | null {
  const id = Number.parseInt(req.params.id ?? "", 10);
  if (!Number.isFinite(id) || id < 1) return null;
  return id;
}

function clientExists(
  db: BetterSQLite3Database<typeof schema>,
  id: number,
): boolean {
  const row = db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.id, id))
    .limit(1)
    .all();
  return row.length > 0;
}

function todayMmDd(): string {
  const d = new Date();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

function isoYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function registerClient360Routes(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  /* ────────────────────────────────────────────────────────────────────────
   *  GET /api/clients/:id/360 — full intelligence object
   * ──────────────────────────────────────────────────────────────────────── */
  app.get(
    "/api/clients/:id/360",
    asyncRoute((req, res) => {
      getStaffContext(req); // auth gate
      const id = parseClientId(req);
      if (id === null) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const [client] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      if (!client) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      const [hairProfile] = db
        .select()
        .from(schema.clientHairProfiles)
        .where(eq(schema.clientHairProfiles.clientId, id))
        .limit(1)
        .all();

      const recentVisits = db
        .select()
        .from(schema.clientVisitRecords)
        .where(eq(schema.clientVisitRecords.clientId, id))
        .orderBy(desc(schema.clientVisitRecords.visitDate))
        .limit(10)
        .all();

      const formulas = db
        .select()
        .from(schema.clientFormulas)
        .where(eq(schema.clientFormulas.clientId, id))
        .orderBy(desc(schema.clientFormulas.createdAt))
        .limit(5)
        .all();

      const notes = db
        .select()
        .from(schema.clientNotes)
        .where(eq(schema.clientNotes.clientId, id))
        .orderBy(desc(schema.clientNotes.createdAt))
        .all();

      const tags = db
        .select()
        .from(schema.clientTags)
        .where(eq(schema.clientTags.clientId, id))
        .all();

      const preferences = db
        .select()
        .from(schema.clientPreferences)
        .where(eq(schema.clientPreferences.clientId, id))
        .all();

      const [loyalty] = db
        .select()
        .from(schema.clientLoyalty)
        .where(eq(schema.clientLoyalty.clientId, id))
        .limit(1)
        .all();

      const debts = db
        .select()
        .from(schema.clientDebts)
        .where(
          and(
            eq(schema.clientDebts.clientId, id),
            eq(schema.clientDebts.status, "open"),
          ),
        )
        .all();

      const upcomingAppointments = db
        .select()
        .from(schema.appointments)
        .where(
          and(
            eq(schema.appointments.clientId, id),
            gte(schema.appointments.startAt, new Date()),
            whereNotDeleted(schema.appointments),
          ),
        )
        .orderBy(schema.appointments.startAt)
        .limit(10)
        .all();

      // Stats — see also Phase 4 cache; this is the canonical read.
      const allAppointments = db
        .select()
        .from(schema.appointments)
        .where(
          and(
            eq(schema.appointments.clientId, id),
            whereNotDeleted(schema.appointments),
          ),
        )
        .all();
      const completedSessions = db
        .select()
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.clientId, id),
            eq(schema.sessions.status, "closed"),
          ),
        )
        .all();
      const totalVisits = completedSessions.length;
      const lastVisitMs = completedSessions
        .map((s) => s.closedAt?.getTime() ?? 0)
        .reduce((a, b) => Math.max(a, b), 0);
      const daysSinceLastVisit =
        lastVisitMs > 0
          ? Math.floor((Date.now() - lastVisitMs) / (24 * 3600 * 1000))
          : null;

      const invoices = db
        .select({
          sessionId: schema.invoices.sessionId,
          total: schema.invoices.totalAmountCents,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.status, "closed"))
        .all();
      const sessionToInvoiceCents = new Map<number, number>();
      for (const inv of invoices) {
        sessionToInvoiceCents.set(
          inv.sessionId,
          (sessionToInvoiceCents.get(inv.sessionId) ?? 0) + (inv.total ?? 0),
        );
      }
      let totalSpentCents = 0;
      for (const s of completedSessions) {
        totalSpentCents += sessionToInvoiceCents.get(s.id) ?? 0;
      }
      const avgVisitCents =
        totalVisits > 0 ? Math.round(totalSpentCents / totalVisits) : 0;
      const noShowRate =
        allAppointments.length > 0
          ? (client.noShowTotal ?? 0) / allAppointments.length
          : 0;
      const reliabilityScore = computeReliabilityScore({
        noShows: client.noShowTotal ?? 0,
        cancels: client.cancelTotal ?? 0,
        completed: totalVisits,
      });

      res.json({
        client,
        hairProfile: hairProfile ?? null,
        recentVisits,
        formulas,
        notes,
        tags,
        preferences,
        loyalty: loyalty ?? null,
        debts,
        upcomingAppointments,
        stats: {
          totalVisits,
          totalSpentCents,
          avgVisitCents,
          reliabilityScore,
          noShowRate,
          daysSinceLastVisit,
          lifetimeStamps: loyalty?.stampsCount ?? 0,
        },
      });
    }),
  );

  /* ────────────────────────────────────────────────────────────────────────
   *  GET /api/clients/birthday-today
   *  — clients whose `system/dob` preference is set with a matching MM-DD
   * ──────────────────────────────────────────────────────────────────────── */
  app.get(
    "/api/clients/birthday-today",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const today = todayMmDd();
      const dobRows = db
        .select({
          clientId: schema.clientPreferences.clientId,
          prefValue: schema.clientPreferences.prefValue,
        })
        .from(schema.clientPreferences)
        .where(
          and(
            eq(schema.clientPreferences.category, "system"),
            eq(schema.clientPreferences.prefKey, "dob"),
          ),
        )
        .all();
      const matchingIds: number[] = [];
      for (const r of dobRows) {
        try {
          /** prefValue is JSON-encoded; expected shape: a string like "1990-05-27". */
          const dob = JSON.parse(r.prefValue) as unknown;
          const dobStr = typeof dob === "string" ? dob : "";
          if (dobStr.length >= 10 && dobStr.slice(5, 10) === today) {
            matchingIds.push(r.clientId);
          }
        } catch {
          /* skip malformed JSON — caller is responsible for the contract */
        }
      }
      if (matchingIds.length === 0) {
        res.json({ clients: [] });
        return;
      }
      const clients = db
        .select()
        .from(schema.clients)
        .where(
          or(
            ...matchingIds.map((id) => eq(schema.clients.id, id)),
          ),
        )
        .all();
      res.json({ clients });
    }),
  );

  /* ────────────────────────────────────────────────────────────────────────
   *  GET /api/clients/at-risk
   *  — clients with >90 days since last closed session AND >3 past sessions
   * ──────────────────────────────────────────────────────────────────────── */
  app.get(
    "/api/clients/at-risk",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000);
      // Group sessions by client_id manually (better-sqlite3 + Drizzle supports raw SQL aggregates,
      // but readability wins here for a salon-scale dataset).
      const sessions = db
        .select({
          clientId: schema.sessions.clientId,
          closedAt: schema.sessions.closedAt,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.status, "closed"))
        .all();
      const byClient = new Map<number, { count: number; lastAt: number }>();
      for (const s of sessions) {
        if (s.clientId == null) continue;
        const existing = byClient.get(s.clientId) ?? { count: 0, lastAt: 0 };
        existing.count += 1;
        const t = s.closedAt?.getTime() ?? 0;
        if (t > existing.lastAt) existing.lastAt = t;
        byClient.set(s.clientId, existing);
      }
      const atRiskIds: number[] = [];
      for (const [cid, agg] of byClient) {
        if (agg.count > 3 && agg.lastAt > 0 && agg.lastAt < cutoff.getTime()) {
          atRiskIds.push(cid);
        }
      }
      if (atRiskIds.length === 0) {
        res.json({ clients: [] });
        return;
      }
      const clients = db
        .select()
        .from(schema.clients)
        .where(or(...atRiskIds.map((id) => eq(schema.clients.id, id))))
        .all();
      const enriched = clients.map((c) => {
        const agg = byClient.get(c.id)!;
        return {
          ...c,
          totalVisits: agg.count,
          daysSinceLastVisit: Math.floor(
            (Date.now() - agg.lastAt) / (24 * 3600 * 1000),
          ),
        };
      });
      res.json({ clients: enriched });
    }),
  );

  /* ────────────────────────────────────────────────────────────────────────
   *  Hair profile — upsert (POST or PATCH, both treated the same)
   * ──────────────────────────────────────────────────────────────────────── */
  const hairProfileFields = [
    "naturalColor",
    "currentColor",
    "hairTexture",
    "hairCondition",
    "scalpCondition",
    "lastBleachAt",
    "lastPermAt",
    "lastRelaxerAt",
    "knownAllergies",
    "patchTestResult",
    "patchTestNotes",
    "preferredStyle",
    "preferredLength",
  ] as const;

  function upsertHairProfile(req: Request, res: Response): void {
    const ctx = getStaffContext(req);
    const id = parseClientId(req);
    if (id === null) {
      res.status(400).json({ error: "bad_id" });
      return;
    }
    if (!clientExists(db, id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const f of hairProfileFields) {
      if (f in body) {
        const v = body[f];
        if (f === "lastBleachAt" || f === "lastPermAt" || f === "lastRelaxerAt") {
          next[f] = v == null ? null : new Date(Number(v));
        } else {
          next[f] = v == null ? null : String(v);
        }
      }
    }
    if (Object.keys(next).length === 0) {
      res.status(400).json({ error: "empty_payload" });
      return;
    }
    const now = new Date();
    next.updatedAt = now;
    next.updatedByStaffId = ctx.staffId;

    const [existing] = db
      .select()
      .from(schema.clientHairProfiles)
      .where(eq(schema.clientHairProfiles.clientId, id))
      .limit(1)
      .all();

    if (existing) {
      db.update(schema.clientHairProfiles)
        .set(next)
        .where(eq(schema.clientHairProfiles.clientId, id))
        .run();
    } else {
      db.insert(schema.clientHairProfiles)
        .values({ clientId: id, ...next })
        .run();
    }

    const [after] = db
      .select()
      .from(schema.clientHairProfiles)
      .where(eq(schema.clientHairProfiles.clientId, id))
      .limit(1)
      .all();

    createAuditLog(db, {
      staffId: ctx.staffId,
      action: "CLIENT_HAIR_PROFILE_UPDATED",
      entityType: "client_hair_profiles",
      entityId: after?.id ?? null,
      beforeData: existing ?? null,
      afterData: after ?? null,
    });

    res.json(after);
  }

  app.post("/api/clients/:id/hair-profile", asyncRoute(upsertHairProfile));
  app.patch("/api/clients/:id/hair-profile", asyncRoute(upsertHairProfile));

  /* ────────────────────────────────────────────────────────────────────────
   *  Visit records — create + paginated list
   * ──────────────────────────────────────────────────────────────────────── */
  app.post(
    "/api/clients/:id/visit-records",
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const id = parseClientId(req);
      if (id === null) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      if (!clientExists(db, id)) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const b = (req.body ?? {}) as Record<string, unknown>;
      const visitDate = String(b.visitDate ?? isoYmd(new Date()));
      const inserted = db
        .insert(schema.clientVisitRecords)
        .values({
          clientId: id,
          sessionId: b.sessionId == null ? null : Number(b.sessionId),
          appointmentId:
            b.appointmentId == null ? null : Number(b.appointmentId),
          staffId: Number(b.staffId ?? ctx.staffId),
          visitDate,
          servicesPerformed:
            b.servicesPerformed == null
              ? null
              : typeof b.servicesPerformed === "string"
                ? b.servicesPerformed
                : JSON.stringify(b.servicesPerformed),
          formulaUsed: b.formulaUsed == null ? null : String(b.formulaUsed),
          formulaId: b.formulaId == null ? null : Number(b.formulaId),
          resultNotes: b.resultNotes == null ? null : String(b.resultNotes),
          clientSatisfaction:
            b.clientSatisfaction == null
              ? null
              : Math.max(1, Math.min(5, Number(b.clientSatisfaction))),
          recommendedNextVisitWeeks:
            b.recommendedNextVisitWeeks == null
              ? null
              : Number(b.recommendedNextVisitWeeks),
          nextTreatmentNotes:
            b.nextTreatmentNotes == null ? null : String(b.nextTreatmentNotes),
          totalPaidCents:
            b.totalPaidCents == null ? null : Number(b.totalPaidCents),
          tipCents: b.tipCents == null ? null : Number(b.tipCents),
          paymentMethod:
            b.paymentMethod == null ? null : String(b.paymentMethod),
        })
        .returning()
        .all();
      const row = inserted[0];
      createAuditLog(db, {
        staffId: ctx.staffId,
        action: "CLIENT_VISIT_RECORD_CREATED",
        entityType: "client_visit_records",
        entityId: row?.id ?? null,
        afterData: row,
      });
      res.json(row);
    }),
  );

  app.get(
    "/api/clients/:id/visit-records",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const id = parseClientId(req);
      if (id === null) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
      const offset = Math.max(0, Number(req.query.offset ?? 0));
      const rows = db
        .select()
        .from(schema.clientVisitRecords)
        .where(eq(schema.clientVisitRecords.clientId, id))
        .orderBy(desc(schema.clientVisitRecords.visitDate))
        .limit(limit)
        .offset(offset)
        .all();
      const [count] = db
        .select({ n: sql<number>`count(*)` })
        .from(schema.clientVisitRecords)
        .where(eq(schema.clientVisitRecords.clientId, id))
        .all();
      res.json({ rows, total: count?.n ?? 0, limit, offset });
    }),
  );

  /* ────────────────────────────────────────────────────────────────────────
   *  Tags — add / remove (UNIQUE(client_id, tag) prevents dups)
   * ──────────────────────────────────────────────────────────────────────── */
  app.post(
    "/api/clients/:id/tags",
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const id = parseClientId(req);
      if (id === null) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      if (!clientExists(db, id)) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const b = (req.body ?? {}) as { tag?: unknown; note?: unknown };
      const tag = typeof b.tag === "string" ? b.tag.trim() : "";
      if (!tag || tag.length > 64) {
        res.status(400).json({ error: "bad_tag" });
        return;
      }
      const note =
        typeof b.note === "string" && b.note.length > 0 ? b.note : null;

      // Race-safe upsert: try insert, fall back to update on UNIQUE collision.
      try {
        db.insert(schema.clientTags)
          .values({
            clientId: id,
            tag,
            setByStaffId: ctx.staffId,
            note,
          })
          .run();
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? "";
        if (!msg.includes("UNIQUE")) throw err;
        db.update(schema.clientTags)
          .set({ note, setByStaffId: ctx.staffId })
          .where(
            and(
              eq(schema.clientTags.clientId, id),
              eq(schema.clientTags.tag, tag),
            ),
          )
          .run();
      }

      const [row] = db
        .select()
        .from(schema.clientTags)
        .where(
          and(
            eq(schema.clientTags.clientId, id),
            eq(schema.clientTags.tag, tag),
          ),
        )
        .limit(1)
        .all();
      createAuditLog(db, {
        staffId: ctx.staffId,
        action: "CLIENT_TAG_SET",
        entityType: "client_tags",
        entityId: row?.id ?? null,
        afterData: row,
      });
      res.json(row);
    }),
  );

  app.delete(
    "/api/clients/:id/tags/:tag",
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const id = parseClientId(req);
      if (id === null) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const tag = String(req.params.tag ?? "").trim();
      if (!tag) {
        res.status(400).json({ error: "bad_tag" });
        return;
      }
      const [existing] = db
        .select()
        .from(schema.clientTags)
        .where(
          and(
            eq(schema.clientTags.clientId, id),
            eq(schema.clientTags.tag, tag),
          ),
        )
        .limit(1)
        .all();
      db.delete(schema.clientTags)
        .where(
          and(
            eq(schema.clientTags.clientId, id),
            eq(schema.clientTags.tag, tag),
          ),
        )
        .run();
      createAuditLog(db, {
        staffId: ctx.staffId,
        action: "CLIENT_TAG_REMOVED",
        entityType: "client_tags",
        entityId: existing?.id ?? null,
        beforeData: existing ?? null,
      });
      res.json({ ok: true });
    }),
  );

  /* ────────────────────────────────────────────────────────────────────────
   *  Preferences — list + upsert (UNIQUE(client_id, category, pref_key))
   * ──────────────────────────────────────────────────────────────────────── */
  app.get(
    "/api/clients/:id/preferences",
    asyncRoute((req, res) => {
      getStaffContext(req);
      const id = parseClientId(req);
      if (id === null) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      const rows = db
        .select()
        .from(schema.clientPreferences)
        .where(eq(schema.clientPreferences.clientId, id))
        .all();
      res.json({ rows });
    }),
  );

  app.post(
    "/api/clients/:id/preferences",
    asyncRoute((req, res) => {
      const ctx = getStaffContext(req);
      const id = parseClientId(req);
      if (id === null) {
        res.status(400).json({ error: "bad_id" });
        return;
      }
      if (!clientExists(db, id)) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const b = (req.body ?? {}) as {
        category?: unknown;
        pref_key?: unknown;
        prefKey?: unknown;
        pref_value?: unknown;
        prefValue?: unknown;
      };
      const category = typeof b.category === "string" ? b.category.trim() : "";
      const prefKey =
        typeof b.pref_key === "string"
          ? b.pref_key.trim()
          : typeof b.prefKey === "string"
            ? b.prefKey.trim()
            : "";
      const valueRaw = b.pref_value ?? b.prefValue;
      if (!category || !prefKey || valueRaw === undefined) {
        res.status(400).json({ error: "missing_fields" });
        return;
      }
      const prefValue =
        typeof valueRaw === "string" ? valueRaw : JSON.stringify(valueRaw);

      const [existing] = db
        .select()
        .from(schema.clientPreferences)
        .where(
          and(
            eq(schema.clientPreferences.clientId, id),
            eq(schema.clientPreferences.category, category),
            eq(schema.clientPreferences.prefKey, prefKey),
          ),
        )
        .limit(1)
        .all();
      const now = new Date();
      if (existing) {
        db.update(schema.clientPreferences)
          .set({
            prefValue,
            setByStaffId: ctx.staffId,
            updatedAt: now,
          })
          .where(eq(schema.clientPreferences.id, existing.id))
          .run();
      } else {
        db.insert(schema.clientPreferences)
          .values({
            clientId: id,
            category,
            prefKey,
            prefValue,
            setByStaffId: ctx.staffId,
          })
          .run();
      }
      const [after] = db
        .select()
        .from(schema.clientPreferences)
        .where(
          and(
            eq(schema.clientPreferences.clientId, id),
            eq(schema.clientPreferences.category, category),
            eq(schema.clientPreferences.prefKey, prefKey),
          ),
        )
        .limit(1)
        .all();
      createAuditLog(db, {
        staffId: ctx.staffId,
        action: existing ? "CLIENT_PREF_UPDATED" : "CLIENT_PREF_CREATED",
        entityType: "client_preferences",
        entityId: after?.id ?? null,
        beforeData: existing ?? null,
        afterData: after ?? null,
      });
      res.json(after);
    }),
  );

  logger.info("client360_routes_registered");
}
