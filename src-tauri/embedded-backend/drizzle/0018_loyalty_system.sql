-- §12.5.31 — Digital loyalty / stamp card.
CREATE TABLE `client_loyalty` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_id` integer NOT NULL REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
  `points_balance` integer NOT NULL DEFAULT 0,
  `stamps_count` integer NOT NULL DEFAULT 0,
  `lifetime_points` integer NOT NULL DEFAULT 0,
  `last_reward_at` integer,
  `updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_loyalty_client_uq` ON `client_loyalty` (`client_id`);
