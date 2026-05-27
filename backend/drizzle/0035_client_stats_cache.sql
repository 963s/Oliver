-- 0035 — Denormalized cache for Client 360° header (Phase 4).
-- SQLite has no materialized views; this table is refreshed by
-- `clientStatsService` after session close, appointment status change,
-- debt settlement, and once at app startup.
--
-- Also adds three composite indexes for the read-paths that scan
-- appointments + sessions when computing the cache.

CREATE TABLE IF NOT EXISTS `client_stats_cache` (
  `client_id` integer PRIMARY KEY NOT NULL,
  `total_visits` integer NOT NULL DEFAULT 0,
  `total_spent_cents` integer NOT NULL DEFAULT 0,
  `avg_visit_cents` integer NOT NULL DEFAULT 0,
  `first_visit_at` integer,
  `last_visit_at` integer,
  `days_since_last_visit` integer,
  `no_show_count` integer NOT NULL DEFAULT 0,
  `cancel_count` integer NOT NULL DEFAULT 0,
  `reliability_score` integer NOT NULL DEFAULT 100,
  `updated_at` integer NOT NULL DEFAULT (cast(unixepoch() * 1000 as integer)),
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `appointments_client_status_idx`
  ON `appointments` (`client_id`, `status`) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `appointments_staff_date_status_idx`
  ON `appointments` (`staff_id`, `start_at`, `status`) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_client_closed_idx`
  ON `sessions` (`client_id`, `closed_at` DESC) WHERE `status` = 'closed';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `client_formulas_client_recent_idx`
  ON `client_formulas` (`client_id`, `created_at` DESC);
