-- §36 GoBD — soft-delete visibility (Änderungshistorie / no hard delete from POS).
ALTER TABLE appointments ADD COLUMN deleted_at INTEGER;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS appointments_deleted_at_idx ON appointments(deleted_at);
