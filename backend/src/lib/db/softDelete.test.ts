import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql, and, eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { softDelete, whereNotDeleted } from "./softDelete.js";

/**
 * Tiny in-memory schema mirroring the GoBD soft-delete contract:
 *   - one soft-deletable domain table ("widgets")
 *   - the live `audit_logs` table from production schema (column names matched
 *     so writeAudit's insert works without modification)
 */
const widgets = sqliteTable("widgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  action: text("action").notNull(),
  beforeStateJson: text("before_state_json"),
  afterStateJson: text("after_state_json"),
  payloadJson: text("payload_json"),
  reason: text("reason"),
  staffId: integer("staff_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(cast(unixepoch() * 1000 as integer))`),
});

function openTestDb(): BetterSQLite3Database<Record<string, unknown>> {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE widgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      action TEXT NOT NULL,
      before_state_json TEXT,
      after_state_json TEXT,
      payload_json TEXT,
      reason TEXT,
      staff_id INTEGER,
      created_at INTEGER NOT NULL DEFAULT (cast(unixepoch() * 1000 as integer))
    );
  `);
  return drizzle(sqlite) as unknown as BetterSQLite3Database<Record<string, unknown>>;
}

function insertWidget(
  db: BetterSQLite3Database<Record<string, unknown>>,
  name: string,
  deletedAt: Date | null = null,
): number {
  const now = new Date();
  const result = db.insert(widgets).values({ name, updatedAt: now, deletedAt }).run();
  return Number(result.lastInsertRowid);
}

describe("whereNotDeleted", () => {
  it("excludes rows where deletedAt is set", () => {
    const db = openTestDb();
    insertWidget(db, "alive-1");
    const tombstoned = insertWidget(db, "tombstoned", new Date());
    insertWidget(db, "alive-2");

    const rows = db.select().from(widgets).where(whereNotDeleted(widgets)).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["alive-1", "alive-2"]);
    expect(rows.find((r) => r.id === tombstoned)).toBeUndefined();
  });

  it("includes rows where deletedAt is null", () => {
    const db = openTestDb();
    insertWidget(db, "alive");
    const rows = db.select().from(widgets).where(whereNotDeleted(widgets)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeNull();
  });

  it("composes with other predicates via and()", () => {
    const db = openTestDb();
    const liveId = insertWidget(db, "live-target");
    insertWidget(db, "live-target", new Date());

    const rows = db
      .select()
      .from(widgets)
      .where(and(eq(widgets.name, "live-target"), whereNotDeleted(widgets)))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(liveId);
  });
});

describe("softDelete", () => {
  // The helper imports `writeAudit` from production code, which inserts into
  // schema.auditLogs (typed against the real schema). At runtime Drizzle only
  // needs the table name to match, so our in-memory `audit_logs` table picks
  // up the insert. We cast the test db to the writeAudit-expected signature.
  type AnyDb = BetterSQLite3Database<Record<string, unknown>>;

  it("sets deletedAt to a recent timestamp", () => {
    const db = openTestDb();
    const id = insertWidget(db, "to-delete");

    const before = Date.now() - 100;
    const result = softDelete(db as AnyDb as never, widgets, id, {
      entityName: "widgets",
      auditAction: "widget_soft_delete",
      staffId: 7,
      reason: "test",
    });
    const after = Date.now() + 100;

    expect(result.ok).toBe(true);
    expect(result.before?.deletedAt).toBeNull();
    expect(result.after?.deletedAt).toBeInstanceOf(Date);
    const ts = (result.after?.deletedAt as Date).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("excludes the row from whereNotDeleted listings after deletion", () => {
    const db = openTestDb();
    const id = insertWidget(db, "doomed");
    insertWidget(db, "survivor");

    softDelete(db as AnyDb as never, widgets, id, {
      entityName: "widgets",
      auditAction: "widget_soft_delete",
      staffId: null,
      reason: "test",
    });

    const visible = db.select().from(widgets).where(whereNotDeleted(widgets)).all();
    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe("survivor");
  });

  it("writes a paired audit log with before/after snapshots", () => {
    const db = openTestDb();
    const id = insertWidget(db, "audited");

    softDelete(db as AnyDb as never, widgets, id, {
      entityName: "widgets",
      auditAction: "widget_soft_delete",
      staffId: 42,
      reason: "GoBD test reason",
    });

    const logs = db.select().from(auditLogs).all();
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.entity).toBe("widgets");
    expect(log.entityId).toBe(id);
    expect(log.action).toBe("widget_soft_delete");
    expect(log.staffId).toBe(42);
    expect(log.reason).toBe("GoBD test reason");
    const beforeSnap = JSON.parse(log.beforeStateJson as string);
    const afterSnap = JSON.parse(log.afterStateJson as string);
    expect(beforeSnap.deletedAt).toBeNull();
    expect(afterSnap.deletedAt).not.toBeNull();
  });

  it("returns ok=false when the row does not exist", () => {
    const db = openTestDb();
    const result = softDelete(db as AnyDb as never, widgets, 9999, {
      entityName: "widgets",
      auditAction: "widget_soft_delete",
      staffId: null,
      reason: "test",
    });
    expect(result.ok).toBe(false);
    expect(result.before).toBeNull();
    expect(result.after).toBeNull();
    const logs = db.select().from(auditLogs).all();
    expect(logs).toHaveLength(0);
  });

  it("returns ok=false when the row is already soft-deleted", () => {
    const db = openTestDb();
    const id = insertWidget(db, "already-gone", new Date());
    const result = softDelete(db as AnyDb as never, widgets, id, {
      entityName: "widgets",
      auditAction: "widget_soft_delete",
      staffId: null,
      reason: "test",
    });
    expect(result.ok).toBe(false);
    const logs = db.select().from(auditLogs).all();
    expect(logs).toHaveLength(0);
  });

  it("applies a custom snapshot function to before/after audit payloads", () => {
    const db = openTestDb();
    const id = insertWidget(db, "snapshot-target");

    softDelete(db as AnyDb as never, widgets, id, {
      entityName: "widgets",
      auditAction: "widget_soft_delete",
      staffId: null,
      reason: "test",
      snapshot: (row) => ({ snapshottedName: (row as { name: string }).name }),
    });

    const [log] = db.select().from(auditLogs).all();
    const beforeSnap = JSON.parse(log.beforeStateJson as string);
    expect(beforeSnap).toEqual({ snapshottedName: "snapshot-target" });
  });
});
