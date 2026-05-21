/**
 * onboardingRoutes.ts — First-launch setup + simplified login (no PIN required).
 *
 *  GET  /api/system/setup-status         → public, returns { needsOnboarding, salonName, authMode }
 *  POST /api/system/initial-setup        → public, ONLY works when no staff exists
 *  POST /api/auth/select-staff           → public when authMode='name_select'; PIN-free login
 *  PATCH /api/system/auth-mode           → admin only, switch between 'name_select' | 'pin'
 *  PATCH /api/system/salon-name          → admin only, edit salon name
 *
 *  Owners can later add a PIN via the existing /api/staff/:id/pin endpoint.
 */
import type { Express, Request, Response } from "express";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, count } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { getStaffContext } from "../lib/sessionAuth.js";
import { signAuthToken, getAuthSecret } from "../lib/authToken.js";
import { createAuditLog } from "../lib/audit/logger.js";

const PIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h

type AuthMode = "name_select" | "pin";

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: (e: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function getSetting(
  db: BetterSQLite3Database<typeof schema>,
  key: string,
): string | null {
  const [row] = db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1)
    .all();
  return row?.value ?? null;
}

function setSetting(
  db: BetterSQLite3Database<typeof schema>,
  key: string,
  value: string,
): void {
  // Upsert
  const existing = getSetting(db, key);
  if (existing !== null) {
    db.update(schema.systemSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(schema.systemSettings.key, key))
      .run();
  } else {
    db.insert(schema.systemSettings).values({ key, value }).run();
  }
}

function getAuthMode(db: BetterSQLite3Database<typeof schema>): AuthMode {
  const v = getSetting(db, "auth_mode");
  return v === "pin" ? "pin" : "name_select"; // default name_select
}

function countActiveStaff(db: BetterSQLite3Database<typeof schema>): number {
  const [r] = db
    .select({ c: count() })
    .from(schema.staff)
    .where(eq(schema.staff.active, true))
    .all();
  return r?.c ?? 0;
}

export function registerOnboardingRoutes(
  app: Express,
  db: BetterSQLite3Database<typeof schema>,
): void {
  /* ───────── 1. Setup status (public) ─────────────────────────────── */
  app.get(
    "/api/system/setup-status",
    asyncRoute((_req, res) => {
      const staffCount = countActiveStaff(db);
      const salonName = getSetting(db, "salon_name") ?? "";
      const authMode = getAuthMode(db);
      res.json({
        needsOnboarding: staffCount === 0,
        salonName,
        authMode,
        staffCount,
      });
    }),
  );

  /* ───────── 2. Initial setup (public, idempotent block) ──────────── */
  app.post(
    "/api/system/initial-setup",
    asyncRoute((req, res) => {
      // Hard block: must be a true first-launch (no staff yet).
      if (countActiveStaff(db) > 0) {
        res
          .status(409)
          .json({ error: "already_initialized", message: "Setup wurde bereits abgeschlossen." });
        return;
      }
      const b = req.body as {
        salonName?: string;
        adminName?: string;
        authMode?: AuthMode;
        staff?: { displayName: string; role?: "owner" | "stylist"; pin?: string }[];
      };
      const salonName = String(b.salonName ?? "").trim();
      const adminName = String(b.adminName ?? "").trim();
      if (adminName.length < 1) {
        res.status(400).json({ error: "admin_name_required" });
        return;
      }
      const authMode: AuthMode = b.authMode === "pin" ? "pin" : "name_select";

      // 1. Create admin (owner role)
      const [admin] = db
        .insert(schema.staff)
        .values({
          displayName: adminName,
          role: "owner",
          pinHash: null,
          active: true,
        })
        .returning()
        .all();
      if (!admin) {
        res.status(500).json({ error: "insert_failed" });
        return;
      }

      // 2. Create additional staff if provided
      const extras = (b.staff ?? []).filter(
        (s) => typeof s.displayName === "string" && s.displayName.trim().length > 0,
      );
      const createdStaff: typeof schema.staff.$inferSelect[] = [];
      for (const s of extras) {
        const [row] = db
          .insert(schema.staff)
          .values({
            displayName: s.displayName.trim(),
            role: s.role === "owner" ? "owner" : "stylist",
            pinHash: null,
            active: true,
          })
          .returning()
          .all();
        if (row) createdStaff.push(row);
      }

      // 3. Save settings
      if (salonName) setSetting(db, "salon_name", salonName);
      setSetting(db, "auth_mode", authMode);
      setSetting(db, "onboarding_completed_at", String(Date.now()));

      // 4. Audit
      try {
        createAuditLog(db, {
          staffId: admin.id,
          action: "INITIAL_SETUP_COMPLETED",
          entityType: "system",
          entityId: null,
          afterData: {
            salonName,
            authMode,
            adminId: admin.id,
            extraStaffCount: createdStaff.length,
          },
        });
      } catch {
        /* non-fatal */
      }

      // 5. Auto-login as admin
      const token = signAuthToken(
        { staffId: admin.id, role: admin.role },
        getAuthSecret(),
        PIN_SESSION_TTL_MS,
      );

      res.status(201).json({
        ok: true,
        token,
        staff: {
          id: admin.id,
          displayName: admin.displayName,
          role: admin.role,
        },
        createdStaff: createdStaff.map((s) => ({
          id: s.id,
          displayName: s.displayName,
          role: s.role,
        })),
      });
    }),
  );

  /* ───────── 3. Select-staff login (PIN-free) ─────────────────────── */
  app.post(
    "/api/auth/select-staff",
    asyncRoute((req, res) => {
      const mode = getAuthMode(db);
      if (mode !== "name_select") {
        res.status(403).json({ error: "pin_required", message: "Bitte PIN-Login verwenden." });
        return;
      }
      const b = req.body as { staffId?: number };
      const staffId = Number(b.staffId);
      if (!Number.isFinite(staffId) || staffId < 1) {
        res.status(400).json({ error: "staff_id required" });
        return;
      }
      const [row] = db
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, staffId))
        .limit(1)
        .all();
      if (!row || row.active === false) {
        res.status(401).json({ error: "invalid_staff" });
        return;
      }
      const token = signAuthToken(
        { staffId: row.id, role: row.role },
        getAuthSecret(),
        PIN_SESSION_TTL_MS,
      );
      try {
        createAuditLog(db, {
          staffId: row.id,
          action: "STAFF_SELECT_LOGIN",
          entityType: "auth",
          entityId: row.id,
          afterData: { mode: "name_select" },
        });
      } catch {
        /* ignore */
      }
      res.json({
        token,
        staff: { id: row.id, displayName: row.displayName, role: row.role },
      });
    }),
  );

  /* ───────── 4. Admin-only setting toggles ────────────────────────── */
  app.patch(
    "/api/system/auth-mode",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      if (c.role !== "owner") {
        res.status(403).json({ error: "owner_required" });
        return;
      }
      const b = req.body as { authMode?: AuthMode };
      const m: AuthMode = b.authMode === "pin" ? "pin" : "name_select";
      setSetting(db, "auth_mode", m);
      res.json({ ok: true, authMode: m });
    }),
  );

  app.patch(
    "/api/system/salon-name",
    asyncRoute((req, res) => {
      const c = getStaffContext(req);
      if (c.role !== "owner") {
        res.status(403).json({ error: "owner_required" });
        return;
      }
      const b = req.body as { salonName?: string };
      const v = String(b.salonName ?? "").trim();
      setSetting(db, "salon_name", v);
      res.json({ ok: true, salonName: v });
    }),
  );
}
