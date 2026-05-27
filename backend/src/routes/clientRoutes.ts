import type { Express, Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { requireAdmin } from "../middleware/auth.js";
import { getStaffContext } from "../lib/sessionAuth.js";
import { createAuditLog } from "../lib/audit/logger.js";
import { whereNotDeleted } from "../lib/db/softDelete.js";

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const DEFAULT_ANONYMIZE_REASON =
  "Betroffenenanfrage — Art. 17 DSGVO (Anonymisierung, keine Löschung fiskalischer Belege)";

export function registerClientRoutes(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  app.post(
    "/api/clients/:id/anonymize",
    requireAdmin,
    asyncRoute((req, res) => {
      const id = Number.parseInt(req.params.id ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ error: "bad_id" });
        return;
      }

      const [row] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (row.anonymizedAt != null) {
        res.status(409).json({ error: "already_anonymized" });
        return;
      }

      const body = req.body as { reason?: string } | undefined;
      const reason =
        typeof body?.reason === "string" && body.reason.trim().length > 0
          ? body.reason.trim()
          : DEFAULT_ANONYMIZE_REASON;

      const beforeSnapshot = {
        firstName: row.firstName,
        lastName: row.lastName,
        name: row.name,
        email: row.email,
        phone: row.phone,
        hadPreferences: row.preferences != null && row.preferences.length > 0,
      };

      db.transaction((tx) => {
        tx.delete(schema.clientFormulas)
          .where(eq(schema.clientFormulas.clientId, id))
          .run();
        tx.delete(schema.clientNotes)
          .where(eq(schema.clientNotes.clientId, id))
          .run();
        /** Strip PII from operational rows so search/UI cannot resolve the person by name or phone. */
        tx.update(schema.appointments)
          .set({ clientName: "Anonymisiert", clientPhone: null })
          .where(
            and(
              eq(schema.appointments.clientId, id),
              whereNotDeleted(schema.appointments),
            ),
          )
          .run();
        tx.update(schema.clients)
          .set({
            firstName: "Anonymisiert",
            lastName: "",
            name: "Anonymisiert",
            email: null,
            phone: null,
            street: null,
            houseNumber: null,
            postalCode: null,
            city: null,
            country: null,
            preferences: null,
            patchTestAt: null,
            hospitalityDrink: null,
            hospitalityConversation: null,
            hospitalitySeat: null,
            sessionHandoverNote: null,
            sessionHandoverUpdatedAt: null,
            anonymizedAt: new Date(),
          })
          .where(eq(schema.clients.id, id))
          .run();
      });

      const ctx = getStaffContext(req);
      createAuditLog(db, {
        staffId: ctx.staffId,
        action: "CLIENT_ANONYMIZED",
        entityType: "clients",
        entityId: id,
        reason,
        beforeData: beforeSnapshot,
        afterData: {
          firstName: "Anonymisiert",
          lastName: "",
          name: "Anonymisiert",
          email: null,
          phone: null,
          preferencesCleared: true,
          formulasRemoved: true,
          notesRemoved: true,
        },
      });

      const [updated] = db
        .select()
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
        .all();
      res.json(updated ?? { id });
    }),
  );
}
